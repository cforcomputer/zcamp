// socket.js
import { io } from "socket.io-client";
import { get } from "svelte/store";
import { addKillmailToBattles } from "./battleStore.js";
import { killmails, settings, filteredKillmails } from "./store.js";
import { getSocketUrl } from "./config.js";

// Enable debug only in browser environment
if (typeof window !== "undefined" && window.localStorage) {
  window.localStorage.debug = "*";
}

const socket = io(getSocketUrl(), {
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  transports: ["websocket"],
  path: "/socket.io/",
  autoConnect: true,
  forceNew: true,
  withCredentials: true,
  EIO: 4,
  debug: true,
  auth: {
    sessionID:
      typeof document !== "undefined"
        ? document.cookie.match(/km_sid=([^;]+)/)?.[1]
        : null,
  },
});

const audio =
  typeof Audio !== "undefined"
    ? new Audio("/build/audio_files/alert.wav")
    : null;

socket.once("connect", () => {
  console.log(
    `[${new Date().toISOString()}] Socket connected. Socket ID: ${socket.id}`
  );
});

socket.on("disconnect", (reason) => {
  console.log(
    `[${new Date().toISOString()}] Socket disconnected. Reason: ${reason}`
  );
});

socket.on("reconnect", (attemptNumber) => {
  console.log(
    `[${new Date().toISOString()}] Socket reconnected after ${attemptNumber} attempts`
  );
});

socket.on("reconnect_attempt", (attemptNumber) => {
  console.log(
    `[${new Date().toISOString()}] Attempting to reconnect... Attempt ${attemptNumber}`
  );
});

socket.on("reconnect_error", (error) => {
  console.error(`[${new Date().toISOString()}] Reconnection error:`, error);
});

socket.on("error", (error) => {
  console.error(`[${new Date().toISOString()}] Socket error:`, error);
});

// Add detailed connection error logging
socket.on("connect_error", (error) => {
  console.error(`[${new Date().toISOString()}] Connection error details:`, {
    message: error.message,
    description: error.description,
    type: error.type,
    data: error.data,
  });
});

socket.on("newKillmail", (killmail) => {
  console.log("Enriched killmail data:", {
    killID: killmail.killID,
    system: killmail.killmail.solar_system_id,
    systemInfo: killmail.pinpoints?.celestialData,
    time: killmail.killmail.killmail_time,
    value: killmail.zkb?.totalValue,
    victim: {
      shipTypeId: killmail.killmail.victim.ship_type_id,
      shipInfo: killmail.shipCategories?.victim,
    },
    attackers: killmail.shipCategories?.attackers?.map((attacker) => ({
      shipTypeId: attacker.shipTypeId,
      category: attacker.category,
      name: attacker.name,
      tier: attacker.tier,
    })),
  });

  killmails.update((currentKillmails) => {
    const existingKillmails = Array.isArray(currentKillmails)
      ? currentKillmails
      : [];
    if (existingKillmails.some((km) => km.killID === killmail.killID)) {
      console.log(
        `[${new Date().toISOString()}] Duplicate killmail ignored:`,
        killmail.killID
      );
      return existingKillmails;
    }

    const prevFilteredLength = get(filteredKillmails).length;
    addKillmailToBattles(killmail);

    setTimeout(() => {
      if (
        get(filteredKillmails).length > prevFilteredLength &&
        get(settings).audio_alerts_enabled
      ) {
        console.log(
          `[${new Date().toISOString()}] Playing audio alert for new killmail`
        );
        audio?.play().catch((err) => console.error("Audio error:", err));
      }
    }, 0);

    console.log(
      `[${new Date().toISOString()}] Added new killmail. Total killmails:`,
      existingKillmails.length + 1
    );
    return [...existingKillmails, killmail].sort(
      (a, b) =>
        new Date(b.killmail.killmail_time) -
          new Date(a.killmail.killmail_time) || b.killID - a.killID
    );
  });
});

socket.on("killmailsCleared", () => {
  console.log(`[${new Date().toISOString()}] Clearing all killmails`);
  killmails.set([]);
  filteredKillmails.set([]);
});

socket.on("connect_timeout", () => {
  console.error(`[${new Date().toISOString()}] Connection timeout`);
});

socket.on("ping", () => {
  console.log(`[${new Date().toISOString()}] Socket ping`);
});

socket.on("pong", (latency) => {
  console.log(
    `[${new Date().toISOString()}] Socket pong - Latency: ${latency}ms`
  );
});

// Add connection recovery handler
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

socket.io.on("reconnect_attempt", () => {
  reconnectAttempts++;
  if (reconnectAttempts >= maxReconnectAttempts) {
    console.log(
      `[${new Date().toISOString()}] Max reconnection attempts reached. Reloading page...`
    );
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }
});

export default socket;
