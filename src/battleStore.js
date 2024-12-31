// src/battleStore.js
import { writable, derived } from "svelte/store";

export const activeBattles = writable([]);

const BATTLE_TIMEOUT = 10 * 60 * 1000; // 10 minutes in milliseconds
const MAX_BATTLE_AGE = 5 * 60 * 1000; // 5 minutes in milliseconds

// In battleStore.js
function areKillsRelated(kill1, kill2) {
  // Must be in same system
  if (kill1.killmail.solar_system_id !== kill2.killmail.solar_system_id) {
    return false;
  }

  // Must be within 3 minutes
  const timeDiff = Math.abs(
    new Date(kill1.killmail.killmail_time) -
      new Date(kill2.killmail.killmail_time)
  );
  if (timeDiff > 180000) {
    // 3 minutes
    return false;
  }

  // Get involved entities from both kills
  const ents1 = new Set([
    ...kill1.killmail.attackers.map(
      (a) => `${a.corporation_id}-${a.alliance_id}`
    ),
    `${kill1.killmail.victim.corporation_id}-${kill1.killmail.victim.alliance_id}`,
  ]);

  const ents2 = new Set([
    ...kill2.killmail.attackers.map(
      (a) => `${a.corporation_id}-${a.alliance_id}`
    ),
    `${kill2.killmail.victim.corporation_id}-${kill2.killmail.victim.alliance_id}`,
  ]);

  // Check for shared entities
  let overlap = 0;
  ents1.forEach((ent) => {
    if (ents2.has(ent)) overlap++;
  });

  return overlap >= 1; // Require at least one shared entity
}

// In battleStore.js
// In battleStore.js
export function addKillmailToBattles(killmail) {
  activeBattles.update((battles) => {
    const now = new Date().getTime();
    const killTime = new Date(killmail.killmail.killmail_time).getTime();

    if (now - killTime > MAX_BATTLE_AGE) return battles;

    const timeWindow = Math.floor(killTime / (3 * 60 * 1000));
    const battleId = `${killmail.killmail.solar_system_id}-${timeWindow}`;

    let foundBattle = battles.find((battle) => {
      const firstKillTime = new Date(
        battle.kills[0].killmail.killmail_time
      ).getTime();
      const battleTimeWindow = Math.floor(firstKillTime / (3 * 60 * 1000));
      return (
        battle.systemId === killmail.killmail.solar_system_id &&
        battleTimeWindow === timeWindow &&
        areKillsRelated(battle.kills[0], killmail)
      );
    });

    if (foundBattle) {
      foundBattle.kills.push(killmail);
      foundBattle.totalValue += killmail.zkb.totalValue;
      foundBattle.lastKill = killmail.killmail.killmail_time;

      killmail.killmail.attackers.forEach((attacker) => {
        if (attacker.character_id)
          foundBattle.involvedCharacters.add(attacker.character_id);
        if (attacker.corporation_id)
          foundBattle.involvedCorporations.add(attacker.corporation_id);
        if (attacker.alliance_id)
          foundBattle.involvedAlliances.add(attacker.alliance_id);
      });

      if (killmail.killmail.victim.character_id) {
        foundBattle.involvedCharacters.add(
          killmail.killmail.victim.character_id
        );
      }

      // Add count properties
      foundBattle.numAttackers = foundBattle.involvedCharacters.size;
      foundBattle.numCorps = foundBattle.involvedCorporations.size;
      foundBattle.numAlliances = foundBattle.involvedAlliances.size;
    } else {
      const newBattle = {
        systemId: killmail.killmail.solar_system_id,
        battleId: battleId,
        kills: [killmail],
        totalValue: killmail.zkb.totalValue,
        lastKill: killmail.killmail.killmail_time,
        involvedCharacters: new Set([
          killmail.killmail.victim.character_id,
          ...killmail.killmail.attackers
            .map((a) => a.character_id)
            .filter(Boolean),
        ]),
        involvedCorporations: new Set([
          killmail.killmail.victim.corporation_id,
          ...killmail.killmail.attackers
            .map((a) => a.corporation_id)
            .filter(Boolean),
        ]),
        involvedAlliances: new Set([
          killmail.killmail.victim.alliance_id,
          ...killmail.killmail.attackers
            .map((a) => a.alliance_id)
            .filter(Boolean),
        ]),
      };

      // Add count properties
      newBattle.numAttackers = newBattle.involvedCharacters.size;
      newBattle.numCorps = newBattle.involvedCorporations.size;
      newBattle.numAlliances = newBattle.involvedAlliances.size;

      battles.push(newBattle);
    }

    battles = mergeBattles(battles);

    return battles.filter((battle) => {
      const battleAge = now - new Date(battle.lastKill).getTime();
      return battleAge < MAX_BATTLE_AGE;
    });
  });
}

function mergeBattles(battles) {
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < battles.length; i++) {
      for (let j = i + 1; j < battles.length; j++) {
        if (
          battles[i].systemId === battles[j].systemId &&
          battles[i].kills.some((kill1) =>
            battles[j].kills.some((kill2) => areKillsRelated(kill1, kill2))
          )
        ) {
          // Merge battles[j] into battles[i]
          battles[i].kills = [...battles[i].kills, ...battles[j].kills];
          battles[i].totalValue += battles[j].totalValue;
          battles[i].lastKill = new Date(
            Math.max(
              new Date(battles[i].lastKill),
              new Date(battles[j].lastKill)
            )
          ).toISOString();

          // Merge involved entities
          battles[j].involvedCharacters.forEach((id) =>
            battles[i].involvedCharacters.add(id)
          );
          battles[j].involvedCorporations.forEach((id) =>
            battles[i].involvedCorporations.add(id)
          );
          battles[j].involvedAlliances.forEach((id) =>
            battles[i].involvedAlliances.add(id)
          );

          // Remove battles[j]
          battles.splice(j, 1);
          merged = true;
          break;
        }
      }
      if (merged) break;
    }
  }
  return battles;
}

export const filteredBattles = derived(
  [activeBattles],
  ([$activeBattles], set) => {
    const minInvolved = 2; // Set this directly in the function
    const now = new Date().getTime();
    const filtered = $activeBattles
      .filter((battle) => {
        const age = now - new Date(battle.lastKill).getTime();
        const meetsAgeRequirement = age < MAX_BATTLE_AGE;
        const meetsInvolvedRequirement =
          battle.involvedCharacters.size >= minInvolved;

        console.log("Battle filtering:", {
          battleId: battle.kills[0]?.killmail_id,
          age: age / 1000,
          maxAge: MAX_BATTLE_AGE / 1000,
          involvedCount: battle.involvedCharacters.size,
          minInvolved,
          included: meetsAgeRequirement && meetsInvolvedRequirement,
        });

        return meetsAgeRequirement && meetsInvolvedRequirement;
      })
      .map((battle) => ({
        ...battle,
        involvedCount: battle.involvedCharacters.size,
        corporationCount: battle.involvedCorporations.size,
        allianceCount: battle.involvedAlliances.size,
      }));

    console.log("Filtered battles:", filtered.length);
    set(filtered);
  }
);
