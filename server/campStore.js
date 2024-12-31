import { writable, derived } from "svelte/store";
import socket from "../src/socket.js";

// Constants
export const CAMP_TIMEOUT = 60 * 60 * 1000;
export const CAPSULE_ID = 670;

// Private camp tracking
const camps = new Map();

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

function calculateCampProbability(camp) {
  if (camp.kills.every((k) => k.zkb.npc)) return 0;

  const nonCapsuleKills = camp.kills.filter(
    (k) => k.killmail.victim.ship_type_id !== CAPSULE_ID
  );
  if (nonCapsuleKills.length < 2) return 0;

  let probability = 0;

  // Combat presence
  const hasInterdictor = camp.kills.some((kill) =>
    kill.killmail.attackers.some((a) =>
      [22456, 22464, 22452, 22460, 12013, 12017, 12021, 12025].includes(
        a.ship_type_id
      )
    )
  );
  if (hasInterdictor) probability += 40;

  // Attacker overlap check
  const overlap = getAttackerOverlap(camp.kills);
  if (overlap.characters > 0) probability += 40;
  else if (overlap.corporations > 0) probability += 20;

  // Victim type check
  if (camp.kills.some((k) => k.shipCategories?.victim === "industrial"))
    probability += 20;

  return Math.min(100, probability);
}

// Exported Functions
export function isGateCamp(killmail) {
  if (!killmail.pinpoints?.nearestCelestial) return false;
  return killmail.pinpoints.nearestCelestial.name
    .toLowerCase()
    .includes("stargate");
}

export function updateCamps(killmail) {
  let currentCamps = [];
  activeCamps.subscribe((value) => {
    currentCamps = value;
  })();

  const systemId = killmail.killmail.solar_system_id;
  const stargateName = killmail.pinpoints.nearestCelestial.name;
  const campId = `${systemId}-${stargateName}`;
  const now = Date.now();

  currentCamps = currentCamps.filter(
    (camp) => now - new Date(camp.lastKill).getTime() <= CAMP_TIMEOUT
  );

  const existingCamp = currentCamps.find((c) => c.id === campId);

  if (existingCamp) {
    existingCamp.kills.push(killmail);
    existingCamp.lastKill = killmail.killmail.killmail_time;
    existingCamp.totalValue += killmail.zkb.totalValue;
    existingCamp.involvedCharacters = Array.from(
      new Set([
        ...existingCamp.involvedCharacters,
        ...killmail.killmail.attackers
          .map((a) => a.character_id)
          .filter(Boolean),
        killmail.killmail.victim.character_id,
      ])
    );
    existingCamp.involvedCorporations = Array.from(
      new Set([
        ...existingCamp.involvedCorporations,
        ...killmail.killmail.attackers
          .map((a) => a.corporation_id)
          .filter(Boolean),
        killmail.killmail.victim.corporation_id,
      ])
    );
    existingCamp.involvedAlliances = Array.from(
      new Set([
        ...existingCamp.involvedAlliances,
        ...killmail.killmail.attackers
          .map((a) => a.alliance_id)
          .filter(Boolean),
        killmail.killmail.victim.alliance_id,
      ])
    );
    existingCamp.probability = calculateCampProbability(existingCamp); // Add this
  } else {
    const newCamp = {
      id: campId,
      systemId,
      stargateName,
      kills: [killmail],
      totalValue: killmail.zkb.totalValue,
      lastKill: killmail.killmail.killmail_time,
      involvedCharacters: Array.from(
        new Set([
          killmail.killmail.victim.character_id,
          ...killmail.killmail.attackers
            .map((a) => a.character_id)
            .filter(Boolean),
        ])
      ),
      involvedCorporations: Array.from(
        new Set([
          killmail.killmail.victim.corporation_id,
          ...killmail.killmail.attackers
            .map((a) => a.corporation_id)
            .filter(Boolean),
        ])
      ),
      involvedAlliances: Array.from(
        new Set([
          killmail.killmail.victim.alliance_id,
          ...killmail.killmail.attackers
            .map((a) => a.alliance_id)
            .filter(Boolean),
        ])
      ),
    };
    newCamp.probability = calculateCampProbability(newCamp); // Add this
    currentCamps.push(newCamp);
  }

  activeCamps.set(currentCamps);
  return currentCamps;
}
// Svelte Stores
export const activeCamps = writable([]);

socket.on("initialCamps", (camps) => activeCamps.set(camps));
socket.on("campUpdate", (camps) => activeCamps.set(camps));

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
      numAttackers: camp.involvedCharacters.length, // Changed from character_ids
      numCorps: camp.involvedCorporations.length, // Changed from corporation_ids
      numAlliances: camp.involvedAlliances.length, // Changed from alliance_ids
      lastKillTime: new Date(camp.lastKill).getTime(),
      age: Date.now() - new Date(camp.lastKill).getTime(),
      isActive: Date.now() - new Date(camp.lastKill).getTime() <= CAMP_TIMEOUT,
    }))
    .sort((a, b) => b.probability - a.probability);
});
