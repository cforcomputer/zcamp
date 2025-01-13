// new campstore.js
import { writable, derived } from "svelte/store";
import socket from "../src/socket.js";
import roamStore from "./roamStore.js";

export const CAMP_TIMEOUT = 40 * 60 * 1000; // 40 minutes
export const DECAY_START = 20 * 60 * 1000; // 20 minutes
export const ROAM_TIMEOUT = 20 * 60 * 1000; // 20 minutes
export const CAPSULE_ID = 670;

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
    .sort((a, b) => b.probability - a.probability); // Add this line back
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

const DEFAULT_COMPOSITION = {
  originalCount: 0,
  activeCount: 0,
  killedCount: 0,
};

export const CAMP_PROBABILITY_FACTORS = {
  // Base probability factors for initial camp detection
  BASE: {
    SINGLE_KILL: 0.3, // Increase initial confidence for first kill to 30%
    MULTI_KILL: 0.5, // 50% base for multiple kills at gate
    INITIAL_BURST: -0.2, // Increased penalty for burst kills
  },

  // Time-based probability adjustments
  TIME_WEIGHTS: {
    INACTIVITY: {
      start: 20, // Start decay after 20 minutes
      penalty: -0.35, // Stronger penalty of 35%
      // Add a rate of decay
      decayPerMinute: 0.1, // 10% additional decay per minute after start
    },
    ESTABLISHED: { threshold: 60, bonus: 0.2 }, // Keep establishment bonus
    SUSTAINED: { threshold: 120, bonus: 0.3 }, // Keep sustained bonus
    FATIGUE: { threshold: 180, penalty: -0.2 }, // Keep fatigue penalty
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
    17722: { weight: 0.25 }, // Vigilant
    22456: { weight: 0.5 }, // Sabre
    22464: { weight: 0.44 }, // Flycatcher
    22452: { weight: 0.44 }, // Heretic
    22460: { weight: 0.44 }, // Eris
    12013: { weight: 0.4 }, // Broadsword
    11995: { weight: 0.4 }, // Onyx
    12021: { weight: 0.4 }, // Phobos
    12017: { weight: 0.4 }, // Devoter
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
    12198: { weight: 0.5 }, // Mobile Small Warp Disruptor I
    26892: { weight: 0.5 }, // Mobile Medium Warp Disruptor I
    12200: { weight: 0.5 }, // Mobile Large Warp Disruptor I
    12199: { weight: 0.5 }, // Mobile Small Warp Disruptor II
    26888: { weight: 0.5 }, // Mobile Medium Warp Disruptor II
    26890: { weight: 0.5 }, // Mobile Large Warp Disruptor II
    28770: { weight: 0.5 }, // Mobile 'Hybrid' Warp Disruptor I
    28772: { weight: 0.5 }, // Mobile 'Hybrid' Warp Disruptor I
    28774: { weight: 0.5 }, // Mobile 'Hybrid' Warp Disruptor I
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
    30005196: { gates: ["Shera"], weight: 0.4 }, // Ahbazon
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

  const updatedRoams = roamStore.updateRoamingGangs(killmail);
  // console.log(`Received ${updatedRoams.length} roams from roamStore`);

  // Update the store directly
  activeRoams.set(updatedRoams);

  console.log("--- End campStore.js: Roaming Gang Update ---");
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
  const log = [];
  log.push(
    `--- Starting probability calculation for camp: ${camp.systemId}-${camp.stargateName} ---`
  );

  //----------------------------------------
  // 1. EARLY EXCLUSIONS - Quick checks to rule out non-camps
  //----------------------------------------

  // Check for NPC kills
  if (camp.kills.some((kill) => kill.zkb?.labels?.includes("npc"))) {
    log.push("Camp excluded: NPC kill detected");
    camp.probabilityLog = log;
    return 0;
  }

  // Check for CONCORD or structure attackers
  const hasInvalidAttackers = camp.kills.some((kill) =>
    kill.shipCategories?.attackers.some((attacker) =>
      ["concord", "structure"].includes(attacker.category)
    )
  );
  if (hasInvalidAttackers) {
    log.push("Camp excluded: Invalid attackers (Concord or structure)");
    camp.probabilityLog = log;
    return 0;
  }

  // Filter out pods and structures, ensure valid kills remain
  const validKills = camp.kills.filter(
    (kill) =>
      kill.killmail.victim.ship_type_id !== CAPSULE_ID &&
      kill.shipCategories?.victim !== "structure"
  );
  if (validKills.length === 0) {
    log.push("Camp excluded: No valid kills (non-pod, non-structure)");
    camp.probabilityLog = log;
    return 0;
  }

  // Ensure kills are at gates
  const gateKills = validKills.filter(isGateCamp);
  if (gateKills.length === 0) {
    log.push("Camp excluded: No kills at a stargate");
    camp.probabilityLog = log;
    return 0;
  }

  //----------------------------------------
  // 2. BASE PROBABILITY
  //----------------------------------------

  const now = Date.now();
  let probability = 0;

  // Count recent kills within last hour
  const recentKills = gateKills.filter(
    (kill) =>
      now - new Date(kill.killmail.killmail_time).getTime() <= 60 * 60 * 1000
  ).length;

  probability = Math.max(0, 0.3 + (recentKills - 1) * 0.25);
  log.push(
    `Base probability from ${recentKills} recent kills: ${(
      probability * 100
    ).toFixed(1)}%`
  );

  //----------------------------------------
  // 3. TIME-BASED ADJUSTMENTS
  //----------------------------------------

  // Decay for inactivity
  const lastKillTime = new Date(camp.lastKill).getTime();
  const minutesSinceLastKill = (now - lastKillTime) / (60 * 1000);
  const timeDecay = Math.max(0, (minutesSinceLastKill - 20) * 0.01);
  probability -= timeDecay;
  log.push(
    `Time decay adjustment (${minutesSinceLastKill.toFixed(
      1
    )} minutes since last kill): -${(timeDecay * 100).toFixed(1)}%`
  );

  // Penalty for burst kills
  const killTimes = gateKills
    .map((k) => new Date(k.killmail.killmail_time).getTime())
    .sort();
  const firstKillTime = killTimes[0];
  const campAge = (now - firstKillTime) / (60 * 1000);

  if (
    campAge <= 15 &&
    killTimes.some((time, i) => i > 0 && time - killTimes[i - 1] < 120000)
  ) {
    probability -= 0.2;
    log.push("Burst kill penalty applied: -20%");
  }

  //----------------------------------------
  // 4. THREAT SHIP BONUSES
  //----------------------------------------

  let threatShipScore = 0;
  const threatShips = new Map();

  gateKills.forEach((kill) => {
    kill.killmail.attackers.forEach((attacker) => {
      const shipType = attacker.ship_type_id;
      const weight =
        CAMP_PROBABILITY_FACTORS.THREAT_SHIPS[shipType]?.weight || 0;
      if (weight > 0) {
        threatShips.set(shipType, (threatShips.get(shipType) || 0) + 1);
        threatShipScore += weight;
      }
    });
  });

  if (threatShips.size > 0) {
    log.push("Threat ships detected:");
    threatShips.forEach((count, shipType) => {
      const weight = CAMP_PROBABILITY_FACTORS.THREAT_SHIPS[shipType].weight;
      log.push(
        `  - Ship type ${shipType}: ${count}x (weight: ${weight}) = +${(
          weight * 100
        ).toFixed(1)}%`
      );
    });
  }

  probability += threatShipScore;
  log.push(`Total threat ship bonus: +${(threatShipScore * 100).toFixed(1)}%`);

  //----------------------------------------
  // 5. KNOWN CAMPING LOCATION BONUS
  //----------------------------------------

  const systemData = CAMP_PROBABILITY_FACTORS.PERMANENT_CAMPS[camp.systemId];
  if (
    systemData &&
    systemData.gates.some((gate) =>
      camp.stargateName.toLowerCase().includes(gate.toLowerCase())
    )
  ) {
    probability += systemData.weight;
    log.push(
      `Known camping location bonus: +${(systemData.weight * 100).toFixed(1)}%`
    );
  }

  //----------------------------------------
  // 6. ATTACKER CONSISTENCY BONUS
  //----------------------------------------

  const CONSISTENCY_BONUS = 0.15; // 15% bonus per consecutive kill with same attackers
  const consistencyCheckKills = gateKills.slice(-3); // Look at last 3 kills
  let consistencyBonus = 0;

  log.push(`Debug: Number of kills to check: ${consistencyCheckKills.length}`);
  log.push(`Debug: Total kills in camp: ${camp.kills.length}`);
  log.push(`Debug: Valid gate kills: ${gateKills.length}`);

  // If we don't have at least 2 kills, no consistency bonus possible
  if (consistencyCheckKills.length < 2) {
    log.push(
      "No consistency bonus: Need at least 2 kills to check consistency"
    );
  } else {
    const latestAttackers = new Set(
      consistencyCheckKills[consistencyCheckKills.length - 1].killmail.attackers
        .map((a) => a.character_id)
        .filter((id) => id)
    );

    // Compare with previous kills
    for (let i = consistencyCheckKills.length - 2; i >= 0; i--) {
      const previousAttackers = new Set(
        consistencyCheckKills[i].killmail.attackers
          .map((a) => a.character_id)
          .filter((id) => id)
      );

      const intersection = new Set(
        [...latestAttackers].filter((x) => previousAttackers.has(x))
      );

      if (intersection.size >= 2) {
        consistencyBonus += CONSISTENCY_BONUS;
        log.push(
          `Attacker consistency bonus with kill ${i + 1}: +${(
            CONSISTENCY_BONUS * 100
          ).toFixed(1)}% (${intersection.size} same attackers)`
        );
      }
    }
  }

  if (consistencyBonus > 0) {
    probability += consistencyBonus;
    log.push(
      `Total attacker consistency bonus: +${(consistencyBonus * 100).toFixed(
        1
      )}%`
    );
  }

  //----------------------------------------
  // 7. VULNERABLE VICTIM BONUS
  //----------------------------------------

  const vulnerableKills = validKills.filter(
    (kill) =>
      kill.shipCategories?.victim ===
        CAMP_PROBABILITY_FACTORS.SHIP_CATEGORIES.INDUSTRIAL ||
      kill.shipCategories?.victim ===
        CAMP_PROBABILITY_FACTORS.SHIP_CATEGORIES.MINING
  );

  if (vulnerableKills.length > 0) {
    probability += 0.4;
    log.push(
      `Vulnerable victim bonus (${vulnerableKills.length} industrial/mining ships): +40%`
    );
  }

  //----------------------------------------
  // 8. FINAL NORMALIZATION
  //----------------------------------------

  probability = Math.max(0, Math.min(95, Math.round(probability * 100)));
  log.push(`Final normalized probability: ${probability}%`);

  camp.probabilityLog = log;
  return probability;
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
  return killmail.zkb?.labels?.includes("npc") || false;
}

function getMetrics(kills, now) {
  const killTimes = kills.map((k) =>
    new Date(k.killmail.killmail_time).getTime()
  );
  const earliestKillTime = Math.min(...killTimes);
  const lastKillTime = Math.max(...killTimes);

  return {
    firstSeen: earliestKillTime,
    // Duration is from earliest kill to NOW
    campDuration: Math.floor((now - earliestKillTime) / (1000 * 60)),
    // Activity is from latest kill to now
    inactivityDuration: Math.floor((now - lastKillTime) / (1000 * 60)),
    podKills: kills.filter((k) => k.killmail.victim.ship_type_id === CAPSULE_ID)
      .length,
    killFrequency:
      kills.length / Math.max(1, (now - earliestKillTime) / (1000 * 60)),
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

  // Clean expired camps
  currentCamps = currentCamps.filter((camp) => {
    const timeSinceLastKill = now - new Date(camp.lastKill).getTime();
    return timeSinceLastKill <= CAMP_TIMEOUT;
  });

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
    existingCamp.metrics = getMetrics(existingCamp.kills, now);

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
      firstKillTime: killTime,
      latestKillTime: killTime,
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

socket.on("initialCamps", (camps) => {
  activeCamps.set(
    camps
      .map((camp) => ensureSets(camp))
      .map((camp) => ({
        ...camp,
        firstKillTime:
          camp.firstKillTime ||
          Math.min(
            ...camp.kills.map((k) =>
              new Date(k.killmail.killmail_time).getTime()
            )
          ),
        latestKillTime:
          camp.latestKillTime ||
          Math.max(
            ...camp.kills.map((k) =>
              new Date(k.killmail.killmail_time).getTime()
            )
          ),
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
          Math.min(
            ...camp.kills.map((k) =>
              new Date(k.killmail.killmail_time).getTime()
            )
          ),
        latestKillTime:
          camp.latestKillTime ||
          Math.max(
            ...camp.kills.map((k) =>
              new Date(k.killmail.killmail_time).getTime()
            )
          ),
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
