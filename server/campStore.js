// src/campStore.js

import { writable, derived } from "svelte/store";
import socket from "../src/socket.js";

// Create stores
export const activeCamps = writable([]);
export const CAMP_TIMEOUT = 60 * 60 * 1000;

socket.on("initialCamps", (camps) => {
  activeCamps.set(camps);
});

socket.on("campUpdate", (camps) => {
  activeCamps.set(camps);
});

export const filteredCamps = derived([activeCamps], ([$activeCamps]) => {
  return $activeCamps
    .filter((camp) => {
      const nonCapsuleKills = camp.kills.filter(
        (k) => k.killmail.victim.ship_type_id !== 670
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

const CAPSULE_ID = 670;

export function isGateCamp(killmail) {
  if (!killmail.pinpoints?.nearestCelestial) return false;
  return (
    killmail.pinpoints.nearestCelestial.name
      .toLowerCase()
      .includes("stargate") ||
    killmail.pinpoints.nearestCelestial.name.toLowerCase().includes("gate to")
  );
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

function getAttackerOverlap(kills) {
  const firstAttackers = {
    characters: new Set(kills[0].killmail.attackers.map((a) => a.character_id)),
    corporations: new Set(
      kills[0].killmail.attackers.map((a) => a.corporation_id)
    ),
    alliances: new Set(kills[0].killmail.attackers.map((a) => a.alliance_id)),
  };

  let overlap = { characters: 0, corporations: 0, alliances: 0 };

  for (let i = 1; i < kills.length; i++) {
    kills[i].killmail.attackers.forEach((attacker) => {
      if (
        attacker.character_id &&
        firstAttackers.characters.has(attacker.character_id)
      ) {
        overlap.characters++;
      }
      if (
        attacker.corporation_id &&
        firstAttackers.corporations.has(attacker.corporation_id)
      ) {
        overlap.corporations++;
      }
      if (
        attacker.alliance_id &&
        firstAttackers.alliances.has(attacker.alliance_id)
      ) {
        overlap.alliances++;
      }
    });
  }

  return overlap;
}

function calculateCampProbability(camp) {
  const now = new Date().getTime();
  const lastKillTime = new Date(
    camp.kills[camp.kills.length - 1].killmail.killmail_time
  ).getTime();

  if (camp.kills.every((k) => k.zkb.npc)) return 0;

  const nonCapsuleKills = camp.kills.filter(
    (k) => k.killmail.victim.ship_type_id !== CAPSULE_ID
  );
  if (nonCapsuleKills.length < 2) return 0;

  let probability = 0;

  const hasIndustrials = camp.kills.some(
    (k) => k.shipCategories?.victim === "industrial"
  );
  if (hasIndustrials) probability += 20;

  camp.kills.forEach((kill) => {
    const attackerCategories = kill.shipCategories?.attackers || [];
    const hasCapitals = attackerCategories.some(
      (a) => a.category === "capital"
    );
    if (hasCapitals) probability += 25;

    const combatShips = attackerCategories.filter(
      (a) => a.category === "combat"
    );
    if (combatShips.length >= 3) probability += 15;
  });

  const attackerOverlap = getAttackerOverlap(camp.kills);
  if (attackerOverlap.characters > 0) probability += 30;
  else if (attackerOverlap.corporations > 0) probability += 20;
  else if (attackerOverlap.alliances > 0) probability += 10;

  return Math.min(100, Math.max(0, probability));
}

export function updateCamps(killmail, activeCamps) {
  const systemId = killmail.killmail.solar_system_id;
  const stargateName = killmail.pinpoints.nearestCelestial.name;
  const campId = `${systemId}-${stargateName}`;

  const now = new Date().getTime();
  for (const [id, camp] of activeCamps.entries()) {
    const age = now - new Date(camp.lastKill).getTime();
    if (age > CAMP_TIMEOUT) {
      activeCamps.delete(id);
    }
  }

  const existingCamp = activeCamps.get(campId);
  if (existingCamp) {
    existingCamp.kills.push(killmail);
    existingCamp.lastKill = killmail.killmail.killmail_time;
    existingCamp.totalValue += killmail.zkb.totalValue;

    const ids = getAttackerIds(killmail.killmail.attackers);
    ids.character_ids.forEach((id) => existingCamp.character_ids.add(id));
    ids.corporation_ids.forEach((id) => existingCamp.corporation_ids.add(id));
    ids.alliance_ids.forEach((id) => existingCamp.alliance_ids.add(id));

    existingCamp.probability = calculateCampProbability(existingCamp);
    activeCamps.set(campId, existingCamp);
  } else {
    const ids = getAttackerIds(killmail.killmail.attackers);
    const newCamp = {
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
    newCamp.probability = calculateCampProbability(newCamp);
    activeCamps.set(campId, newCamp);
  }

  return activeCamps;
}

// module.exports = {
//   isGateCamp,
//   updateCamps,
//   CAMP_TIMEOUT,
// };
