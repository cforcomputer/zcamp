import { writable, derived } from "svelte/store";
import socket from "../src/socket.js";

// Constants
export const CAMP_TIMEOUT = 60 * 60 * 1000;
export const CAPSULE_ID = 670;

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

function getAttackerOverlap(kills) {
  // Filter out structure kills first
  const nonStructureKills = kills.filter(
    (k) =>
      k.shipCategories?.victim !== "structure" &&
      k.shipCategories?.victim !== "fighter"
  );

  if (nonStructureKills.length === 0)
    return { characters: 0, corporations: 0, alliances: 0 };

  const firstAttackers = {
    characters: new Set(
      nonStructureKills[0].killmail.attackers.map((a) => a.character_id)
    ),
    corporations: new Set(
      nonStructureKills[0].killmail.attackers.map((a) => a.corporation_id)
    ),
    alliances: new Set(
      nonStructureKills[0].killmail.attackers.map((a) => a.alliance_id)
    ),
  };

  let overlap = { characters: 0, corporations: 0, alliances: 0 };

  for (let i = 1; i < nonStructureKills.length; i++) {
    nonStructureKills[i].killmail.attackers.forEach((attacker) => {
      if (
        attacker.character_id &&
        firstAttackers.characters.has(attacker.character_id)
      )
        overlap.characters++;
      if (
        attacker.corporation_id &&
        firstAttackers.corporations.has(attacker.corporation_id)
      )
        overlap.corporations++;
      if (
        attacker.alliance_id &&
        firstAttackers.alliances.has(attacker.alliance_id)
      )
        overlap.alliances++;
    });
  }

  return overlap;
}

// Add at top with other constants
const THREAT_SHIPS = {
  3756: 15, // gnosis
  11202: 3, // ares
  11196: 11, // stiletto
  11176: 4, // crow
  11184: 3, // crusader
  11186: 8, // malediction
  11200: 3, // Taranis
  11178: 4, // raptor
  29988: 35, // proteus
  20125: 20, // Curse
  17722: 20, // Vigilant
  22456: 50, // Sabre
  22464: 44, // Flycatcher
  22452: 44, // Heretic
  22460: 44, // Eris
  12013: 40, // Broadsword
  12017: 40, // Onyx
  12021: 40, // Phobos
  12025: 40, // Devoter
  29984: 15, // Tengu
  29990: 29, // Loki
  11174: 30, // Keres
  35683: 13, // Hecate
  11969: 30, // Arazu
  11961: 30, // Huginn
  11957: 4, // Falcon
  29986: 9, // Legion
  47466: 6, // Praxis
  12038: 5, // Purifier
  12034: 5, // hound
  17720: 12, // Cynabal
  11963: 16, // Rapier
  12044: 8, // enyo
  17922: 18, // Ashimmu
  11999: 6, // Vagabond
  85086: 4, // Cenotaph
  33818: 3, // Orthrus
  11971: 22, // Lachesis
  4310: 1, // Tornado
  17738: 1, // Machariel
  11387: 3, // Hyena
};

const HIGH_RISK_SYSTEMS = {
  30002813: {
    // Tama
    gates: ["Nourvukaiken", "Kedama"],
    boost: 36,
  },
  30003068: {
    // Rancer
    gates: ["Miroitem", "Crielere"],
    boost: 25,
  },
  30000142: {
    // Jita
    gates: ["Perimeter"],
    boost: 15,
  },
  30002647: {
    // Ignoitton
    gates: ["Iyen-Oursta"],
    boost: 25,
  },
};

