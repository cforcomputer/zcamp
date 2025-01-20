// socket.js
import { io } from "socket.io-client";
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

// Basic connection logging
socket.on("connect", () => {
  console.log(`Socket connected. ID: ${socket.id}`);
});

socket.on("disconnect", (reason) => {
  console.log(`Socket disconnected. Reason: ${reason}`);
});

socket.on("connect_error", (error) => {
  console.error("Socket connection error:", error);
});

// Connection recovery
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

socket.io.on("reconnect_attempt", () => {
  reconnectAttempts++;
  if (reconnectAttempts >= maxReconnectAttempts) {
    console.log("Max reconnection attempts reached. Reloading page...");
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }
});

export default socket;
