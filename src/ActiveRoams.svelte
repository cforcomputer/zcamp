<script>
  import { filteredRoams } from "../server/campStore.js";
  // Debug logging
  $: console.log("Filtered roams:", $filteredRoams);

  $: {
    console.log("ActiveRoams component state:");
    console.log("Filtered roams:", $filteredRoams);
    console.log("Number of roams:", $filteredRoams.length);
    if ($filteredRoams.length > 0) {
      console.log("Sample roam data:", $filteredRoams[0]);
    }
  }

  function formatValue(value) {
    if (!value) return "0 ISK";
    if (value >= 1000000000) return (value / 1000000000).toFixed(2) + "B";
    if (value >= 1000000) return (value / 1000000).toFixed(2) + "M";
    return (value / 1000).toFixed(2) + "K";
  }

  function getTimeAgo(timestamp) {
    if (!timestamp) return "unknown";
    const minutes = Math.floor(
      (Date.now() - new Date(timestamp).getTime()) / (1000 * 60)
    );
    if (minutes < 1) return "just now";
    if (minutes === 1) return "1 minute ago";
    return `${minutes} minutes ago`;
  }

  function getSystemCount(roam) {
    if (!roam.systems) return 0;
    return new Set(roam.systems.map((s) => s.id)).size;
  }

  function getMemberCount(roam) {
    return roam.members?.length || 0;
  }

  function getRoamDuration(roam) {
    if (!roam.kills || roam.kills.length === 0) return "unknown";

    // Find earliest kill time
    const firstKillTime = roam.kills.reduce((earliest, kill) => {
      const killTime = new Date(kill.killmail.killmail_time).getTime();
      return killTime < earliest ? killTime : earliest;
    }, new Date(roam.kills[0].killmail.killmail_time).getTime());

    const minutes = Math.floor((Date.now() - firstKillTime) / (1000 * 60));
    if (minutes < 1) return "just started";
    if (minutes === 1) return "1 minute";
    return `${minutes} minutes`;
  }

  function getUniqueRecentSystems(systems) {
    if (!systems || !Array.isArray(systems)) return [];

    // Create a map to store the most recent timestamp for each system
    const systemMap = new Map();

    // Update the map with the most recent timestamp for each system
    systems.forEach((system) => {
      const existing = systemMap.get(system.name);
      if (!existing || new Date(system.time) > new Date(existing.time)) {
        systemMap.set(system.name, system);
      }
    });

    // Convert map back to array, sort by time, and take last 3
    return Array.from(systemMap.values())
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 3)
      .reverse();
  }

  function getRoamColor(roam) {
    const systemCount = getSystemCount(roam);
    const memberCount = getMemberCount(roam);

    if (systemCount > 10 || memberCount > 20) return "#ff4444";
    if (systemCount > 5 || memberCount > 10) return "#ff8c00";
    if (systemCount > 2 || memberCount > 5) return "#ffd700";
    return "#90ee90";
  }
</script>

