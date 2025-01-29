// dataManager.js
import { writable, get } from "svelte/store";
import socket from "./socket.js";
import { processNewSalvage } from "./salvage.js";
import { addKillmailToBattles } from "./battles.js";
import { activeCamps } from "./campManager.js";
import { activeRoams } from "./roamManager.js";
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
    socket.emit("requestCamps");
    socket.emit("requestRoams");
  });

  socket.on("disconnect", (reason) => {
    console.log("Socket disconnected:", reason);
    socketConnected.set(false);
    isInitialLoadComplete.set(false);
  });

  socket.on("connect_error", (error) => {
    console.error("Socket connection error:", error);
    lastSocketError.set(error.message);
  });

  // Cache initialization and synchronization
  socket.on("cacheInitStart", ({ totalSize }) => {
    // Only start a new sync if we're not already syncing
    if (!isSyncing) {
      console.log(`Starting cache initialization. Expected size: ${totalSize}`);
      isSyncing = true;
      expectedCacheSize = totalSize;
      receivedKillmails = [];
    }
  });

  socket.on("cacheChunk", ({ chunk, currentCount, totalSize }) => {
    // Only process chunks if we're syncing
    if (isSyncing) {
      receivedKillmails.push(...chunk);
      console.log(`Received chunk. Progress: ${currentCount}/${totalSize}`);

      // Process the chunk
      chunk.forEach((killmail) => {
        processNewSalvage(killmail);
        addKillmailToBattles(killmail);
      });

      if (currentCount === totalSize) {
        console.log("Cache chunk reception complete");
        killmails.set(receivedKillmails);
        socket.emit("cacheSyncComplete", {
          receivedSize: receivedKillmails.length,
        });
      }
    }
  });

  socket.on("syncVerified", ({ success }) => {
    if (success) {
      console.log("Cache sync verified, enabling live updates");
      isInitialLoadComplete.set(true);
      // Mark sync as complete
      isSyncing = false;
    }
  });

  socket.on("reinitializeCache", () => {
    console.log("Cache mismatch detected, reinitializing");
    receivedKillmails = [];
    isInitialLoadComplete.set(false);
    socket.emit("requestInitialKillmails");
  });

  // Live killmail updates
  socket.on("newKillmail", (killmail) => {
    if (get(isInitialLoadComplete)) {
      killmails.update((km) => [killmail, ...km]);
      processNewSalvage(killmail);
      addKillmailToBattles(killmail);
    }
  });

  // Camp and roam updates
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

  socket.on("reconnect", () => {
    receivedKillmails = [];
    isInitialLoadComplete.set(false);
    socket.emit("requestInitialKillmails");
  });
}

// Cleanup all socket listeners
function cleanupSocket() {
  const events = [
    "connect",
    "disconnect",
    "connect_error",
    "cacheInitStart",
    "cacheChunk",
    "syncVerified",
    "reinitializeCache",
    "newKillmail",
    "campUpdate",
    "roamUpdate",
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
