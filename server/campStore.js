import { writable, derived } from "svelte/store";
import socket from "../src/socket.js";

export const CAMP_TIMEOUT = 40 * 60 * 1000; // 40 minutes
export const DECAY_START = 20 * 60 * 1000; // 20 minutes
export const ROAM_TIMEOUT = 20 * 60 * 1000; // 20 minutes
export const CAPSULE_ID = 670;

export const activeRoams = writable([]);
export const activeCamps = writable([]);

export const CAMP_PROBABILITY_FACTORS = {
  BASE: {
    SINGLE_KILL: 0.3,
    MULTI_KILL: 0.5,
    INITIAL_BURST: -0.2,
  },

  TIME_WEIGHTS: {
    INACTIVITY: {
      start: 20,
      penalty: -0.35,
      decayPerMinute: 0.2,
    },
    ESTABLISHED: { threshold: 60, bonus: 0.2 },
    SUSTAINED: { threshold: 120, bonus: 0.3 },
    FATIGUE: { threshold: 180, penalty: -0.2 },
  },

  SMARTBOMB_WEAPONS: {
    // Large T1 Smartbombs
    14210: "Large EMP Smartbomb I",
    14208: "Large Proton Smartbomb I",
    14212: "Large Plasma Smartbomb I",
    14214: "Large Electron Smartbomb I",
    14216: "Large Gamma Smartbomb I",
    // Large T2 Smartbombs
    14209: "Large EMP Smartbomb II",
    14207: "Large Proton Smartbomb II",
    14211: "Large Plasma Smartbomb II",
    14213: "Large Electron Smartbomb II",
    14215: "Large Gamma Smartbomb II",
    // Large Faction Smartbombs
    14269: "Domination Large EMP Smartbomb",
    14271: "Dark Blood Large EMP Smartbomb",
    14273: "True Sansha Large EMP Smartbomb",
    14275: "Shadow Serpentis Large Electron Smartbomb",
    14277: "Dread Guristas Large Proton Smartbomb",
    14279: "Republic Fleet Large EMP Smartbomb",
    14281: "Caldari Navy Large Proton Smartbomb",
    14283: "Imperial Navy Large EMP Smartbomb",
    14285: "Federation Navy Large Electron Smartbomb",
    // Medium T1 Smartbombs
    14202: "Medium EMP Smartbomb I",
    14200: "Medium Proton Smartbomb I",
    14204: "Medium Plasma Smartbomb I",
    14206: "Medium Electron Smartbomb I",
    14198: "Medium Gamma Smartbomb I",
    // Medium T2 Smartbombs
    14201: "Medium EMP Smartbomb II",
    14199: "Medium Proton Smartbomb II",
    14203: "Medium Plasma Smartbomb II",
    14205: "Medium Electron Smartbomb II",
    14197: "Medium Gamma Smartbomb II",
    // Medium Faction Smartbombs
    14268: "Domination Medium EMP Smartbomb",
    14270: "Dark Blood Medium EMP Smartbomb",
    14272: "True Sansha Medium EMP Smartbomb",
    14274: "Shadow Serpentis Medium Electron Smartbomb",
    14276: "Dread Guristas Medium Proton Smartbomb",
    14278: "Republic Fleet Medium EMP Smartbomb",
    14280: "Caldari Navy Medium Proton Smartbomb",
    14282: "Imperial Navy Medium EMP Smartbomb",
    14284: "Federation Navy Medium Electron Smartbomb",
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
    SAME_CHARS: 0.25,
    SAME_CORPS: 0.15,
    TIME_WINDOW: 1800000,
  },
};

function hasSmartbombs(kills) {
  return kills.some((kill) =>
    kill.killmail.attackers.some(
      (attacker) =>
        attacker.weapon_type_id &&
        CAMP_PROBABILITY_FACTORS.SMARTBOMB_WEAPONS[attacker.weapon_type_id]
    )
  );
}

