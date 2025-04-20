// locationStore.js (Corrected: Added missing isPolling declaration)
import { writable } from "svelte/store";
import { getValidAccessToken } from "./tokenManager.js";
import socket from "./socket.js";

export const currentLocation = writable(null);
export const locationError = writable(null);
let pollInterval;
let lastSystemId = null;
let isPolling = false; // <-- ADDED THIS DECLARATION

const POLL_INTERVAL = 20000; // 20 seconds

async function pollLocation() {
  if (isPolling) {
    // console.log("[LocationStore] Poll already in progress, skipping.");
    return;
  }
  isPolling = true; // Now assigns to the declared variable
  console.log("[LocationStore] pollLocation started.");
  try {
    locationError.set(null); // Clear previous errors

    console.log("[LocationStore] Getting current character ID...");
    const characterId = await getCurrentCharacterId();
    console.log(`[LocationStore] Character ID found: ${characterId}`);

    console.log(
      "[LocationStore] Getting valid access token (forceRefresh=false)..."
    );
    const accessToken = await getValidAccessToken(false);
    console.log(
      `[LocationStore] Access token obtained (starts with ${accessToken?.substring(
        0,
        6
      )}...)`
    );

    const locationEndpoint = `characters/${characterId}/location/`;
    console.log(
      `[LocationStore] Fetching ESI location endpoint: ${locationEndpoint}...`
    );
    const response = await fetch(
      `https://esi.evetech.net/latest/${locationEndpoint}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      }
    );
    console.log(
      `[LocationStore] ESI location response status: ${response.status}, ok: ${response.ok}`
    );

    // --- CORRECTED HANDLING for 304 ---
    if (response.status === 304) {
      console.log(
        "[LocationStore] ESI location data not modified (304). Polling cycle complete."
      );
      currentLocation.update((loc) =>
        loc ? { ...loc, timestamp: new Date().toISOString() } : null
      ); // Update timestamp
    } else if (response.ok) {
      // Handle 200 OK
      let locationData;
      try {
        locationData = await response.json();
        console.log("[LocationStore] ESI location fetch successful (200 OK).");
        await processLocationData(locationData);
        console.log("[LocationStore] processLocationData completed.");
      } catch (parseError) {
        console.error(
          "[LocationStore] Failed to parse ESI location JSON (200 OK):",
          parseError
        );
        throw new Error(
          "[LocationStore] Failed to parse ESI location response"
        );
      }
    } else {
      // Handle non-ok, non-304 statuses (4xx, 5xx)
      if (response.status === 401 || response.status === 403) {
        console.warn(
          `[LocationStore] ESI location call failed (${response.status}), attempting token refresh...`
        );
        const newToken = await getValidAccessToken(true); // Force refresh
        console.log(
          `[LocationStore] Retrying ESI location with new token (starts with ${newToken?.substring(
            0,
            6
          )})...`
        );
        const retryResponse = await fetch(
          `https://esi.evetech.net/latest/${locationEndpoint}`,
          {
            headers: {
              Authorization: `Bearer ${newToken}`,
              Accept: "application/json",
            },
          }
        );
        console.log(
          `[LocationStore] ESI location retry response status: ${retryResponse.status}, ok: ${retryResponse.ok}`
        );

        if (!retryResponse.ok) {
          let errorBodyRetry = "Could not read error body";
          try {
            errorBodyRetry = await retryResponse.text();
          } catch (e) {}
          console.error(
            `[LocationStore] ESI location retry FAILED (${retryResponse.status}):`,
            errorBodyRetry
          );
          window.dispatchEvent(new CustomEvent("session-expired"));
          throw new Error(
            `[LocationStore] EVE API request failed after token refresh: ${retryResponse.status}`
          );
        }
        console.log(
          "[LocationStore] ESI location fetch successful after retry."
        );
        const locationDataRetry = await retryResponse.json();
        await processLocationData(locationDataRetry);
        // Successfully handled retry, exit pollLocation for this cycle
        isPolling = false; // Release lock before returning
        return;
      } else {
        // Handle other non-ok statuses
        let errorBody = "Could not read error body";
        try {
          errorBody = await response.text();
        } catch (e) {}
        console.error(
          `[LocationStore] ESI location initial call FAILED (${response.status}):`,
          errorBody
        );
        throw new Error(
          `[LocationStore] EVE API request failed: ${response.status}`
        );
      }
    }
    // --- END CORRECTED HANDLING ---

    console.log(
      "[LocationStore] pollLocation finished successfully for this interval."
    );
  } catch (err) {
    console.error("[LocationStore] pollLocation ERROR:", err);
    locationError.set(err.message);
    if (
      err.message.includes("token") ||
      err.message.includes("session") ||
      err.message.includes("Session expired") ||
      err.message.includes("character ID not found")
    ) {
      console.warn(
        "[LocationStore] Triggering session-expired event due to error."
      );
      window.dispatchEvent(new CustomEvent("session-expired"));
      stopLocationPolling();
    }
  } finally {
    isPolling = false; // Assigns to the declared variable
  }
}