function calculateCampProbability(camp) {
  // Skip if all kills are NPC
  if (camp.kills.every((k) => k.zkb.npc)) return 0;

  // Require at least 2 non-capsule kills
  const nonCapsuleKills = camp.kills.filter(
    (k) => k.killmail.victim.ship_type_id !== CAPSULE_ID
  );
  if (nonCapsuleKills.length < 2) return 0;

  let probability = 0;

  // Check for known high-risk system/gate combination
  const systemData = HIGH_RISK_SYSTEMS[camp.systemId];
  if (
    systemData &&
    systemData.gates.some((gate) =>
      camp.stargateName.toLowerCase().includes(gate.toLowerCase())
    )
  ) {
    probability += systemData.boost;
  }

  // Check for threat ships
  const threatShipsFound = new Set();
  camp.kills.forEach((kill) => {
    kill.killmail.attackers.forEach((attacker) => {
      if (attacker.ship_type_id && THREAT_SHIPS[attacker.ship_type_id]) {
        threatShipsFound.add(attacker.ship_type_id);
      }
    });
  });

  // Add probability for each unique threat ship
  threatShipsFound.forEach((shipId) => {
    probability += THREAT_SHIPS[shipId];
  });

  // Attacker overlap check
  const overlap = getAttackerOverlap(camp.kills);
  if (overlap.characters > 0) probability += 40;
  else if (overlap.corporations > 0) probability += 20;

  // Victim type check
  if (camp.kills.some((k) => k.shipCategories?.victim === "industrial")) {
    probability += 20;
  }

  // Time-based probability reduction
  const timeSinceLastKill = Date.now() - new Date(camp.lastKill).getTime();
  const inactiveMinutes = Math.max(
    0,
    Math.floor((timeSinceLastKill - 36 * 60 * 1000) / (60 * 1000))
  );
  const timeReduction = Math.min(probability, inactiveMinutes); // Cap reduction at current probability

  probability = Math.max(0, probability - timeReduction);

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
  // Initialize tracking properties if not existing
  if (!camp.originalAttackers) {
    camp.originalAttackers = new Set();
    camp.activeAttackers = new Set();
    camp.killedAttackers = new Set();
    camp.involvedCorporations = [];
    camp.involvedAlliances = [];

    // Add initial attackers
    killmail.killmail.attackers.forEach((attacker) => {
      if (attacker.character_id) {
        camp.originalAttackers.add(attacker.character_id);
        camp.activeAttackers.add(attacker.character_id);
      }
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
  } else {
    // Process new killmail attackers
    const newAttackers = killmail.killmail.attackers.filter(
      (attacker) =>
        attacker.character_id &&
        !camp.originalAttackers.has(attacker.character_id)
    );

    newAttackers.forEach((attacker) => {
      // Check if this attacker is related to existing campers
      const isRelated =
        camp.involvedCorporations.includes(attacker.corporation_id) ||
        camp.involvedAlliances.includes(attacker.alliance_id) ||
        killmail.killmail.attackers.some(
          (a) => a.character_id && camp.originalAttackers.has(a.character_id)
        );

      if (isRelated) {
        camp.originalAttackers.add(attacker.character_id);
        camp.activeAttackers.add(attacker.character_id);
      }

      // Add new corps and alliances
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
  }

  // Check if victim was a camp member
  const victimId = killmail.killmail.victim.character_id;
  if (victimId && camp.activeAttackers.has(victimId)) {
    camp.activeAttackers.delete(victimId);
    camp.killedAttackers.add(victimId);

    // Check if camp is crashed (2/3 of original attackers killed)
    if (camp.killedAttackers.size >= (camp.originalAttackers.size * 2) / 3) {
      camp.state = CAMP_STATES.CRASHED;
      camp.crashedTime = new Date().getTime();
    }
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

    const composition = updateCampComposition(newCamp, killmail);
    newCamp.composition = composition;
    newCamp.probability = calculateCampProbability(newCamp);
    currentCamps.push(newCamp);
  }

  activeCamps.set(currentCamps);
  return currentCamps;
}

socket.on("initialCamps", (camps) => {
  activeCamps.set(camps.map((camp) => ensureSets(camp)));
});

socket.on("campUpdate", (camps) => {
  activeCamps.set(camps.map((camp) => ensureSets(camp)));
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