export const filteredCamps = derived([activeCamps], ([$activeCamps]) => {
  return $activeCamps
    .map((camp) => ({
      ...camp,
      nonPodKills: camp.kills.filter(
        (k) => k.killmail.victim.ship_type_id !== CAPSULE_ID
      ).length,
      composition: camp.composition || {
        originalCount: 0,
        activeCount: 0,
        killedCount: 0,
      },
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

    const campCharacters = new Set();
    $activeCamps.forEach((camp) => {
      if (camp.probability >= 60) {
        camp.originalAttackers?.forEach((id) => campCharacters.add(id));
        camp.activeAttackers?.forEach((id) => campCharacters.add(id));
      }
    });

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
        return (
          roam.members.length >= 2 &&
          roam.systems.length > 0 &&
          Date.now() - new Date(roam.lastActivity).getTime() <= ROAM_TIMEOUT
        );
      })
      .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  }
);

export function calculateCampProbability(camp) {
  const log = [];
  log.push(
    `--- Starting probability calculation for camp: ${camp.systemId}-${camp.stargateName} ---`
  );

  // Check for smartbomb usage and set camp type
  if (hasSmartbombs(camp.kills)) {
    camp.type = "smartbomb";
    log.push("Smartbomb weapons detected - marking as smartbomb camp");
  } else {
    camp.type = "standard";
  }

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
  // 3. TIME-BASED ADJUSTMENTS (Initial Checks)
  //----------------------------------------

  const lastKillTime = new Date(camp.lastKill).getTime();
  const minutesSinceLastKill = (now - lastKillTime) / (60 * 1000);

  // Penalty for burst kills
  const killTimes = gateKills
    .map((k) => new Date(k.killmail.killmail_time).getTime())
    .sort();
  const firstKillTime = killTimes[0];
  const campAge = (now - firstKillTime) / (60 * 1000);
  log.push(`Camp age: ${campAge.toFixed(1)} minutes`);

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

  const CONSISTENCY_BONUS = 0.15;
  const consistencyCheckKills = gateKills.slice(-3);
  let consistencyBonus = 0;

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
  // 8. FINAL TIME DECAY
  //----------------------------------------

  // Calculate time decay percentage
  let timeDecayPercent = 0;
  if (minutesSinceLastKill > DECAY_START / (60 * 1000)) {
    const decayMinutes = minutesSinceLastKill - DECAY_START / (60 * 1000);
    timeDecayPercent = Math.min(0.95, decayMinutes * 0.05); // 5% decay per minute after decay start, max 95% decay
    log.push(
      `Applying decay for ${decayMinutes.toFixed(1)} minutes beyond decay start`
    );

    // Apply decay as a percentage of current probability
    const beforeDecay = probability;
    probability *= 1 - timeDecayPercent;
    log.push(
      `Time decay adjustment (${minutesSinceLastKill.toFixed(
        1
      )} minutes since last kill): -${(timeDecayPercent * 100).toFixed(
        1
      )}% (${beforeDecay} → ${probability})`
    );
  }

  //----------------------------------------
  // 9. FINAL NORMALIZATION
  //----------------------------------------

  probability = Math.max(0, Math.min(95, Math.round(probability * 100)));
  log.push(`Final normalized probability: ${probability}%`);

  camp.probabilityLog = log;
  return probability;
}

function getMetrics(kills, now) {
  const killTimes = kills.map((k) =>
    new Date(k.killmail.killmail_time).getTime()
  );
  const earliestKillTime = Math.min(...killTimes);
  const lastKillTime = Math.max(...killTimes);

  // Calculate total duration from first kill to now
  const totalDuration = Math.floor((now - earliestKillTime) / (1000 * 60));

  // Calculate duration from first to last kill
  const activeDuration = Math.floor(
    (lastKillTime - earliestKillTime) / (1000 * 60)
  );

  // Calculate inactivity duration from last kill to now
  const inactivityDuration = Math.floor((now - lastKillTime) / (1000 * 60));

  return {
    firstSeen: earliestKillTime,
    campDuration: totalDuration, // Total duration including inactive time
    activeDuration: activeDuration, // Duration between first and last kill
    inactivityDuration: inactivityDuration,
    podKills: kills.filter((k) => k.killmail.victim.ship_type_id === CAPSULE_ID)
      .length,
    killFrequency: kills.length / Math.max(1, activeDuration),
    avgValuePerKill:
      kills.reduce((sum, k) => sum + k.zkb.totalValue, 0) / kills.length,
  };
}

export function updateCamps(killmail) {
  console.log("--- campStore.js: Camp Update Debug ---");
  console.log("Processing killmail:", {
    killID: killmail.killID,
    systemId: killmail.killmail.solar_system_id,
    time: killmail.killmail.killmail_time,
    attackers: killmail.killmail.attackers.length,
  });

  activeCamps.update((currentCamps) => {
    const now = Date.now();

    // Clean expired camps
    const beforeCleanCount = currentCamps.length;
    let updatedCamps = currentCamps.filter((camp) => {
      const timeSinceLastKill = now - new Date(camp.lastKill).getTime();
      const isActive = timeSinceLastKill <= CAMP_TIMEOUT;
      if (!isActive) {
        console.log(
          `Camp ${camp.id} expired after ${Math.floor(
            timeSinceLastKill / 1000 / 60
          )}m of inactivity`
        );
      }
      return isActive;
    });

    console.log(
      `Cleaned expired camps: ${beforeCleanCount} -> ${updatedCamps.length}`
    );

    // Skip if not a gate camp
    if (!isGateCamp(killmail)) {
      console.log("Not a gate camp, skipping");
      return updatedCamps;
    }

    const systemId = killmail.killmail.solar_system_id;
    const systemName =
      killmail.pinpoints?.celestialData?.solarsystemname || systemId.toString();
    const stargateName =
      killmail.pinpoints?.nearestCelestial?.name || "Unknown Gate";
    const campId = `${systemId}-${stargateName}`;

    // Get unique attacker character IDs, excluding capsules
    const attackerIds = new Set(
      killmail.killmail.attackers
        .filter((a) => a.character_id && a.ship_type_id !== CAPSULE_ID)
        .map((a) => a.character_id)
    );

    console.log(`Found ${attackerIds.size} unique attackers in killmail`);

    // Find existing camp
    const existingCampIndex = updatedCamps.findIndex(
      (camp) => camp.id === campId
    );

    if (existingCampIndex !== -1) {
      console.log("Updating existing camp:", {
        id: updatedCamps[existingCampIndex].id,
        previousKills: updatedCamps[existingCampIndex].kills.length,
      });

      // Update existing camp
      const camp = updatedCamps[existingCampIndex];
      camp.kills.push(killmail);
      camp.lastKill = killmail.killmail.killmail_time;
      camp.totalValue += killmail.zkb.totalValue;

      // Check for smartbomb usage
      if (hasSmartbombs([killmail])) {
        camp.type = "smartbomb";
      }

      camp.probability = calculateCampProbability(camp);
      camp.composition = updateCampComposition(camp, killmail);
      camp.metrics = getMetrics(camp.kills, now);

      console.log("Updated camp stats:", {
        kills: camp.kills.length,
        totalValue: camp.totalValue,
        probability: camp.probability,
        type: camp.type,
      });
    } else {
      console.log("Creating new camp");
      // Create new camp
      const newCamp = {
        id: campId,
        systemId,
        stargateName,
        kills: [killmail],
        totalValue: killmail.zkb.totalValue,
        lastKill: killmail.killmail.killmail_time,
        firstKillTime: now,
        latestKillTime: now,
        type: hasSmartbombs([killmail]) ? "smartbomb" : "standard",
        probability: calculateCampProbability({ kills: [killmail] }),
        composition: updateCampComposition(
          {
            originalAttackers: new Set(),
            activeAttackers: new Set(),
            killedAttackers: new Set(),
          },
          killmail
        ),
        metrics: getMetrics([killmail], now),
      };

      updatedCamps.push(newCamp);
      console.log("New camp created:", {
        id: newCamp.id,
        system: newCamp.stargateName,
        totalValue: newCamp.totalValue,
        type: newCamp.type,
      });
    }

    console.log(`Total active camps: ${updatedCamps.length}`);

    // Prepare camps for emission with all required data
    return updatedCamps.map((campData) => ({
      ...campData,
      probability: campData.probability || 0,
      probabilityLog: campData.probabilityLog || [],
      composition: campData.composition || {
        originalCount: 0,
        activeCount: 0,
        killedCount: 0,
      },
    }));
  });

  // Return current value for socket emission
  let currentValue;
  activeCamps.subscribe((value) => {
    currentValue = value;
  })();

  return currentValue;
}

function updateCampComposition(camp, killmail) {
  camp.originalAttackers = camp.originalAttackers || new Set();
  camp.activeAttackers = camp.activeAttackers || new Set();
  camp.killedAttackers = camp.killedAttackers || new Set();
  camp.involvedCorporations = camp.involvedCorporations || [];
  camp.involvedAlliances = camp.involvedAlliances || [];

  killmail.killmail.attackers.forEach((attacker) => {
    if (!attacker.character_id) return;

    if (!camp.originalAttackers.has(attacker.character_id)) {
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

export function isGateCamp(killmail) {
  if (!killmail.pinpoints?.nearestCelestial) return false;
  return killmail.pinpoints.nearestCelestial.name
    .toLowerCase()
    .includes("stargate");
}

// Socket event handlers
socket.on("initialCamps", (camps) => {
  const processedCamps = camps.map((camp) => {
    camp = ensureSets(camp);
    camp.probability = calculateCampProbability(camp);
    camp.composition = updateCampComposition(
      camp,
      camp.kills[camp.kills.length - 1]
    );
    camp.metrics = getMetrics(camp.kills, Date.now());
    return {
      ...camp,
      probabilityLog: camp.probabilityLog || [],
      probability: camp.probability || 0,
    };
  });
  activeCamps.set(processedCamps);
});

socket.on("campUpdate", (camps) => {
  const processedCamps = camps.map((camp) => {
    camp = ensureSets(camp);
    if (!camp.probability) {
      camp.probability = calculateCampProbability(camp);
    }
    camp.composition = updateCampComposition(
      camp,
      camp.kills[camp.kills.length - 1]
    );
    camp.metrics = getMetrics(camp.kills, Date.now());
    return {
      ...camp,
      probabilityLog: camp.probabilityLog || [],
      probability: camp.probability || 0,
    };
  });
  activeCamps.set(processedCamps);
});

function ensureSets(camp) {
  return {
    ...camp,
    originalAttackers: new Set(
      Array.isArray(camp.originalAttackers) ? camp.originalAttackers : []
    ),
    activeAttackers: new Set(
      Array.isArray(camp.activeAttackers) ? camp.activeAttackers : []
    ),
    killedAttackers: new Set(
      Array.isArray(camp.killedAttackers) ? camp.killedAttackers : []
    ),
  };
}

// Periodic probability updates
if (typeof window !== "undefined") {
  setInterval(() => {
    activeCamps.update((camps) => {
      return camps.map((camp) => {
        const now = Date.now();
        const lastKillTime = new Date(camp.lastKill).getTime();
        const minutesSinceLastKill = (now - lastKillTime) / (60 * 1000);

        if (minutesSinceLastKill > DECAY_START / (60 * 1000)) {
          camp.probability = calculateCampProbability(camp);
          camp.metrics = getMetrics(camp.kills, now);
        }

        return camp;
      });
    });
  }, 60000);
}

socket.on("initialRoams", (roams) => {
  const formattedRoams = roams.map(formatRoam);
  activeRoams.set(formattedRoams);
});

socket.on("roamUpdate", (roams) => {
  const formattedRoams = roams.map(formatRoam);
  activeRoams.set(formattedRoams);
});

function formatRoam(roam) {
  return {
    ...roam,
    id: roam.id,
    members: Array.isArray(roam.members) ? Array.from(roam.members) : [],
    systems: Array.isArray(roam.systems) ? [...roam.systems] : [],
    kills: Array.isArray(roam.kills) ? [...roam.kills] : [],
    totalValue: roam.totalValue || 0,
    lastActivity: roam.lastActivity || new Date().toISOString(),
    lastSystem: roam.lastSystem || { id: 0, name: "Unknown" },
    startTime: roam.startTime || roam.lastActivity || new Date().toISOString(),
  };
}
