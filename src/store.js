// store.js
import { writable } from 'svelte/store';

export const killmails = writable([]);
export const settings = writable({});

export function clearKills() {
    killmails.set([]); // Clear the killmails store
  }