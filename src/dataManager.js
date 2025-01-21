// dataManager.js
import { writable, get } from "svelte/store";
import socket from "./socket.js";
import { processNewSalvage } from "./salvage.js";
import { addKillmailToBattles } from "./battles.js";
import campManager, { activeCamps } from "./campManager.js";
import {
  killmails,
  settings,
  filterLists,
  profiles,
  filteredKillmails,
} from "./settingsStore.js";

// Create stores for different data types
export const socketConnected = writable(false);
export const lastSocketError = writable(null);
export const isInitialLoadComplete = writable(false);

// Audio setup for alerts
const audio =
  typeof Audio !== "undefined"
    ? new Audio("/build/audio_files/alert.wav")
    : null;

let processedKillIds = new Set();

async function fetchCelestialData(systemId) {
  try {
    const response = await fetch(`/api/celestials/system/${systemId}`);
    if (!response.ok) throw new Error("Failed to fetch celestial data");
    return await response.json();
  } catch (err) {
    console.error("Error fetching celestial data:", err);
    return null;
  }
}

async function handleKillmailBatch(killmails) {
  console.log(`Processing batch of ${killmails.length} killmails`);

  for (const killmail of killmails) {
    if (!processedKillIds.has(killmail.killID)) {
      await handleNewKillmail(killmail);
      processedKillIds.add(killmail.killID);
    }
  }
}

async function handleNewKillmail(killmail) {
  console.log("Processing new killmail:", {
    id: killmail.killID,
    system: killmail.killmail.solar_system_id,
    time: killmail.killmail.killmail_time,
  });

  // Fetch celestial data and continue processing...
  const systemId = killmail.killmail.solar_system_id;
  const celestialData = await fetchCelestialData(systemId);

  // More detailed logging to track celestial data
  console.log("Celestial data response:", {
    hasData: !!celestialData,
    systemName: celestialData?.[0]?.solarsystemname,
    regionName: celestialData?.[0]?.regionname,
    dataLength: celestialData?.length,
  });

  if (celestialData?.length > 0) {
    // Ensure we preserve any existing pinpoints data
    killmail.pinpoints = {
      ...killmail.pinpoints,
      celestialData: {
        regionid: celestialData[0].regionid,
        regionname: celestialData[0].regionname,
        solarsystemid: systemId,
        solarsystemname:
          celestialData[0].solarsystemname || `System ${systemId}`,
        // Keep the full celestial data for triangulation
        celestials: celestialData,
      },
    };
  } else {
    // Fallback if celestial data fetch fails
    killmail.pinpoints = {
      ...killmail.pinpoints,
      celestialData: {
        solarsystemid: systemId,
        solarsystemname: `System ${systemId}`,
        regionname: "Unknown Region",
      },
    };
  }

  // Verify the data is properly attached
  console.log("Processed killmail system info:", {
    systemId: killmail.killmail.solar_system_id,
    systemName: killmail.pinpoints?.celestialData?.solarsystemname,
    region: killmail.pinpoints?.celestialData?.regionname,
    hasData: !!killmail.pinpoints?.celestialData,
  });

  killmails.update((currentKillmails) => {
    const existing = Array.isArray(currentKillmails) ? currentKillmails : [];

    if (existing.some((km) => km.killID === killmail.killID)) {
      return existing;
    }

    const prevFilteredLength = get(filteredKillmails).length;

    try {
      processNewSalvage(killmail);
      addKillmailToBattles(killmail);
      campManager.processCamp(killmail); // Use campManager directly instead of processCamp

      // Handle audio alerts
      if (
        get(filteredKillmails).length > prevFilteredLength &&
        get(settings).audio_alerts_enabled
      ) {
        audio?.play().catch((err) => console.error("Audio error:", err));
      }
    } catch (err) {
      console.error("Error processing killmail:", err);
    }

    return [...existing, killmail].sort(
      (a, b) =>
        new Date(b.killmail.killmail_time) - new Date(a.killmail.killmail_time)
    );
  });
}

// Initialize socket connection and event handlers
export function initializeSocketStore() {
  // Connection events
  socket.on("connect", () => {
    console.log("Socket connected");
    socketConnected.set(true);
    lastSocketError.set(null);

    // Request initial data
    socket.emit("requestInitialKillmails");
    socket.emit("requestCamps");
    socket.emit("requestRoams");
  });

  socket.on("disconnect", (reason) => {
    console.log("Socket disconnected:", reason);
    socketConnected.set(false);
    processedKillIds.clear();
  });

  socket.on("connect_error", (error) => {
    console.error("Socket connection error:", error);
    lastSocketError.set(error.message);
  });

  // Data events
  socket.on("killmailBatch", handleKillmailBatch);
  socket.on("initialLoadComplete", () => {
    isInitialLoadComplete.set(true);
    console.log("Initial killmail load complete");
  });

  socket.on("newKillmail", handleNewKillmail);

  socket.on("campUpdate", (camps) => {
    console.log(`Received camp update: ${camps.length} camps`);
    activeCamps.set(camps);
  });

  socket.on("roamUpdate", (roams) => {
    console.log(`Received roam update: ${roams.length} roams`);
    activeRoams.set(roams);
  });

  // Filter and profile events
  socket.on("filterListCreated", (newList) => {
    filterLists.update((lists) => [...lists, newList]);
  });

  socket.on("filterListDeleted", (id) => {
    filterLists.update((lists) => lists.filter((l) => l.id !== id));
  });

  socket.on("profileSaved", (profile) => {
    profiles.update((currentProfiles) => {
      const index = currentProfiles.findIndex((p) => p.id === profile.id);
      if (index !== -1) {
        const updated = [...currentProfiles];
        updated[index] = profile;
        return updated;
      }
      return [...currentProfiles, profile];
    });
  });

  socket.on("profileDeleted", (id) => {
    profiles.update((currentProfiles) =>
      currentProfiles.filter((p) => p.id !== id)
    );
  });

  // Error handling
  socket.on("error", (error) => {
    console.error("Socket error:", error);
    lastSocketError.set(error.message);
  });
}

// Cleanup all socket listeners
function cleanupSocket() {
  const events = [
    "connect",
    "disconnect",
    "connect_error",
    "newKillmail",
    "killmailBatch",
    "initialLoadComplete",
    "campUpdate",
    "roamUpdate",
    "filterListCreated",
    "filterListDeleted",
    "profileSaved",
    "profileDeleted",
    "error",
  ];

  events.forEach((event) => socket.off(event));
  processedKillIds.clear();
}
export function cleanup() {
  cleanupSocket();
  socketConnected.set(false);
  lastSocketError.set(null);
}

// Export socket instance for direct access if needed
export { socket };
