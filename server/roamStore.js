// /server/roamStore.js
const CAPSULE_ID = 670;

export class RoamStore {
  constructor() {
    this.activeRoams = [];
    this.ROAM_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  }

  updateRoamingGangs(killmail) {
    const now = Date.now();

    // Clean expired roams
    this.activeRoams = this.activeRoams.filter(
      (roam) => now - new Date(roam.lastActivity).getTime() <= this.ROAM_TIMEOUT
    );

    const systemId = killmail.killmail.solar_system_id;
    const systemName =
      killmail.pinpoints?.celestialData?.solarsystemname || systemId.toString();

    // Get unique attacker character IDs, excluding capsules
    const attackerIds = new Set(
      killmail.killmail.attackers
        .filter((a) => a.character_id && a.ship_type_id !== CAPSULE_ID)
        .map((a) => a.character_id)
    );

    // Skip if insufficient unique attackers
    if (attackerIds.size < 2) {
      return this.activeRoams;
    }

    // Find existing roam with overlapping members
    let existingRoam = this.activeRoams.find((roam) => {
      const members = new Set(roam.members);
      return [...attackerIds].some((id) => members.has(id));
    });

    if (existingRoam) {
      // Update existing roam
      existingRoam.members = Array.from(
        new Set([...existingRoam.members, ...attackerIds])
      );
      existingRoam.lastActivity = killmail.killmail.killmail_time;
      existingRoam.lastSystem = { id: systemId, name: systemName };
      existingRoam.systems.push({
        id: systemId,
        name: systemName,
        time: killmail.killmail.killmail_time,
      });
      existingRoam.kills.push(killmail);
      existingRoam.totalValue += killmail.zkb.totalValue;
    } else {
      // Create new roam
      const newRoam = {
        id: `roam-${Date.now()}`,
        members: Array.from(attackerIds),
        systems: [
          {
            id: systemId,
            name: systemName,
            time: killmail.killmail.killmail_time,
          },
        ],
        lastSystem: { id: systemId, name: systemName },
        startTime: killmail.killmail.killmail_time,
        lastActivity: killmail.killmail.killmail_time,
        kills: [killmail],
        totalValue: killmail.zkb.totalValue,
      };
      this.activeRoams.push(newRoam);
    }

    return this.activeRoams;
  }

  getRoams() {
    return this.activeRoams;
  }

  clearExpiredRoams() {
    const now = Date.now();
    this.activeRoams = this.activeRoams.filter(
      (roam) => now - new Date(roam.lastActivity).getTime() <= this.ROAM_TIMEOUT
    );
    return this.activeRoams;
  }
}

export default new RoamStore();
