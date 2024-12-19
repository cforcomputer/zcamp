import { io } from "socket.io-client";
import { get } from "svelte/store";
import {
  killmails,
  settings,
  filterLists,
  profiles,
  addFilterList,
} from "./store";

const socket = io("http://localhost:3000");
let audio = new Audio("audio_files/alert.wav");

socket.on("connect", () => {
  console.log("Connected to server with socket id:", socket.id);
  socket.emit("requestInitialData");
});

socket.on("disconnect", () => {
  console.log("Disconnected from server");
});

socket.on("initialData", (data) => {
  console.log("Received initialData:", data);
  settings.set(data.settings || {});
  killmails.set(Array.isArray(data.killmails) ? data.killmails : []);
  filterLists.set(Array.isArray(data.filterLists) ? data.filterLists : []);
});

function playSound() {
  const settingsValue = get(settings);
  if (settingsValue.audio_alerts_enabled) {
    audio.play().catch((err) => {
      console.error("Error playing audio:", err);
    });
  }
}

socket.on("filterListCreated", (newFilterList) => {
  console.log("New filter list created:", newFilterList);
  addFilterList(newFilterList);
});

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
    return [...existingKillmails, killmail].sort(
      (a, b) =>
        new Date(b.killmail.killmail_time) - new Date(a.killmail.killmail_time)
    );
  });

  playSound();
});

socket.on("killmailsCleared", () => {
  console.log("Clearing killmails");
  killmails.set([]);
});

export default socket;
