import { writable, derived } from "svelte/store";

export const killmails = writable([]);
export const filterLists = writable([]);
export const profiles = writable([]);

const DEFAULT_SETTINGS = {
  dropped_value_enabled: false,
  total_value_enabled: false,
  points_enabled: false,
  npc_only: false,
  solo: false,
  awox_only: false,
  location_filter_enabled: false,
  ship_type_filter_enabled: false,
  time_threshold_enabled: false,
  audio_alerts_enabled: false,
  attacker_alliance_filter_enabled: false,
  attacker_corporation_filter_enabled: false,
  attacker_ship_type_filter_enabled: false,
  victim_alliance_filter_enabled: false,
  victim_corporation_filter_enabled: false,
  solar_system_filter_enabled: false,
  item_type_filter_enabled: false,
  triangulation_filter_enabled: false,
  triangulation_filter_exclude: false,
  webhook_enabled: false,
  webhook_url: "",
  // location type/new filters
  location_type_filter_enabled: false,
  location_types: {
    highsec: false,
    lowsec: false,
    nullsec: false,
    wspace: false,
    abyssal: false,
  },
  combat_label_filter_enabled: false,
  combat_labels: {
    ganked: false,
    pvp: false,
    padding: false,
  },
};
export const settings = writable(DEFAULT_SETTINGS);
export const filteredKillmails = derived(
  [killmails, settings, filterLists],
  ([$killmails, $settings, $filterLists]) => {
    const filtered = $killmails.filter((killmail) => {
      // Triangulation Filter check
      if ($settings.triangulation_filter_enabled) {
        const isTriangulatable =
          killmail?.pinpoints?.triangulationPossible || false;
        if ($settings.triangulation_filter_exclude) {
          if (isTriangulatable) return false;
        } else {
          if (!isTriangulatable) return false;
        }
      }

      // Apply filter lists
      for (let list of $filterLists) {
        if (!list.enabled) continue;

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
          case "triangulation":
            match = killmail?.pinpoints?.triangulationPossible || false;
            if (list.is_exclude && match) return false;
            if (!list.is_exclude && !match) return false;
            continue;
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
          case "region": {
            const celestialData = killmail.pinpoints?.celestialData;
            if (!celestialData) return false;

            // Debug log to verify data
            console.log("Region Filter - Comparing:", {
              celestialRegionId: celestialData.regionid,
              celestialRegionName: celestialData.regionname,
              filterIds: ids,
            });

            // Ensure ids is an array
            const idList = Array.isArray(ids) ? ids : [ids];

            // Compare both ID and name, accounting for string/number conversion
            match = idList.some((id) => {
              const matchesId =
                celestialData.regionid.toString() === id.toString();
              const matchesName =
                celestialData.regionname.toLowerCase() ===
                id.toString().toLowerCase();

              // Debug log for each comparison
              console.log("Comparing:", {
                id,
                matchesId,
                matchesName,
                celestialRegionId: celestialData.regionid,
                celestialRegionName: celestialData.regionname,
              });

              return matchesId || matchesName;
            });

            break;
          }
          case "location_type":
            match = killmail.zkb.labels.some((label) =>
              ids.includes(label.replace("loc:", ""))
            );
            break;
          case "ship_category":
            match = killmail.zkb.labels.some(
              (label) =>
                (label.startsWith("cat:") || label === "capital") &&
                ids.includes(label.replace("cat:", ""))
            );
            break;
          case "combat_type":
            match = killmail.zkb.labels.some(
              (label) =>
                ids.includes(label) &&
                ["atShip", "ganked", "pvp", "padding"].includes(label)
            );
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
      // Location Type Filter
      if ($settings.location_type_filter_enabled && $settings.location_types) {
        const selectedTypes = Object.entries(
          $settings.location_types || {
            highsec: false,
            lowsec: false,
            nullsec: false,
            wspace: false,
            abyssal: false,
          }
        )
          .filter(([_, enabled]) => enabled)
          .map(([type, _]) => `loc:${type}`);
        if (
          selectedTypes.length > 0 &&
          !killmail.zkb.labels.some((label) => selectedTypes.includes(label))
        ) {
          return false;
        }
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

      // Location Type Filter
      if ($settings.location_type_filter_enabled) {
        const selectedTypes = Object.entries(settings.location_types)
          .filter(([_, enabled]) => enabled)
          .map(([type, _]) => `loc:${type}`);
        if (
          selectedTypes.length > 0 &&
          !killmail.zkb.labels.some((label) => selectedTypes.includes(label))
        ) {
          return false;
        }
      }

      // Ship Category Filter
      // When capitals only is enabled
      if ($settings.capitals_only && !killmail.zkb.labels.includes("capital")) {
        return false;
      }

      // Combat Type Filter
      if ($settings.combat_label_filter_enabled && $settings.combat_labels) {
        const selectedLabels = Object.entries(
          $settings.combat_labels || {
            ganked: false,
            pvp: false,
            padding: false,
          }
        )
          .filter(([_, enabled]) => enabled)
          .map(([label, _]) => label);
        if (
          selectedLabels.length > 0 &&
          !killmail.zkb.labels.some((label) => selectedLabels.includes(label))
        ) {
          return false;
        }
      }

      return true;
    });

    // Sort the filtered results by killmail_time in descending order
    return filtered.sort((a, b) => {
      const timeA = new Date(a.killmail.killmail_time).getTime();
      const timeB = new Date(b.killmail.killmail_time).getTime();
      return timeB - timeA;
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

export function initializeSettings(serverSettings) {
  try {
    const parsedSettings =
      typeof serverSettings === "string"
        ? JSON.parse(serverSettings)
        : serverSettings;

    return {
      ...DEFAULT_SETTINGS,
      ...parsedSettings,
      location_types: {
        ...DEFAULT_SETTINGS.location_types,
        ...(parsedSettings?.location_types || {}),
      },
      combat_labels: {
        ...DEFAULT_SETTINGS.combat_labels,
        ...(parsedSettings?.combat_labels || {}),
      },
    };
  } catch (e) {
    console.error("Error initializing settings:", e);
    return DEFAULT_SETTINGS;
  }
}
