// dataManager.js
import { writable, get } from "svelte/store";
import socket from "./socket.js";
import { processNewSalvage } from "./salvage.js";
import { addKillmailToBattles } from "./battles.js";
import { activeCamps } from "./campManager.js";
import { activeRoams } from "./roamManager.js"; // Add this import
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
let processedKillIds = new Set(
  JSON.parse(localStorage.getItem("processedKillIds") || "[]")
);
let lastAckedId = 0;

async function handleKillmailBatch({ batch, latestId }) {
  // Filter any already processed kills
  const newKills = batch.filter((k) => !processedKillIds.has(k.killID));

  // Process new kills
  for (const killmail of newKills) {
    processedKillIds.add(killmail.killID);
    killmails.update((k) => {
      // Ensure no duplicates
      if (!k.some((existing) => existing.killID === killmail.killID)) {
        return [killmail, ...k];
      }
      return k;
    });
    addKillmailToBattles(killmail);
  }

  // Update last processed ID
  if (newKills.length > 0) {
    lastAckedId = Math.max(lastAckedId, latestId);
  }
}

// Initialize socket connection and event handlers
export function initializeSocketStore() {
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

  // Only handle killmail batches
  socket.on("killmailBatch", handleKillmailBatch);
  socket.on("initialLoadComplete", () => {
    isInitialLoadComplete.set(true);
    console.log("Initial killmail load complete");
  });

  // Keep other event handlers
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
    socket.emit("requestInitialKillmails");
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
  // Save processed kills to localStorage
  localStorage.setItem(
    "processedKillIds",
    JSON.stringify([...processedKillIds])
  );
}

// Export socket instance for direct access if needed
export { socket };
