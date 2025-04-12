// roamManager.js
import { writable } from "svelte/store";
import { EventEmitter } from "./browserEvents.js";
import socket from "./socket.js";

export const ROAM_TIMEOUT = 30 * 60 * 1000; // 30 minutes
export const CAPSULE_ID = 670;

// Create store for active roams
export const activeRoams = writable([]);

class RoamManager extends EventEmitter {
  constructor() {
    super();
    this.forceUpdate = this.forceUpdate.bind(this);
  }

  startUpdates() {
    // This function no longer needs to do anything as updates come from the server
    console.log("Roam manager connected to server");

    // Request initial data
    this.forceUpdate();
  }

  stopUpdates() {
    // No local intervals to clear
  }

  forceUpdate() {
    // Just request fresh data from the server
    if (socket && socket.connected) {
      socket.emit("requestRoams");
    }
  }

  cleanup() {
    this.stopUpdates();
    this.removeAllListeners();
  }
}

// Create singleton instance
const roamManager = new RoamManager();

// Export both singleton and store
export default roamManager;
export { RoamManager };
