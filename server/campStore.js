// new campstore.js
import { writable, derived } from "svelte/store";
import socket from "../src/socket.js";
import roamStore from "./roamStore.js";

export const CAMP_TIMEOUT = 60 * 60 * 1000; // 1 hour
export const ROAM_TIMEOUT = 30 * 60 * 1000; // 30 minutes
export const CAPSULE_ID = 670;

let lastExportTime = Date.now();
const EXPORT_INTERVAL = 60 * 60 * 1000; // 1 hour

export const activeRoams = writable([]);

export const activeCamps = writable([]);
export const filteredCamps = derived([activeCamps], ([$activeCamps]) => {
  return $activeCamps
    .map((camp) => ({
      ...camp,
      nonPodKills: camp.kills.filter(
        (k) => k.killmail.victim.ship_type_id !== CAPSULE_ID
      ).length,
      composition: camp.composition || DEFAULT_COMPOSITION,
      lastKillTime: new Date(camp.lastKill).getTime(),
      age: Date.now() - new Date(camp.lastKill).getTime(),
      isActive: Date.now() - new Date(camp.lastKill).getTime() <= CAMP_TIMEOUT,
      firstKillTime: camp.firstKillTime,
      latestKillTime: camp.latestKillTime,
    }))
    .filter((camp) => camp.nonPodKills > 0)
    .sort((a, b) => b.probability - a.probability);
});

export const filteredRoams = derived(
  [activeRoams, activeCamps],
  ([$activeRoams, $activeCamps]) => {
    if (!Array.isArray($activeRoams)) {
      return [];
    }

    // Get all character IDs involved in active gate camps
    const campCharacters = new Set();
    $activeCamps.forEach((camp) => {
      if (camp.probability >= 60) {
        // Only exclude high-probability camps
        camp.originalAttackers?.forEach((id) => campCharacters.add(id));
        camp.activeAttackers?.forEach((id) => campCharacters.add(id));
      }
    });

    // Filter out roams that have significant overlap with gate camps
    return $activeRoams
      .map((roam) => ({
        ...roam,
        members: Array.isArray(roam.members)
          ? roam.members.filter((id) => !campCharacters.has(id))
          : [],
        systems: Array.isArray(roam.systems) ? roam.systems : [],
        kills: Array.isArray(roam.kills) ? roam.kills : [],
        totalValue: roam.totalValue || 0,
        lastActivity: roam.lastActivity || new Date().toISOString(),
        lastSystem: roam.lastSystem || { id: 0, name: "Unknown" },
        startTime:
          roam.startTime || roam.lastActivity || new Date().toISOString(),
      }))
      .filter((roam) => {
        // Keep roams that still have enough active members
        return (
          roam.members.length >= 2 &&
          roam.systems.length > 0 &&
          Date.now() - new Date(roam.lastActivity).getTime() <= ROAM_TIMEOUT
        );
      })
      .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  }
);

const CAMP_STATES = {
  ACTIVE: "active",
  CRASHED: "crashed",
  EXPIRED: "expired",
};

const DEFAULT_COMPOSITION = {
  originalCount: 0,
  activeCount: 0,
  killedCount: 0,
};

