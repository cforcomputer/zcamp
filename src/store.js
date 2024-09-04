import { writable, derived } from "svelte/store";

export const killmails = writable([]);
export const settings = writable({});

// New store for filtered killmails
export const filteredKillmails = derived(
  [killmails, settings],
  ([$killmails, $settings]) => {
    return $killmails.filter((killmail) => {
      // Apply filters based on settings
      if (
        $settings.dropped_value_enabled &&
        killmail.zkb.droppedValue < $settings.dropped_value
      ) {
        return false;
      }
      if ($settings.time_threshold_enabled) {
        const killTime = new Date(killmail.killmail.killmail_time).getTime();
        const currentTime = new Date().getTime();
        const timeDiff = (currentTime - killTime) / 1000; // Convert to seconds
        if (timeDiff > $settings.time_threshold) {
          return false;
        }
      }
      if ($settings.npc_only && !killmail.zkb.npc) {
        return false;
      }
      if ($settings.solo && killmail.zkb.solo !== true) {
        return false;
      }
      // Add more filter conditions here as needed
      return true;
    });
  }
);

export function clearKills() {
  killmails.set([]);
}
