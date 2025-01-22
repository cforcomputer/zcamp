// roamManager.js
import { writable, derived } from "svelte/store";
import { killmails } from "./settingsStore.js";
import { EventEmitter } from "./browserEvents.js";

export const ROAM_TIMEOUT = 30 * 60 * 1000; // 30 minutes
export const CAPSULE_ID = 670;

// Create store for active roams
export const activeRoams = writable([]);

class RoamManager extends EventEmitter {
  constructor() {
    super();
    this._roams = [];
    this.updateInterval = null;
    this.lastUpdate = Date.now();

    // Subscribe to killmail store
    killmails.subscribe((kills) => {
      this.processKillmails(kills);
    });
  }

  startUpdates(interval = 30000) {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    this.updateInterval = setInterval(() => {
      this.clearExpiredRoams();
    }, interval);
  }

  stopUpdates() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  processKillmails(kills) {
    // Process only recent kills (last 30 minutes)
    const cutoffTime = Date.now() - ROAM_TIMEOUT;
    const recentKills = kills.filter(
      (kill) => new Date(kill.killmail.killmail_time).getTime() > cutoffTime
    );

    // Process each kill
    recentKills.forEach((kill) => {
      this.updateRoamingGangs(kill);
    });

    // Update store
    activeRoams.set(this._roams);
  }

  updateRoamingGangs(killmail) {
    console.log("--- roamManager.js: Roaming Gang Update Debug ---");
    const now = Date.now();

    // Clean expired roams first
    this._roams = this._roams.filter((roam) => {
      const timeSinceLastActivity = now - new Date(roam.lastActivity).getTime();
      return timeSinceLastActivity <= ROAM_TIMEOUT;
    });

    const systemId = killmail.killmail.solar_system_id;
    const systemName =
      killmail.pinpoints?.celestialData?.solarsystemname || systemId.toString();
    const regionName = killmail.pinpoints?.celestialData?.regionname || null;

    // Get unique attacker IDs
    const attackerIds = new Set(
      killmail.killmail.attackers
        .filter((a) => a.character_id && a.ship_type_id !== CAPSULE_ID)
        .map((a) => a.character_id)
    );

    if (attackerIds.size < 2) {
      activeRoams.set(this._roams);
      return this._roams;
    }

    // Find existing roam with overlapping members
    let existingRoam = this._roams.find((roam) => {
      const members = new Set(roam.members);
      return [...attackerIds].some((id) => members.has(id));
    });

    if (existingRoam) {
      // Check if kill already exists in roam
      const killExists = existingRoam.kills.some(
        (k) => k.killID === killmail.killID
      );
      if (!killExists) {
        existingRoam.kills.push(killmail);
        existingRoam.totalValue += killmail.zkb.totalValue;

        // Update systems list
        existingRoam.systems.push({
          id: systemId,
          name: systemName,
          region: regionName,
          time: killmail.killmail.killmail_time,
        });
      }

      // Always update members and timestamps
      existingRoam.members = Array.from(
        new Set([...existingRoam.members, ...attackerIds])
      );
      existingRoam.lastActivity = killmail.killmail.killmail_time;
      existingRoam.lastSystem = {
        id: systemId,
        name: systemName,
        region: regionName,
      };
    } else {
      // Create new roam
      const newRoam = {
        id: `roam-${Date.now()}`,
        members: Array.from(attackerIds),
        systems: [
          {
            id: systemId,
            name: systemName,
            region: regionName,
            time: killmail.killmail.killmail_time,
          },
        ],
        lastSystem: { id: systemId, name: systemName, region: regionName },
        startTime: killmail.killmail.killmail_time,
        lastActivity: killmail.killmail.killmail_time,
        kills: [killmail],
        totalValue: killmail.zkb.totalValue,
      };
      this._roams.push(newRoam);
    }

    activeRoams.set(this._roams);
    this.emit("roamsUpdated", this._roams);
    return this._roams;
  }

  // Rest of the methods remain the same
  getRoams() {
    return this.formatRoams(this._roams);
  }

  formatRoams(roams) {
    return roams.map((roam) => ({
      ...roam,
      members: Array.from(roam.members || []),
      systems: (roam.systems || []).map((system) => ({
        ...system,
        region: system.region || "Unknown",
      })),
      kills: roam.kills || [],
      totalValue: roam.totalValue || 0,
      lastActivity: roam.lastActivity || new Date().toISOString(),
      lastSystem: {
        id: roam.lastSystem?.id || 0,
        name: roam.lastSystem?.name || "Unknown",
        region: roam.lastSystem?.region || "Unknown",
      },
      startTime:
        roam.startTime || roam.lastActivity || new Date().toISOString(),
    }));
  }

  clearExpiredRoams() {
    const now = Date.now();
    const beforeCleanCount = this._roams.length;

    this._roams = this._roams.filter((roam) => {
      const timeSinceLastActivity = now - new Date(roam.lastActivity).getTime();
      return timeSinceLastActivity <= ROAM_TIMEOUT;
    });

    if (beforeCleanCount !== this._roams.length) {
      console.log(
        `Cleared ${beforeCleanCount - this._roams.length} expired roams`
      );

      // Update store
      activeRoams.set(this._roams);

      // Emit for compatibility
      this.emit("roamsUpdated", this._roams);
    }

    return this._roams;
  }

  cleanup() {
    this.stopUpdates();
    this._roams = [];
    activeRoams.set([]);
    this.removeAllListeners();
  }
}

// Create singleton instance
const roamManager = new RoamManager();

// Export both singleton and store
export default roamManager;
export { RoamManager };