export const CAMP_PROBABILITY_FACTORS = {
  // Base probability factors for initial camp detection
  BASE: {
    SINGLE_KILL: 0.15, // 15% base for single kill at gate
    MULTI_KILL: 0.3, // 30% base for multiple kills at gate
    INITIAL_BURST: -0.1, // -10% if burst detected in first 15 minutes
  },

  // Time-based probability adjustments
  TIME_WEIGHTS: {
    ESTABLISHED: { threshold: 60, bonus: 0.2 }, // +20% after 1 hour of activity
    SUSTAINED: { threshold: 120, bonus: 0.3 }, // +30% after 2 hours of sustained activity
    FATIGUE: { threshold: 180, penalty: -0.2 }, // -20% after 3 hours
    INACTIVITY: { start: 25, penalty: -0.15 }, // -15% after 25 minutes of inactivity
  },

  THREAT_SHIPS: {
    3756: { weight: 0.15 }, // gnosis
    11202: { weight: 0.03 }, // ares
    11196: { weight: 0.11 }, // stiletto
    11176: { weight: 0.04 }, // crow
    11184: { weight: 0.03 }, // crusader
    11186: { weight: 0.08 }, // malediction
    11200: { weight: 0.03 }, // Taranis
    11178: { weight: 0.04 }, // raptor
    29988: { weight: 0.35 }, // proteus
    20125: { weight: 0.2 }, // Curse
    17722: { weight: 0.2 }, // Vigilant
    22456: { weight: 0.5 }, // Sabre
    22464: { weight: 0.44 }, // Flycatcher
    22452: { weight: 0.44 }, // Heretic
    22460: { weight: 0.44 }, // Eris
    12013: { weight: 0.4 }, // Broadsword
    12017: { weight: 0.4 }, // Onyx
    12021: { weight: 0.4 }, // Phobos
    12025: { weight: 0.4 }, // Devoter
    29984: { weight: 0.15 }, // Tengu
    29990: { weight: 0.29 }, // Loki
    11174: { weight: 0.3 }, // Keres
    35683: { weight: 0.13 }, // Hecate
    11969: { weight: 0.3 }, // Arazu
    11961: { weight: 0.3 }, // Huginn
    11957: { weight: 0.04 }, // Falcon
    29986: { weight: 0.09 }, // Legion
    47466: { weight: 0.06 }, // Praxis
    12038: { weight: 0.05 }, // Purifier
    12034: { weight: 0.05 }, // hound
    17720: { weight: 0.12 }, // Cynabal
    11963: { weight: 0.16 }, // Rapier
    12044: { weight: 0.08 }, // enyo
    17922: { weight: 0.18 }, // Ashimmu
    11999: { weight: 0.06 }, // Vagabond
    85086: { weight: 0.04 }, // Cenotaph
    33818: { weight: 0.03 }, // Orthrus
    11971: { weight: 0.22 }, // Lachesis
    4310: { weight: 0.01 }, // Tornado
    17738: { weight: 0.01 }, // Machariel
    11387: { weight: 0.03 }, // Hyena
  },

  // Ship categories for classification
  SHIP_CATEGORIES: {
    INDUSTRIAL: "industrial",
    MINING: "mining",
    CONCORD: "concord",
    NPC: "npc",
  },

  PERMANENT_CAMPS: {
    30002813: { gates: ["Nourvukaiken", "Kedama"], weight: 0.5 }, // Tama
    30003068: { gates: ["Miroitem", "Crielere"], weight: 0.5 }, // Rancer
    30000142: { gates: ["Perimeter"], weight: 0.25 }, // Jita
    30002647: { gates: ["Iyen-Oursta"], weight: 0.3 }, // Ignoitton
  },
  CONSISTENCY: {
    SAME_CHARS: 0.25, // 25% bonus for same characters across kills
    SAME_CORPS: 0.15, // 15% bonus for same corporation across kills
    TIME_WINDOW: 1800000, // 30 minute window for considering consistency
  },
};

// Function to track roaming gang movements
function updateRoamingGangs(killmail) {
  console.log("--- campStore.js: Roaming Gang Update ---");
  // console.log("Delegating to roamStore with killmail:", {
  //   id: killmail.killID,
  //   system: killmail.killmail.solar_system_id,
  //   time: killmail.killmail.killmail_time,
  // });

  const updatedRoams = roamStore.updateRoamingGangs(killmail);
  // console.log(`Received ${updatedRoams.length} roams from roamStore`);

  // Update the store directly
  activeRoams.set(updatedRoams);

  console.log("--- End campStore.js: Roaming Gang Update ---");
}

