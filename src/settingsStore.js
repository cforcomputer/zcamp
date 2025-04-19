// settingsStore.js
import { writable, derived } from "svelte/store";
import { DEFAULT_SETTINGS } from "./constants.js"; //
export const killmails = writable([]); //
export const filterLists = writable([]); //
export const profiles = writable([]); //
export { DEFAULT_SETTINGS } from "./constants.js"; //

const currentTime = writable(Date.now()); //
setInterval(() => {
  currentTime.set(Date.now()); //
}, 1000);
export const settings = writable({ ...DEFAULT_SETTINGS }); //

export const filteredKillmails = derived(
  [killmails, settings, filterLists],
  ([$killmails, $settings, $filterLists]) => {
    // Ensure settings and filterLists are initialized properly
    const currentSettings = { ...DEFAULT_SETTINGS, ...$settings }; // [cite: 2678]
    const currentFilterLists = Array.isArray($filterLists) ? $filterLists : [];

    const enabledFilters = currentFilterLists.filter((list) => list.enabled); //

    // Group enabled filters by type
    const filtersByType = enabledFilters.reduce((acc, list) => {
      const type = list.filter_type;
      if (!type) return acc; // Skip lists without a type
      if (!acc[type]) {
        acc[type] = { include: [], exclude: [] };
      }
      // Ensure ids are parsed correctly, default to empty array if invalid
      let parsedIds = [];
      try {
        if (typeof list.ids === "string") {
          parsedIds = JSON.parse(list.ids || "[]");
        } else if (Array.isArray(list.ids)) {
          parsedIds = list.ids;
        }
      } catch (e) {
        console.warn(
          `Failed to parse IDs for filter list ${list.id || list.name}:`,
          list.ids,
          e
        );
      }
      const validList = { ...list, ids: parsedIds.map(String) }; // Ensure IDs are strings

      if (list.is_exclude) {
        acc[type].exclude.push(validList);
      } else {
        acc[type].include.push(validList);
      }
      return acc;
    }, {});

    const filtered = $killmails.filter((killmail) => {
      // --- Base Filters (Applied First) ---

      // Triangulation Filter checks
      if (currentSettings.triangulation_filter_enabled) {
        //
        const pinpoints = killmail?.pinpoints;

        // Skip if no pinpoint data, unless 'none' is the *only* selected filter
        const enabledTypes = Object.entries(currentSettings)
          .filter(
            ([key, value]) =>
              key.startsWith("triangulation_") &&
              value === true &&
              key !== "triangulation_filter_enabled" &&
              key !== "triangulation_filter_exclude" &&
              key !== "triangulation_filter_near_stargate" &&
              key !== "triangulation_filter_near_celestial"
          )
          .map(([key]) => key.replace("triangulation_", ""));

        if (!pinpoints) {
          if (enabledTypes.length === 1 && enabledTypes[0] === "none") {
            // If only 'none' is checked and no pinpoints, it passes this specific filter part
          } else if (enabledTypes.length > 0) {
            return false; // If other types are checked but no pinpoints, fail
          }
          // If no types are checked or pinpoints exist, continue to other checks
        } else {
          if (enabledTypes.length > 0) {
            let matchesEnabledType = false;
            if (
              enabledTypes.includes("none") &&
              !pinpoints.triangulationPossible
            ) {
              matchesEnabledType = true;
            } else if (
              enabledTypes.includes("at_celestial") &&
              pinpoints.atCelestial
            ) {
              matchesEnabledType = true;
            } else if (
              enabledTypes.includes("direct_warp") &&
              pinpoints.triangulationType === "direct_warp"
            ) {
              matchesEnabledType = true;
            } else if (
              enabledTypes.includes("near_celestial") &&
              pinpoints.triangulationType === "near_celestial"
            ) {
              matchesEnabledType = true;
            } else if (
              enabledTypes.includes("via_bookspam") &&
              pinpoints.triangulationType === "via_bookspam"
            ) {
              matchesEnabledType = true;
            }

            if (!matchesEnabledType) return false; // Must match at least one enabled type if any are enabled
          }

          // Additional triangulation filters (applied regardless of specific type checks if enabled)
          if (
            currentSettings.triangulation_filter_near_stargate &&
            pinpoints?.nearestCelestial?.name
              ?.toLowerCase()
              .includes("stargate")
          ) {
            return false; //
          }
          if (
            currentSettings.triangulation_filter_near_celestial && // Check setting name
            (pinpoints?.atCelestial ||
              (pinpoints?.nearestCelestial &&
                !pinpoints?.nearestCelestial?.name
                  ?.toLowerCase()
                  .includes("stargate"))) // Check if near any celestial that isn't a stargate
          ) {
            return false; //
          }
          if (
            currentSettings.triangulation_filter_exclude && // Check setting name
            pinpoints?.triangulationPossible
          ) {
            return false; //
          }
        }
      }

      // Capital Ship Attacker Filter
      if (currentSettings.attacker_capital_filter_enabled) {
        //
        const hasCapitalAttacker = killmail.killmail.attackers.some(
          //
          (attacker) => {
            const attackerShipCategory =
              killmail.shipCategories?.attackers?.find(
                //
                (ship) => ship.shipTypeId === attacker.ship_type_id
              )?.category;
            if (attackerShipCategory === "capital") return true; //

            const shipTypeLabel = killmail.zkb.labels.find(
              (
                label //
              ) => label.startsWith(`shipType:${attacker.ship_type_id}:`) //
            );
            if (shipTypeLabel?.includes(":capital")) return true; //

            return false;
          }
        );
        if (!hasCapitalAttacker) {
          //
          return false;
        }
      }

      // Basic Value/Points/Flags Filters
      if (
        currentSettings.dropped_value_enabled && // [cite: 2503]
        killmail.zkb.droppedValue < currentSettings.dropped_value // [cite: 2506]
      ) {
        return false; // [cite: 2506]
      }

      if (
        currentSettings.total_value_enabled && // [cite: 2510]
        killmail.zkb.totalValue < currentSettings.total_value // [cite: 2511]
      ) {
        return false; // [cite: 2511]
      }

      if (
        currentSettings.points_enabled &&
        killmail.zkb.points < currentSettings.points
      ) {
        // [cite: 2518]
        return false; // [cite: 2518]
      }

      if (currentSettings.npc_only && !killmail.zkb.npc) {
        // [cite: 2520]
        return false; // [cite: 2520]
      }

      if (currentSettings.solo && !killmail.zkb.solo) {
        // [cite: 2522]
        return false; // [cite: 2522]
      }

      if (currentSettings.awox_only && !killmail.zkb.awox) {
        // [cite: 2523]
        return false; // [cite: 2523]
      }

      // Location type filters (using currentSettings)
      if (currentSettings.location_type_filter_enabled) {
        // [cite: 2491]
        const locationTypes = currentSettings.location_types || {}; // [cite: 2642]
        const hasEnabledTypes = Object.values(locationTypes).some(
          // [cite: 2644]
          (enabled) => enabled
        );
        if (hasEnabledTypes) {
          // [cite: 2645]
          const selectedTypes = Object.entries(locationTypes) // [cite: 2645]
            .filter(([_, enabled]) => enabled) // [cite: 2645]
            .map(([type, _]) => `loc:${type}`); // [cite: 2645]
          const hasUnknownEnabled = locationTypes.unknown; // [cite: 2646]
          const hasLocationLabel = killmail.zkb.labels.some(
            (
              label // [cite: 2647]
            ) => label.startsWith("loc:") // [cite: 2647]
          );
          if (
            // [cite: 2648]
            !killmail.zkb.labels.some(
              (
                label // [cite: 2648]
              ) => selectedTypes.includes(label) // [cite: 2648]
            ) &&
            !(hasUnknownEnabled && !hasLocationLabel) // [cite: 2648]
          ) {
            return false; // [cite: 2649]
          }
        }
      }

      // Victim Ship Type Filter (using currentSettings)
      if (currentSettings.ship_type_filter_enabled) {
        // [cite: 2665]
        const targetShipId = parseInt(currentSettings.ship_type_filter); // [cite: 2667]
        if (isNaN(targetShipId)) return false; // [cite: 2667]

        const victimShipId = killmail.killmail.victim.ship_type_id; // [cite: 2667]
        if (victimShipId !== targetShipId) {
          // [cite: 2667]
          const hasMatchingLabel = killmail.zkb.labels.some(
            // [cite: 2667]
            (label) =>
              label === `shipType:${targetShipId}` || // [cite: 2667]
              label.startsWith(`shipType:${targetShipId}:`) // [cite: 2667]
          );
          if (!hasMatchingLabel) return false; // [cite: 2667]
        }
      }

      // Time Threshold Filter (using currentSettings)
      if (currentSettings.time_threshold_enabled) {
        // [cite: 2513]
        const killTime = new Date(killmail.killmail.killmail_time).getTime(); // [cite: 2513]
        const now = Date.now(); // Get current time
        const timeDiff = (now - killTime) / 1000; // [cite: 2513]
        if (timeDiff > currentSettings.time_threshold) {
          // [cite: 2513]
          return false; // [cite: 2513]
        }
      }

      // Combat Label Filters (using currentSettings)
      if (
        currentSettings.combat_label_filter_enabled &&
        currentSettings.combat_labels
      ) {
        // [cite: 2531]
        const selectedLabels = Object.entries(currentSettings.combat_labels) // [cite: 2531]
          .filter(([_, enabled]) => enabled) // [cite: 2531]
          .map(([label, _]) => label); // [cite: 2531]
        if (selectedLabels.length > 0) {
          // [cite: 2664]
          const hasMatchingLabel = selectedLabels.some((selectedLabel) => {
            // [cite: 2664]
            if (killmail.zkb.labels.includes(selectedLabel)) return true; // [cite: 2664]

            if (
              // [cite: 2665]
              selectedLabel === "atShip" && // [cite: 2665]
              killmail.shipCategories?.victim?.category === "at" // [cite: 2665]
            )
              return true; // [cite: 2665]

            if (
              // [cite: 2665]
              selectedLabel === "ganked" && // [cite: 2665]
              killmail.zkb.labels.includes("ganked") // [cite: 2665]
            )
              return true; // [cite: 2666]
            if (selectedLabel === "pvp" && !killmail.zkb.npc) return true; // [cite: 2666]
            if (
              // [cite: 2666]
              selectedLabel === "padding" && // [cite: 2666]
              killmail.zkb.labels.includes("padding") // [cite: 2666]
            )
              return true; // [cite: 2667]

            return false;
          });
          if (!hasMatchingLabel) return false; // [cite: 2668]
        }
      }

      if (
        currentSettings.capitals_only &&
        !killmail.zkb.labels.includes("capital")
      ) {
        // [cite: 2564, 2668]
        return false; // [cite: 2668]
      }

      // --- Filter List Logic (Grouped) ---

      // Helper function to check if a killmail property matches any ID in a list
      const checkMatch = (propertyValue, idList) => {
        if (propertyValue === null || propertyValue === undefined) return false;
        // Ensure propertyValue is an array if it's not already
        const valuesToCheck = Array.isArray(propertyValue)
          ? propertyValue
          : [propertyValue];
        // Ensure IDs in the list are strings for comparison
        const stringIdList = idList.map((id) => String(id));
        // Check if any value matches any ID in the list
        return valuesToCheck.some((val) => stringIdList.includes(String(val)));
      };

      // Helper function to extract relevant property(s) from killmail based on filter type
      const getKillmailProperty = (type, km) => {
        switch (type) {
          case "attacker_alliance": // [cite: 2607]
            return km.killmail.attackers
              .map((a) => a.alliance_id)
              .filter(Boolean);
          case "attacker_corporation": // [cite: 2608]
            return km.killmail.attackers
              .map((a) => a.corporation_id)
              .filter(Boolean);
          case "attacker_ship_type": // [cite: 2609]
            return km.killmail.attackers
              .map((a) => a.ship_type_id)
              .filter(Boolean);
          case "victim_alliance": // [cite: 2612]
            return km.killmail.victim.alliance_id;
          case "victim_corporation": // [cite: 2613]
            return km.killmail.victim.corporation_id;
          case "ship_type": // Victim ship type // [cite: 2614]
            return km.killmail.victim.ship_type_id;
          case "solar_system": // [cite: 2615]
            return km.killmail.solar_system_id;
          case "region": {
            // [cite: 2616]
            const celestialData = km.pinpoints?.celestialData; // [cite: 2616]
            const isAbyssal = km.zkb.labels.includes("loc:abyssal"); // [cite: 2617]
            if (
              !celestialData?.regionid &&
              !celestialData?.regionname &&
              isAbyssal
            ) {
              // [cite: 2619]
              return "abyssal"; // Special value for abyssal matching
            }
            return celestialData?.regionid || km.system?.regionID; // Return ID // [cite: 2622, 2623]
          }
          // Add cases for other filter types if needed
          default:
            console.warn(
              `Unhandled filter type in getKillmailProperty: ${type}`
            );
            return null;
        }
      };

      for (const type in filtersByType) {
        const { include: includeLists, exclude: excludeLists } =
          filtersByType[type];

        // Check Include Filters (OR logic)
        if (includeLists.length > 0) {
          let passedInclude = false;
          for (const list of includeLists) {
            const killmailValue = getKillmailProperty(type, killmail);
            // Special handling for region matching name or ID
            if (type === "region" && killmailValue === "abyssal") {
              if (
                list.ids.some(
                  (id) =>
                    id.toLowerCase() === "abyssal" ||
                    id.toLowerCase() === "abyss"
                )
              ) {
                passedInclude = true;
                break;
              }
            } else if (type === "region") {
              const regionId = killmailValue; // Already extracted ID or 'abyssal'
              const regionName =
                killmail.pinpoints?.celestialData?.regionname ||
                killmail.system?.regionName;
              if (
                list.ids.some(
                  (id) =>
                    (regionId && id.toString() === regionId.toString()) ||
                    (regionName &&
                      id.toLowerCase() === regionName.toLowerCase())
                )
              ) {
                passedInclude = true;
                break;
              }
            } else if (checkMatch(killmailValue, list.ids)) {
              // Standard check for other types
              passedInclude = true;
              break;
            }
          }
          if (!passedInclude) return false; // Must match at least one 'include' list for this type
        }

        // Check Exclude Filters (NOR logic)
        if (excludeLists.length > 0) {
          for (const list of excludeLists) {
            const killmailValue = getKillmailProperty(type, killmail);
            // Special handling for region matching name or ID
            if (type === "region" && killmailValue === "abyssal") {
              if (
                list.ids.some(
                  (id) =>
                    id.toLowerCase() === "abyssal" ||
                    id.toLowerCase() === "abyss"
                )
              ) {
                return false; // Exclude if it matches abyssal
              }
            } else if (type === "region") {
              const regionId = killmailValue;
              const regionName =
                killmail.pinpoints?.celestialData?.regionname ||
                killmail.system?.regionName;
              if (
                list.ids.some(
                  (id) =>
                    (regionId && id.toString() === regionId.toString()) ||
                    (regionName &&
                      id.toLowerCase() === regionName.toLowerCase())
                )
              ) {
                return false; // Exclude if it matches region ID or name
              }
            } else if (checkMatch(killmailValue, list.ids)) {
              // Standard check for other types
              return false; // If it matches *any* exclude list, reject killmail
            }
          }
        }
      } // End loop through filter types

      // --- Passed all filters ---
      return true; // [cite: 2669]
    });

    return filtered.sort((a, b) => {
      // [cite: 2669]
      const timeA = new Date(a.killmail.killmail_time).getTime(); // [cite: 2669]
      const timeB = new Date(b.killmail.killmail_time).getTime(); // [cite: 2669]
      return timeB - timeA; // [cite: 2669]
    });
  }
);

