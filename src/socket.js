import { io } from "socket.io-client";
import { get } from "svelte/store";
import { addKillmailToBattles } from "./battleStore.js";
import { killmails, settings, filteredKillmails } from "./store.js";

const socket = io("http://localhost:3000", {
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  transports: ["websocket"],
});

const audio =
  typeof Audio !== "undefined" ? new Audio("audio_files/alert.wav") : null;

socket.once("connect", () => console.log("Socket connected"));

socket.on("newKillmail", (killmail) => {
  killmails.update((currentKillmails) => {
    const existingKillmails = Array.isArray(currentKillmails)
      ? currentKillmails
      : [];
    if (existingKillmails.some((km) => km.killID === killmail.killID))
      return existingKillmails;

    const prevFilteredLength = get(filteredKillmails).length;
    addKillmailToBattles(killmail);

    setTimeout(() => {
      if (
        get(filteredKillmails).length > prevFilteredLength &&
        get(settings).audio_alerts_enabled
      ) {
        audio?.play().catch((err) => console.error("Audio error:", err));
      }
    }, 0);

    return [...existingKillmails, killmail].sort(
      (a, b) =>
        new Date(b.killmail.killmail_time) -
          new Date(a.killmail.killmail_time) || b.killID - a.killID
    );
  });
});

socket.on("killmailsCleared", () => {
  killmails.set([]);
  filteredKillmails.set([]);
});

export default socket;
