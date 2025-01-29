// locationStore.js
import { writable } from "svelte/store";
import socket from "./socket.js";

export const currentLocation = writable(null);
export const locationError = writable(null);

let pollInterval;
let lastSystemId = null;

const POLL_INTERVAL = 20000; // 20 seconds
const TOKEN_REFRESH_BUFFER = 60; // Refresh token 60 seconds before expiry

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

async function pollLocation() {
  try {
    // Get current session data with token refresh handling
    const sessionResponse = await fetch("/api/session", {
      credentials: "include",
    });

    if (!sessionResponse.ok) {
      throw new Error("Failed to get session data");
    }

    const { user } = await sessionResponse.json();

    // Check if we have required user data
    if (!user?.character_id || !user?.access_token) {
      throw new Error("Missing required user data");
    }

    // Check if token needs refresh
    const now = Math.floor(Date.now() / 1000);
    if (user.token_expiry && now >= user.token_expiry - 60) {
      let retryCount = 3;
      while (retryCount > 0) {
        try {
          const refreshResponse = await fetch("/api/refresh-token", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify({ refresh_token: user.refresh_token }),
          });

          if (!refreshResponse.ok) {
            throw new Error("Failed to refresh token");
          }

          const refreshData = await refreshResponse.json();
          user.access_token = refreshData.access_token;
          user.token_expiry = refreshData.token_expiry;
          break;
        } catch (refreshError) {
          console.error(
            `Token refresh attempt failed (${retryCount} remaining):`,
            refreshError
          );
          retryCount--;
          if (retryCount === 0) {
            throw new Error("Failed to refresh token after multiple attempts");
          }
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

    if (locationData.solar_system_id !== lastSystemId) {
      const systemResponse = await fetch(
        `/api/celestials/system/${locationData.solar_system_id}`
      );
      if (!systemResponse.ok) throw new Error("Failed to fetch system data");

      const celestialData = await systemResponse.json();
      const systemName = celestialData[0]?.solarsystemname || "Unknown System";

      // Get connected systems from celestial data
      const connectedSystems = celestialData
        .filter((cel) => cel.typename?.includes("Stargate"))
        .map((gate) => ({
          id: gate.destinationid,
          name: gate.itemname.match(/\(([^)]+)\)/)[1],
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
    console.error("Location polling error:", err);
    locationError.set(err.message);

    if (
      err.message.includes("token") ||
      err.message.includes("401") ||
      err.message.includes("403")
    ) {
      // Token-related errors
      window.dispatchEvent(new CustomEvent("session-expired"));
      stopLocationPolling();
      return;
    }

    if (err.message.includes("Failed to get session data")) {
      // Session-related errors
      window.dispatchEvent(new CustomEvent("session-expired"));
      stopLocationPolling();
      return;
    }

    // For other errors, continue polling but set error state
    locationError.set(err.message);
  }
}

export async function startLocationPolling() {
  try {
    console.log("Starting location polling...");
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