function getAttackerOverlap(kills) {
  if (kills.length < 2) {
    return {
      characters: 0,
      corporations: 0,
      alliances: 0,
    };
  }

  const CONSECUTIVE_THRESHOLD = 40 * 60 * 1000; // 40 minutes between kills max

  // Get attackers from each kill with their timestamps
  const killAttackers = kills
    .map((kill) => ({
      time: new Date(kill.killmail.killmail_time).getTime(),
      attackers: {
        characters: new Set(
          kill.killmail.attackers.map((a) => a.character_id).filter(Boolean)
        ),
        corporations: new Set(
          kill.killmail.attackers.map((a) => a.corporation_id).filter(Boolean)
        ),
        alliances: new Set(
          kill.killmail.attackers.map((a) => a.alliance_id).filter(Boolean)
        ),
      },
    }))
    .sort((a, b) => a.time - b.time);

  // Track consistent attackers across consecutive kills
  let consistentAttackers = {
    characters: new Set(),
    corporations: new Set(),
    alliances: new Set(),
  };

  // Compare consecutive kills
  for (let i = 1; i < killAttackers.length; i++) {
    const timeDiff = killAttackers[i].time - killAttackers[i - 1].time;

    if (timeDiff <= CONSECUTIVE_THRESHOLD) {
      ["characters", "corporations", "alliances"].forEach((type) => {
        killAttackers[i - 1].attackers[type].forEach((id) => {
          if (killAttackers[i].attackers[type].has(id)) {
            consistentAttackers[type].add(id);
          }
        });
      });
    }
  }

  return {
    characters: consistentAttackers.characters.size,
    corporations: consistentAttackers.corporations.size,
    alliances: consistentAttackers.alliances.size,
  };
}

// Function to ensure Set objects are properly initialized
function ensureSets(camp) {
  if (!camp.originalAttackers || !(camp.originalAttackers instanceof Set)) {
    camp.originalAttackers = new Set(
      Array.isArray(camp.originalAttackers) ? camp.originalAttackers : []
    );
  }
  if (!camp.activeAttackers || !(camp.activeAttackers instanceof Set)) {
    camp.activeAttackers = new Set(
      Array.isArray(camp.activeAttackers) ? camp.activeAttackers : []
    );
  }
  if (!camp.killedAttackers || !(camp.killedAttackers instanceof Set)) {
    camp.killedAttackers = new Set(
      Array.isArray(camp.killedAttackers) ? camp.killedAttackers : []
    );
  }
  return camp;
}

/**
 * Calculates the probability that a series of kills represents an active gate camp.
 * This function uses a weighted scoring system that considers multiple factors:
 * - Presence of kills at stargates
 * - Types of ships involved in kills
 * - Time patterns of kills
 * - Attacker consistency
 * - Known camping locations
 * - CONCORD/NPC involvement
 *
 * @param {Object} camp - The camp object containing kill data and metrics
 * @returns {number} - A probability score between 0-100
 */
