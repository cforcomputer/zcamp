// src/campCrusherTargetStore.js
import { writable } from "svelte/store";

/**
 * Stores the ID of the currently selected Camp Crusher target activity.
 * Value is null if no target is selected.
 */
export const selectedCampCrusherTargetId = writable(null);

/**
 * Stores the calculated end time for the current target's countdown.
 * Value is null if no target is active or end time is unknown.
 */
export const currentTargetEndTime = writable(null);
