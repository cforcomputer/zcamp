// campManager.js
import { writable } from "svelte/store";
import { EventEmitter } from "./browserEvents.js";
import socket from "./socket.js";

// Create a store for active camps
export const activeCamps = writable([]);

class CampManager extends EventEmitter {
  constructor() {
    super();
    this.forceUpdate = this.forceUpdate.bind(this);
  }

  startUpdates() {
    // This function no longer needs to do anything as updates come from the server
    console.log("Camp manager connected to server");

    // Request initial data
    this.forceUpdate();
  }

  stopUpdates() {
    // No local intervals to clear
  }

  forceUpdate() {
    // Just request fresh data from the server
    if (socket && socket.connected) {
      socket.emit("requestCamps");
    }
  }

  cleanup() {
    this.removeAllListeners();
  }
}

// Create singleton instance
const campManager = new CampManager();

// Export both singleton and store
export default campManager;
export { CampManager };
