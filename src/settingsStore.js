import { writable, derived } from "svelte/store";
import { DEFAULT_SETTINGS } from "./constants.js";

export const killmails = writable([]);
export const filterLists = writable([]);
export const profiles = writable([]);
export { DEFAULT_SETTINGS } from "./constants.js";

const currentTime = writable(Date.now());
setInterval(() => {
  currentTime.set(Date.now());
}, 1000);

export const settings = writable({ ...DEFAULT_SETTINGS });

export const filteredKillmails = derived(
  [killmails, settings, filterLists],
  ([$killmails, $settings, $filterLists]) => {
    const filtered = $killmails.filter((killmail) => {
      // Triangulation Filter checks
      if ($settings.triangulation_filter_enabled) {
        const pinpoints = killmail?.pinpoints;

        // Skip if no pinpoint data
        if (!pinpoints) return false;

        // Check specific triangulation types if any are enabled
        const enabledTypes = [
          {
            setting: $settings.triangulation_at_celestial,
            type: "at_celestial",
          },
          { setting: $settings.triangulation_direct_warp, type: "direct_warp" },
          {
            setting: $settings.triangulation_near_celestial,
            type: "near_celestial",
          },
          {
            setting: $settings.triangulation_via_bookspam,
            type: "via_bookspam",
          },
          { setting: $settings.triangulation_none, type: "none" },
        ].filter((t) => t.setting);

        if (enabledTypes.length > 0) {
          // If none is selected, check for non-triangulatable kills
          if (
            $settings.triangulation_none &&
            !pinpoints.triangulationPossible
          ) {
            return true;
          }

          // Check for specific triangulation types
          const matchesType = enabledTypes.some(({ type }) => {
            switch (type) {
              case "at_celestial":
                return pinpoints.atCelestial;
              case "direct_warp":
                return pinpoints.triangulationType === "direct_warp";
              case "near_celestial":
                return pinpoints.triangulationType === "near_celestial";
              case "via_bookspam":
                return pinpoints.triangulationType === "via_bookspam";
              default:
                return false;
            }
          });

          if (!matchesType) return false;
        }

        // Additional triangulation filters
        if (
          $settings.triangulation_filter_near_stargate &&
          pinpoints?.nearestCelestial?.name?.toLowerCase().includes("stargate")
        ) {
          return false;
        }

        if (
          $settings.triangulation_filter_near_celestial &&
          (pinpoints?.atCelestial || pinpoints?.nearestCelestial)
        ) {
          return false;
        }

        if (
          $settings.triangulation_filter_exclude &&
          pinpoints?.triangulationPossible
        ) {
          return false;
        }
      }

      // Capital Ship Attacker Filter
      if ($settings.attacker_capital_filter_enabled) {
        const hasCapitalAttacker = killmail.killmail.attackers.some(
          (attacker) => {
            // First check killmail categories
            const attackerShipCategory =
              killmail.shipCategories?.attackers?.find(
                (ship) => ship.shipTypeId === attacker.ship_type_id
              )?.category;
            if (attackerShipCategory === "capital") return true;

            // Then check labels
            const shipType = killmail.zkb.labels.find((label) =>
              label.startsWith(`shipType:${attacker.ship_type_id}:`)
            );
            if (shipType?.includes(":capital")) return true;

            return false;
          }
        );

        if (!hasCapitalAttacker) {
          return false;
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

            // Check if this is an Abyssal killmail
            const isAbyssal = killmail.zkb.labels.includes("loc:abyssal");

            // If region is null and it's an Abyssal location
            if (
              !celestialData?.regionid &&
              !celestialData?.regionname &&
              isAbyssal
            ) {
              // Special handling for Abyssal regions
              const idList = Array.isArray(ids) ? ids : [ids];
              match = idList.some(
                (id) =>
                  id.toLowerCase() === "abyssal" || id.toLowerCase() === "abyss"
              );
              break;
            }

            // Handle unknown regions with direct ID match
            if (!celestialData?.regionid && !celestialData?.regionname) {
              match = ids.includes(killmail.system?.regionID?.toString());
              break;
            }

            // Rest of existing region filter logic
            const idList = Array.isArray(ids) ? ids : [ids];
            match = idList.some((id) => {
              const targetId = id.toString().toLowerCase();
              return (
                (celestialData.regionid &&
                  celestialData.regionid.toString() === targetId) ||
                (celestialData.regionname &&
                  celestialData.regionname.toLowerCase() === targetId) ||
                (killmail.system?.regionID &&
                  killmail.system.regionID.toString() === targetId) ||
                (killmail.system?.regionName &&
                  killmail.system.regionName.toLowerCase() === targetId)
              );
            });
            break;
          }
          case "location_type":
            match = killmail.zkb.labels.some((label) =>
              ids.includes(label.replace("loc:", ""))
            );
            if (!match && ids.includes("unknown")) {
              match = !killmail.zkb.labels.some((label) =>
                label.startsWith("loc:")
              );
            }
            break;
          case "ship_category": {
            // First check direct labels
            match = killmail.zkb.labels.some(
              (label) =>
                (label.startsWith("cat:") || label === "capital") &&
                ids.includes(label.replace("cat:", ""))
            );

            // If no match and we have ship categories data, check that
            if (!match && killmail.shipCategories) {
              const victimCat =
                killmail.shipCategories.victim?.category?.toLowerCase();
              match = victimCat && ids.includes(victimCat);
            }
            break;
          }
          case "combat_type": {
            // Direct label match first
            match = killmail.zkb.labels.some(
              (label) =>
                ids.includes(label) &&
                ["atShip", "ganked", "pvp", "padding"].includes(label)
            );

            // Special handling for AT ships
            if (!match && ids.includes("atShip")) {
              match = killmail.shipCategories?.victim?.category === "at";
            }
            break;
          }
        }

        if (list.is_exclude && match) return false;
        if (!list.is_exclude && !match) return false;
      }

      // Basic filters
      if (
        $settings.dropped_value_enabled &&
        killmail.zkb.droppedValue < $settings.dropped_value
      ) {
        return false;
      }

      if (
        $settings.total_value_enabled &&
        killmail.zkb.totalValue < $settings.total_value
      ) {
        return false;
      }

      if ($settings.points_enabled && killmail.zkb.points < $settings.points) {
        return false;
      }

      if ($settings.npc_only && !killmail.zkb.npc) {
        return false;
      }

      if ($settings.solo && !killmail.zkb.solo) {
        return false;
      }

      if ($settings.awox_only && !killmail.zkb.awox) {
        return false;
      }

      // Location type filters
      if ($settings.location_type_filter_enabled) {
        const locationTypes = $settings.location_types || {
          highsec: false,
          lowsec: false,
          nullsec: false,
          wspace: false,
          abyssal: false,
        };

        const hasEnabledTypes = Object.values(locationTypes).some(
          (enabled) => enabled
        );

        if (hasEnabledTypes) {
          const selectedTypes = Object.entries(locationTypes)
            .filter(([_, enabled]) => enabled)
            .map(([type, _]) => `loc:${type}`);

          // Handle unknown locations
          const hasUnknownEnabled = locationTypes.unknown;
          const hasLocationLabel = killmail.zkb.labels.some((label) =>
            label.startsWith("loc:")
          );

          if (
            !killmail.zkb.labels.some((label) =>
              selectedTypes.includes(label)
            ) &&
            !(hasUnknownEnabled && !hasLocationLabel)
          ) {
            return false;
          }
        }
      }

      // Ship Type Filter
      if ($settings.ship_type_filter_enabled) {
        const targetShipId = parseInt($settings.ship_type_filter);
        if (isNaN(targetShipId)) return false;

        const victimShipId = killmail.killmail.victim.ship_type_id;
        if (victimShipId !== targetShipId) {
          // Check alternative ship type references
          const hasMatchingLabel = killmail.zkb.labels.some(
            (label) =>
              label === `shipType:${targetShipId}` ||
              label.startsWith(`shipType:${targetShipId}:`)
          );
          if (!hasMatchingLabel) return false;
        }
      }

      // Time Threshold Filter
      if ($settings.time_threshold_enabled) {
        const killTime = new Date(killmail.killmail.killmail_time).getTime();
        const currentTime = new Date().getTime();
        const timeDiff = (currentTime - killTime) / 1000;
        if (timeDiff > $settings.time_threshold) {
          return false;
        }
      }

      // Attacker Filters
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

      // Victim Filters
      if (
        $settings.victim_alliance_filter_enabled &&
        $settings.victim_alliance_filter &&
        killmail.killmail.victim.alliance_id !==
          parseInt($settings.victim_alliance_filter)
      ) {
        return false;
      }

      if (
        $settings.victim_corporation_filter_enabled &&
        $settings.victim_corporation_filter &&
        killmail.killmail.victim.corporation_id !==
          parseInt($settings.victim_corporation_filter)
      ) {
        return false;
      }

      if (
        $settings.item_type_filter_enabled &&
        $settings.item_type_filter &&
        !killmail.killmail.victim.items.some(
          (item) => item.item_type_id === parseInt($settings.item_type_filter)
        )
      ) {
        return false;
      }

      if (
        $settings.solar_system_filter_enabled &&
        $settings.solar_system_filter &&
        killmail.killmail.solar_system_id !==
          parseInt($settings.solar_system_filter)
      ) {
        return false;
      }

      // Location Filter
      if ($settings.location_filter_enabled && $settings.location_filter) {
        const locationLabel = `loc:${$settings.location_filter}`;
        const hasLocationLabel = killmail.zkb.labels.includes(locationLabel);
        if (!hasLocationLabel) {
          return false;
        }
      }

      // Combat Label Filters
      if ($settings.combat_label_filter_enabled && $settings.combat_labels) {
        const selectedLabels = Object.entries($settings.combat_labels)
          .filter(([_, enabled]) => enabled)
          .map(([label, _]) => label);

        if (selectedLabels.length > 0) {
          const hasMatchingLabel = selectedLabels.some((selectedLabel) => {
            // Direct label match
            if (killmail.zkb.labels.includes(selectedLabel)) return true;

            // Special case for AT ships
            if (
              selectedLabel === "atShip" &&
              killmail.shipCategories?.victim?.category === "at"
            )
              return true;

            // Check derived combat labels
            if (
              selectedLabel === "ganked" &&
              killmail.zkb.labels.includes("ganked")
            )
              return true;
            if (selectedLabel === "pvp" && !killmail.zkb.npc) return true;
            if (
              selectedLabel === "padding" &&
              killmail.zkb.labels.includes("padding")
            )
              return true;

            return false;
          });

          if (!hasMatchingLabel) return false;
        }
      }

      if ($settings.capitals_only && !killmail.zkb.labels.includes("capital")) {
        return false;
      }

      return true;
    });

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
  profiles.update((existingProfiles) => {
    const index = existingProfiles.findIndex((p) => p.id === profile.id);
    if (index !== -1) {
      // Update existing profile
      existingProfiles[index] = profile;
      return [...existingProfiles];
    }
    // Add new profile
    return [...existingProfiles, profile];
  });
}

export function updateProfile(updatedProfile) {
  profiles.update((profs) =>
    profs.map((prof) => (prof.id === updatedProfile.id ? updatedProfile : prof))
  );
}

export function deleteProfile(id) {
  profiles.update((existingProfiles) =>
    existingProfiles.filter((p) => p.id !== id)
  );
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
