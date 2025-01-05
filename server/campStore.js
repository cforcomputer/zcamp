// new campstore.js
import { writable, derived } from "svelte/store";
import socket from "../src/socket.js";
import roamStore from "./roamStore.js";

export const CAMP_TIMEOUT = 60 * 60 * 1000; // 1 hour
export const ROAM_TIMEOUT = 30 * 60 * 1000; // 30 minutes
export const CAPSULE_ID = 670;

export const activeRoams = writable([]);

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
  TIME_WEIGHTS: {
    INITIAL_DETECTION: { threshold: 15, maxBonus: 20 },
    SUSTAINED_ACTIVITY: { threshold: 60, maxBonus: 40 },
    FATIGUE: { threshold: 180, penalty: -30 },
    INACTIVITY: { start: 25, severe: 40, penalty: -50 },
  },

  KILL_SPACING: {
    BURST_THRESHOLD: 20,
    BURST_PENALTY: -30,
    CONSISTENT_BONUS: 25,
  },

  THREAT_SHIPS: {
    3756: { weight: 15, category: "dps" }, // gnosis
    11202: { weight: 3, category: "tackle" }, // ares
    11196: { weight: 11, category: "tackle" }, // stiletto
    11176: { weight: 4, category: "tackle" }, // crow
    11184: { weight: 3, category: "tackle" }, // crusader
    11186: { weight: 8, category: "tackle" }, // malediction
    11200: { weight: 3, category: "tackle" }, // Taranis
    11178: { weight: 4, category: "tackle" }, // raptor
    29988: { weight: 35, category: "dps" }, // proteus
    20125: { weight: 20, category: "ewar" }, // Curse
    17722: { weight: 20, category: "dps" }, // Vigilant
    22456: { weight: 50, category: "dictor" }, // Sabre
    22464: { weight: 44, category: "dictor" }, // Flycatcher
    22452: { weight: 44, category: "dictor" }, // Heretic
    22460: { weight: 44, category: "dictor" }, // Eris
    12013: { weight: 40, category: "hic" }, // Broadsword
    12017: { weight: 40, category: "hic" }, // Onyx
    12021: { weight: 40, category: "hic" }, // Phobos
    12025: { weight: 40, category: "hic" }, // Devoter
    29984: { weight: 15, category: "dps" }, // Tengu
    29990: { weight: 29, category: "dps" }, // Loki
    11174: { weight: 30, category: "ewar" }, // Keres
    35683: { weight: 13, category: "dps" }, // Hecate
    11969: { weight: 30, category: "ewar" }, // Arazu
    11961: { weight: 30, category: "ewar" }, // Huginn
    11957: { weight: 4, category: "ewar" }, // Falcon
    29986: { weight: 9, category: "dps" }, // Legion
    47466: { weight: 6, category: "dps" }, // Praxis
    12038: { weight: 5, category: "dps" }, // Purifier
    12034: { weight: 5, category: "dps" }, // hound
    17720: { weight: 12, category: "dps" }, // Cynabal
    11963: { weight: 16, category: "ewar" }, // Rapier
    12044: { weight: 8, category: "tackle" }, // enyo
    17922: { weight: 18, category: "ewar" }, // Ashimmu
    11999: { weight: 6, category: "dps" }, // Vagabond
    85086: { weight: 4, category: "dps" }, // Cenotaph
    33818: { weight: 3, category: "dps" }, // Orthrus
    11971: { weight: 22, category: "ewar" }, // Lachesis
    4310: { weight: 1, category: "dps" }, // Tornado
    17738: { weight: 1, category: "dps" }, // Machariel
    11387: { weight: 3, category: "ewar" }, // Hyena
  },

  PERMANENT_CAMPS: {
    30002813: { gates: ["Nourvukaiken", "Kedama"], boost: 36 }, // Tama
    30003068: { gates: ["Miroitem", "Crielere"], boost: 25 }, // Rancer
    30000142: { gates: ["Perimeter"], boost: 15 }, // Jita
    30002647: { gates: ["Iyen-Oursta"], boost: 25 }, // Ignoitton
  },
};