async function processLocationData(locationData) {
  console.log(
    "[LocationStore] processLocationData started with:",
    locationData
  );
  if (!locationData || typeof locationData.solar_system_id === "undefined") {
    console.warn(
      "[LocationStore] Invalid locationData received in processLocationData",
      locationData
    );
    currentLocation.set(null);
    lastSystemId = null;
    return;
  }
  try {
    if (locationData.solar_system_id !== lastSystemId) {
      console.log(
        `[LocationStore] System changed: ${lastSystemId} -> ${locationData.solar_system_id}. Fetching celestial data...`
      );
      const systemResponse = await fetch(
        `/api/celestials/system/${locationData.solar_system_id}`
      );
      console.log(
        `[LocationStore] /api/celestials response status: ${systemResponse.status}`
      );
      if (!systemResponse.ok) {
        throw new Error(
          `[LocationStore] Failed to fetch system data for ${locationData.solar_system_id}: ${systemResponse.status}`
        );
      }
      const celestialData = await systemResponse.json();
      if (!Array.isArray(celestialData) || celestialData.length === 0) {
        console.warn(
          `[LocationStore] Empty or invalid celestial data for ${locationData.solar_system_id}`
        );
        currentLocation.set({
          solar_system_id: locationData.solar_system_id,
          systemName: `System ${locationData.solar_system_id}`,
          connected_systems: [],
          regionName: "Unknown Region",
          regionId: null,
          celestialData: [],
          timestamp: new Date().toISOString(),
        });
      } else {
        const systemName =
          celestialData[0]?.solarsystemname ||
          `System ${locationData.solar_system_id}`;
        const connectedSystems = celestialData
          .filter(
            (cel) =>
              cel.typename?.toLowerCase().includes("stargate") &&
              cel.destinationid
          )
          .map((gate) => ({
            id: gate.destinationid,
            name: gate.itemname?.match(/\(([^)]+)\)/)?.[1] || "Unknown",
            gateName: gate.itemname,
          }));
        console.log(
          `[LocationStore] Updating location: ${systemName}, ${connectedSystems.length} connections`
        );
        currentLocation.set({
          solar_system_id: locationData.solar_system_id,
          systemName,
          connected_systems: connectedSystems,
          regionName: celestialData[0]?.regionname || "Unknown Region",
          regionId: celestialData[0]?.regionid,
          celestialData: celestialData,
          timestamp: new Date().toISOString(),
        });
      }
      lastSystemId = locationData.solar_system_id;
    } else {
      // console.log(`[LocationStore] System ${locationData.solar_system_id} unchanged.`);
      currentLocation.update((loc) =>
        loc ? { ...loc, timestamp: new Date().toISOString() } : null
      );
    }
  } catch (err) {
    console.error("[LocationStore] Error processing location data:", err);
    locationError.set(`Error processing system data: ${err.message}`);
  }
}

// Helper function to get the current character ID (Needs /api/session endpoint)
async function getCurrentCharacterId() {
  console.log("[LocationStore] getCurrentCharacterId fetching /api/session...");
  const response = await fetch("/api/session", { credentials: "include" });
  console.log(`[LocationStore] /api/session response: ${response.status}`);
  if (!response.ok) {
    throw new Error(
      "[LocationStore] Failed to get session data for character ID check"
    );
  }
  const text = await response.text();
  if (!text) {
    throw new Error(
      "[LocationStore] Empty response received from /api/session"
    );
  }
  const data = JSON.parse(text);
  if (!data.user?.character_id) {
    throw new Error("[LocationStore] Character ID not found in session");
  }
  return data.user.character_id;
}

export async function startLocationPolling() {
  if (pollInterval) {
    console.warn("[LocationStore] Polling already started.");
    return true;
  }
  console.log("[LocationStore] Starting location polling...");
  try {
    await pollLocation();
    pollInterval = setInterval(pollLocation, POLL_INTERVAL);
    console.log("[LocationStore] Location polling interval set.");
    return true;
  } catch (err) {
    console.error("[LocationStore] Location polling START error:", err);
    locationError.set(`Initial poll failed: ${err.message}`);
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = null;
    isPolling = false; // Assigns to the declared variable
    if (
      err.message.includes("token") ||
      err.message.includes("session") ||
      err.message.includes("Character ID")
    ) {
      window.dispatchEvent(new CustomEvent("session-expired"));
    }
    return false;
  }
}

export function stopLocationPolling() {
  if (pollInterval) {
    console.log("[LocationStore] Stopping location polling.");
    clearInterval(pollInterval);
    pollInterval = null;
  }
  isPolling = false; // Assigns to the declared variable
}