function calculateCampProbability(camp) {
  // Check for NPC involvement first
  if (camp.kills.some(isNPCKill)) {
    return 0;
  }

  // Check for invalid attackers or victims
  const hasInvalidAttackers = camp.kills.some((kill) =>
    kill.shipCategories?.attackers.some((attacker) =>
      ["concord", "structure"].includes(attacker.category)
    )
  );

  if (hasInvalidAttackers) return 0;

  // Get valid kills (non-pod, non-structure victims)
  const validKills = camp.kills.filter(
    (kill) =>
      kill.killmail.victim.ship_type_id !== CAPSULE_ID &&
      kill.shipCategories?.victim !== "structure"
  );

  if (validKills.length === 0) return 0;

  // Initialize tracking variables
  const now = Date.now();
  let probability = 0;

  // Get valid gate kills
  const gateKills = validKills.filter(isGateCamp);

  if (gateKills.length === 0) return 0;

  // Set initial probability based on number of kills
  probability =
    gateKills.length === 1
      ? CAMP_PROBABILITY_FACTORS.BASE.SINGLE_KILL
      : CAMP_PROBABILITY_FACTORS.BASE.MULTI_KILL;

  // Apply time-based inactivity penalty first
  const lastKillTime = new Date(camp.lastKill).getTime();
  const minutesSinceLastKill = (now - lastKillTime) / (60 * 1000);

  if (minutesSinceLastKill > 25) {
    // Reduce by 1% per minute after 25 minutes
    const reductionFactor = Math.min(0.95, (minutesSinceLastKill - 25) * 0.01);
    probability *= 1 - reductionFactor;
  }

  // Check if this is a known camping system/gate - apply early for higher impact
  const systemData = CAMP_PROBABILITY_FACTORS.PERMANENT_CAMPS[camp.systemId];
  if (
    systemData &&
    systemData.gates.some((gate) =>
      camp.stargateName.toLowerCase().includes(gate.toLowerCase())
    )
  ) {
    // Increase base probability for known camping locations
    probability += systemData.weight;
  }

  // Get chronological kill data for pattern analysis
  const killTimes = gateKills
    .map((k) => new Date(k.killmail.killmail_time).getTime())
    .sort();
  const firstKillTime = killTimes[0];
  const campAge = (now - firstKillTime) / (60 * 1000); // minutes

  // Check for burst kills in first 15 minutes (indicates possible roaming gang)
  if (campAge <= 15) {
    const hasInitialBurst = killTimes.some(
      (time, i) => i > 0 && time - killTimes[i - 1] < 120000 // 2 minute threshold
    );
    if (hasInitialBurst) {
      probability += CAMP_PROBABILITY_FACTORS.BASE.INITIAL_BURST;
    }
  }

  // Analyze all threat ships involved in kills
  const threatShipsPresent = new Map();
  camp.kills.forEach((kill) => {
    kill.killmail.attackers.forEach((attacker) => {
      const shipType = attacker.ship_type_id;
      if (CAMP_PROBABILITY_FACTORS.THREAT_SHIPS[shipType]) {
        const count = threatShipsPresent.get(shipType) || 0;
        threatShipsPresent.set(shipType, count + 1);
      }
    });
  });

  // Calculate threat ship bonus with diminishing returns
  let threatShipBonus = 0;
  threatShipsPresent.forEach((count, shipId) => {
    const baseWeight = CAMP_PROBABILITY_FACTORS.THREAT_SHIPS[shipId].weight;
    // Cap effectiveness of multiple same-type ships
    threatShipBonus += baseWeight * Math.min(count, 2);
  });
  // Limit total ship bonus to 50%
  probability += Math.min(threatShipBonus, 0.5);

  // Apply time-based modifiers based on camp lifecycle
  if (campAge >= CAMP_PROBABILITY_FACTORS.TIME_WEIGHTS.ESTABLISHED.threshold) {
    // Bonus for established camps (running over an hour)
    probability += CAMP_PROBABILITY_FACTORS.TIME_WEIGHTS.ESTABLISHED.bonus;
  }
  if (campAge >= CAMP_PROBABILITY_FACTORS.TIME_WEIGHTS.SUSTAINED.threshold) {
    // Additional bonus for long-running camps (over 2 hours)
    probability += CAMP_PROBABILITY_FACTORS.TIME_WEIGHTS.SUSTAINED.bonus;
  }
  if (campAge >= CAMP_PROBABILITY_FACTORS.TIME_WEIGHTS.FATIGUE.threshold) {
    // Penalty for very long camps (over 3 hours) - fatigue factor
    probability += CAMP_PROBABILITY_FACTORS.TIME_WEIGHTS.FATIGUE.penalty;
  }

  // Analyze attacker consistency
  const overlap = getAttackerOverlap(camp.kills);
  if (overlap.characters > 0) {
    // Bonus for same characters appearing in multiple kills
    probability += CAMP_PROBABILITY_FACTORS.CONSISTENCY.SAME_CHARS;
  }
  if (overlap.corporations > 0) {
    // Additional bonus for corporate-level organization
    probability += CAMP_PROBABILITY_FACTORS.CONSISTENCY.SAME_CORPS;
  }

  // Check for industrial/mining victims
  const hasVulnerableVictims = validKills.some(
    (kill) =>
      kill.shipCategories?.victim ===
        CAMP_PROBABILITY_FACTORS.SHIP_CATEGORIES.INDUSTRIAL ||
      kill.shipCategories?.victim ===
        CAMP_PROBABILITY_FACTORS.SHIP_CATEGORIES.MINING
  );
  if (hasVulnerableVictims) {
    probability += 0.1; // 10% bonus for targeting typical gate camp victims
  }

  // Convert to percentage at the very end and clamp between 0-95
  return Math.max(0, Math.min(95, probability * 100));
}

