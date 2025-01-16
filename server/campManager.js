// campManager.js
import EventEmitter from "events";
import {
  CAMP_TIMEOUT,
  DECAY_START,
  CAPSULE_ID,
  CAMP_PROBABILITY_FACTORS,
} from "../src/constants.js";

class CampManager extends EventEmitter {
  constructor() {
    super();
    this.activeCamps = [];
    this.updateInterval = null;
    this.lastUpdate = Date.now();
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

    this.activeCamps = this.activeCamps
      .filter((camp) => {
        const timeSinceLastKill = now - new Date(camp.lastKill).getTime();
        return timeSinceLastKill <= CAMP_TIMEOUT;
      })
      .map((camp) => ({
        ...camp,
        probability: this.calculateCampProbability(camp),
      }));

    // Sort camps by probability (descending order) after updating
    this.activeCamps.sort((a, b) => b.probability - a.probability);

    this.lastUpdate = now;
    console.log(
      `[${new Date().toISOString()}] Emitting campsUpdated event with ${
        this.activeCamps.length
      } active camps`
    );
    this.emit("campsUpdated", this.activeCamps);
  }

  processCamp(killmail) {
    if (!this.isGateCamp(killmail)) {
      console.log(
        `[${new Date().toISOString()}] Killmail ${
          killmail.killID
        } is not a gate camp, skipping camp processing`
      );
      return this.activeCamps;
    }

    const now = Date.now();
    const systemId = killmail.killmail.solar_system_id;
    const systemName =
      killmail.pinpoints?.celestialData?.solarsystemname || systemId.toString();
    const stargateName =
      killmail.pinpoints?.nearestCelestial?.name || "Unknown Gate";
    const campId = `${systemId}-${stargateName}`;

    const existingCampIndex = this.activeCamps.findIndex(
      (camp) => camp.id === campId
    );

    if (existingCampIndex !== -1) {
      // Update existing camp
      const camp = this.activeCamps[existingCampIndex];
      camp.kills.push(killmail);
      camp.lastKill = killmail.killmail.killmail_time;
      camp.totalValue += killmail.zkb.totalValue;

      if (this.hasSmartbombs([killmail])) {
        camp.type = "smartbomb";
      }

      camp.probability = this.calculateCampProbability(camp);
      camp.composition = this.updateCampComposition(camp, killmail);
      camp.metrics = this.getMetrics(camp.kills, now);

      this.activeCamps[existingCampIndex] = camp;
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
      this.activeCamps.push(newCamp);
    }

    this.emit("campsUpdated", this.activeCamps);
    return this.activeCamps;
  }

  calculateCampProbability(camp) {
    const log = [];
    log.push(
      `--- Starting probability calculation for camp: ${camp.systemId}-${camp.stargateName} ---`
    );

    // Early validation
    if (camp.kills.some((kill) => kill.zkb?.labels?.includes("npc"))) {
      log.push("Camp excluded: NPC kill detected");
      camp.probabilityLog = log;
      return 0;
    }

    // Filter out pods and structures
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
    const gateKills = validKills.filter((kill) => this.isGateCamp(kill));
    if (gateKills.length === 0) {
      log.push("Camp excluded: No kills at a stargate");
      camp.probabilityLog = log;
      return 0;
    }

    const now = Date.now();
    let probability = 0;
    log.push(`Starting with base probability of 0%`);

    const recentKills = gateKills.filter(
      (kill) =>
        now - new Date(kill.killmail.killmail_time).getTime() <= 60 * 60 * 1000
    ).length;
    log.push(`Found ${recentKills} kills within the last hour`);

    const lastKillTime = new Date(camp.lastKill).getTime();
    const minutesSinceLastKill = (now - lastKillTime) / (60 * 1000);

    const killTimes = gateKills
      .map((k) => new Date(k.killmail.killmail_time).getTime())
      .sort();
    const firstKillTime = killTimes[0];
    const campAge = (now - firstKillTime) / (60 * 1000);
    log.push(`Camp age: ${campAge.toFixed(1)} minutes`);

    // Initial burst penalty
    if (
      campAge <= 15 &&
      killTimes.some((time, i) => i > 0 && time - killTimes[i - 1] < 120000)
    ) {
      probability -= 0.2;
      log.push("Burst kill penalty applied: -20%");
    }

    // Threat ship calculation
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
    log.push(
      `Total threat ship bonus: +${(threatShipScore * 100).toFixed(1)}%`
    );

    // Known camping location bonus
    const systemData = CAMP_PROBABILITY_FACTORS.PERMANENT_CAMPS[camp.systemId];
    if (
      systemData &&
      systemData.gates.some((gate) =>
        camp.stargateName.toLowerCase().includes(gate.toLowerCase())
      )
    ) {
      probability += systemData.weight;
      log.push(
        `Known camping location bonus: +${(systemData.weight * 100).toFixed(
          1
        )}%`
      );
    }

    // Attacker consistency bonus
    const CONSISTENCY_BONUS = 0.15;
    const consistencyCheckKills = gateKills.slice(-3);
    let consistencyBonus = 0;

    if (consistencyCheckKills.length < 2) {
      log.push(
        "No consistency bonus: Need at least 2 kills to check consistency"
      );
    } else {
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
    }

    if (consistencyBonus > 0) {
      probability += consistencyBonus;
      log.push(
        `Total attacker consistency bonus: +${(consistencyBonus * 100).toFixed(
          1
        )}%`
      );
    }

    // Vulnerable victim bonus
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

    // Time decay
    let timeDecayPercent = 0;
    if (minutesSinceLastKill > DECAY_START / (60 * 1000)) {
      const decayMinutes = minutesSinceLastKill - DECAY_START / (60 * 1000);
      timeDecayPercent = Math.min(0.95, decayMinutes * 0.05);
      log.push(
        `Applying decay for ${decayMinutes.toFixed(
          1
        )} minutes beyond decay start`
      );

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

    // Final normalization
    probability = Math.max(0, Math.min(95, Math.round(probability * 100)));
    log.push(`Final normalized probability: ${probability}%`);

    camp.probabilityLog = log;
    return probability;
  }

  isGateCamp(killmail) {
    if (!killmail.pinpoints?.nearestCelestial) return false;
    return killmail.pinpoints.nearestCelestial.name
      .toLowerCase()
      .includes("stargate");
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

  cleanup() {
    this.stopUpdates();
    this.removeAllListeners();
    this.activeCamps = [];
  }
}

// Export a singleton instance
const campManager = new CampManager();
export default campManager;

// Also export the class for testing or if multiple instances are needed
export { CampManager };
