// In src/socket.js

import { io } from "socket.io-client";
import { get } from "svelte/store";
import {
  killmails,
  settings,
  filterLists,
  profiles,
  addFilterList,
  filteredKillmails, // Add this import
} from "./store";

const socket = io("http://localhost:3000");
let audio = new Audio("audio_files/alert.wav");

// Modify the newKillmail handler
socket.on("newKillmail", (killmail) => {
  console.log("Received new killmail:", killmail);
  killmails.update((currentKillmails) => {
    const existingKillmails = Array.isArray(currentKillmails)
      ? currentKillmails
      : [];

    // Verify this killmail ID doesn't already exist
    const duplicateIndex = existingKillmails.findIndex(
      (km) => km.killID === killmail.killID
    );

    if (duplicateIndex !== -1) {
      console.warn(`Duplicate killmail detected - ID: ${killmail.killID}`);
      return existingKillmails;
    }

    // Add new killmail and maintain chronological order
    const updatedKillmails = [...existingKillmails, killmail].sort(
      (a, b) =>
        new Date(b.killmail.killmail_time) - new Date(a.killmail.killmail_time)
    );

    // Get current filtered killmails length before update
    const prevFilteredLength = get(filteredKillmails).length;

    // Wait for next tick to let filters process
    setTimeout(() => {
      const newFilteredLength = get(filteredKillmails).length;
      // Only play sound if killmail passed filters (filtered length increased)
      if (newFilteredLength > prevFilteredLength) {
        const settingsValue = get(settings);
        if (settingsValue.audio_alerts_enabled) {
          playSound();
        }
      }
    }, 0);

    return updatedKillmails;
  });
});

socket.on("killmailsCleared", () => {
  killmails.set([]);
  filteredKillmails.set([]); // Make sure filtered killmails are also cleared
});

function playSound() {
  audio.play().catch((err) => {
    console.error("Error playing audio:", err);
  });
}

export default socket;
