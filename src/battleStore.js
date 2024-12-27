// src/battleStore.js
import { writable, derived } from "svelte/store";

export const activeBattles = writable([]);

const BATTLE_TIMEOUT = 10 * 60 * 1000; // 10 minutes in milliseconds
const MAX_BATTLE_AGE = 5 * 60 * 1000; // 5 minutes in milliseconds

function areKillsRelated(kill1, kill2) {
  // Helper function to extract all relevant IDs from a killmail
  function extractIds(killmail) {
    const ids = {
      characters: new Set(),
      corporations: new Set(),
      alliances: new Set(),
    };

    // Add victim IDs
    if (killmail.killmail.victim.character_id) {
      ids.characters.add(killmail.killmail.victim.character_id);
    }
    if (killmail.killmail.victim.corporation_id) {
      ids.corporations.add(killmail.killmail.victim.corporation_id);
    }
    if (killmail.killmail.victim.alliance_id) {
      ids.alliances.add(killmail.killmail.victim.alliance_id);
    }

    // Add attacker IDs
    killmail.killmail.attackers.forEach((attacker) => {
      if (attacker.character_id) ids.characters.add(attacker.character_id);
      if (attacker.corporation_id)
        ids.corporations.add(attacker.corporation_id);
      if (attacker.alliance_id) ids.alliances.add(attacker.alliance_id);
    });

    return ids;
  }

  const ids1 = extractIds(kill1);
  const ids2 = extractIds(kill2);

  // Check for any overlapping IDs
  const hasOverlap =
    [...ids1.characters].some((id) => ids2.characters.has(id)) ||
    [...ids1.corporations].some((id) => ids2.corporations.has(id)) ||
    [...ids1.alliances].some((id) => ids2.alliances.has(id));

  return hasOverlap;
}

export function addKillmailToBattles(killmail) {
  activeBattles.update((battles) => {
    const now = new Date().getTime();
    const killTime = new Date(killmail.killmail.killmail_time).getTime();

    // Check if kill is too old to be included
    if (now - killTime > MAX_BATTLE_AGE) {
      console.log(
        "Kill is too old to be included in battles:",
        killmail.killmail_id
      );
      return battles;
    }

    console.log("Processing killmail:", killmail.killmail_id);
    console.log("Current battles:", battles);

    // Remove old battles
    battles = battles.filter((battle) => {
      const age = now - new Date(battle.lastKill).getTime();
      return age < BATTLE_TIMEOUT;
    });

    const systemId = killmail.killmail.solar_system_id;

    // First, look for related battles in the same system
    let foundBattle = battles.find(
      (battle) =>
        battle.systemId === systemId &&
        battle.kills.some((kill) => areKillsRelated(kill, killmail))
    );

    if (foundBattle) {
      // Add kill to existing battle
      foundBattle.kills.push(killmail);
      foundBattle.totalValue += killmail.zkb.totalValue;
      foundBattle.lastKill = killmail.killmail.killmail_time;

      // Update involved entities
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
      if (killmail.killmail.victim.corporation_id) {
        foundBattle.involvedCorporations.add(
          killmail.killmail.victim.corporation_id
        );
      }
      if (killmail.killmail.victim.alliance_id) {
        foundBattle.involvedAlliances.add(killmail.killmail.victim.alliance_id);
      }
    } else {
      // Create new battle
      const newBattle = {
        systemId,
        kills: [killmail],
        totalValue: killmail.zkb.totalValue || 0, // Add default value of 0
        lastKill: killmail.killmail.killmail_time,
        involvedCharacters: new Set(),
        involvedCorporations: new Set(),
        involvedAlliances: new Set(),
      };

      // Add initial involved entities
      killmail.killmail.attackers.forEach((attacker) => {
        if (attacker.character_id)
          newBattle.involvedCharacters.add(attacker.character_id);
        if (attacker.corporation_id)
          newBattle.involvedCorporations.add(attacker.corporation_id);
        if (attacker.alliance_id)
          newBattle.involvedAlliances.add(attacker.alliance_id);
      });

      if (killmail.killmail.victim.character_id) {
        newBattle.involvedCharacters.add(killmail.killmail.victim.character_id);
      }
      if (killmail.killmail.victim.corporation_id) {
        newBattle.involvedCorporations.add(
          killmail.killmail.victim.corporation_id
        );
      }
      if (killmail.killmail.victim.alliance_id) {
        newBattle.involvedAlliances.add(killmail.killmail.victim.alliance_id);
      }

      console.log("Created new battle:", {
        systemId,
        killCount: 1,
        involvedCharacters: newBattle.involvedCharacters.size,
        involvedCorporations: newBattle.involvedCorporations.size,
        involvedAlliances: newBattle.involvedAlliances.size,
      });

      battles.push(newBattle);
    }

    // Check for battle merging
    battles = mergeBattles(battles);

    return battles;
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
