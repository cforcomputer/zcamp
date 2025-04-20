// dataManager.js
import { writable, get } from "svelte/store";
import socket from "./socket.js";
import { processNewSalvage } from "./salvage.js";
import { addKillmailToBattles } from "./battles.js";
// Import the unified activity store
import { activeActivities } from "./activityManager.js"; // Changed import
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
let isSyncing = false;

// Initialize socket connection and event handlers
export function initializeSocketStore() {
  let receivedKillmails = [];
  let expectedCacheSize = 0;

  socket.on("connect", () => {
    console.log("Socket connected");
    socketConnected.set(true);
    lastSocketError.set(null);

    // Only request initial data if we haven't completed a sync
    if (!get(isInitialLoadComplete)) {
      socket.emit("requestInitialKillmails");
    }
    // Request unified activity data
    socket.emit("requestActivities"); // Changed event name
  });

  socket.on("disconnect", (reason) => {
    console.log("Socket disconnected:", reason);
    socketConnected.set(false);
  });

  socket.on("connect_error", (error) => {
    console.error("Socket connection error:", error);
    lastSocketError.set(error.message);
  });

  // Cache initialization and synchronization
  socket.on("cacheInitStart", ({ totalSize }) => {
    if (!get(isInitialLoadComplete)) {
      console.log(`Starting cache initialization. Expected size: ${totalSize}`);
      isSyncing = true;
      expectedCacheSize = totalSize;
      receivedKillmails = [];
    } else {
      console.log("Ignoring cache init request - already synchronized");
    }
  });

  socket.on("cacheChunk", ({ chunk, currentCount, totalSize }) => {
    if (isSyncing) {
      receivedKillmails.push(...chunk);
      console.log(`Received chunk. Progress: ${currentCount}/${totalSize}`);

      chunk.forEach((killmail) => {
        processNewSalvage(killmail);
        addKillmailToBattles(killmail);
      });

      if (currentCount === totalSize) {
        console.log("Cache chunk reception complete");
        killmails.set(receivedKillmails);
        socket.emit("cacheSyncComplete");
      }
    } else {
      console.log("Ignoring chunk - not currently syncing");
    }
  });

  socket.on("syncVerified", ({ success }) => {
    if (success) {
      console.log("Cache sync verified, enabling live updates");
      isInitialLoadComplete.set(true);
      isSyncing = false;
    }
  });

  // Live killmail updates
  socket.on("newKillmail", (killmail) => {
    if (get(isInitialLoadComplete)) {
      killmails.update((km) => [killmail, ...km]);
      processNewSalvage(killmail);
      addKillmailToBattles(killmail);
      // Note: Server's processKillmailActivity should handle updating activities
    }
  });

  // --- REMOVED campUpdate and roamUpdate listeners ---

  // --- ADDED activityUpdate listener ---
  socket.on("activityUpdate", (activities) => {
    console.log(`Received activity update: ${activities.length} activities`);
    activeActivities.set(activities); // Update the unified store
  });
  // --- END ADDED ---

  // Filter and profile events (remain the same)
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

  socket.on("reconnect", () => {
    console.log("Socket reconnected");
    if (!get(isInitialLoadComplete)) {
      receivedKillmails = [];
      socket.emit("requestInitialKillmails");
    }
    // Request activities on reconnect
    socket.emit("requestActivities"); // Changed event name
  });
}

function cleanupSocket() {
  const events = [
    "connect",
    "disconnect",
    "connect_error",
    "cacheInitStart",
    "cacheChunk",
    "syncVerified",
    "newKillmail",
    // "campUpdate", // Removed
    // "roamUpdate", // Removed
    "activityUpdate", // Added
    "filterListCreated",
    "filterListDeleted",
    "profileSaved",
    "profileDeleted",
    "error",
  ];

  events.forEach((event) => socket.off(event));
}

export function cleanup() {
  cleanupSocket();
  socketConnected.set(false);
  lastSocketError.set(null);
}

// Export socket instance for direct access if needed
export { socket };