export function clearKills() {
  // [cite: 2670]
  killmails.set([]); // [cite: 2670]
}

export function addFilterList(list) {
  // [cite: 2670]
  filterLists.update((lists) => [...lists, list]); // [cite: 2670]
}

export function updateFilterList(updatedList) {
  // [cite: 2671]
  filterLists.update(
    (
      lists // [cite: 2671]
    ) => lists.map((list) => (list.id === updatedList.id ? updatedList : list)) // [cite: 2671]
  );
}

export function deleteFilterList(id) {
  // [cite: 2672]
  filterLists.update((lists) => lists.filter((list) => list.id !== id)); // [cite: 2672]
}

export function addProfile(profile) {
  // [cite: 2673]
  profiles.update((existingProfiles) => {
    // [cite: 2673]
    const index = existingProfiles.findIndex((p) => p.id === profile.id); // [cite: 2673]
    if (index !== -1) {
      // [cite: 2673]
      // Update existing profile
      existingProfiles[index] = profile; // [cite: 2673]
      return [...existingProfiles]; // [cite: 2673]
    }
    // Add new profile
    return [...existingProfiles, profile]; // [cite: 2673]
  });
}

export function updateProfile(updatedProfile) {
  // [cite: 2674]
  profiles.update(
    (
      profs // [cite: 2674]
    ) =>
      profs.map((prof) =>
        prof.id === updatedProfile.id ? updatedProfile : prof
      ) // [cite: 2674]
  );
}