<div class="active-roams">
  <h2>Active Gangs</h2>
  <div class="roam-grid">
    {#each $filteredRoams as roam (roam.id)}
      <button
        class="roam-card"
        type="button"
        style="border-color: {getRoamColor(roam)}"
        on:click={() => {
          const latestKill = roam.kills[roam.kills.length - 1];
          if (latestKill) {
            const killTime = new Date(latestKill.killmail.killmail_time);
            const formattedTime = `${killTime.getUTCFullYear()}${String(
              killTime.getUTCMonth() + 1
            ).padStart(2, "0")}${String(killTime.getUTCDate()).padStart(
              2,
              "0"
            )}${String(killTime.getUTCHours()).padStart(2, "0")}${String(
              killTime.getUTCMinutes()
            ).padStart(2, "0")}`;
            window.open(
              `https://zkillboard.com/related/${roam.lastSystem.id}/${formattedTime}/`,
              "_blank"
            );
          }
        }}
      >
        <div class="roam-header">
          <h3>{getMemberCount(roam)} Pilots</h3>
          <div class="roam-indicators">
            <span
              class="probability"
              style="background-color: {getRoamColor(roam)}"
            >
              {getSystemCount(roam)} Systems
            </span>
            <span class="roam-duration">
              Roaming: {getRoamDuration(roam)}
            </span>
          </div>
        </div>

        <div class="roam-stats">
          <div class="stat-row">
            <span class="stat-label">Current System:</span>
            <span class="stat-value">{roam.lastSystem?.name || "Unknown"}</span>
          </div>

          <div class="stat-row">
            <span class="stat-label">Systems Visited:</span>
            <span class="stat-value">{getSystemCount(roam)}</span>
          </div>

          <div class="stat-row">
            <span class="stat-label">Kills:</span>
            <span class="stat-value">{roam.kills?.length || 0}</span>
          </div>

          <div class="stat-row">
            <span class="stat-label">Total Value:</span>
            <span class="stat-value value">{formatValue(roam.totalValue)}</span>
          </div>
        </div>

        <div class="system-history">
          <h4>Recent Systems:</h4>
          <div class="system-list">
            {#each getUniqueRecentSystems(roam.systems) as system}
              <div class="system-entry">
                <span class="system-name">{system.name}</span>
                <span class="system-time">{getTimeAgo(system.time)}</span>
              </div>
            {/each}
          </div>
        </div>
      </button>
    {/each}

    {#if $filteredRoams.length === 0}
      <p class="no-roams">No active roaming gangs detected</p>
    {/if}
  </div>
</div>

<style>
  .active-roams {
    padding: 1em;
  }

  .roam-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1em;
  }

  .roam-card {
    cursor: pointer;
    background: rgba(0, 0, 0, 0.7);
    border: 2px solid;
    border-radius: 8px;
    padding: 1em;
    transition: all 0.3s ease;
    width: 100%;
    text-align: left;
    font-family: inherit;
    color: white;
    appearance: none;
    margin: 0;
  }

  .roam-card:hover {
    transform: scale(1.02);
    filter: brightness(1.2);
  }

  .roam-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1em;
  }

  .system-history {
    margin-top: 1em;
  }

  .system-list {
    background: rgba(0, 0, 0, 0.3);
    border-radius: 4px;
    padding: 0.5em;
    height: 100px; /* Fixed height */
    overflow: hidden;
  }

  .system-entry {
    display: flex;
    justify-content: space-between;
    padding: 0.3em 0;
    height: 28px; /* Fixed height for each entry */
    align-items: center;
  }

  .roam-duration {
    color: #888;
    font-style: italic;
    font-size: 0.8em;
  }

  .roam-indicators {
    display: flex;
    align-items: center;
    gap: 0.5em;
  }

  .probability {
    padding: 0.3em 0.6em;
    border-radius: 4px;
    font-size: 0.9em;
    font-weight: bold;
  }

  h2 {
    color: white;
    margin-bottom: 1em;
  }

  h3 {
    margin: 0;
    color: white;
  }

  h4 {
    margin: 0 0 0.5em 0;
    color: #aaa;
  }

  .roam-stats {
    font-size: 0.9em;
  }

  .stat-row {
    display: flex;
    justify-content: space-between;
    margin: 0.5em 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding-bottom: 0.3em;
  }

  .stat-label {
    color: #888;
    font-weight: 500;
  }

  .stat-value {
    color: #fff;
  }

  .value {
    color: #ff4444;
    font-weight: bold;
  }

  .system-history {
    margin-top: 1em;
  }

  .system-list {
    background: rgba(0, 0, 0, 0.3);
    border-radius: 4px;
    padding: 0.5em;
  }

  .system-entry {
    display: flex;
    justify-content: space-between;
    padding: 0.3em 0;
  }

  .system-name {
    color: #fff;
  }

  .system-time {
    color: #888;
    font-size: 0.9em;
  }

  .no-roams {
    grid-column: 1 / -1;
    text-align: center;
    padding: 2em;
    color: #888;
    font-style: italic;
  }
</style>
