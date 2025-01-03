import { writable } from "svelte/store";
import { filteredCamps } from "../server/campStore.js";

export const currentLocation = writable(null);
export const locationError = writable(null);

let pollInterval;
let lastSystemId = null;

const POLL_INTERVAL = 20000; // 20 seconds

async function refreshToken(refreshToken) {
  try {
    const response = await fetch("/api/refresh-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) throw new Error("Failed to refresh token");
    return await response.json();
  } catch (err) {
    console.error("Token refresh failed:", err);
    throw err;
  }
}

async function checkForGateCamps(systemId, celestialData) {
  let camps = [];
  const unsubscribe = filteredCamps.subscribe((value) => (camps = value));

  try {
    // Extract stargates from celestial data
    const stargates = celestialData
      .filter((cel) => cel.typename?.includes("Stargate"))
      .map((gate) => ({
        destination: {
          system_name: gate.itemname.match(/\(([^)]+)\)/)[1],
          system_id: gate.destinationid,
        },
      }));

    console.log("Found stargates:", stargates);

    // Current system camps
    const currentSystemCamps = camps.filter(
      (camp) => camp.systemId === systemId
    );

    // Connected system camps
    const connectedCamps = camps.filter((camp) => {
      const campSystem =
        camp.kills[0]?.pinpoints?.celestialData?.solarsystemname;

      // Check if this camp's system matches any of our stargate destinations
      const isConnected = stargates.some((gate) => {
        const matches =
          campSystem?.toLowerCase() ===
          gate.destination.system_name.toLowerCase();
        console.log("Checking system connection:", {
          gateDestination: gate.destination.system_name.toLowerCase(),
          campSystem: campSystem?.toLowerCase(),
          matches,
        });
        return matches;
      });

      return isConnected;
    });

    console.log("Connected camps found:", connectedCamps);

    return {
      current: currentSystemCamps,
      connected: connectedCamps,
    };
  } finally {
    unsubscribe();
  }
}

async function pollLocation() {
  try {
    const userData = JSON.parse(sessionStorage.getItem("user"));
    console.log("Starting location poll...");

    // Check if token needs refresh
    const now = Math.floor(Date.now() / 1000);
    if (userData.token_expiry && now >= userData.token_expiry) {
      console.log("Token expired, refreshing...");
      const newTokens = await refreshToken(userData.refresh_token);

      // Update user data with new tokens
      userData.access_token = newTokens.access_token;
      userData.refresh_token = newTokens.refresh_token;
      userData.token_expiry = now + newTokens.expires_in;

      // Save updated tokens
      sessionStorage.setItem("user", JSON.stringify(userData));
    }

    let response = await fetch(
      `https://esi.evetech.net/latest/characters/${userData.character_id}/location/`,
      {
        headers: {
          Authorization: `Bearer ${userData.access_token}`,
        },
      }
    );

    const locationData = await response.json();
    console.log(
      "Current system:",
      locationData.solar_system_id,
      "Last system:",
      lastSystemId
    );

    if (locationData.solar_system_id !== lastSystemId) {
      console.log("System change detected!");
      const systemResponse = await fetch(
        `/api/celestials/system/${locationData.solar_system_id}`
      );
      if (!systemResponse.ok) throw new Error("Failed to fetch system data");

      const celestialData = await systemResponse.json();
      const systemName = celestialData[0]?.solarsystemname || "Unknown System";
      const camps = await checkForGateCamps(
        locationData.solar_system_id,
        celestialData
      );

      // Only create announcement if there are camps
      if (camps.current.length > 0 || camps.connected.length > 0) {
        let campStatus = "";
        if (camps.current.length > 0) {
          campStatus = `Camp detected at: ${camps.current
            .map((c) => c.stargateName)
            .join(", ")}`;
        } else if (camps.connected.length > 0) {
          const connectedCampInfo = camps.connected
            .map((camp) => {
              const systemName =
                camp.kills[0]?.pinpoints?.celestialData?.solarsystemname;
              // Extract just the destination name from "Stargate (Destination)"
              const gateName =
                camp.stargateName.match(/\(([^)]+)\)/)?.[1] ||
                camp.stargateName;
              return systemName
                ? `${systemName} (${gateName} gate, ${Math.round(
                    camp.probability
                  )}% confidence)`
                : null;
            })
            .filter(Boolean);
          campStatus = `Active camps in connected systems: ${connectedCampInfo.join(
            ", "
          )}`;
        }

        // Only speak if we have a camp status
        if (campStatus) {
          const announcement = `System change. Your current system is ${systemName}. ${campStatus}`;
          console.log("About to speak:", announcement);

          setTimeout(() => {
            console.log("Attempting speech...");
            window.speechSynthesis.cancel();
            const msg = new SpeechSynthesisUtterance(announcement);
            window.speechSynthesis.speak(msg);
            console.log("Speech attempt completed");
          }, 100);
        }
      }

      currentLocation.set({
        solar_system_id: locationData.solar_system_id,
        systemName,
        camps,
      });

      lastSystemId = locationData.solar_system_id;
    }
  } catch (err) {
    console.error("Location polling error:", err);
    locationError.set(err.message);
    stopLocationPolling();
  }
}

export async function startLocationPolling() {
  try {
    const sessionResponse = await fetch("/api/session", {
      credentials: "include",
    });
    if (!sessionResponse.ok) {
      throw new Error("Session verification failed");
    }

    const { user } = await sessionResponse.json();
    if (!user?.character_id || !user?.access_token) {
      throw new Error(
        "No authenticated character - Please log in with EVE Online"
      );
    }

    sessionStorage.setItem("user", JSON.stringify(user));

    // Initial poll and announcement
    await pollLocation();
    if (currentLocation) {
      const msg = new SpeechSynthesisUtterance(
        `Tracking enabled for: ${user.character_name}. Your current system is ${currentLocation.systemName}.`
      );
      window.speechSynthesis.speak(msg);
    }

    pollInterval = setInterval(pollLocation, POLL_INTERVAL);
    return true;
  } catch (err) {
    locationError.set(err.message);
    return false;
  }
}

export function stopLocationPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  currentLocation.set(null);
  lastSystemId = null;
}