export function deleteProfile(id) {
  // [cite: 2675]
  profiles.update(
    (
      existingProfiles // [cite: 2675]
    ) => existingProfiles.filter((p) => p.id !== id) // [cite: 2675]
  );
}

export function initializeSettings(serverSettings) {
  // [cite: 2676]
  try {
    const parsedSettings = // [cite: 2676]
      typeof serverSettings === "string" // [cite: 2676]
        ? JSON.parse(serverSettings) // [cite: 2677]
        : serverSettings; // [cite: 2677]
    return {
      // [cite: 2678]
      ...DEFAULT_SETTINGS, // [cite: 2678]
      ...parsedSettings, // [cite: 2678]
      location_types: {
        // [cite: 2678]
        ...DEFAULT_SETTINGS.location_types, // [cite: 2678]
        ...(parsedSettings?.location_types || {}), // [cite: 2679]
      },
      combat_labels: {
        // [cite: 2679]
        ...DEFAULT_SETTINGS.combat_labels, // [cite: 2679]
        ...(parsedSettings?.combat_labels || {}), // [cite: 2679]
      },
      // Ensure triangulation settings are properly merged
      triangulation_filter_enabled:
        parsedSettings?.triangulation_filter_enabled ??
        DEFAULT_SETTINGS.triangulation_filter_enabled, // [cite: 2496]
      triangulation_at_celestial:
        parsedSettings?.triangulation_at_celestial ??
        DEFAULT_SETTINGS.triangulation_at_celestial, // [cite: 2500]
      triangulation_direct_warp:
        parsedSettings?.triangulation_direct_warp ??
        DEFAULT_SETTINGS.triangulation_direct_warp, // [cite: 2500]
      triangulation_near_celestial:
        parsedSettings?.triangulation_near_celestial ??
        DEFAULT_SETTINGS.triangulation_near_celestial, // [cite: 2501]
      triangulation_via_bookspam:
        parsedSettings?.triangulation_via_bookspam ??
        DEFAULT_SETTINGS.triangulation_via_bookspam, // [cite: 2501]
      triangulation_none:
        parsedSettings?.triangulation_none ??
        DEFAULT_SETTINGS.triangulation_none, // [cite: 2502]
      triangulation_filter_exclude:
        parsedSettings?.triangulation_filter_exclude ??
        DEFAULT_SETTINGS.triangulation_filter_exclude,
      triangulation_filter_near_stargate:
        parsedSettings?.triangulation_filter_near_stargate ??
        DEFAULT_SETTINGS.triangulation_filter_near_stargate,
      triangulation_filter_near_celestial:
        parsedSettings?.triangulation_filter_near_celestial ??
        DEFAULT_SETTINGS.triangulation_filter_near_celestial,
    };
  } catch (e) {
    // [cite: 2679]
    console.error("Error initializing settings:", e); // [cite: 2679]
    return DEFAULT_SETTINGS; // [cite: 2679]
  }
}
