// activityManager.js
import { writable } from "svelte/store";
import { EventEmitter } from "./browserEvents.js"; // Assuming you have this utility
import socket from "./socket.js";

// Create a store for active activities (camps, roams, battles)
export const activeActivities = writable([]);

class ActivityManager extends EventEmitter {
  constructor() {
    super();
    this.forceUpdate = this.forceUpdate.bind(this);
    this._setupSocketListeners();
  }

  _setupSocketListeners() {
    // Listen for the unified update event from the server
    socket.on("activityUpdate", (activities) => {
      console.log(`Received activity update: ${activities.length} activities`);
      // Update the Svelte store with the latest list
      activeActivities.set(activities);
      this.emit("update", activities); // Emit an event for components if needed
    });

    // Handle initial connection/reconnection
    socket.on("connect", () => {
      this.forceUpdate(); // Request latest data on connect
    });
  }

  startUpdates() {
    // Primarily relies on server push, but can request initial state
    console.log("Activity manager connected to server");
    this.forceUpdate();
  }

  stopUpdates() {
    // No local intervals to clear, server pushes updates
    console.log("Activity manager updates stopped (relies on server push)");
  }

  forceUpdate() {
    // Request fresh data from the server
    if (socket && socket.connected) {
      console.log("Requesting activities from server...");
      socket.emit("requestActivities"); // Use a new event name
    } else {
      console.warn("Cannot force update, socket not connected.");
    }
  }

  cleanup() {
    this.stopUpdates();
    this.removeAllListeners();
    // Optionally remove socket listeners if the manager instance is truly destroyed
    // socket.off("activityUpdate");
    // socket.off("connect", this.forceUpdate); // Be careful removing shared listeners
    console.log("Activity manager cleaned up.");
  }
}

// Create singleton instance
const activityManager = new ActivityManager();

// Export both singleton and store
export default activityManager;
export { ActivityManager }; // Export class if needed elsewhere
