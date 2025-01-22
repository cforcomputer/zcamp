import { writable } from "svelte/store";
import socket from "./socket.js";

export const currentLocation = writable(null);
export const locationError = writable(null);

let pollInterval;
let lastSystemId = null;

const POLL_INTERVAL = 20000; // 20 seconds

async function refreshToken(refreshToken) {
  try {
    console.log("Attempting to refresh token");
    const response = await fetch("/api/refresh-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) throw new Error("Failed to refresh token");
    const data = await response.json();
    console.log("Token refresh successful");
    return data;
  } catch (err) {
    console.error("Token refresh failed:", err);
    throw err;
  }
}

async function checkForGateCamps(systemId, celestialData) {
  try {
    // Add error handling for celestial data
    if (!celestialData || !Array.isArray(celestialData)) {
      console.error("Invalid celestial data:", celestialData);
      return { current: [], connected: [] };
    }
    // Request active camps from the server
    const camps = await new Promise((resolve) => {
      socket.emit("requestCamps", (response) => {
        resolve(response);
      });
    });

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
  } catch (error) {
    console.error("Error checking for gate camps:", error);
    return { current: [], connected: [] }; // Return empty arrays on error
  }
}

async function pollLocation() {
  try {
    // Get current session data
    const sessionResponse = await fetch("/api/session", {
      credentials: "include",
    });

    if (!sessionResponse.ok) {
      throw new Error("Failed to get session data");
    }

    const { user } = await sessionResponse.json();
    console.log("Starting location poll...");

    // Check if token needs refresh
    const now = Math.floor(Date.now() / 1000);
    if (user.token_expiry && now >= user.token_expiry) {
      console.log("Token expired, refreshing...");
      let retryCount = 3;
      while (retryCount > 0) {
        try {
          const refreshResponse = await refreshToken(user.refresh_token);
          user.access_token = refreshResponse.access_token;
          user.token_expiry = refreshResponse.token_expiry;
          console.log("Token refreshed successfully");
          break;
        } catch (refreshError) {
          console.error(
            `Token refresh attempt failed (${retryCount} remaining):`,
            refreshError
          );
          retryCount--;
          if (retryCount === 0)
            throw new Error("Failed to refresh token after multiple attempts");
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    let response = await fetch(
      `https://esi.evetech.net/latest/characters/${user.character_id}/location/`,
      {
        headers: {
          Authorization: `Bearer ${user.access_token}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`EVE API request failed: ${response.status}`);
    }

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
    if (err.message.includes("token")) {
      // Don't stop polling on token errors, just skip this cycle
      return;
    }
    stopLocationPolling();
  }
}

export async function startLocationPolling() {
  try {
    console.log("Starting location polling...");
    const sessionResponse = await fetch("/api/session", {
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
    console.log("Session response status:", sessionResponse.status);

    if (!sessionResponse.ok) {
      const errorData = await sessionResponse.json();
      console.error("Session verification failed:", errorData);
      throw new Error("Session verification failed");
    }

    const { user } = await sessionResponse.json();
    console.log("Session user data:", user);

    if (!user?.character_id || !user?.access_token) {
      console.error("Missing required user data:", user);
      throw new Error(
        "No authenticated character - Please log in with EVE Online"
      );
    }

    // Initial poll
    await pollLocation();

    // Start polling interval
    pollInterval = setInterval(pollLocation, POLL_INTERVAL);

    return true;
  } catch (err) {
    console.error("Location polling start error:", err);
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
