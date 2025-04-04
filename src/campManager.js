// campManager.js
import { writable, derived } from "svelte/store";
import { killmails } from "./settingsStore.js";
import { EventEmitter } from "./browserEvents.js";
import {
  CAMP_TIMEOUT,
  DECAY_START,
  CAPSULE_ID,
  CAMP_PROBABILITY_FACTORS,
} from "./constants.js";

// Create a store for active camps
export const activeCamps = writable([]);

class CampManager extends EventEmitter {
  constructor() {
    super();
    this._camps = [];
    this.updateInterval = null;
    this.lastUpdate = Date.now();

    // Subscribe to killmail store but also process existing killmails immediately
    killmails.subscribe((kills) => {
      if (kills && kills.length > 0) {
        this.processKillmails(kills);
      }
    });
  }

  startUpdates(interval = 30000) {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    this.updateInterval = setInterval(() => {
      this.updateAllProbabilities();
    }, interval);
  }

  stopUpdates() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  getActiveCamps() {
    // Return a sorted copy of the array
    return [...this.activeCamps].sort((a, b) => b.probability - a.probability);
  }

  updateAllProbabilities() {
    const now = Date.now();

    this._camps = this._camps
      .filter((camp) => {
        const timeSinceLastKill = now - new Date(camp.lastKill).getTime();
        const minutesSinceLastKill = timeSinceLastKill / (60 * 1000);

        // Hard cutoff at 40 minutes regardless of probability
        if (minutesSinceLastKill > 40) {
          return false;
        }

        return timeSinceLastKill <= CAMP_TIMEOUT;
      })
      .map((camp) => ({
        ...camp,
        probability: this.calculateCampProbability(camp),
      }))
      .filter((camp) => camp.probability > 0); // Only keep camps with probability > 0

    // Sort camps by probability (descending order) after updating
    this._camps.sort((a, b) => b.probability - a.probability);

    this.lastUpdate = now;
    console.log(
      `[${new Date().toISOString()}] Updated camp probabilities for ${
        this._camps.length
      } active camps`
    );

    // Update the store
    activeCamps.set(this._camps);

    // Emit event for compatibility
    this.emit("campsUpdated", this._camps);
  }

  processKillmails(kills) {
    // Process only recent kills (last 2 hours)
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const recentKills = kills.filter(
      (kill) => new Date(kill.killmail.killmail_time).getTime() > twoHoursAgo
    );

    // Process each kill
    recentKills.forEach((kill) => {
      this.processCamp(kill);
    });

    // Update store
    activeCamps.set(this._camps);
  }

  getActiveCamps() {
    return [...this._camps].sort((a, b) => b.probability - a.probability);
  }

  processCamp(killmail) {
    const now = Date.now();
    const systemId = killmail.killmail.solar_system_id;
    const systemName =
      killmail.pinpoints?.celestialData?.solarsystemname || systemId.toString();
    const stargateName =
      killmail.pinpoints?.nearestCelestial?.name || "Unknown Gate";
    const campId = `${systemId}-${stargateName}`;

    const existingCampIndex = this._camps.findIndex(
      (camp) => camp.id === campId
    );

    if (existingCampIndex !== -1) {
      const camp = this._camps[existingCampIndex];

      // Check if kill already exists in camp
      const killExists = camp.kills.some((k) => k.killID === killmail.killID);
      if (!killExists) {
        camp.kills.push(killmail);
        camp.totalValue += killmail.zkb.totalValue;

        if (this.hasSmartbombs([killmail])) {
          camp.type = "smartbomb";
        }

        camp.composition = this.updateCampComposition(camp, killmail);
      }

      // Always update timestamps and recalculate
      camp.lastKill = killmail.killmail.killmail_time;
      camp.latestKillTime = now;
      camp.probability = this.calculateCampProbability(camp);
      camp.metrics = this.getMetrics(camp.kills, now);

      this._camps[existingCampIndex] = camp;
    } else {
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
        type: this.hasSmartbombs([killmail]) ? "smartbomb" : "standard",
        composition: this.updateCampComposition(
          {
            originalAttackers: new Set(),
            activeAttackers: new Set(),
            killedAttackers: new Set(),
          },
          killmail
        ),
        metrics: this.getMetrics([killmail], now),
      };
      newCamp.probability = this.calculateCampProbability(newCamp);
      this._camps.push(newCamp);
    }

