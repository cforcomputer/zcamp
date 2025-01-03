import { writable } from "svelte/store";
import { filteredCamps } from "../server/campStore.js";

export const currentLocation = writable(null);
export const locationError = writable(null);

let pollInterval;
let lastSystemId = null;
let cachedCelestialData = null;

const POLL_INTERVAL = 30000; // 30 seconds

async function getCelestialData(systemId) {
  // Return cached data if system hasn't changed
  if (systemId === lastSystemId && cachedCelestialData) {
    console.log("Using cached celestial data for system:", systemId);
    return cachedCelestialData;
  }

  try {
    console.log("Fetching new celestial data for system:", systemId);
    const response = await fetch(`/api/celestials/system/${systemId}`);
    if (!response.ok) throw new Error("Failed to fetch celestial data");
    const data = await response.json();

    // Cache the new data
    lastSystemId = systemId;
    cachedCelestialData = data;
    return data;
  } catch (err) {
    console.error("Error fetching celestial data:", err);
    return null;
  }
}

async function checkForGateCamps(systemId, celestialData) {
  let camps = [];
  const unsubscribe = filteredCamps.subscribe((value) => (camps = value));

  try {
    // Check current system camps
    const currentSystemCamps = camps.filter(
      (camp) => camp.systemId === systemId
    );
    if (currentSystemCamps.length > 0) {
      const gateNames = currentSystemCamps
        .map((camp) => camp.stargateName)
        .join(", ");
      const msg = new SpeechSynthesisUtterance(
        `Warning! Gate camp detected in your current system at ${gateNames}`
      );
      window.speechSynthesis.speak(msg);
      return { current: currentSystemCamps, connected: [] };
    }

    // Check connected systems
    const connectedCamps = camps.filter((camp) => {
      return camp.stargateName.includes(
        `(${celestialData[0].solarsystemname})`
      );
    });

    if (connectedCamps.length > 0) {
      const campSystems = connectedCamps
        .map(
          (camp) =>
            `${camp.kills[0]?.pinpoints?.celestialData?.solarsystemname} at ${camp.stargateName}`
        )
        .filter(Boolean);

      if (campSystems.length > 0) {
        const msg = new SpeechSynthesisUtterance(
          `Warning! Gate camps detected in connected systems: ${campSystems.join(
            ", "
          )}`
        );
        window.speechSynthesis.speak(msg);
      }
      return { current: [], connected: connectedCamps };
    }
  } finally {
    unsubscribe();
  }

  return { current: [], connected: [] };
}

export async function startLocationPolling() {
  try {
    console.log("Starting location polling...");

    // Get session data first
    console.log("Fetching session data...");
    const sessionResponse = await fetch("/api/session", {
      credentials: "include",
    });

    console.log("Session response status:", sessionResponse.status);

    // Log raw response
    const rawResponse = await sessionResponse.text();
    console.log("Raw session response:", rawResponse);

    if (!sessionResponse.ok) {
      console.error("Session fetch failed:", rawResponse);
      locationError.set(`Session verification failed: ${rawResponse}`);
      return false;
    }

    // Try parsing JSON
    let sessionData;
    try {
      sessionData = JSON.parse(rawResponse);
      console.log("Parsed session data:", sessionData);
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      console.error("Failed to parse response:", rawResponse);
      locationError.set(`Session data parse error: ${parseError.message}`);
      return false;
    }

    const { user } = sessionData;
    console.log("User data:", {
      hasCharacterId: !!user?.character_id,
      hasToken: !!user?.access_token,
      characterName: user?.character_name,
      tokenLength: user?.access_token?.length,
    });

    if (!user?.character_id || !user?.access_token) {
      locationError.set(
        "No authenticated character - Please log in with EVE Online"
      );
      return false;
    }

    // Store valid session data
    console.log("Storing session data...");
    sessionStorage.setItem("user", JSON.stringify(user));

    async function pollLocation() {
      try {
        const userData = JSON.parse(sessionStorage.getItem("user"));
        console.log("Polling location for character:", userData.character_id);

        const response = await fetch(
          `https://esi.evetech.net/latest/characters/${userData.character_id}/location/`,
          {
            headers: {
              Authorization: `Bearer ${userData.access_token}`,
            },
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error("Location fetch error:", errorText);
          throw new Error(`Failed to fetch location: ${errorText}`);
        }

        const locationData = await response.json();
        console.log("Location data received:", locationData);

        // Only fetch celestial data if system changed
        if (
          locationData.solar_system_id !== lastSystemId ||
          !cachedCelestialData
        ) {
          console.log("System changed, fetching new celestial data");
          const celestialData = await getCelestialData(
            locationData.solar_system_id
          );
          if (celestialData) {
            const systemName = celestialData[0]?.solarsystemname;
            const campData = await checkForGateCamps(
              locationData.solar_system_id,
              celestialData
            );

            currentLocation.set({
              ...locationData,
              systemName,
              celestialData,
              camps: campData,
            });
          }
        } else {
          // Use cached data for same system
          console.log("Using cached data for system:", lastSystemId);
          const campData = await checkForGateCamps(
            locationData.solar_system_id,
            cachedCelestialData
          );

          currentLocation.set({
            ...locationData,
            systemName: cachedCelestialData[0]?.solarsystemname,
            celestialData: cachedCelestialData,
            camps: campData,
          });
        }
      } catch (err) {
        console.error("Location polling error:", err);
        locationError.set(err.message);
        stopLocationPolling();
      }
    }

    // Initial poll and start interval
    await pollLocation();
    pollInterval = setInterval(pollLocation, POLL_INTERVAL);
    console.log("Location polling started successfully");
    return true;
  } catch (err) {
    console.error("Failed to start location polling:", err);
    locationError.set(`Failed to start location polling: ${err.message}`);
    return false;
  }
}

export function stopLocationPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  currentLocation.set(null);
}
