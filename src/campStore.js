// src/campStore.js
import { writable, derived } from "svelte/store";

export const activeCamps = writable([]);

const CAMP_TIMEOUT = 60 * 60 * 1000; // 1 hour in milliseconds

function isStargate(celestialName) {
  return celestialName?.toLowerCase().includes("stargate");
}

function getAttackerIds(attackers) {
  const ids = {
    character_ids: new Set(),
    corporation_ids: new Set(),
    alliance_ids: new Set(),
  };

  attackers.forEach((attacker) => {
    if (attacker.character_id) ids.character_ids.add(attacker.character_id);
    if (attacker.corporation_id)
      ids.corporation_ids.add(attacker.corporation_id);
    if (attacker.alliance_id) ids.alliance_ids.add(attacker.alliance_id);
  });

  return ids;
}

function checkRelatedAttackers(camp, killmail) {
  const newIds = getAttackerIds(killmail.killmail.attackers);

  // Check for any overlapping IDs
  return (
    [...camp.character_ids].some((id) => newIds.character_ids.has(id)) ||
    [...camp.corporation_ids].some((id) => newIds.corporation_ids.has(id)) ||
    [...camp.alliance_ids].some((id) => newIds.alliance_ids.has(id))
  );
}

export function addKillmailToCamps(killmail) {
  if (
    !killmail.pinpoints?.nearestCelestial ||
    !isStargate(killmail.pinpoints.nearestCelestial.name)
  ) {
    return;
  }

  activeCamps.update((camps) => {
    const now = new Date().getTime();

    // Remove old camps
    camps = camps.filter((camp) => {
      const age = now - new Date(camp.lastKill).getTime();
      return age < CAMP_TIMEOUT;
    });

    const systemId = killmail.killmail.solar_system_id;
    const stargateName = killmail.pinpoints.nearestCelestial.name;

    // Find existing camp
    let camp = camps.find(
      (c) => c.systemId === systemId && c.stargateName === stargateName
    );

    if (camp) {
      // Only add kill if attackers are related
      if (checkRelatedAttackers(camp, killmail)) {
        camp.kills.push(killmail);
        camp.lastKill = killmail.killmail.killmail_time;
        camp.totalValue += killmail.zkb.totalValue;

        // Update attacker IDs
        const newIds = getAttackerIds(killmail.killmail.attackers);
        newIds.character_ids.forEach((id) => camp.character_ids.add(id));
        newIds.corporation_ids.forEach((id) => camp.corporation_ids.add(id));
        newIds.alliance_ids.forEach((id) => camp.alliance_ids.add(id));
      }
    } else {
      // Create new camp
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
      };
      camps.push(camp);
    }

    return camps;
  });
}

export const filteredCamps = derived([activeCamps], ([$activeCamps]) => {
  return $activeCamps
    .filter((camp) => camp.kills.length >= 2)
    .map((camp) => ({
      ...camp,
      numAttackers: camp.character_ids.size,
      numCorps: camp.corporation_ids.size,
      numAlliances: camp.alliance_ids.size,
    }));
});