// Exported Functions
export function isGateCamp(killmail) {
  if (!killmail.pinpoints?.nearestCelestial) return false;
  return killmail.pinpoints.nearestCelestial.name
    .toLowerCase()
    .includes("stargate");
}

function updateCampComposition(camp, killmail) {
  // Ensure Sets exist and are properly initialized
  camp.originalAttackers = camp.originalAttackers || new Set();
  camp.activeAttackers = camp.activeAttackers || new Set();
  camp.killedAttackers = camp.killedAttackers || new Set();
  camp.involvedCorporations = camp.involvedCorporations || [];
  camp.involvedAlliances = camp.involvedAlliances || [];

  // Process all attackers from this killmail
  killmail.killmail.attackers.forEach((attacker) => {
    if (!attacker.character_id) return;

    // Add to original attackers if new
    if (!camp.originalAttackers.has(attacker.character_id)) {
      camp.originalAttackers.add(attacker.character_id);
      camp.activeAttackers.add(attacker.character_id);
    }

    // Track corporations and alliances
    if (
      attacker.corporation_id &&
      !camp.involvedCorporations.includes(attacker.corporation_id)
    ) {
      camp.involvedCorporations.push(attacker.corporation_id);
    }
    if (
      attacker.alliance_id &&
      !camp.involvedAlliances.includes(attacker.alliance_id)
    ) {
      camp.involvedAlliances.push(attacker.alliance_id);
    }
  });

  // Process victim
  const victimId = killmail.killmail.victim.character_id;
  if (victimId && camp.activeAttackers.has(victimId)) {
    camp.activeAttackers.delete(victimId);
    camp.killedAttackers.add(victimId);
  }

  return {
    originalCount: camp.originalAttackers.size,
    activeCount: camp.activeAttackers.size,
    killedCount: camp.killedAttackers.size,
    numCorps: camp.involvedCorporations.length,
    numAlliances: camp.involvedAlliances.length,
  };
}

function isNPCKill(killmail) {
  // Check if killmail is tagged as NPC
  const isNPCTagged = killmail.zkb?.labels?.includes("npc");

  // Check if victim ship is an NPC type
  const isNPCShipType = killmail.shipCategories?.victim === "npc";

  return isNPCTagged || isNPCShipType;
}

function getMetrics(kills, now) {
  // Find earliest and latest kill times without sorting
  let earliestKill = Infinity;
  let latestKill = 0;

  kills.forEach((kill) => {
    const killTime = new Date(kill.killmail.killmail_time).getTime();
    if (killTime < earliestKill) {
      earliestKill = killTime;
    }
    if (killTime > latestKill) {
      latestKill = killTime;
    }
  });

  return {
    firstSeen: earliestKill,
    campDuration: Math.max(
      0,
      Math.floor((latestKill - earliestKill) / (1000 * 60))
    ),
    inactivityDuration: Math.max(
      0,
      Math.floor((now - latestKill) / (1000 * 60))
    ),
    podKills: kills.filter((k) => k.killmail.victim.ship_type_id === CAPSULE_ID)
      .length,
    killFrequency:
      kills.length / Math.max(1, (latestKill - earliestKill) / (1000 * 60)),
    avgValuePerKill:
      kills.reduce((sum, k) => sum + k.zkb.totalValue, 0) / kills.length,
  };
}

