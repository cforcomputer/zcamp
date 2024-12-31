import { io } from "socket.io-client";
import { get } from "svelte/store";
import { addKillmailToBattles } from "./battleStore.js";
// import { addKillmailToCamps } from "../server/campStore.js";
import {
  killmails,
  settings,
  filterLists,
  profiles,
  filteredKillmails,
} from "./store.js";

const socket = io("http://localhost:3000");

let audio;

if (typeof Audio !== "undefined") {
  audio = new Audio("audio_files/alert.wav");
}

socket.on("newKillmail", (killmail) => {
  console.log("Socket.js - Processing killmail:", killmail.killID);

  killmails.update((currentKillmails) => {
    // Ensure we have an array to work with
    const existingKillmails = Array.isArray(currentKillmails)
      ? currentKillmails
      : [];

    // Check if this killmail already exists
    const isDuplicate = existingKillmails.some(
      (km) => km.killID === killmail.killID
    );

    if (isDuplicate) {
      console.log("Socket.js - Duplicate killmail detected:", killmail.killID);
      return existingKillmails;
    }

    // Get current filtered length for sound alerts
    const prevFilteredLength = get(filteredKillmails).length;

    // Process for battles and camps
    addKillmailToBattles(killmail);
    // addKillmailToCamps(killmail);

    // Add new killmail and sort chronologically
    const updatedKillmails = [...existingKillmails, killmail].sort((a, b) => {
      const timeA = new Date(a.killmail.killmail_time).getTime();
      const timeB = new Date(b.killmail.killmail_time).getTime();
      if (timeA === timeB) {
        return b.killID - a.killID; // Use killID as tiebreaker
      }
      return timeB - timeA;
    });

    // Handle sound alerts after update
    setTimeout(() => {
      const newFilteredLength = get(filteredKillmails).length;
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
  filteredKillmails.set([]);
});

function playSound() {
  audio.play().catch((err) => {
    console.error("Error playing audio:", err);
  });
}

export default socket;