    activeCamps.set(this._camps);
    return this._camps;
  }

  calculateCampProbability(camp) {
    const log = [];
    log.push(
      `--- Starting probability calculation for camp: ${camp.systemId}-${camp.stargateName} ---`
    );

    // Early validation
    if (
      camp.kills.some(
        (kill) =>
          kill.zkb?.labels?.includes("npc") ||
          kill.shipCategories?.victim === "structure" ||
          kill.shipCategories?.victim?.category === "structure" ||
          kill.killmail.victim.ship_type_id === 35834 ||
          (kill.killmail.victim.corporation_id &&
            !kill.killmail.victim.character_id)
      )
    ) {
      log.push("Camp excluded: NPC kill or structure detected");
      camp.probabilityLog = log;
      return 0;
    }

    // Check if this is a standalone capsule kill (not part of an existing ship kill)
    const isStandaloneCapsule =
      camp.kills.length === 1 &&
      camp.kills[0].killmail.victim.ship_type_id === CAPSULE_ID;

    // Filter out pods and structures, but keep standalone capsule kills
    const validKills = camp.kills.filter((kill) => {
      if (kill.shipCategories?.victim === "structure") return false;
      if (kill.killmail.victim.ship_type_id === CAPSULE_ID) {
        // Only keep capsule if it's a standalone kill
        return isStandaloneCapsule;
      }
      return true;
    });

    if (validKills.length === 0) {
      log.push(
        "Camp excluded: No valid kills (non-structure) or secondary pod kills"
      );
      camp.probabilityLog = log;
      return 0;
    }

    // Ensure kills are at gates
    const gateKills = validKills.filter((kill) => this.isGateCamp(kill));
    if (gateKills.length === 0) {
      log.push("Camp excluded: No kills at a stargate");
      camp.probabilityLog = log;
      return 0;
    }

    const now = Date.now();
    const isSingleKill = gateKills.length === 1;
    let baseProbability = 0;
    log.push(`Starting with base probability of 0%`);

    const recentKills = gateKills.filter(
      (kill) =>
        now - new Date(kill.killmail.killmail_time).getTime() <= 60 * 60 * 1000
    ).length;
    log.push(`Found ${recentKills} kills within the last hour`);

    const lastKillTime = new Date(camp.lastKill).getTime();
    const minutesSinceLastKill = (now - lastKillTime) / (60 * 1000);

    // Get unique victim characters to check for real player-vs-player engagements
    const uniqueVictimCharacters = new Set(
      gateKills.map((kill) => kill.killmail.victim.character_id).filter(Boolean)
    );

    // ======== STAGE 1: BASIC CLASSIFICATION FACTORS ========

    // Initial burst penalty
    if (camp.kills.length > 1) {
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
        baseProbability -= 0.2;
        log.push("Burst kill penalty applied: -20%");
      }
    }

    // ======== STAGE 2: THREAT SHIP CALCULATION ========

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

    // ======== STAGE 3: CAP THREAT SHIP SCORE FOR SINGLE KILLS ========

    let cappedThreatShipScore = threatShipScore;
    if (isSingleKill) {
      cappedThreatShipScore = Math.min(0.5, threatShipScore);
      if (threatShipScore > 0.5) {
        log.push(
          `Threat ship score capped at 50% for single kill (was ${(
            threatShipScore * 100
          ).toFixed(1)}%)`
        );
      }
    }

    baseProbability += cappedThreatShipScore;
    log.push(
      `Final threat ship contribution: +${(cappedThreatShipScore * 100).toFixed(
        1
      )}%`
    );

    // ======== STAGE 4: ADDITIONAL IDENTIFICATION FACTORS ========

    // General smartbomb activity check
    if (camp.type === "smartbomb") {
      let smartbombBonus = 0.16; // Base 16% probability for smartbomb activity
      log.push("Smartbomb activity detected: +16%");

      // Additional bonus for specific smartbomb ships
      const hasSmartbombShip = camp.kills.some((kill) =>
        kill.killmail.attackers.some(
          (attacker) =>
            CAMP_PROBABILITY_FACTORS.SMARTBOMB_SHIPS[attacker.ship_type_id]
        )
      );

      if (hasSmartbombShip) {
        const extraBonus = isSingleKill ? 0.15 : 0.3; // Limit bonus for single kill
        smartbombBonus += extraBonus;
        log.push(`Dedicated smartbomb ship bonus: +${extraBonus * 100}%`);
      }

      baseProbability += smartbombBonus;
    }

    // Known camping location bonus
    const systemData = CAMP_PROBABILITY_FACTORS.PERMANENT_CAMPS[camp.systemId];
    if (
      systemData &&
      systemData.gates.some((gate) =>
        camp.stargateName.toLowerCase().includes(gate.toLowerCase())
      )
    ) {
      baseProbability += systemData.weight;
      log.push(
        `Known camping location bonus: +${(systemData.weight * 100).toFixed(
          1
        )}%`
      );
    }

    // Vulnerable victim bonus - limited for single kills
    const vulnerableKills = validKills.filter(
      (kill) =>
        kill.shipCategories?.victim ===
          CAMP_PROBABILITY_FACTORS.SHIP_CATEGORIES.INDUSTRIAL ||
        kill.shipCategories?.victim ===
          CAMP_PROBABILITY_FACTORS.SHIP_CATEGORIES.MINING
    );

    if (vulnerableKills.length > 0) {
      const vulnerableBonus = isSingleKill ? 0.2 : 0.4; // Reduced for single kill
      baseProbability += vulnerableBonus;
      log.push(
        `Vulnerable victim bonus (${
          vulnerableKills.length
        } industrial/mining ships): +${vulnerableBonus * 100}%`
      );
    }

    // ======== STAGE 5: CONSECUTIVE KILLS & CONSISTENCY CALCULATION ========

    let consistencyBonus = 0;

    if (camp.kills.length >= 2) {
      const CONSISTENCY_BONUS = 0.15; // Each consistent kill adds 15%
      const consistencyCheckKills = gateKills.slice(-3);

      if (consistencyCheckKills.length >= 2) {
        // Check if these kills were part of a burst
        const killTimes = consistencyCheckKills
          .map((k) => new Date(k.killmail.killmail_time).getTime())
          .sort();

        const isBurst = killTimes.some(
          (time, i) => i > 0 && time - killTimes[i - 1] < 120000
        );

        // Skip consistency bonus if all victims in burst are from same corp/alliance
        let skipConsistencyBonus = false;

        if (isBurst) {
          // Check corporation consistency
          const victimCorps = consistencyCheckKills
            .map((k) => k.killmail.victim.corporation_id)
            .filter(Boolean);

          const uniqueCorps = new Set(victimCorps);

          // Check alliance consistency
          const victimAlliances = consistencyCheckKills
            .map((k) => k.killmail.victim.alliance_id)
            .filter(Boolean);

          const uniqueAlliances = new Set(victimAlliances);

          // If all victims have a corporation and they're all the same,
          // or all victims have an alliance and they're all the same
          if (
            (victimCorps.length === consistencyCheckKills.length &&
              uniqueCorps.size === 1) ||
            (victimAlliances.length === consistencyCheckKills.length &&
              uniqueAlliances.size === 1)
          ) {
            skipConsistencyBonus = true;
            log.push(
              "Burst kills from same corporation/alliance detected: skipping consistency bonus"
            );
          }
        }

        if (!skipConsistencyBonus) {
          const latestAttackers = new Set(
            consistencyCheckKills[
              consistencyCheckKills.length - 1
            ].killmail.attackers
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

          if (consistencyBonus > 0) {
            log.push(
              `Total attacker consistency bonus: +${(
                consistencyBonus * 100
              ).toFixed(1)}%`
            );
          }
        }
      } else {
        log.push(
          "No consistency bonus: Need at least 2 kills to check consistency"
        );
      }
    }

    baseProbability += consistencyBonus;
    // ======== STAGE 6: FINAL PROBABILITY CALCULATION & CAPPING ========

    // Cap final probability at 95% before time decay
    const rawProbability = Math.min(0.95, baseProbability);
    log.push(
      `Raw probability (capped at 95%): ${(rawProbability * 100).toFixed(1)}%`
    );

    // ======== STAGE 7: TIME DECAY CALCULATION ========

    // Apply time decay directly to the final percentage
    let finalProbability = rawProbability;
    let timeDecayPercent = 0;

    if (minutesSinceLastKill > DECAY_START / (60 * 1000)) {
      const decayMinutes = minutesSinceLastKill - DECAY_START / (60 * 1000);

      // FIXED: Remove the 0.95 cap and allow full decay to zero
      timeDecayPercent = Math.min(1.0, decayMinutes * 0.1);

      // Apply the decay
      finalProbability = rawProbability * (1 - timeDecayPercent);

      log.push(
        `Applying decay for ${decayMinutes.toFixed(
          1
        )} minutes beyond decay start`
      );
      log.push(
        `Time decay adjustment: -${(timeDecayPercent * 100).toFixed(1)}% (${(
          rawProbability * 100
        ).toFixed(1)}% → ${(finalProbability * 100).toFixed(1)}%)`
      );

      // ADDED: Hard timeout after 30 minutes since decay start
      if (decayMinutes > CAMP_TIMEOUT) {
        log.push(`Camp expired: More than 30 minutes since activity`);
        return 0;
      }
    }

    // Final normalization with minimum threshold
    finalProbability = Math.max(0, Math.min(0.95, finalProbability));

    // ADDED: Minimum threshold to appear in UI
    if (finalProbability < 0.05) {
      // 5% minimum threshold
      log.push(
        `Camp below minimum threshold (5%): ${(finalProbability * 100).toFixed(
          1
        )}% → 0%`
      );
      return 0;
    }

    const percentProbability = Math.round(finalProbability * 100);
    log.push(`Final normalized probability: ${percentProbability}%`);

    camp.probabilityLog = log;
    return percentProbability;
  }

  isGateCamp(killmail) {
    if (!killmail.pinpoints?.nearestCelestial) return false;

    const isAtGate =
      killmail.pinpoints.atCelestial &&
      killmail.pinpoints.nearestCelestial.name
        .toLowerCase()
        .includes("stargate");
    const isNearGate =
      !killmail.pinpoints.atCelestial &&
      killmail.pinpoints.nearestCelestial.name
        .toLowerCase()
        .includes("stargate") &&
      killmail.pinpoints.triangulationPossible;

    return isAtGate || isNearGate;
  }

  hasSmartbombs(kills) {
    return kills.some((kill) =>
      kill.killmail.attackers.some(
        (attacker) =>
          attacker.weapon_type_id &&
          CAMP_PROBABILITY_FACTORS.SMARTBOMB_WEAPONS[attacker.weapon_type_id]
      )
    );
  }

  updateCampComposition(camp, killmail) {
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

  getMetrics(kills, now) {
    const killTimes = kills.map((k) =>
      new Date(k.killmail.killmail_time).getTime()
    );
    const earliestKillTime = Math.min(...killTimes);
    const lastKillTime = Math.max(...killTimes);

    const totalDuration = Math.floor((now - earliestKillTime) / (1000 * 60));
    const activeDuration = Math.floor(
      (lastKillTime - earliestKillTime) / (1000 * 60)
    );
    const inactivityDuration = Math.floor((now - lastKillTime) / (1000 * 60));

    return {
      firstSeen: earliestKillTime,
      campDuration: totalDuration,
      activeDuration: activeDuration,
      inactivityDuration: inactivityDuration,
      podKills: kills.filter(
        (k) => k.killmail.victim.ship_type_id === CAPSULE_ID
      ).length,
      killFrequency: kills.length / Math.max(1, activeDuration),
      avgValuePerKill:
        kills.reduce((sum, k) => sum + k.zkb.totalValue, 0) / kills.length,
    };
  }

  forceUpdate() {
    this.updateAllProbabilities();
    activeCamps.set(this._camps);
  }

  cleanup() {
    this.stopUpdates();
    this.removeAllListeners();
    this._camps = [];
    activeCamps.set([]);
  }
}

// Create singleton instance
const campManager = new CampManager();

// Export singleton and classes
export default campManager;
export { CampManager };
