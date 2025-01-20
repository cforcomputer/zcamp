// salvageStore.js
import { writable, derived } from "svelte/store";
import { killmails } from "./store.js";
import { SALVAGE_VALUES } from "./constants.js";

export const salvageFields = writable(new Map());

export function processNewKillmail(killmail) {
  salvageFields.update((fields) => {
    const now = Date.now();
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;

    // Clean up old wrecks first
    for (const [systemId, system] of fields) {
      system.wrecks = system.wrecks.filter((wreck) => wreck.expiryTime > now);
      if (system.wrecks.length === 0) {
        fields.delete(systemId);
      } else {
        // Recalculate total value
        system.totalValue = system.wrecks.reduce(
          (sum, wreck) => sum + wreck.estimatedValue,
          0
        );
      }
    }

    // Process new killmail if it's T2
    if (killmail.shipCategories?.victim?.tier === "T2") {
      const killTime = new Date(killmail.killmail.killmail_time).getTime();
      if (killTime < twoHoursAgo) return fields;

      const systemId = killmail.killmail.solar_system_id;
      const systemName =
        killmail.pinpoints?.celestialData?.solarsystemname ||
        `System ${systemId}`;
      const category = killmail.shipCategories.victim.category.toLowerCase();
      const estimatedValue = SALVAGE_VALUES[category] || SALVAGE_VALUES.unknown;
      const expiryTime = killTime + 2 * 60 * 60 * 1000;
      const isTriangulatable = killmail.pinpoints?.triangulationPossible;
      const nearestCelestial =
        killmail.pinpoints?.nearestCelestial?.name || "Unknown";

      if (!fields.has(systemId)) {
        fields.set(systemId, {
          systemName,
          wrecks: [],
          totalValue: 0,
          isTriangulatable,
          nearestCelestial,
        });
      }

      const system = fields.get(systemId);
      system.wrecks.push({
        shipName: killmail.shipCategories.victim.name,
        category,
        estimatedValue,
        expiryTime,
        isTriangulatable,
        killmailId: killmail.killID,
      });
      system.totalValue += estimatedValue;
    }

    return fields;
  });
}

// Process initial killmails and set up auto-cleanup
export function initializeSalvageFields(initialKillmails) {
  const fields = new Map();
  const now = Date.now();
  const twoHoursAgo = now - 2 * 60 * 60 * 1000;

  initialKillmails.forEach((killmail) => {
    if (killmail.shipCategories?.victim?.tier === "T2") {
      const killTime = new Date(killmail.killmail.killmail_time).getTime();
      if (killTime < twoHoursAgo) return;

      const systemId = killmail.killmail.solar_system_id;
      const systemName =
        killmail.pinpoints?.celestialData?.solarsystemname ||
        `System ${systemId}`;
      const category = killmail.shipCategories.victim.category.toLowerCase();
      const estimatedValue = SALVAGE_VALUES[category] || SALVAGE_VALUES.unknown;
      const expiryTime = killTime + 2 * 60 * 60 * 1000;
      const isTriangulatable = killmail.pinpoints?.triangulationPossible;
      const nearestCelestial =
        killmail.pinpoints?.nearestCelestial?.name || "Unknown";

      if (!fields.has(systemId)) {
        fields.set(systemId, {
          systemName,
          wrecks: [],
          totalValue: 0,
          isTriangulatable,
          nearestCelestial,
        });
      }

      const system = fields.get(systemId);
      system.wrecks.push({
        shipName: killmail.shipCategories.victim.name,
        category,
        estimatedValue,
        expiryTime,
        isTriangulatable,
        killmailId: killmail.killID,
      });
      system.totalValue += estimatedValue;
    }
  });

  salvageFields.set(fields);

  // Set up periodic cleanup
  setInterval(() => {
    salvageFields.update((fields) => {
      const now = Date.now();
      for (const [systemId, system] of fields) {
        system.wrecks = system.wrecks.filter((wreck) => wreck.expiryTime > now);
        if (system.wrecks.length === 0) {
          fields.delete(systemId);
        } else {
          system.totalValue = system.wrecks.reduce(
            (sum, wreck) => sum + wreck.estimatedValue,
            0
          );
        }
      }
      return fields;
    });
  }, 30000); // Clean up every 30 seconds
}

// Export a derived store that can be used to get sorted/filtered fields
export const filteredSalvageFields = derived(
  salvageFields,
  ($salvageFields) => $salvageFields
);