export function updateCamps(killmail) {
  updateRoamingGangs(killmail);

  let currentCamps = [];
  activeCamps.subscribe((value) => {
    currentCamps = value;
  })();

  const now = Date.now();
  const systemId = killmail.killmail.solar_system_id;
  const stargateName = killmail.pinpoints.nearestCelestial.name;
  const campId = `${systemId}-${stargateName}`;

  // Clean expired and crashed camps
  currentCamps = currentCamps.filter((camp) => {
    const timeSinceLastKill = now - new Date(camp.lastKill).getTime();
    if (camp.state === CAMP_STATES.CRASHED) {
      return timeSinceLastKill <= 20 * 60 * 1000;
    }
    return timeSinceLastKill <= CAMP_TIMEOUT;
  });

  // Prepare export data if interval has passed
  if (now - lastExportTime >= EXPORT_INTERVAL) {
    const exportData = {
      timestamp: new Date().toISOString(),
      kills: [],
      campMetrics: [],
    };

    // Collect all kills with their camp context
    currentCamps.forEach((camp) => {
      camp.kills.forEach((kill) => {
        // Add camp context to each kill
        const killData = {
          killmail: {
            killmail_id: kill.killmail.killmail_id,
            killmail_time: kill.killmail.killmail_time,
            solar_system_id: kill.killmail.solar_system_id,
            victim: {
              character_id: kill.killmail.victim.character_id,
              corporation_id: kill.killmail.victim.corporation_id,
              alliance_id: kill.killmail.victim.alliance_id,
              ship_type_id: kill.killmail.victim.ship_type_id,
            },
            attackers: kill.killmail.attackers.map((a) => ({
              character_id: a.character_id,
              corporation_id: a.corporation_id,
              alliance_id: a.alliance_id,
              ship_type_id: a.ship_type_id,
              security_status: a.security_status,
            })),
          },
          zkb: {
            totalValue: kill.zkb.totalValue,
          },
          pinpoints: {
            nearestCelestial: {
              name: kill.pinpoints.nearestCelestial.name,
              distance: kill.pinpoints.nearestCelestial.distance,
            },
          },
          campContext: {
            campId: camp.id,
            probability: camp.probability,
            killIndex: camp.kills.indexOf(kill),
            totalKills: camp.kills.length,
            campDuration: camp.metrics.campDuration,
            isGateCamp: isGateCamp(kill),
          },
        };
        exportData.kills.push(killData);
      });

      // Add camp metrics
      exportData.campMetrics.push({
        campId: camp.id,
        systemId: camp.systemId,
        stargateName: camp.stargateName,
        probability: camp.probability,
        metrics: camp.metrics,
        composition: camp.composition,
        totalValue: camp.totalValue,
        firstSeen: new Date(camp.kills[0].killmail.killmail_time).toISOString(),
        lastKill: camp.lastKill,
      });
    });

    // Emit export event with compressed data
    socket.emit("exportKillmails", JSON.stringify(exportData));
    lastExportTime = now;
  }

  const existingCamp = currentCamps.find((c) => c.id === campId);

  if (existingCamp) {
    const killTime = new Date(killmail.killmail.killmail_time).getTime();

    // Update earliest/latest kill times
    if (!existingCamp.firstKillTime || killTime < existingCamp.firstKillTime) {
      existingCamp.firstKillTime = killTime;
    }
    if (
      !existingCamp.latestKillTime ||
      killTime > existingCamp.latestKillTime
    ) {
      existingCamp.latestKillTime = killTime;
    }

    existingCamp.kills.push(killmail);
    existingCamp.lastKill = killmail.killmail.killmail_time;
    existingCamp.totalValue += killmail.zkb.totalValue;
    existingCamp.composition = updateCampComposition(existingCamp, killmail);

    // Calculate metrics using the tracked timestamps
    existingCamp.metrics = {
      ...getMetrics(existingCamp.kills, now),
      campDuration: Math.floor(
        (existingCamp.latestKillTime - existingCamp.firstKillTime) / (1000 * 60)
      ),
    };

    existingCamp.probability = calculateCampProbability(existingCamp);
  } else {
    const killTime = new Date(killmail.killmail.killmail_time).getTime();
    const newCamp = {
      id: campId,
      systemId,
      stargateName,
      kills: [killmail],
      totalValue: killmail.zkb.totalValue,
      lastKill: killmail.killmail.killmail_time,
      firstKillTime: killTime, // Add this
      latestKillTime: killTime, // Add this
      state: CAMP_STATES.ACTIVE,
      originalAttackers: new Set(),
      activeAttackers: new Set(),
      killedAttackers: new Set(),
      involvedCorporations: [],
      involvedAlliances: [],
    };

    newCamp.composition = updateCampComposition(newCamp, killmail);
    newCamp.metrics = {
      ...getMetrics([killmail], now),
      campDuration: 0, // Initialize to 0 for new camps
    };
    newCamp.probability = calculateCampProbability(newCamp);
    currentCamps.push(newCamp);
  }

  activeCamps.set([...currentCamps]);
  return currentCamps;
}

