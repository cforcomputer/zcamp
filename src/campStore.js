import { writable, derived } from "svelte/store";

export const activeCamps = writable([]);

const CAMP_TIMEOUT = 60 * 60 * 1000; // 1 hour in milliseconds
const CAPSULE_ID = 670;

const PERMANENTLY_CAMPED_SYSTEMS = new Set([
  30002813, 30005196, 30002718, 30002647,
]);

const SHIP_IDS = {
  INTERDICTORS: new Set([22456, 22464, 22452, 22460]), // Sabre, Flycatcher, Heretic, Eris
  HICTORS: new Set([12013, 12017, 12021, 12025]), // Broadsword, Onyx, Phobos, Devoter
  FORCE_RECON: new Set([11963, 11961]), // Rapier, Lachesis
  T3_CRUISERS: {
    LOKI: 29990,
    PROTEUS: 29988,
  },
  CURSE: 11965,
  INTERCEPTORS: new Set([11375, 11379, 11377, 11381]),
  LOGISTICS: new Set([11985, 11987, 11989, 11978]),
  TACTICAL_DESTROYERS: new Set([34317, 34828]), // Hecate, Jackdaw
};

const INDUSTRIAL_CATEGORIES = new Set([
  "Industrial",
  "Industrial Command Ship",
  "Deep Space Transport",
  "Blockade Runner",
  "Freighter",
  "Jump Freighter",
]);

function isStargate(name) {
  if (!name) return false;
  return (
    name.toLowerCase().includes("stargate") ||
    name.toLowerCase().includes("gate to") ||
    name.toLowerCase().includes("jump gate")
  );
}

function calculateCampProbability(kills, systemId) {
  let probability = 0;
  const now = new Date().getTime();
  const lastKillTime = new Date(
    kills[kills.length - 1].killmail.killmail_time
  ).getTime();
  const timeSinceLastKill = now - lastKillTime;

  if (kills.every((k) => k.zkb.npc)) return 0;

  const nonCapsuleKills = kills.filter(
    (k) => k.killmail.victim.ship_type_id !== CAPSULE_ID
  );
  if (nonCapsuleKills.length < 2) return 0;

  if (PERMANENTLY_CAMPED_SYSTEMS.has(systemId)) {
    if (timeSinceLastKill <= 45 * 60 * 1000) {
      return 100;
    }
    return 30;
  }

  // Check for industrial victims
  const hasIndustrialVictims = kills.some(
    (kill) => kill.shipCategories?.victim === "industrial"
  );
  if (hasIndustrialVictims) {
    probability += 20;
  }

  // Check for capital victims
  const hasCapitalVictims = kills.some(
    (kill) => kill.shipCategories?.victim === "capital"
  );
  if (hasCapitalVictims) {
    probability += 30;
  }

  // Analyze attacker compositions
  kills.forEach((kill) => {
    const attackerCategories = kill.shipCategories?.attackers || [];

    // Check for capital support
    const hasCapitalSupport = attackerCategories.some(
      (attacker) => attacker.category === "capital"
    );
    if (hasCapitalSupport) {
      probability += 25;
    }

    // Check for combat ship concentration
    const combatShips = attackerCategories.filter(
      (attacker) => attacker.category === "combat"
    );
    if (combatShips.length >= 3) {
      probability += 15;
    }
  });

  // Time-based probability adjustment
  if (probability >= 60) {
    if (timeSinceLastKill > 40 * 60 * 1000) {
      const decayFactor = Math.min(
        1,
        (timeSinceLastKill - 40 * 60 * 1000) / (20 * 60 * 1000)
      );
      probability = Math.max(30, probability * (1 - decayFactor));
    }
  }

  // Check for shared attackers
  const attackerOverlap = getAttackerOverlap(kills);
  if (attackerOverlap.characters > 0) probability += 30;
  else if (attackerOverlap.corporations > 0) probability += 20;
  else if (attackerOverlap.alliances > 0) probability += 10;

  return Math.min(100, Math.max(0, probability));
}

function getAttackerOverlap(kills) {
  const overlap = {
    characters: 0,
    corporations: 0,
    alliances: 0,
  };

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

  for (let i = 1; i < kills.length; i++) {
    kills[i].killmail.attackers.forEach((attacker) => {
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

export function addKillmailToCamps(killmail) {
  if (!killmail.pinpoints?.nearestCelestial) return;
  if (!isStargate(killmail.pinpoints.nearestCelestial.name)) return;

  activeCamps.update((camps) => {
    const now = new Date().getTime();
    const oldCamps = camps.filter((camp) => {
      const age = now - new Date(camp.lastKill).getTime();
      return age < CAMP_TIMEOUT;
    });

    const systemId = killmail.killmail.solar_system_id;
    const stargateName = killmail.pinpoints.nearestCelestial.name;
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

      camp.probability = calculateCampProbability(camp.kills, systemId);
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
  return $activeCamps
    .filter((camp) => {
      const nonCapsuleKills = camp.kills.filter(
        (k) => k.killmail.victim.ship_type_id !== CAPSULE_ID
      );
      return nonCapsuleKills.length >= 2 && camp.probability >= 30;
    })
    .map((camp) => ({
      ...camp,
      numAttackers: camp.character_ids.size,
      numCorps: camp.corporation_ids.size,
      numAlliances: camp.alliance_ids.size,
    }))
    .sort((a, b) => b.probability - a.probability);
});
