// ServerActivityManager.js
import {
  CAMP_TIMEOUT,
  ROAM_TIMEOUT, // Added roam timeout
  DECAY_START,
  CAPSULE_ID,
  CAMP_PROBABILITY_FACTORS,
} from "../src/constants.js";

// Helper function to generate unique roam IDs
function generateRoamId() {
  return `roam-${Date.now()}-${Math.random().toString(16).substring(2, 8)}`;
}

export class ServerActivityManager {
  constructor(io, pool) {
    this._activities = new Map(); // Unified store: key is activity ID (campId or roamId), value is activity object
    this.lastUpdate = Date.now();
    this.updateInterval = null;
    this.io = io;
    this.pool = pool; // Store the database pool
    if (!pool) {
      console.error(
        "ERROR: ServerActivityManager requires a database pool instance!"
      );
    }
  }

  /**
   * Starts the periodic update loop for all activities.
   * @param {number} [interval=30000] - Update interval in milliseconds.
   */
  startUpdates(interval = 30000) {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    console.log(`Activity Manager: Starting updates every ${interval / 1000}s`);
    this.updateInterval = setInterval(() => {
      this.updateAndEmitActivities();
    }, interval);
  }

  /**
   * Stops the periodic update loop.
   */
  stopUpdates() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      console.log("Activity Manager: Updates stopped.");
    }
  }

  /**
   * Retrieves the current list of active, classified activities, sorted by probability or last activity time.
   * @returns {Array<object>} - A sorted array of active activity objects.
   */
  getActiveActivities() {
    return Array.from(this._activities.values())
      .filter((activity) => {
        // Keep activities that are classified and haven't timed out based on their type
        const now = Date.now();
        const timeout =
          activity.classification === "camp" ||
          activity.classification === "smartbomb" ||
          activity.classification === "roaming_camp" ||
          activity.classification === "battle"
            ? CAMP_TIMEOUT
            : ROAM_TIMEOUT;
        // Use lastActivity if available (for roams), otherwise fall back to lastKill (for camps)
        const lastEventTime = new Date(
          activity.lastActivity ||
            activity.lastKill ||
            activity.startTime ||
            activity.firstKillTime
        ).getTime();
        return now - lastEventTime <= timeout;
      })
      .sort((a, b) => {
        // Prioritize higher probability, then more recent activity
        if ((a.probability || 0) !== (b.probability || 0)) {
          return (b.probability || 0) - (a.probability || 0);
        }
        const timeA = new Date(a.lastActivity || a.lastKill || 0).getTime();
        const timeB = new Date(b.lastActivity || b.lastKill || 0).getTime();
        return timeB - timeA;
      });
  }

  /**
   * Processes an incoming killmail, updating or creating relevant activities.
   * @param {object} killmail - The killmail object with added pinpoint and ship category data.
   */
  processKillmailActivity(killmail) {
    const now = Date.now();
    const killTime = new Date(killmail.killmail.killmail_time).getTime();
    const systemId = killmail.killmail.solar_system_id;
    const systemName =
      killmail.pinpoints?.celestialData?.solarsystemname || systemId.toString();
    const regionName = killmail.pinpoints?.celestialData?.regionname || null;
    const stargateName = killmail.pinpoints?.nearestCelestial?.name; // Might be undefined if not near a gate

    // --- Identify Potential Camp Activity ---
    let campId = null;
    let isAtStargate = false;
    // Check if the kill is near *any* stargate in the system for camp identification
    if (
      stargateName &&
      stargateName.toLowerCase().includes("stargate") &&
      this.isGateCamp(killmail)
    ) {
      campId = `${systemId}-${stargateName}`;
      isAtStargate = true;
    }

    // --- Identify Potential Roaming Activity ---
    const attackerIds = new Set(
      killmail.killmail.attackers
        .filter((a) => a.character_id && a.ship_type_id !== CAPSULE_ID) // Exclude pods from roam members
        .map((a) => a.character_id)
    );

    let updatedActivityIds = new Set(); // Track which activities were updated by this kill

    // --- Update/Create Camp-like Activity (if at stargate) ---
    if (isAtStargate && campId) {
      let campActivity = this._activities.get(campId);
      if (!campActivity) {
        // Create new potential camp activity
        campActivity = {
          id: campId,
          type: "camp", // Initial type, can change
          classification: "camp", // Initial classification
          systemId,
          stargateName, // Store the specific stargate name
          kills: [],
          totalValue: 0,
          lastKill: null,
          firstKillTime: killTime, // Use kill time for first seen
          latestKillTime: now,
          composition: {
            originalAttackers: new Set(),
            activeAttackers: new Set(),
            killedAttackers: new Set(),
            involvedCorporations: [],
            involvedAlliances: [],
          },
          metrics: {},
          probability: 0,
          maxProbability: 0,
          probabilityLog: [],
          visitedSystems: new Set([systemId]), // Initialize visited systems
          systemsVisited: 1,
          members: new Set(), // Initialize members set for potential classification change
          systems: [], // Initialize systems list for pathing if it becomes roam
          lastSystem: { id: systemId, name: systemName, region: regionName }, // Track last system
          startTime: killTime, // Use kill time as start time
          lastActivity: killTime, // Use kill time as last activity
        };
        this._activities.set(campId, campActivity);
        console.log(
          `Activity Manager: Created new potential camp activity ${campId}`
        );
      }

      // Update the camp activity
      const killExists = campActivity.kills.some(
        (k) => k.killID === killmail.killID
      );
      if (!killExists) {
        campActivity.kills.push(killmail);
        campActivity.totalValue += killmail.zkb.totalValue || 0; // Ensure value exists
        if (
          this.hasSmartbombs([killmail]) &&
          campActivity.type !== "smartbomb"
        ) {
          campActivity.type = "smartbomb"; // Mark as smartbomb type
        }
        campActivity.composition = this.updateActivityComposition(
          campActivity,
          killmail
        ); // Use unified composition updater
        campActivity.members = new Set([
          ...campActivity.members,
          ...attackerIds,
        ]); // Add attackers to members
      }
      campActivity.lastKill = killmail.killmail.killmail_time;
      campActivity.latestKillTime = now; // Timestamp of processing
      campActivity.lastActivity = killTime; // Timestamp of the kill event
      campActivity.visitedSystems.add(systemId); // Add current system
      campActivity.systemsVisited = campActivity.visitedSystems.size;
      campActivity.metrics = this.getMetrics(campActivity.kills, now); // Recalculate metrics
      campActivity.probability = this.calculateCampProbability(campActivity); // Recalculate probability
      campActivity.classification = this.determineClassification(campActivity); // Recalculate classification
      this._activities.set(campId, campActivity); // Ensure map is updated
      updatedActivityIds.add(campId);
      // console.log(`Activity Manager: Updated camp activity ${campId}, classification: ${campActivity.classification}`);
    }

    // --- Update/Create Roam-like Activity ---
    if (attackerIds.size >= 2) {
      // Only consider roams with 2+ attackers
      let matchedRoam = false;
      let matchedRoamId = null;

      // Find existing roams this kill might belong to
      for (const [activityId, activity] of this._activities.entries()) {
        // Skip if it's the camp we just updated OR if it's not classified as roam-related
        // Allow updating a camp if it turns into a roaming camp or battle
        if (activityId === campId) {
          continue; // Already handled above
        }
        // Check if the activity has members and if there's overlap
        const members = new Set(activity.members || []);
        if (members.size === 0) continue; // Skip activities without members defined

        const overlap = [...attackerIds].some((id) => members.has(id));

        if (overlap) {
          matchedRoam = true;
          matchedRoamId = activityId; // Store the ID of the matched roam
          console.log(
            `Activity Manager: Kill ${killmail.killID} matches existing roam/battle activity ${activityId}`
          );

          // Update existing roam/battle activity
          const killExists = activity.kills.some(
            (k) => k.killID === killmail.killID
          );
          if (!killExists) {
            activity.kills.push(killmail);
            activity.totalValue += killmail.zkb.totalValue || 0;
            // Only add system if it's different from the last one recorded
            const lastRecordedSystem =
              activity.systems[activity.systems.length - 1];
            if (!lastRecordedSystem || lastRecordedSystem.id !== systemId) {
              activity.systems.push({
                id: systemId,
                name: systemName,
                region: regionName,
                time: killmail.killmail.killmail_time,
              });
            }
          }
          activity.members = new Set([...members, ...attackerIds]); // Update members
          activity.lastActivity = killTime; // Update last activity time
          activity.lastKill = killmail.killmail.killmail_time; // Also update lastKill
          activity.lastSystem = {
            id: systemId,
            name: systemName,
            region: regionName,
          };
          activity.visitedSystems.add(systemId); // Add current system
          activity.systemsVisited = activity.visitedSystems.size;
          activity.metrics = this.getMetrics(activity.kills, now); // Recalculate metrics
          activity.composition = this.updateActivityComposition(
            activity,
            killmail
          ); // Update composition
          activity.probability = this.calculateCampProbability(activity); // Recalculate probability for potential reclassification
          activity.classification = this.determineClassification(activity); // Recalculate classification
          this._activities.set(activityId, activity); // Ensure map is updated
          updatedActivityIds.add(activityId);
          // console.log(`Activity Manager: Updated roam/battle activity ${activityId}, classification: ${activity.classification}`);
          break; // Assume kill belongs to only one roam group for now
        }
      }

      // If no existing roam matched, create a new roam activity
      // Also ensure we didn't *just* update a camp with this exact kill (avoid double counting)
      if (!matchedRoam && (!campId || !updatedActivityIds.has(campId))) {
        const newRoamId = generateRoamId();
        const newRoamActivity = {
          id: newRoamId,
          type: "roam", // Initial type
          classification: "roam", // Initial classification
          systemId: systemId, // Track current system ID
          stargateName: null, // Roams don't inherently have a stargate focus
          kills: [killmail],
          totalValue: killmail.zkb.totalValue || 0,
          lastKill: killmail.killmail.killmail_time,
          firstKillTime: killTime, // Use kill time for first seen
          latestKillTime: now, // Timestamp of processing
          composition: this.updateActivityComposition(
            {
              originalAttackers: new Set(),
              activeAttackers: new Set(),
              killedAttackers: new Set(),
              involvedCorporations: [],
              involvedAlliances: [],
            },
            killmail
          ),
          metrics: this.getMetrics([killmail], now),
          probability: 0, // Roams don't use camp probability directly unless reclassified
          maxProbability: 0,
          probabilityLog: [],
          visitedSystems: new Set([systemId]), // Initialize visited systems
          systemsVisited: 1,
          members: attackerIds, // Set initial members
          systems: [
            {
              id: systemId,
              name: systemName,
              region: regionName,
              time: killmail.killmail.killmail_time,
            },
          ], // Initialize systems list
          lastSystem: { id: systemId, name: systemName, region: regionName }, // Set last system
          startTime: killTime, // Roam start time
          lastActivity: killTime, // Roam last activity time
        };
        newRoamActivity.classification =
          this.determineClassification(newRoamActivity); // Initial classification
        this._activities.set(newRoamId, newRoamActivity);
        updatedActivityIds.add(newRoamId);
        console.log(
          `Activity Manager: Created new roam activity ${newRoamId}, classification: ${newRoamActivity.classification}`
        );
      }
    }

    // If any activity was updated, emit the changes
    if (updatedActivityIds.size > 0) {
      this.io
        .to("live-updates")
        .emit("activityUpdate", this.getActiveActivities());
    }
  }

  /**
   * Periodically updates probabilities, classifications, and removes expired activities.
   * Emits the updated list of active activities to clients.
   */
  async updateAndEmitActivities() {
    const now = Date.now();
    const activitiesToKeep = new Map();
    const activitiesToExpire = [];
    let changed = false; // Track if any activity changed state

    for (const [id, activity] of this._activities.entries()) {
      // Determine timeout based on current classification
      const timeout =
        activity.classification === "camp" ||
        activity.classification === "smartbomb" ||
        activity.classification === "roaming_camp" ||
        activity.classification === "battle"
          ? CAMP_TIMEOUT
          : ROAM_TIMEOUT;
      // Use the most recent timestamp available
      const lastEventTime = new Date(
        activity.lastActivity ||
          activity.lastKill ||
          activity.startTime ||
          activity.firstKillTime
      ).getTime();

      if (now - lastEventTime <= timeout) {
        // Activity is still active
        let previousProbability = activity.probability;
        let previousClassification = activity.classification;

        // Recalculate probability if it's potentially camp-like
        if (
          ["camp", "smartbomb", "roaming_camp", "battle"].includes(
            activity.classification
          ) ||
          activity.stargateName
        ) {
          activity.probability = this.calculateCampProbability(activity);
        }

        // Recalculate classification based on current state
        activity.classification = this.determineClassification(activity);

        // Check if probability or classification actually changed
        if (
          activity.probability !== previousProbability ||
          activity.classification !== previousClassification
        ) {
          changed = true;
        }

        // If probability dropped to 0 or below threshold for camp-like types, mark for expiry check
        // (It might still be active as a 'roam' if lastActivity is recent enough for ROAM_TIMEOUT)
        if (
          activity.probability < 5 &&
          ["camp", "smartbomb", "roaming_camp"].includes(
            activity.classification
          )
        ) {
          // Don't immediately expire, let the main timeout check handle it,
          // but ensure classification is updated. If it becomes 'roam', it gets ROAM_TIMEOUT.
          // If it stays 'camp' but prob is < 5, the main timeout check will expire it correctly.
          console.log(
            `Activity ${activity.id} probability dropped below threshold, reclassified to ${activity.classification}. Expiry based on timeout.`
          );
        }
        activitiesToKeep.set(id, activity);
      } else {
        // Activity has expired based on its timeout
        activitiesToExpire.push(activity);
        changed = true; // State changed due to expiration
      }
    }

    // Filter expired activities to save only relevant ones
    const activitiesToSave = activitiesToExpire.filter(
      (activity) =>
        activity.stargateName &&
        ["camp", "smartbomb", "roaming_camp", "battle"].includes(
          activity.classification
        )
      // Add other save criteria if needed, e.g., || activity.classification === 'battle'
    );

    const expiredCount = activitiesToExpire.length;
    const savedCount = activitiesToSave.length;

    // Save expired activities to the database asynchronously
    for (const expiredActivity of activitiesToSave) {
      try {
        await this.saveExpiredActivity(expiredActivity);
      } catch (error) {
        console.error(
          `Failed to save expired activity ${expiredActivity.id}:`,
          error
        );
      }
    }

    // Update the main activities map
    this._activities = activitiesToKeep;
    this.lastUpdate = now;

    if (changed) {
      // Only log and emit if something actually changed
      console.log(
        `Activity Manager: Updated activities. Active: ${this._activities.size}, Expired: ${expiredCount}, Saved: ${savedCount}`
      );
      // Emit updated *active* activities to clients
      this.io
        .to("live-updates")
        .emit("activityUpdate", this.getActiveActivities());
    }
  }

  /**
   * Determines the classification of an activity based on its properties.
   * @param {object} activity - The activity object.
   * @returns {string} Classification: 'camp', 'smartbomb', 'roaming_camp', 'battle', 'roam', 'activity'
   */
  determineClassification(activity) {
    // Ensure probability is calculated if it hasn't been or needs recalculation
    // We calculate it in the update loop now, so we can use the stored value.
    const campProbability = activity.probability || 0;
    const isCampLike = campProbability >= 5; // Use 5% threshold
    const systemsVisited = activity.visitedSystems?.size || 1;
    const participantCount =
      activity.metrics?.partyMetrics?.characters || activity.members?.size || 0;

    // 1. Smartbomb override
    if (activity.type === "smartbomb") {
      return "smartbomb";
    }

    // 2. Battle override
    if (participantCount >= 40) {
      return "battle";
    }

    // 3. Roaming Camp classification
    if (systemsVisited > 1 && isCampLike) {
      return "roaming_camp";
    }

    // 4. Standard Camp classification
    if (isCampLike) {
      // Includes single-system camps
      return "camp";
    }

    // 5. Roam classification
    if (systemsVisited > 1) {
      return "roam";
    }

    // 6. Default/Fallback
    // If it's single system, not camp-like, not smartbomb, not battle -> classify as 'activity'
    // This might represent fleeting engagements not meeting camp criteria.
    return "activity";
  }

  /**
   * Calculates the probability of an activity being a gate camp.
   * Incorporates various factors: threat ships (capped), bonuses for specific scenarios
   * (smartbombs, location, vulnerable victims, consistency, widely spaced kills),
   * a separate small bonus for pod kills, and filters out irrelevant kills
   * (NPCs, structures, AWOX, structure-only attackers).
   * This version avoids the 'Cannot access killsForProbability before initialization' error.
   * @param {object} activity - The activity object.
   * @returns {number} Probability percentage (0-100).
   */
  calculateCampProbability(activity) {
    // --- START of calculateCampProbability ---
    const log = []; // Log for debugging probability steps
    activity.probabilityLog = log; // Attach log to the activity object
    log.push(
      `--- Prob Calc for Activity: ${activity.id} (Current Class: ${activity.classification}) ---`
    );

    const initialMaxProbability = activity.maxProbability || 0; // Track highest probability reached
    const CAPSULE_ID = 670; // Assuming this is the constant for pods

    // --- Filter Kills for Probability Calculation ---
    // Filter out kills irrelevant to player-driven gate camping activity.
    // Pods are NOT filtered here, they are handled separately later.
    const killsForProbability = (activity.kills || []).filter((kill) => {
      // Filter 1: AWOX Kills
      if (kill.zkb?.awox) {
        log.push(`Ignoring AWOX kill ${kill.killID} for probability scoring.`);
        return false;
      }

      // Filter 2: NPC or Structure VICTIMS
      if (
        (kill.killmail.victim.corporation_id &&
          !kill.killmail.victim.character_id) || // Corp asset victim
        kill.zkb?.labels?.includes("npc") || // NPC victim label
        kill.shipCategories?.victim === "structure" || // Structure category (victim)
        kill.shipCategories?.victim?.category === "structure"
      ) {
        log.push(
          `Ignoring NPC/Structure victim kill ${kill.killID} for probability.`
        );
        return false;
      }

      // Filter 3: Mobile Tractor Unit (MTU) VICTIMS
      if (kill.killmail.victim.ship_type_id === 35834) {
        // MTU ID
        log.push(`Ignoring MTU victim kill ${kill.killID} for probability.`);
        return false;
      }

      // Filter 4: Structure-Only ATTACKERS
      const attackers = kill.killmail.attackers || [];
      const hasPlayerOrNpcAttacker = attackers.some(
        (a) => a.character_id || a.faction_id // Check for player or NPC pilot
      );
      if (!hasPlayerOrNpcAttacker && attackers.length > 0) {
        // If no player/NPC attacker found, assume structure-only kill
        log.push(
          `Ignoring kill ${kill.killID} - no player/NPC attackers detected (likely structure-only).`
        );
        return false; // Exclude this kill
      }

      // If none of the above filters matched, keep the kill for now.
      return true;
    });
    // --- End of Kill Filtering ---

    // If no kills remain after basic filtering, probability is 0.
    if (killsForProbability.length === 0) {
      log.push(
        "Camp probability 0: No valid player kills remain after filtering."
      );
      activity.maxProbability = Math.max(initialMaxProbability, 0);
      return 0;
    }

    // If activity is tied to a stargate, ensure remaining kills happened *at* that gate.
    const gateKills = activity.stargateName
      ? killsForProbability.filter((kill) => this.isGateCamp(kill))
      : [];
    if (activity.stargateName && gateKills.length === 0) {
      log.push("Camp probability 0: No valid kills at the specified stargate.");
      activity.maxProbability = Math.max(initialMaxProbability, 0);
      return 0;
    }

    // Use gateKills if applicable, otherwise use all filtered kills.
    const relevantKillsUnsorted = activity.stargateName
      ? gateKills
      : killsForProbability;

    // --- Separate Ship Kills from Pod Kills ---
    // This happens *after* the main filter, avoiding the reference error.
    const relevantShipKills = relevantKillsUnsorted
      .filter((k) => k.killmail.victim.ship_type_id !== CAPSULE_ID)
      .sort(
        // Sort ship kills by time for sequence-based bonuses
        (a, b) =>
          new Date(a.killmail.killmail_time).getTime() -
          new Date(b.killmail.killmail_time).getTime()
      );
    const relevantPodKills = relevantKillsUnsorted.filter(
      (k) => k.killmail.victim.ship_type_id === CAPSULE_ID
    );

    log.push(
      `Relevant Kills for Calc: ${relevantShipKills.length} ships, ${relevantPodKills.length} pods.`
    );

    // If there are no ship *or* pod kills left, probability is 0.
    if (relevantShipKills.length === 0 && relevantPodKills.length === 0) {
      log.push(
        "Camp probability 0: No relevant ship or pod kills for calculation."
      );
      activity.maxProbability = Math.max(initialMaxProbability, 0);
      return 0;
    }

    // --- Start Probability Calculation Stages ---
    const now = Date.now();
    const lastEventTime = new Date(
      activity.lastKill || activity.lastActivity || activity.firstKillTime
    ).getTime();
    const minutesSinceLastKill = (now - lastEventTime) / (60 * 1000);
    let baseProbability = 0; // Accumulates score

    // --- STAGE 1: Burst Penalty (Based on Ship Kills) ---
    if (relevantShipKills.length > 1) {
      const shipKillTimes = relevantShipKills.map((k) =>
        new Date(k.killmail.killmail_time).getTime()
      );
      const firstOverallKillTime = new Date(
        activity.firstKillTime || Date.now()
      ).getTime();
      const campAge = (now - firstOverallKillTime) / (60 * 1000);
      log.push(
        `Activity age (based on first kill time): ${campAge.toFixed(1)} minutes`
      );
      const BURST_THRESHOLD_MS = 120 * 1000; // 2 minutes
      const BURST_PENALTY_AGE_LIMIT_MIN = 15;
      if (
        campAge <= BURST_PENALTY_AGE_LIMIT_MIN &&
        shipKillTimes.some(
          (time, i) => i > 0 && time - shipKillTimes[i - 1] < BURST_THRESHOLD_MS
        )
      ) {
        baseProbability -= 0.2;
        log.push("Burst ship kill penalty applied (-20%) for young camp.");
      }
    }

    // --- STAGE 2: Threat Ships Contribution (Based on Ship Kills, Capped) ---
    let threatShipScore = 0;
    if (relevantShipKills.length > 0) {
      const threatShips = new Map();
      relevantShipKills.forEach((kill) => {
        (kill.killmail.attackers || []).forEach((attacker) => {
          const shipType = attacker.ship_type_id;
          const weight =
            CAMP_PROBABILITY_FACTORS.THREAT_SHIPS[shipType]?.weight || 0;
          if (weight > 0) {
            threatShips.set(shipType, (threatShips.get(shipType) || 0) + 1);
            threatShipScore += weight;
          }
        });
      });
      const THREAT_SCORE_CAP = 0.5;
      const cappedThreatShipScoreContribution = Math.min(
        THREAT_SCORE_CAP,
        threatShipScore
      );
      if (threatShipScore > THREAT_SCORE_CAP && threatShipScore !== Infinity) {
        log.push(
          `Threat ship score component capped at ${
            THREAT_SCORE_CAP * 100
          }% (was ${(threatShipScore * 100).toFixed(1)}%)`
        );
      } else if (threatShipScore === Infinity) {
        log.push(
          `Threat ship score component was Infinity, capped at ${
            THREAT_SCORE_CAP * 100
          }%`
        );
      }
      baseProbability += cappedThreatShipScoreContribution;
      log.push(
        `Threat ship contribution added: +${(
          cappedThreatShipScoreContribution * 100
        ).toFixed(1)}%`
      );
    } else {
      log.push("No relevant ship kills for threat score calculation.");
    }

    // --- STAGE 3: Other Factor Bonuses ---
    // Smartbomb Bonus: Check activity type and attackers across *all* kills
    if (activity.type === "smartbomb") {
      let smartbombBonus = 0.16;
      const hasSmartbombShip = (activity.kills || []).some((kill) =>
        (kill.killmail.attackers || []).some(
          (attacker) =>
            CAMP_PROBABILITY_FACTORS.SMARTBOMB_SHIPS[attacker.ship_type_id]
        )
      );
      if (hasSmartbombShip) {
        const extraBonus = relevantShipKills.length <= 1 ? 0.15 : 0.3; // Bonus higher if multiple ship kills
        smartbombBonus += extraBonus;
        log.push(` > Dedicated smartbomb ship bonus: +${extraBonus * 100}%`);
      }
      baseProbability += smartbombBonus;
      log.push(`Smartbomb bonus added: +${(smartbombBonus * 100).toFixed(1)}%`);
    }

    // Known Camping Location Bonus
    if (activity.stargateName) {
      const systemData =
        CAMP_PROBABILITY_FACTORS.PERMANENT_CAMPS[activity.systemId];
      if (
        systemData &&
        systemData.gates.some((gate) =>
          activity.stargateName.toLowerCase().includes(gate.toLowerCase())
        )
      ) {
        baseProbability += systemData.weight;
        log.push(
          `Known camping location bonus added: +${(
            systemData.weight * 100
          ).toFixed(1)}%`
        );
      }
    }

    // Vulnerable Victim Bonus (Based on Ship Kills only)
    const vulnerableShipKills = relevantShipKills.filter(
      (kill) =>
        kill.shipCategories?.victim?.category ===
          CAMP_PROBABILITY_FACTORS.SHIP_CATEGORIES.INDUSTRIAL ||
        kill.shipCategories?.victim?.category ===
          CAMP_PROBABILITY_FACTORS.SHIP_CATEGORIES.MINING
    );
    if (vulnerableShipKills.length > 0) {
      const vulnerableBonus = vulnerableShipKills.length === 1 ? 0.2 : 0.4; // Higher bonus for multiple vulnerable ships
      baseProbability += vulnerableBonus;
      log.push(
        `Vulnerable ship victim bonus added: +${vulnerableBonus * 100}%`
      );
    }

    // --- STAGE 4: Consistency Bonus (Attacker Overlap on Ship Kills) ---
    let consistencyBonus = 0;
    const MIN_CONSISTENCY_SHIP_KILLS = 2;
    if (relevantShipKills.length >= MIN_CONSISTENCY_SHIP_KILLS) {
      const CONSISTENCY_BONUS_PER_MATCH = 0.15;
      const MAX_CONSISTENCY_BONUS = 0.3;
      const consistencyCheckKills = relevantShipKills.slice(-3); // Check last 3 ship kills

      if (consistencyCheckKills.length >= MIN_CONSISTENCY_SHIP_KILLS) {
        const killTimes = consistencyCheckKills.map((k) =>
          new Date(k.killmail.killmail_time).getTime()
        );
        const isBurst = killTimes.some(
          (time, i) => i > 0 && time - killTimes[i - 1] < 120000
        );
        let skipConsistencyBonus = false;
        if (isBurst) {
          // Don't reward consistency if it was just a burst against the same entity
          const victimCorps = consistencyCheckKills
            .map((k) => k.killmail.victim.corporation_id)
            .filter(Boolean);
          const uniqueCorps = new Set(victimCorps);
          const victimAlliances = consistencyCheckKills
            .map((k) => k.killmail.victim.alliance_id)
            .filter(Boolean);
          const uniqueAlliances = new Set(victimAlliances);
          if (
            (victimCorps.length === consistencyCheckKills.length &&
              uniqueCorps.size === 1) ||
            (victimAlliances.length === consistencyCheckKills.length &&
              uniqueAlliances.size === 1)
          ) {
            skipConsistencyBonus = true;
            log.push(
              " > Burst ship kills from same victim corp/alliance: skipping attacker consistency bonus"
            );
          }
        }
        if (!skipConsistencyBonus) {
          const latestAttackers = new Set(
            (
              consistencyCheckKills[consistencyCheckKills.length - 1].killmail
                .attackers || []
            )
              .map((a) => a.character_id)
              .filter((id) => id)
          );
          for (let i = consistencyCheckKills.length - 2; i >= 0; i--) {
            const previousAttackers = new Set(
              (consistencyCheckKills[i].killmail.attackers || [])
                .map((a) => a.character_id)
                .filter((id) => id)
            );
            const intersection = new Set(
              [...latestAttackers].filter((x) => previousAttackers.has(x))
            );
            const minOverlap = Math.max(
              2,
              Math.floor(previousAttackers.size / 3)
            );
            if (intersection.size >= minOverlap && intersection.size >= 2) {
              consistencyBonus += CONSISTENCY_BONUS_PER_MATCH;
              log.push(
                ` > Attacker consistency bonus match (ships): +${(
                  CONSISTENCY_BONUS_PER_MATCH * 100
                ).toFixed(1)}%`
              );
            }
          }
          if (consistencyBonus > 0) {
            if (consistencyBonus > MAX_CONSISTENCY_BONUS) {
              log.push(
                ` > Capping consistency bonus at ${
                  MAX_CONSISTENCY_BONUS * 100
                }%`
              );
              consistencyBonus = MAX_CONSISTENCY_BONUS;
            }
            baseProbability += consistencyBonus;
            log.push(
              `Total attacker consistency bonus added: +${(
                consistencyBonus * 100
              ).toFixed(1)}%`
            );
          }
        }
      }
    } else {
      log.push("Not enough ship kills for attacker consistency check.");
    }

    // --- STAGE 5: Widely Spaced Kill Bonus (Based on Ship Kills) ---
    let widelySpacedBonus = 0;
    const MIN_SPACED_SHIP_KILLS = 2;
    if (relevantShipKills.length >= MIN_SPACED_SHIP_KILLS) {
      const WIDELY_SPACED_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
      const WIDELY_SPACED_BONUS_PER_KILL = 0.15;
      const MAX_WIDELY_SPACED_BONUS = 0.45;
      const shipKillTimes = relevantShipKills.map((k) =>
        new Date(k.killmail.killmail_time).getTime()
      );
      let widelySpacedCount = 0;
      for (let i = 1; i < shipKillTimes.length; i++) {
        const timeDiff = shipKillTimes[i] - shipKillTimes[i - 1];
        if (timeDiff > WIDELY_SPACED_THRESHOLD_MS) {
          widelySpacedBonus += WIDELY_SPACED_BONUS_PER_KILL;
          widelySpacedCount++;
          log.push(
            ` > Widely spaced ship kill bonus match: +${(
              WIDELY_SPACED_BONUS_PER_KILL * 100
            ).toFixed(0)}% (Gap: ${(timeDiff / 60000).toFixed(1)} min)`
          );
        }
      }
      if (widelySpacedCount > 0) {
        if (widelySpacedBonus > MAX_WIDELY_SPACED_BONUS) {
          log.push(
            ` > Capping widely spaced bonus at ${
              MAX_WIDELY_SPACED_BONUS * 100
            }%`
          );
          widelySpacedBonus = MAX_WIDELY_SPACED_BONUS;
        }
        baseProbability += widelySpacedBonus;
        log.push(
          `Total widely spaced ship kill bonus added: +${(
            widelySpacedBonus * 100
          ).toFixed(1)}%`
        );
      }
    } else {
      log.push("Not enough ship kills for widely spaced bonus check.");
    }

    // --- STAGE 5b: Pod Kill Bonus ---
    // Add a small, capped bonus for each relevant pod kill found earlier.
    let podKillBonus = 0;
    if (relevantPodKills.length > 0) {
      const POD_BONUS_PER_KILL = 0.03; // 3% per pod
      const MAX_POD_BONUS = 0.15; // Cap total pod bonus (e.g., max 5 pods = 15%)
      podKillBonus = relevantPodKills.length * POD_BONUS_PER_KILL;
      if (podKillBonus > MAX_POD_BONUS) {
        log.push(
          ` > Capping pod kill bonus at ${MAX_POD_BONUS * 100}% (was ${
            podKillBonus * 100
          }%)`
        );
        podKillBonus = MAX_POD_BONUS;
      }
      baseProbability += podKillBonus;
      log.push(
        `Pod kill bonus added: +${(podKillBonus * 100).toFixed(1)}% (${
          relevantPodKills.length
        } pods)`
      );
    }

    // --- STAGE 6: Pre-Decay Capping & Flooring ---
    const OVERALL_CAP_BEFORE_DECAY = 0.95;
    let probabilityBeforeDecay = baseProbability;
    if (probabilityBeforeDecay > OVERALL_CAP_BEFORE_DECAY) {
      log.push(
        `Probability sum capped at ${OVERALL_CAP_BEFORE_DECAY * 100}% (was ${(
          probabilityBeforeDecay * 100
        ).toFixed(1)}%) before decay`
      );
      probabilityBeforeDecay = OVERALL_CAP_BEFORE_DECAY;
    } else if (probabilityBeforeDecay < 0) {
      log.push(
        `Probability sum floored at 0% (was ${(
          probabilityBeforeDecay * 100
        ).toFixed(1)}%) before decay`
      );
      probabilityBeforeDecay = 0;
    } else {
      log.push(
        `Total probability before decay: ${(
          probabilityBeforeDecay * 100
        ).toFixed(1)}%`
      );
    }

    // --- STAGE 7: Decay ---
    let finalProbability = probabilityBeforeDecay;
    // DECAY_START should be defined in constants.js (e.g., 5 * 60 * 1000 for 5 minutes)
    const decayStartMinutes = (DECAY_START || 5 * 60 * 1000) / (60 * 1000);
    if (minutesSinceLastKill > decayStartMinutes) {
      const decayMinutes = minutesSinceLastKill - decayStartMinutes;
      const decayRatePerMinute = 0.1; // 10% decay per minute past threshold
      const timeDecayPercent = Math.min(1.0, decayMinutes * decayRatePerMinute); // Cap decay at 100%
      finalProbability = probabilityBeforeDecay * (1 - timeDecayPercent);
      log.push(
        `Applying decay for ${decayMinutes.toFixed(
          1
        )} minutes past threshold (${decayStartMinutes}m)`
      );
      log.push(
        `Time decay adjustment: -${(timeDecayPercent * 100).toFixed(1)}% -> ${(
          finalProbability * 100
        ).toFixed(1)}%`
      );
    }

    // --- STAGE 8: Final Normalization & Minimum Threshold ---
    finalProbability = Math.max(
      0,
      Math.min(OVERALL_CAP_BEFORE_DECAY, finalProbability)
    );
    const percentProbability = Math.round(finalProbability * 100);
    const MINIMUM_THRESHOLD = 5; // Minimum 5% to be considered active
    if (percentProbability < MINIMUM_THRESHOLD) {
      log.push(
        `Final probability 0: Below minimum threshold (${MINIMUM_THRESHOLD}%)`
      );
      activity.maxProbability = Math.max(
        initialMaxProbability,
        percentProbability
      );
      return 0;
    }

    log.push(`Final normalized probability: ${percentProbability}%`);
    activity.maxProbability = Math.max(
      initialMaxProbability,
      percentProbability
    );

    return percentProbability;
    // --- END of calculateCampProbability ---
  }

  /**
   * Saves an expired activity to the database if it meets criteria.
   * @param {object} activity - The expired activity object.
   */
  async saveExpiredActivity(activity) {
    if (!this.pool) {
      console.error(
        "Cannot save expired activity: Database pool not available."
      );
      return;
    }

    // Save criteria: Must have occurred at a stargate AND be classified as camp, smartbomb, roaming_camp, or battle.
    const shouldSave =
      activity.stargateName &&
      ["camp", "smartbomb", "roaming_camp", "battle"].includes(
        activity.classification
      );

    if (!shouldSave) {
      // console.log(`Skipping save for expired activity ${activity.id} (classification: ${activity.classification}, stargate: ${!!activity.stargateName})`);
      return;
    }

    try {
      const campDetails = {
        kills: activity.kills || [], // Ensure kills array exists
        composition: activity.composition || {},
        metrics: activity.metrics || {},
        probabilityLog: activity.probabilityLog || [],
        members: Array.from(activity.members || []),
        systems: activity.systems || [],
        visitedSystemsCount: activity.visitedSystems?.size || 1,
      };

      // Calculate estimated end time based on appropriate timeout
      const timeout = ["camp", "smartbomb", "roaming_camp", "battle"].includes(
        activity.classification
      )
        ? CAMP_TIMEOUT
        : ROAM_TIMEOUT;
      const lastEventTimestamp = new Date(
        activity.lastActivity ||
          activity.lastKill ||
          activity.startTime ||
          activity.firstKillTime
      ).getTime();
      const campEndTime = new Date(lastEventTimestamp + timeout);

      // Database query - Ensure table schema matches (classification column might be needed)
      const query = `
          INSERT INTO expired_camps (
            camp_unique_id, system_id, stargate_name, max_probability,
            camp_start_time, last_kill_time, camp_end_time, processing_time,
            total_value, camp_type, final_kill_count, camp_details, classifier
            -- Add classification column here if needed: , classification
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, DEFAULT, $8, $9, $10, $11, DEFAULT /*, $12 */)
          ON CONFLICT (camp_unique_id) DO NOTHING;
        `;

      const values = [
        activity.id, // Use the unique activity ID
        activity.systemId,
        activity.stargateName || null, // Use null if no specific stargate
        activity.maxProbability || activity.probability || 0, // Use max probability recorded
        new Date(activity.firstKillTime || activity.startTime || Date.now()), // Ensure valid start date
        new Date(activity.lastKill || activity.lastActivity || Date.now()), // Ensure valid last event date
        campEndTime, // Estimated end time
        activity.totalValue || 0, // Ensure value exists
        activity.type || "unknown", // 'camp', 'roam', 'smartbomb' etc.
        (activity.kills || []).length, // Ensure kills array exists
        JSON.stringify(campDetails), // Serialize complex data
        // activity.classification, // Uncomment if column added
      ];

      await this.pool.query(query, values);
      console.log(
        `Saved expired activity ${activity.id} (Class: ${activity.classification}) to database.`
      );
    } catch (error) {
      // Ignore unique constraint violation errors as they mean the camp was already saved
      if (error.code !== "23505") {
        console.error(`Error saving expired activity ${activity.id}:`, error);
      } else {
        // console.log(`Expired activity ${activity.id} already saved, skipping.`);
      }
    }
  }

  /**
   * Checks if a kill occurred near a stargate based on pinpoint data.
   * @param {object} killmail - The killmail object.
   * @returns {boolean} True if the kill is considered a gate camp kill.
   */
  isGateCamp(killmail) {
    // Check if pinpoint data exists and includes nearest celestial information
    if (!killmail?.pinpoints?.nearestCelestial?.name) {
      return false; // Cannot determine if it's a gate camp without nearest celestial info
    }

    // Check if the nearest celestial name contains "stargate" (case-insensitive)
    const isStargate = killmail.pinpoints.nearestCelestial.name
      .toLowerCase()
      .includes("stargate");
    if (!isStargate) {
      return false; // Not near a stargate
    }

    // Consider it a gate camp kill if it's AT the stargate or NEAR it (direct warp or near celestial triangulation)
    return (
      killmail.pinpoints.atCelestial ||
      killmail.pinpoints.triangulationType === "direct_warp" ||
      killmail.pinpoints.triangulationType === "near_celestial"
    );
  }

  /**
   * Checks if any kills involve smartbomb weapons.
   * @param {Array<object>} kills - Array of killmail objects.
   * @returns {boolean} True if smartbombs were used.
   */
  hasSmartbombs(kills) {
    if (!kills || kills.length === 0) return false; // Handle empty or null kills array
    return kills.some((kill) =>
      (kill?.killmail?.attackers || []).some(
        // Add null checks and default empty array
        (attacker) =>
          attacker?.weapon_type_id && // Add null check for attacker
          CAMP_PROBABILITY_FACTORS.SMARTBOMB_WEAPONS[attacker.weapon_type_id]
      )
    );
  }

  /**
   * Updates the composition metrics for an activity based on a new killmail.
   * @param {object} activity - The activity object to update.
   * @param {object} killmail - The new killmail object.
   * @returns {object} The updated composition object.
   */
  updateActivityComposition(activity, killmail) {
    // Ensure sets and arrays exist, initializing if necessary
    activity.originalAttackers = activity.originalAttackers || new Set();
    activity.activeAttackers = activity.activeAttackers || new Set();
    activity.killedAttackers = activity.killedAttackers || new Set();
    activity.involvedCorporations = activity.involvedCorporations || [];
    activity.involvedAlliances = activity.involvedAlliances || [];
    activity.members = activity.members || new Set(); // Ensure members set exists

    // Process attackers
    (killmail?.killmail?.attackers || []).forEach((attacker) => {
      // Add null checks
      if (!attacker || !attacker.character_id) return; // Skip if attacker or character_id is missing

      activity.members.add(attacker.character_id); // Add to overall members

      if (!activity.originalAttackers.has(attacker.character_id)) {
        activity.originalAttackers.add(attacker.character_id);
      }
      // Add to active attackers only if they aren't already marked as killed in this activity
      if (!activity.killedAttackers.has(attacker.character_id)) {
        activity.activeAttackers.add(attacker.character_id);
      }

      // Track unique corporations and alliances
      if (
        attacker.corporation_id &&
        !activity.involvedCorporations.includes(attacker.corporation_id)
      ) {
        activity.involvedCorporations.push(attacker.corporation_id);
      }
      if (
        attacker.alliance_id &&
        !activity.involvedAlliances.includes(attacker.alliance_id)
      ) {
        activity.involvedAlliances.push(attacker.alliance_id);
      }
    });

    // Process victim
    const victim = killmail?.killmail?.victim;
    if (victim && victim.character_id) {
      // Check if victim is a player character
      const victimId = victim.character_id;
      activity.members.add(victimId); // Add victim to members list

      // If the victim was previously an active attacker in this activity, move them to killed
      if (activity.activeAttackers.has(victimId)) {
        activity.activeAttackers.delete(victimId);
        activity.killedAttackers.add(victimId);
      }

      // Track victim's corp/alliance if not already present
      if (
        victim.corporation_id &&
        !activity.involvedCorporations.includes(victim.corporation_id)
      ) {
        activity.involvedCorporations.push(victim.corporation_id);
      }
      if (
        victim.alliance_id &&
        !activity.involvedAlliances.includes(victim.alliance_id)
      ) {
        activity.involvedAlliances.push(victim.alliance_id);
      }
    }

    // Update and return the composition metrics
    activity.composition = {
      originalCount: activity.originalAttackers.size,
      activeCount: activity.activeAttackers.size,
      killedCount: activity.killedAttackers.size,
      // Use Sets for accurate unique counts of corps/alliances involved
      numCorps: new Set(activity.involvedCorporations).size,
      numAlliances: new Set(activity.involvedAlliances).size,
    };
    return activity.composition;
  }

  /**
   * Calculates various metrics for an activity based on its kills.
   * @param {Array<object>} kills - Array of killmail objects for the activity.
   * @param {number} now - Current timestamp (Date.now()).
   * @returns {object} Calculated metrics.
   */
  getMetrics(kills, now) {
    // Provide default metrics if kills array is empty or invalid
    if (!kills || !Array.isArray(kills) || kills.length === 0) {
      return {
        firstSeen: now, // Default to current time if no kills
        campDuration: 0,
        activeDuration: 0,
        inactivityDuration: 0,
        podKills: 0,
        killFrequency: 0,
        avgValuePerKill: 0,
        shipCounts: {},
        partyMetrics: { characters: 0, corporations: 0, alliances: 0 },
      };
    }

    // Filter out invalid kill times before calculating min/max
    const validKillTimes = kills
      .map((k) => new Date(k?.killmail?.killmail_time).getTime()) // Add null checks
      .filter((time) => !isNaN(time)); // Filter out NaN results from invalid dates

    if (validKillTimes.length === 0) {
      // Handle case where no valid kill times exist
      return {
        firstSeen: now,
        campDuration: 0,
        activeDuration: 0,
        inactivityDuration: 0,
        podKills: 0,
        killFrequency: 0,
        avgValuePerKill: 0,
        shipCounts: {},
        partyMetrics: { characters: 0, corporations: 0, alliances: 0 },
      };
    }

    const earliestKillTime = Math.min(...validKillTimes);
    const lastKillTime = Math.max(...validKillTimes);

    const totalDuration = Math.floor((now - earliestKillTime) / (1000 * 60));
    // Calculate active duration, ensure it's at least 1 minute if there are kills, or 0 if times are the same
    const activeDurationMillis = lastKillTime - earliestKillTime;
    const activeDuration =
      activeDurationMillis <= 0
        ? 0
        : Math.max(1, Math.floor(activeDurationMillis / (1000 * 60)));
    const inactivityDuration = Math.floor((now - lastKillTime) / (1000 * 60));

    // Calculate ship type frequency
    const shipCounts = {};
    kills.forEach((kill) => {
      (kill?.killmail?.attackers || []).forEach((attacker) => {
        // Add null checks
        if (attacker?.ship_type_id) {
          // Add null check
          shipCounts[attacker.ship_type_id] =
            (shipCounts[attacker.ship_type_id] || 0) + 1;
        }
      });
    });

    // Calculate party metrics (unique characters, corps, alliances involved)
    const partyMetrics = {};
    const characterIds = new Set();
    const corporationIds = new Set();
    const allianceIds = new Set();

    kills.forEach((kill) => {
      // Process attackers
      (kill?.killmail?.attackers || []).forEach((attacker) => {
        // Add null checks
        if (attacker) {
          if (attacker.character_id) characterIds.add(attacker.character_id);
          if (attacker.corporation_id)
            corporationIds.add(attacker.corporation_id);
          if (attacker.alliance_id) allianceIds.add(attacker.alliance_id);
        }
      });
      // Process victim (if player)
      const victim = kill?.killmail?.victim;
      if (victim && victim.character_id) {
        // Check if victim is a player
        characterIds.add(victim.character_id);
        if (victim.corporation_id) corporationIds.add(victim.corporation_id);
        if (victim.alliance_id) allianceIds.add(victim.alliance_id);
      }
    });

    partyMetrics.characters = characterIds.size;
    partyMetrics.corporations = corporationIds.size;
    partyMetrics.alliances = allianceIds.size;

    const totalValueSum = kills.reduce(
      (sum, k) => sum + (k?.zkb?.totalValue || 0),
      0
    ); // Add null check for kill and zkb

    return {
      firstSeen: earliestKillTime,
      campDuration: totalDuration,
      activeDuration: activeDuration,
      inactivityDuration: inactivityDuration,
      podKills: kills.filter(
        (k) => k?.killmail?.victim?.ship_type_id === CAPSULE_ID // Add null checks
      ).length,
      // Use activeDuration for frequency, avoid division by zero
      killFrequency: activeDuration > 0 ? kills.length / activeDuration : 0,
      avgValuePerKill: kills.length > 0 ? totalValueSum / kills.length : 0,
      shipCounts: shipCounts,
      partyMetrics: partyMetrics,
    };
  }

  /**
   * Forces an immediate update and emission of activities.
   */
  forceUpdate() {
    console.log("Activity Manager: Force update requested.");
    this.updateAndEmitActivities();
  }

  /**
   * Stops updates and clears the activity list.
   */
  cleanup() {
    this.stopUpdates();
    this._activities.clear();
    console.log("Activity Manager: Cleaned up.");
  }
}
