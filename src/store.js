import { writable, derived } from "svelte/store";

export const killmails = writable([]);
export const settings = writable({});

export const filteredKillmails = derived(
  [killmails, settings],
  ([$killmails, $settings]) => {
    return $killmails.filter((killmail) => {
      // Dropped Value Filter
      if (
        $settings.dropped_value_enabled &&
        killmail.zkb.droppedValue < $settings.dropped_value
      ) {
        return false;
      }

      // Total Value Filter
      if (
        $settings.total_value_enabled &&
        killmail.zkb.totalValue < $settings.total_value
      ) {
        return false;
      }

      // Points Filter
      if ($settings.points_enabled && killmail.zkb.points < $settings.points) {
        return false;
      }

      // NPC Only Filter
      if ($settings.npc_only && !killmail.zkb.npc) {
        return false;
      }

      // Solo Only Filter
      if ($settings.solo && !killmail.zkb.solo) {
        return false;
      }

      // AWOX Only Filter
      if ($settings.awox_only && !killmail.zkb.awox) {
        return false;
      }

      // Location Filter
      if (
        $settings.location_filter_enabled &&
        $settings.location_filter &&
        killmail.zkb.locationID !== parseInt($settings.location_filter)
      ) {
        return false;
      }

      // Ship Type Filter
      if (
        $settings.ship_type_filter_enabled &&
        killmail.killmail.victim.ship_type_id !== $settings.ship_type_filter
      ) {
        return false;
      }

      // Time Threshold Filter
      if ($settings.time_threshold_enabled) {
        const killTime = new Date(killmail.killmail.killmail_time).getTime();
        const currentTime = new Date().getTime();
        const timeDiff = (currentTime - killTime) / 1000; // Convert to seconds
        if (timeDiff > $settings.time_threshold) {
          return false;
        }
      }

      // If all filters pass, include the killmail
      return true;
    });
  }
);

export function clearKills() {
  killmails.set([]);
}
