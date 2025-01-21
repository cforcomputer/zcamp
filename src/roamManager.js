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
    console.log("Processing killmail:", {
      killID: killmail.killID,
      systemId: killmail.killmail.solar_system_id,
      time: killmail.killmail.killmail_time,
      attackers: killmail.killmail.attackers.length,
    });

    const now = Date.now();

    // Clean expired roams
    const beforeCleanCount = this._roams.length;
    this._roams = this._roams.filter((roam) => {
      const timeSinceLastActivity = now - new Date(roam.lastActivity).getTime();
      const isActive = timeSinceLastActivity <= ROAM_TIMEOUT;
      if (!isActive) {
        console.log(
          `Roam ${roam.id} expired after ${Math.floor(
            timeSinceLastActivity / 1000 / 60
          )}m of inactivity`
        );
      }
      return isActive;
    });
    console.log(
      `Cleaned expired roams: ${beforeCleanCount} -> ${this._roams.length}`
    );

    const systemId = killmail.killmail.solar_system_id;
    const systemName =
      killmail.pinpoints?.celestialData?.solarsystemname || systemId.toString();
    const regionName = killmail.pinpoints?.celestialData?.regionname || null;

    // Get unique attacker character IDs, excluding capsules
    const attackerIds = new Set(
      killmail.killmail.attackers
        .filter((a) => a.character_id && a.ship_type_id !== CAPSULE_ID)
        .map((a) => a.character_id)
    );

    console.log(`Found ${attackerIds.size} unique attackers in killmail`);
    console.log("Attacker IDs:", [...attackerIds]);

    // Skip if insufficient unique attackers
    if (attackerIds.size < 2) {
      console.log("Skipping - insufficient unique attackers");
      activeRoams.set(this._roams);
      return this._roams;
    }

    // Find existing roam with overlapping members
    let existingRoam = this._roams.find((roam) => {
      const members = new Set(roam.members);
      const overlappingMembers = [...attackerIds].filter((id) =>
        members.has(id)
      );
      const hasOverlap = overlappingMembers.length > 0;
      if (hasOverlap) {
        console.log(
          `Found matching roam: ${roam.id} with overlapping members:`,
          overlappingMembers
        );
      }
      return hasOverlap;
    });

    if (existingRoam) {
      console.log("Updating existing roam:", {
        id: existingRoam.id,
        previousMembers: existingRoam.members.length,
        previousSystems: existingRoam.systems.length,
        previousKills: existingRoam.kills.length,
      });

      // Update existing roam
      existingRoam.members = Array.from(
        new Set([...existingRoam.members, ...attackerIds])
      );
      existingRoam.lastActivity = killmail.killmail.killmail_time;
      existingRoam.lastSystem = {
        id: systemId,
        name: systemName,
        region: regionName,
      };
      existingRoam.systems.push({
        id: systemId,
        name: systemName,
        region: regionName,
        time: killmail.killmail.killmail_time,
      });
      existingRoam.kills.push(killmail);
      existingRoam.totalValue += killmail.zkb.totalValue;

      console.log("Updated roam stats:", {
        members: existingRoam.members.length,
        systems: existingRoam.systems.length,
        kills: existingRoam.kills.length,
        totalValue: existingRoam.totalValue,
      });
    } else {
      console.log("Creating new roam");
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
        lastSystem: {
          id: systemId,
          name: systemName,
          region: regionName,
        },
        startTime: killmail.killmail.killmail_time,
        lastActivity: killmail.killmail.killmail_time,
        kills: [killmail],
        totalValue: killmail.zkb.totalValue,
      };

      this._roams.push(newRoam);
      console.log("New roam created:", {
        id: newRoam.id,
        members: newRoam.members.length,
        system: newRoam.lastSystem.name,
        totalValue: newRoam.totalValue,
      });
    }

    // Update store
    activeRoams.set(this._roams);

    // Emit for compatibility
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