// Roaming gangs stuff
const roamUpdateListeners = [];

export function addRoamUpdateListener(listener) {
  roamUpdateListeners.push(listener);
}

export function removeRoamUpdateListener(listener) {
  const index = roamUpdateListeners.indexOf(listener);
  if (index > -1) {
    roamUpdateListeners.splice(index, 1);
  }
}

function notifyRoamUpdateListeners(roams) {
  roamUpdateListeners.forEach((listener) => listener(roams));
}

// Function to track roaming gang movements
function updateRoamingGangs(killmail) {
  const updatedRoams = roamStore.updateRoamingGangs(killmail);
  activeRoams.set(updatedRoams);
  notifyRoamUpdateListeners(updatedRoams);
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

function calculateCampProbability(camp) {
  console.log("--- Camp Probability Calculation Debug ---");
  console.log(`System: ${camp.systemId} - ${camp.stargateName}`);
  console.log(`Total Kills: ${camp.kills.length}`);

  // Skip if all kills are NPC
  if (camp.kills.every((k) => k.zkb.npc)) {
    console.log("All kills are NPC - Probability: 0");
    return 0;
  }

  // Require at least 2 non-capsule kills
  const nonCapsuleKills = camp.kills.filter(
    (k) => k.killmail.victim.ship_type_id !== CAPSULE_ID
  );
  if (nonCapsuleKills.length < 2) {
    console.log(
      `Non-capsule kills: ${nonCapsuleKills.length} - Probability: 0`
    );
    return 0;
  }

  let probability = 0;

  // Gate camp detection logging
  const gateKills = camp.kills.filter(isGateCamp);
  console.log(`Gate Kills: ${gateKills.length}`);
  if (gateKills.length > 0) {
    probability += gateKills.length * 25;
    console.log(`Gate Kill Bonus: ${gateKills.length * 25}`);
  }

  // High-risk system check
  const systemData = CAMP_PROBABILITY_FACTORS.PERMANENT_CAMPS[camp.systemId];
  console.log("High-Risk System Check:");
  if (
    systemData &&
    systemData.gates.some((gate) =>
      camp.stargateName.toLowerCase().includes(gate.toLowerCase())
    )
  ) {
    probability += systemData.boost * 2;
    console.log(`High-Risk System Bonus: ${systemData.boost * 2}`);
  }

  // Detailed threat ship analysis
  console.log("Threat Ships Analysis:");
  const threatShipsFound = new Set();
  let threatShipScore = 0;
  const attackerShipGroups = {};

  camp.kills.forEach((kill, killIndex) => {
    console.log(`Kill ${killIndex + 1} Attackers:`);
    kill.killmail.attackers.forEach((attacker) => {
      if (attacker.ship_type_id) {
        if (CAMP_PROBABILITY_FACTORS[attacker.ship_type_id]) {
          threatShipsFound.add(attacker.ship_type_id);
          const shipWeight = CAMP_PROBABILITY_FACTORS[attacker.ship_type_id];
          threatShipScore += shipWeight;

          // Group tracking
          if (!attackerShipGroups[attacker.ship_type_id]) {
            attackerShipGroups[attacker.ship_type_id] = {
              count: 0,
              totalWeight: 0,
            };
          }
          attackerShipGroups[attacker.ship_type_id].count++;
          attackerShipGroups[attacker.ship_type_id].totalWeight += shipWeight;

          console.log(
            `  - Threat Ship: ${attacker.ship_type_id}, Weight: ${shipWeight}`
          );
        }
      }
    });
  });

  // Detailed threat ship logging
  console.log("Threat Ship Groups:");
  Object.entries(attackerShipGroups).forEach(([shipId, data]) => {
    console.log(
      `  Ship ${shipId}: Count ${data.count}, Total Weight ${data.totalWeight}`
    );
  });

  probability += Math.min(threatShipScore * 1.5, 50);
  console.log(
    `Threat Ship Probability Bonus: ${Math.min(threatShipScore * 1.5, 50)}`
  );

  function getAttackerOverlap(kills) {
    // Skip if not enough kills
    if (kills.length < 2) {
      return {
        characters: 0,
        corporations: 0,
        alliances: 0,
      };
    }

    // Get attackers from each kill, mapping kill time to attacker IDs
    const killAttackers = kills
      .map((kill) => ({
        time: new Date(kill.killmail.killmail_time).getTime(),
        attackers: kill.killmail.attackers.reduce(
          (acc, attacker) => {
            if (attacker.character_id) {
              acc.characters.add(attacker.character_id);
            }
            if (attacker.corporation_id) {
              acc.corporations.add(attacker.corporation_id);
            }
            if (attacker.alliance_id) {
              acc.alliances.add(attacker.alliance_id);
            }
            return acc;
          },
          {
            characters: new Set(),
            corporations: new Set(),
            alliances: new Set(),
          }
        ),
      }))
      .sort((a, b) => a.time - b.time);

    // Count attackers that appear in consecutive kills within timeframe
    let consistentAttackers = {
      characters: new Set(),
      corporations: new Set(),
      alliances: new Set(),
    };

    const CONSECUTIVE_THRESHOLD = 40 * 60 * 1000; // 40 minutes between kills max

    for (let i = 1; i < killAttackers.length; i++) {
      const timeDiff = killAttackers[i].time - killAttackers[i - 1].time;

      // If kills are close enough in time, look for overlap
      if (timeDiff <= CONSECUTIVE_THRESHOLD) {
        const prevAttackers = killAttackers[i - 1].attackers;
        const currAttackers = killAttackers[i].attackers;

        // Find attackers present in both kills
        prevAttackers.characters.forEach((id) => {
          if (currAttackers.characters.has(id)) {
            consistentAttackers.characters.add(id);
          }
        });

        prevAttackers.corporations.forEach((id) => {
          if (currAttackers.corporations.has(id)) {
            consistentAttackers.corporations.add(id);
          }
        });

        prevAttackers.alliances.forEach((id) => {
          if (currAttackers.alliances.has(id)) {
            consistentAttackers.alliances.add(id);
          }
        });
      }
    }

    return {
      characters: consistentAttackers.characters.size,
      corporations: consistentAttackers.corporations.size,
      alliances: consistentAttackers.alliances.size,
    };
  }

  // Attacker overlap analysis
  console.log("Attacker Overlap Analysis:");
  const overlap = getAttackerOverlap(camp.kills);
  console.log(`  Character Overlap: ${overlap.characters}`);
  console.log(`  Corporation Overlap: ${overlap.corporations}`);
  console.log(`  Alliance Overlap: ${overlap.alliances}`);

  if (overlap.characters > 1) {
    probability += 50;
    console.log("  Multiple Character Overlap Bonus: 50");
  } else if (overlap.characters > 0) {
    probability += 25;
    console.log("  Single Character Overlap Bonus: 25");
  }

  if (overlap.corporations > 0) {
    probability += 20;
    console.log("  Corporation Overlap Bonus: 20");
  }
  if (overlap.alliances > 0) {
    probability += 10;
    console.log("  Alliance Overlap Bonus: 10");
  }

  // Victim analysis
  console.log("Victim Ship Categories:");
  const victimCategories = new Set(
    camp.kills.map((k) => k.shipCategories?.victim).filter(Boolean)
  );
  console.log(`  Categories: ${[...victimCategories]}`);

  const vulnerableCategories = ["industrial", "mining", "transport"];
  if (vulnerableCategories.some((cat) => victimCategories.has(cat))) {
    probability += 30;
    console.log("  Vulnerable Victim Category Bonus: 30");
  }

  // Time-based reduction
  const timeSinceLastKill = Date.now() - new Date(camp.lastKill).getTime();
  const inactiveMinutes = Math.max(
    0,
    Math.floor((timeSinceLastKill - 45 * 60 * 1000) / (60 * 1000))
  );
  const timeReduction = Math.min(probability * 0.5, inactiveMinutes);

  probability = Math.max(0, probability - timeReduction);

  console.log(`Final Probability: ${Math.min(100, probability)}`);
  console.log("--- End of Camp Probability Calculation ---");

  return Math.min(100, probability);
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

export function updateCamps(killmail) {
  // Use roamStore to update roaming gangs
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
      return timeSinceLastKill <= 20 * 60 * 1000; // Keep crashed camps for 20 minutes
    }
    return timeSinceLastKill <= CAMP_TIMEOUT;
  });

  const existingCamp = currentCamps.find((c) => c.id === campId);

  if (existingCamp) {
    existingCamp.kills.push(killmail);
    existingCamp.lastKill = killmail.killmail.killmail_time;
    existingCamp.totalValue += killmail.zkb.totalValue;
    existingCamp.composition = updateCampComposition(existingCamp, killmail);
    existingCamp.probability = calculateCampProbability(existingCamp);
  } else {
    const newCamp = {
      id: campId,
      systemId,
      stargateName,
      kills: [killmail],
      totalValue: killmail.zkb.totalValue,
      lastKill: killmail.killmail.killmail_time,
      state: CAMP_STATES.ACTIVE,
      originalAttackers: new Set(),
      activeAttackers: new Set(),
      killedAttackers: new Set(),
      involvedCorporations: [],
      involvedAlliances: [],
    };

    newCamp.composition = updateCampComposition(newCamp, killmail);
    newCamp.probability = calculateCampProbability(newCamp);
    currentCamps.push(newCamp);
  }

  activeCamps.set([...currentCamps]);
  return currentCamps;
}

