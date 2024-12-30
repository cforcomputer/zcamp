import { writable, derived } from "svelte/store"; // Add derived here

export const activeCamps = writable([]);

const CAMP_TIMEOUT = 15 * 60 * 1000; // 15 minutes in milliseconds
// Add at top of campStore.js
const CAPSULE_ID = 670;
const INTERDICTOR_IDS = new Set([
  22456, // Sabre
  22464, // Flycatcher
  22452, // Heretic
  22460, // Eris
  // Add other interdictor IDs
]);

const HICTOR_IDS = new Set([
  12013, // Broadsword
  12017, // Onyx
  12021, // Phobos
  12025, // Devoter
  // Add other heavy interdictor IDs
]);

function isStargate(name) {
  if (!name) return false;

  // Common patterns for stargate names
  return (
    name.toLowerCase().includes("stargate") ||
    name.toLowerCase().includes("gate to") ||
    name.toLowerCase().includes("jump gate")
  );
}

function calculateCampProbability(kills) {
  let probability = 0;

  // Ignore if only capsule kills
  const nonCapsuleKills = kills.filter(
    (k) => k.killmail.victim.ship_type_id !== CAPSULE_ID
  );

  if (nonCapsuleKills.length < 2) return 0;

  // Base probability starts at 30% with 2+ kills
  probability = 30;

  // Check time distribution
  const killTimes = nonCapsuleKills.map((k) =>
    new Date(k.killmail.killmail_time).getTime()
  );
  const timeSpan = Math.max(...killTimes) - Math.min(...killTimes);
  const avgTimeBetweenKills = timeSpan / (killTimes.length - 1);

  // If kills are very close together (within 2 minutes), reduce probability
  if (avgTimeBetweenKills < 120000) {
    probability -= 20;
  } else if (avgTimeBetweenKills > 600000) {
    // If spread out over 10+ minutes
    probability += 20;
  }

  // Check for interdictors/hictors
  const hasInterdictor = nonCapsuleKills.some((kill) =>
    kill.killmail.attackers.some(
      (a) =>
        INTERDICTOR_IDS.has(a.ship_type_id) || HICTOR_IDS.has(a.ship_type_id)
    )
  );

  if (hasInterdictor) {
    probability += 30;
  }

  // Check for shared attackers
  const attackerOverlap = getAttackerOverlap(nonCapsuleKills);
  if (attackerOverlap.characters > 0) {
    probability += 30;
  } else if (attackerOverlap.corporations > 0) {
    probability += 20;
  } else if (attackerOverlap.alliances > 0) {
    probability += 10;
  }

  // Cap probability at 100%
  return Math.min(100, Math.max(0, probability));
}

function getAttackerOverlap(kills) {
  const overlap = {
    characters: 0,
    corporations: 0,
    alliances: 0,
  };

  // Create sets for first kill's attacker IDs
  const firstKillAttackers = {
    characters: new Set(
      kills[0].killmail.attackers.map((a) => a.character_id).filter(Boolean)
    ),
    corporations: new Set(
      kills[0].killmail.attackers.map((a) => a.corporation_id).filter(Boolean)
    ),
    alliances: new Set(
      kills[0].killmail.attackers.map((a) => a.alliance_id).filter(Boolean)
    ),
  };

  // Check other kills for overlapping IDs
  for (let i = 1; i < kills.length; i++) {
    const kill = kills[i];
    kill.killmail.attackers.forEach((attacker) => {
      if (
        attacker.character_id &&
        firstKillAttackers.characters.has(attacker.character_id)
      ) {
        overlap.characters++;
      }
      if (
        attacker.corporation_id &&
        firstKillAttackers.corporations.has(attacker.corporation_id)
      ) {
        overlap.corporations++;
      }
      if (
        attacker.alliance_id &&
        firstKillAttackers.alliances.has(attacker.alliance_id)
      ) {
        overlap.alliances++;
      }
    });
  }

  return overlap;
}

function getAttackerIds(attackers) {
  return {
    character_ids: new Set(
      attackers.map((a) => a.character_id).filter(Boolean)
    ),
    corporation_ids: new Set(
      attackers.map((a) => a.corporation_id).filter(Boolean)
    ),
    alliance_ids: new Set(attackers.map((a) => a.alliance_id).filter(Boolean)),
  };
}

// In campStore.js
export function addKillmailToCamps(killmail) {
  if (!killmail.pinpoints?.nearestCelestial) {
    return;
  }

  if (!isStargate(killmail.pinpoints.nearestCelestial.name)) {
    return;
  }

  activeCamps.update((camps) => {
    const now = new Date().getTime();

    // Remove old camps
    const oldCamps = camps.filter((camp) => {
      const age = now - new Date(camp.lastKill).getTime();
      const isOld = age >= CAMP_TIMEOUT;
      if (isOld) {
        console.log("Removing old camp:", {
          systemId: camp.systemId,
          stargateName: camp.stargateName,
          age: Math.floor(age / 1000) + "s",
        });
      }
      return !isOld;
    });

    const systemId = killmail.killmail.solar_system_id;
    const stargateName = killmail.pinpoints.nearestCelestial.name;

    // Find existing camp
    let camp = oldCamps.find(
      (c) => c.systemId === systemId && c.stargateName === stargateName
    );

    if (camp) {
      camp.kills.push(killmail);
      camp.lastKill = killmail.killmail.killmail_time;
      camp.totalValue += killmail.zkb.totalValue;

      const newIds = getAttackerIds(killmail.killmail.attackers);
      newIds.character_ids.forEach((id) => camp.character_ids.add(id));
      newIds.corporation_ids.forEach((id) => camp.corporation_ids.add(id));
      newIds.alliance_ids.forEach((id) => camp.alliance_ids.add(id));

      camp.probability = calculateCampProbability(camp.kills);
    } else {
      const ids = getAttackerIds(killmail.killmail.attackers);
      camp = {
        systemId,
        stargateName,
        kills: [killmail],
        totalValue: killmail.zkb.totalValue,
        lastKill: killmail.killmail.killmail_time,
        character_ids: ids.character_ids,
        corporation_ids: ids.corporation_ids,
        alliance_ids: ids.alliance_ids,
        probability: 0,
      };
      oldCamps.push(camp);
    }

    return oldCamps;
  });
}

export const filteredCamps = derived([activeCamps], ([$activeCamps]) => {
  console.log("Filtering camps. Total camps:", $activeCamps.length);

  const filtered = $activeCamps
    .filter((camp) => {
      // Filter out camps with only capsule kills
      const nonCapsuleKills = camp.kills.filter(
        (k) => k.killmail.victim.ship_type_id !== CAPSULE_ID
      );

      const hasEnoughKills = nonCapsuleKills.length >= 2;
      const hasHighEnoughProbability = camp.probability >= 30;

      console.log("Camp evaluation:", {
        systemId: camp.systemId,
        stargateName: camp.stargateName,
        totalKills: camp.kills.length,
        nonCapsuleKills: nonCapsuleKills.length,
        probability: camp.probability,
        passed: hasEnoughKills && hasHighEnoughProbability,
      });

      return hasEnoughKills && hasHighEnoughProbability;
    })
    .map((camp) => ({
      ...camp,
      numAttackers: camp.character_ids.size,
      numCorps: camp.corporation_ids.size,
      numAlliances: camp.alliance_ids.size,
    }))
    .sort((a, b) => b.probability - a.probability);

  console.log("Filtered camps:", filtered.length);
  return filtered;
});