// Add listener for export confirmation
socket.on("exportComplete", (response) => {
  console.log(`Export completed at ${new Date().toISOString()}`);
  console.log(
    `Exported ${response.killCount} kills from ${response.campCount} camps`
  );
  if (response.fileUrl) {
    console.log(`Data available at: ${response.fileUrl}`);
  }
});

socket.on("initialCamps", (camps) => {
  activeCamps.set(
    camps
      .map((camp) => ensureSets(camp))
      .map((camp) => ({
        ...camp,
        firstKillTime:
          camp.firstKillTime ||
          new Date(camp.kills[0]?.killmail.killmail_time).getTime(),
        latestKillTime:
          camp.latestKillTime || new Date(camp.lastKill).getTime(),
      }))
  );
});

socket.on("campUpdate", (camps) => {
  activeCamps.set(
    camps
      .map((camp) => ensureSets(camp))
      .map((camp) => ({
        ...camp,
        firstKillTime:
          camp.firstKillTime ||
          new Date(camp.kills[0]?.killmail.killmail_time).getTime(),
        latestKillTime:
          camp.latestKillTime || new Date(camp.lastKill).getTime(),
      }))
  );
});

socket.on("initialRoams", (roams) => {
  const formattedRoams = roams.map((roam) => ({
    ...roam,
    id: roam.id,
    members: Array.isArray(roam.members) ? Array.from(roam.members) : [],
    systems: Array.isArray(roam.systems) ? [...roam.systems] : [],
    kills: Array.isArray(roam.kills) ? [...roam.kills] : [],
    totalValue: roam.totalValue || 0,
    lastActivity: roam.lastActivity || new Date().toISOString(),
    lastSystem: roam.lastSystem || { id: 0, name: "Unknown" },
    startTime: roam.startTime || roam.lastActivity || new Date().toISOString(),
  }));
  activeRoams.set(formattedRoams);
});

socket.on("roamUpdate", (roams) => {
  console.log("Received roam update via socket:", roams);

  const formattedRoams = roams.map((roam) => ({
    ...roam,
    id: roam.id,
    members: Array.isArray(roam.members) ? Array.from(roam.members) : [],
    systems: Array.isArray(roam.systems) ? [...roam.systems] : [],
    kills: Array.isArray(roam.kills) ? [...roam.kills] : [],
    totalValue: roam.totalValue || 0,
    lastActivity: roam.lastActivity || new Date().toISOString(),
    lastSystem: roam.lastSystem || { id: 0, name: "Unknown" },
    startTime: roam.startTime || roam.lastActivity || new Date().toISOString(),
  }));

  activeRoams.set(formattedRoams);
});
