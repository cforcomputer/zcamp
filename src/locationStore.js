// locationStore.js - improved implementation
import { writable } from "svelte/store";
import { getValidAccessToken } from "./tokenManager.js";
import socket from "./socket.js";

export const currentLocation = writable(null);
export const locationError = writable(null);

let pollInterval;
let lastSystemId = null;

const POLL_INTERVAL = 20000; // 20 seconds

async function pollLocation() {
  try {
    // Clear any previous errors at the start of a successful poll attempt
    locationError.set(null);

    // Get character ID first to avoid unnecessary token refreshes if we don't have it
    const characterId = await getCurrentCharacterId();

    // Get a valid token from our tokenManager with explicit refresh for location endpoint
    const accessToken = await getValidAccessToken(true); // Force refresh to ensure valid token

    // Use the token for the API call
    const response = await fetch(
      `https://esi.evetech.net/latest/characters/${characterId}/location/`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      if (response.status === 403) {
        // This is a scope permission issue, not a token issue
        console.error("Missing required scope: esi-location.read_location.v1");
        throw new Error(
          `You don't have permission to access location data. Make sure you granted the correct scopes when logging in.`
        );
      } else if (response.status === 401) {
        // Try one more token refresh before giving up
        const newToken = await getValidAccessToken(true);
        const retryResponse = await fetch(
          `https://esi.evetech.net/latest/characters/${characterId}/location/`,
          {
            headers: {
              Authorization: `Bearer ${newToken}`,
            },
          }
        );

        if (!retryResponse.ok) {
          throw new Error(
            `EVE API request failed after token refresh: ${retryResponse.status}`
          );
        }

        const locationData = await retryResponse.json();
        processLocationData(locationData);
        return;
      } else {
        throw new Error(`EVE API request failed: ${response.status}`);
      }
    }

    const locationData = await response.json();
    processLocationData(locationData);
  } catch (err) {
    console.error("Location polling error:", err);
    locationError.set(err.message);

    // Only trigger session expired for token-related errors
    if (err.message.includes("token") || err.message.includes("session")) {
      window.dispatchEvent(new CustomEvent("session-expired"));
      stopLocationPolling();
    }
  }
}

async function processLocationData(locationData) {
  try {
    if (locationData.solar_system_id !== lastSystemId) {
      const systemResponse = await fetch(
        `/api/celestials/system/${locationData.solar_system_id}`
      );
      if (!systemResponse.ok) throw new Error("Failed to fetch system data");

      const celestialData = await systemResponse.json();
      const systemName = celestialData[0]?.solarsystemname || "Unknown System";

      // Get connected systems from celestial data
      const connectedSystems = celestialData
        .filter((cel) => cel.typename?.toLowerCase().includes("stargate"))
        .map((gate) => ({
          id: gate.destinationid,
          name: gate.itemname.match(/\(([^)]+)\)/)?.[1] || "Unknown",
          gateName: gate.itemname,
        }));

      // Update current location with all relevant data
      currentLocation.set({
        solar_system_id: locationData.solar_system_id,
        systemName,
        connected_systems: connectedSystems,
        regionName: celestialData[0]?.regionname || "Unknown Region",
        regionId: celestialData[0]?.regionid,
        celestialData: celestialData,
        timestamp: new Date().toISOString(),
      });

      lastSystemId = locationData.solar_system_id;
    }
  } catch (err) {
    console.error("Error processing location data:", err);
    throw err;
  }
}

// Helper function to get the current character ID
async function getCurrentCharacterId() {
  const response = await fetch("/api/session", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to get session data");
  }

  const { user } = await response.json();
  if (!user?.character_id) {
    throw new Error("Character ID not found in session");
  }

  return user.character_id;
}

export async function startLocationPolling() {
  try {
    console.log("Starting location polling...");
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
