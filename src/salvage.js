// salvage.js
import { writable, derived } from "svelte/store";
import { SALVAGE_VALUES } from "./constants.js";

// Constants
const WRECK_TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
const CLEANUP_INTERVAL = 30000; // 30 seconds

// Stores
export const salvageFields = writable(new Map());

// Process new killmail for salvage opportunities
export function processNewSalvage(killmail) {
  salvageFields.update((fields) => {
    const now = Date.now();
    const twoHoursAgo = now - WRECK_TIMEOUT;

    // Clean up old wrecks first
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

    // Process new killmail if it's T2
    if (killmail.shipCategories?.victim?.tier === "T2") {
      const killTime = new Date(killmail.killmail.killmail_time).getTime();
      if (killTime < twoHoursAgo) return fields;

      const systemId = killmail.killmail.solar_system_id;
      const systemName =
        killmail.pinpoints?.celestialData?.systemName || `System ${systemId}`;
      const regionName =
        killmail.pinpoints?.celestialData?.regionName || "Unknown Region";
      const category = killmail.shipCategories.victim.category.toLowerCase();
      const estimatedValue = SALVAGE_VALUES[category] || SALVAGE_VALUES.unknown;
      const expiryTime = killTime + WRECK_TIMEOUT;
      const isTriangulatable = killmail.pinpoints?.triangulationPossible;
      const nearestCelestial =
        killmail.pinpoints?.nearestCelestial?.name || "Unknown";

      if (!fields.has(systemId)) {
        fields.set(systemId, {
          systemName,
          regionName,
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
        celestialData: killmail.pinpoints?.celestialData,
      });
      system.totalValue += estimatedValue;
    }

    return fields;
  });
}

// Initialize salvage tracking
export function initializeSalvage(initialKillmails) {
  const fields = new Map();
  const now = Date.now();
  const twoHoursAgo = now - WRECK_TIMEOUT;

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
      const expiryTime = killTime + WRECK_TIMEOUT;
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
  const cleanupInterval = setInterval(() => {
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
  }, CLEANUP_INTERVAL);

  return cleanupInterval;
}

// Derived store for filtered/sorted salvage fields
export const filteredSalvageFields = derived(
  salvageFields,
  ($salvageFields) => {
    return Array.from($salvageFields.entries()).sort(
      ([, a], [, b]) => b.totalValue - a.totalValue
    );
  }
);

// Cleanup function
export function cleanup() {
  salvageFields.set(new Map());
}

export function getTimeRemaining(expiryTime) {
  const now = Date.now();
  return Math.max(0, Math.floor((expiryTime - now) / 1000 / 60));
}