socket.on("initialCamps", (camps) => {
  activeCamps.set(
    camps.map((camp) => ensureSets(camp)).map((camp) => ({ ...camp }))
  );
});

socket.on("campUpdate", (camps) => {
  activeCamps.set(
    camps.map((camp) => ensureSets(camp)).map((camp) => ({ ...camp }))
  );
});

socket.on("initialRoams", (roams) => {
  activeRoams.set(
    roams.map((roam) => ({
      ...roam,
      members: Array.from(roam.members || []),
    }))
  );
});

socket.on("roamUpdate", (roams) => {
  activeRoams.set(
    roams.map((roam) => ({
      ...roam,
      members: Array.from(roam.members || []),
    }))
  );
});

// Roaming gangs detection logic
export const filteredRoams = derived([activeRoams], ([$activeRoams]) => {
  return $activeRoams
    .map((roam) => ({
      ...roam,
      memberCount: roam.members.length,
      systemCount: new Set(roam.systems.map((s) => s.id)).size,
      age: Date.now() - new Date(roam.startTime).getTime(),
      lastSeen: Date.now() - new Date(roam.lastActivity).getTime(),
    }))
    .filter((roam) => roam.systemCount >= 1 && roam.lastSeen <= ROAM_TIMEOUT)
    .sort((a, b) => b.lastActivity - a.lastActivity);
});

// Svelte Stores
export const activeCamps = writable([]);
export const filteredCamps = derived([activeCamps], ([$activeCamps]) => {
  return $activeCamps
    .filter((camp) => {
      const nonCapsuleKills = camp.kills.filter(
        (k) => k.killmail.victim.ship_type_id !== CAPSULE_ID
      );
      return nonCapsuleKills.length >= 2 && camp.probability >= 30;
    })
    .map((camp) => ({
      ...camp,
      composition: camp.composition || DEFAULT_COMPOSITION,
      lastKillTime: new Date(camp.lastKill).getTime(),
      age: Date.now() - new Date(camp.lastKill).getTime(),
      isActive: Date.now() - new Date(camp.lastKill).getTime() <= CAMP_TIMEOUT,
    }))
    .sort((a, b) => b.probability - a.probability);
});
