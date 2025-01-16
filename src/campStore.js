import { writable } from "svelte/store";
import socket from "./socket";
/**
 * campsStore.js
 *
 * This file defines a Svelte store specifically for managing the state of active
 * gate camps within the ActiveCamps component. It listens for 'initialCamps' and
 * 'campUpdate' events from the Socket.IO server to keep the camp data
 * synchronized with the server.
 *
 * The store is designed to be used internally by the ActiveCamps component and
 * its children. It is not intended for use by other components in the
 * application.
 *
 * The store holds an array of camp objects. Each camp object is expected to
 * have the following structure (based on `campManager.js` and usage
 * in `ActiveCamps.svelte`):
 *
 * {
 *   id: string,           // Unique identifier for the camp (e.g., "systemId-stargateName")
 *   systemId: number,     // ID of the solar system where the camp is located
 *   stargateName: string, // Name of the stargate where the camp is located
 *   kills: array,         // Array of killmail objects related to the camp
 *   totalValue: number,   // Total ISK value of kills in the camp
 *   lastKill: string,     // Timestamp of the last kill in the camp (ISO 8601 format)
 *   firstKillTime: number, // Timestamp of the first kill in the camp (in milliseconds)
 *   latestKillTime: number, // Timestamp of the last kill in the camp (in milliseconds)
 *   type: string,         // Type of camp (e.g., "smartbomb", "standard")
 *   composition: object,   // Object containing details about camp composition (see campManager.js)
 *   metrics: object,      // Object containing various camp metrics (see campManager.js)
 *   probability: number,  // Calculated probability of the camp's existence (0-100)
 *   probabilityLog: array, // Array of strings detailing the probability calculation
 *   state: string,        // "CRASHED" or undefined
 * }
 */

const initialCamps = []; // Start with an empty array
export const camps = writable(initialCamps);

function setCamps(newCamps) {
  camps.set(newCamps);
}

socket.on("initialCamps", setCamps);
socket.on("campUpdate", setCamps);
