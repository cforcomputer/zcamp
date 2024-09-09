import { writable, derived } from "svelte/store";

export const killmails = writable([]);
export const settings = writable({});
export const filterLists = writable([]);
export const profiles = writable([]);

export const filteredKillmails = derived(
  [killmails, settings, filterLists],
  ([$killmails, $settings, $filterLists]) => {
    return $killmails.filter((killmail) => {
      // Apply filter lists
      for (let list of $filterLists) {
        if (!list.enabled) continue; // Skip disabled filter lists

        const ids = Array.isArray(list.ids) ? list.ids : JSON.parse(list.ids);
        let match = false;

        switch (list.filter_type) {
          case "attacker_alliance":
            match = killmail.killmail.attackers.some((attacker) =>
              ids.includes(attacker.alliance_id?.toString())
            );
            break;
          case "attacker_corporation":
            match = killmail.killmail.attackers.some((attacker) =>
              ids.includes(attacker.corporation_id?.toString())
            );
            break;
          case "attacker_ship_type":
            match = killmail.killmail.attackers.some((attacker) =>
              ids.includes(attacker.ship_type_id?.toString())
            );
            break;
          case "victim_alliance":
            match = ids.includes(
              killmail.killmail.victim.alliance_id?.toString()
            );
            break;
          case "victim_corporation":
            match = ids.includes(
              killmail.killmail.victim.corporation_id?.toString()
            );
            break;
          case "ship_type":
            match = ids.includes(
              killmail.killmail.victim.ship_type_id?.toString()
            );
            break;
          case "solar_system":
            match = ids.includes(killmail.killmail.solar_system_id?.toString());
            break;
        }

        if (list.is_exclude && match) return false;
        if (!list.is_exclude && !match) return false;
      }

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

      // Attacker Alliance Filter
      if (
        $settings.attacker_alliance_filter_enabled &&
        $settings.attacker_alliance_filter &&
        !killmail.killmail.attackers.some(
          (attacker) =>
            attacker.alliance_id ===
            parseInt($settings.attacker_alliance_filter)
        )
      ) {
        return false;
      }

      // Attacker Corporation Filter
      if (
        $settings.attacker_corporation_filter_enabled &&
        $settings.attacker_corporation_filter &&
        !killmail.killmail.attackers.some(
          (attacker) =>
            attacker.corporation_id ===
            parseInt($settings.attacker_corporation_filter)
        )
      ) {
        return false;
      }

      // Attacker Ship Type Filter
      if (
        $settings.attacker_ship_type_filter_enabled &&
        $settings.attacker_ship_type_filter &&
        !killmail.killmail.attackers.some(
          (attacker) =>
            attacker.ship_type_id ===
            parseInt($settings.attacker_ship_type_filter)
        )
      ) {
        return false;
      }

      // Victim Alliance Filter
      if (
        $settings.victim_alliance_filter_enabled &&
        $settings.victim_alliance_filter &&
        killmail.killmail.victim.alliance_id !==
          parseInt($settings.victim_alliance_filter)
      ) {
        return false;
      }

      // Victim Corporation Filter
      if (
        $settings.victim_corporation_filter_enabled &&
        $settings.victim_corporation_filter &&
        killmail.killmail.victim.corporation_id !==
          parseInt($settings.victim_corporation_filter)
      ) {
        return false;
      }

      // Item Type Filter
      if (
        $settings.item_type_filter_enabled &&
        $settings.item_type_filter &&
        !killmail.killmail.victim.items.some(
          (item) => item.item_type_id === parseInt($settings.item_type_filter)
        )
      ) {
        return false;
      }

      // Solar System Filter
      if (
        $settings.solar_system_filter_enabled &&
        $settings.solar_system_filter &&
        killmail.killmail.solar_system_id !==
          parseInt($settings.solar_system_filter)
      ) {
        return false;
      }

      // If all filters pass, include the killmail
      return true;
    });
  }
);

export function clearKills() {
  killmails.set([]);
}

export function addFilterList(list) {
  filterLists.update((lists) => [...lists, list]);
}

export function updateFilterList(updatedList) {
  filterLists.update((lists) =>
    lists.map((list) => (list.id === updatedList.id ? updatedList : list))
  );
}

export function deleteFilterList(id) {
  filterLists.update((lists) => lists.filter((list) => list.id !== id));
}

export function addProfile(profile) {
  profiles.update((profs) => [...profs, profile]);
}

export function updateProfile(updatedProfile) {
  profiles.update((profs) =>
    profs.map((prof) => (prof.id === updatedProfile.id ? updatedProfile : prof))
  );
}

export function deleteProfile(id) {
  profiles.update((profs) => profs.filter((prof) => prof.id !== id));
}
