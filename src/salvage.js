import { writable, derived } from "svelte/store";

// Initialize the store with an empty Map
export const salvageFields = writable(new Map());

// process killmail for salvage.js, imported by dataManager.js
export function processNewSalvage(killmail) {
  // Early validation
  if (!killmail?.killmail) return null;

  const { solar_system_id, killmail_time, victim } = killmail.killmail;
  const { position } = victim;
  const { totalValue } = killmail.zkb;

  // Skip if no position data
  if (!position) return null;

  // Calculate expiry time (2 hours from killmail time)
  const expiryTime = new Date(killmail_time).getTime() + 2 * 60 * 60 * 1000;

  // Process triangulation data
  const triangulationStatus = getDetailedTriangulationStatus(
    killmail.pinpoints
  );

  // Get system info from celestial data if available
  const systemInfo = {
    name:
      killmail.pinpoints?.celestialData?.solarsystemname ||
      `System ${solar_system_id}`,
    security: killmail.pinpoints?.celestialData?.security || "unknown",
    regionName: killmail.pinpoints?.celestialData?.regionname || "unknown",
  };

  return {
    systemId: solar_system_id,
    systemInfo,
    position,
    expiryTime,
    value: totalValue,
    triangulationStatus,
    nearestCelestial: killmail.pinpoints?.nearestCelestial?.name || null,
  };
}

function getDetailedTriangulationStatus(pinpoints) {
  if (!pinpoints) {
    return {
      isTriangulatable: false,
      triangulationType: null,
      atCelestial: false,
      nearCelestial: false,
      nearestCelestial: null,
      points: [],
    };
  }

  let triangulationType = "direct";
  if (pinpoints.triangulationType === "via_bookspam") {
    triangulationType = "via_bookspam";
  } else if (pinpoints.atCelestial) {
    triangulationType = "at_celestial";
  } else if (pinpoints.nearestCelestial && pinpoints.triangulationPossible) {
    triangulationType = "near_celestial";
  }

  return {
    isTriangulatable: pinpoints.triangulationPossible,
    triangulationType,
    atCelestial: pinpoints.atCelestial,
    nearCelestial: pinpoints.nearestCelestial !== null,
    nearestCelestial: pinpoints.nearestCelestial?.name || null,
    points: pinpoints.points || [],
  };
}

export function initializeSalvage(killmails) {
  // Clear and rebuild the salvage fields
  salvageFields.update((fields) => {
    fields.clear();

    killmails.forEach((killmail) => {
      const wreck = processNewSalvage(killmail);
      if (!wreck) return;

      const existingField = fields.get(wreck.systemId) || {
        systemName: wreck.systemInfo.name,
        systemId: wreck.systemId,
        securityType: getSecurity(wreck.systemInfo),
        wrecks: [],
        totalValue: 0,
        isTriangulatable: false,
        triangulationType: null,
        atCelestial: false,
        nearCelestial: false,
        nearestCelestial: null,
        triangulationPoints: [],
      };

      // Update field triangulation status based on the new wreck
      if (wreck.triangulationStatus.isTriangulatable) {
        existingField.isTriangulatable = true;

        // Set best available triangulation type
        if (
          !existingField.triangulationType ||
          shouldUpdateTriangulationType(
            existingField.triangulationType,
            wreck.triangulationStatus.triangulationType
          )
        ) {
          existingField.triangulationType =
            wreck.triangulationStatus.triangulationType;
          existingField.triangulationPoints = wreck.triangulationStatus.points;
        }

        // Update celestial status
        existingField.atCelestial =
          existingField.atCelestial || wreck.triangulationStatus.atCelestial;
        existingField.nearCelestial =
          existingField.nearCelestial ||
          wreck.triangulationStatus.nearCelestial;

        // Update nearest celestial if it's closer than current
        if (
          !existingField.nearestCelestial ||
          (wreck.nearestCelestial &&
            (!existingField.nearestCelestial ||
              wreck.triangulationStatus.nearestCelestial))
        ) {
          existingField.nearestCelestial = wreck.nearestCelestial;
        }
      }

      // Add the wreck to the field
      existingField.wrecks.push({
        position: wreck.position,
        value: wreck.value,
        expiryTime: wreck.expiryTime,
        triangulationType: wreck.triangulationStatus.triangulationType,
        triangulationPoints: wreck.triangulationStatus.points,
      });

      // Update total value
      existingField.totalValue = existingField.wrecks.reduce(
        (sum, w) => sum + w.value,
        0
      );

      fields.set(wreck.systemId, existingField);
    });

    return fields;
  });

  // Set up cleanup interval
  const cleanupInterval = setInterval(cleanup, 60000); // Clean up every minute
  return cleanupInterval;
}

function shouldUpdateTriangulationType(currentType, newType) {
  const typeRanking = {
    at_celestial: 1,
    near_celestial: 2,
    direct: 3,
    via_bookspam: 4,
  };

  return typeRanking[newType] < typeRanking[currentType];
}

function getSecurity(systemInfo) {
  const regionName = systemInfo.regionName.toLowerCase();

  if (regionName.includes("wormhole")) return "wormhole";
  if (regionName.includes("null")) return "null";
  if (regionName.includes("low")) return "low";
  return "high";
}

export function cleanup() {
  const now = Date.now();

  salvageFields.update((fields) => {
    for (const [systemId, field] of fields.entries()) {
      // Remove expired wrecks
      field.wrecks = field.wrecks.filter((wreck) => wreck.expiryTime > now);

      // Recalculate total value
      field.totalValue = field.wrecks.reduce((sum, w) => sum + w.value, 0);

      // Recalculate triangulation status if wrecks changed
      if (field.wrecks.length === 0) {
        fields.delete(systemId);
      } else {
        // Update triangulation status based on remaining wrecks
        field.isTriangulatable = field.wrecks.some((w) => w.triangulationType);
        field.triangulationType = getBestTriangulationType(field.wrecks);
        field.atCelestial = field.wrecks.some(
          (w) => w.triangulationType === "at_celestial"
        );
        field.nearCelestial = field.wrecks.some(
          (w) => w.triangulationType === "near_celestial"
        );
      }
    }
    return fields;
  });
}

function getBestTriangulationType(wrecks) {
  if (wrecks.some((w) => w.triangulationType === "at_celestial"))
    return "at_celestial";
  if (wrecks.some((w) => w.triangulationType === "near_celestial"))
    return "near_celestial";
  if (wrecks.some((w) => w.triangulationType === "direct")) return "direct";
  if (wrecks.some((w) => w.triangulationType === "via_bookspam"))
    return "via_bookspam";
  return null;
}

// Export the filtered store
export const filteredSalvageFields = derived(salvageFields, ($salvageFields) =>
  Array.from($salvageFields.entries())
);
