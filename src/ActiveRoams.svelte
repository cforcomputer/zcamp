<!-- src/ActiveRoams.svelte -->
<script>
  import { filteredRoams } from "../server/campStore.js";

  function formatValue(value) {
    if (value >= 1000000000) return (value / 1000000000).toFixed(2) + "B";
    if (value >= 1000000) return (value / 1000000).toFixed(2) + "M";
    return (value / 1000).toFixed(2) + "K";
  }

  function getTimeAgo(timestamp) {
    const minutes = Math.floor(
      (Date.now() - new Date(timestamp).getTime()) / (1000 * 60)
    );
    if (minutes < 1) return "just now";
    if (minutes === 1) return "1 minute ago";
    return `${minutes} minutes ago`;
  }
</script>

<div class="active-roams">
  <h2>Active Roaming Gangs</h2>
  <div class="roam-grid">
    {#each $filteredRoams as roam}
      <div class="roam-card">
        <div class="roam-header">
          <h3>{roam.memberCount} Pilots</h3>
          <span class="last-seen"
            >Last seen: {getTimeAgo(roam.lastActivity)}</span
          >
        </div>

        <div class="roam-stats">
          <div class="stat-row">
            <span class="stat-label">Current System:</span>
            <span class="stat-value">{roam.lastSystem.name}</span>
          </div>

          <div class="stat-row">
            <span class="stat-label">Systems Visited:</span>
            <span class="stat-value">{roam.systemCount}</span>
          </div>

          <div class="stat-row">
            <span class="stat-label">Kills:</span>
            <span class="stat-value">{roam.kills.length}</span>
          </div>

          <div class="stat-row">
            <span class="stat-label">Total Value:</span>
            <span class="stat-value value"
              >{formatValue(roam.totalValue)} ISK</span
            >
          </div>
        </div>

        <div class="system-history">
          <h4>Recent Systems:</h4>
          <div class="system-list">
            {#each roam.systems.slice(-5).reverse() as system}
              <div class="system-entry">
                <span class="system-name">{system.name}</span>
                <span class="system-time">{getTimeAgo(system.time)}</span>
              </div>
            {/each}
          </div>
        </div>
      </div>
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
    background: rgba(0, 0, 0, 0.7);
    border: 2px solid #4a4a4a;
    border-radius: 8px;
    padding: 1em;
  }

  .roam-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1em;
  }

  .stat-row {
    display: flex;
    justify-content: space-between;
    margin: 0.5em 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding-bottom: 0.3em;
  }

  .system-history {
    margin-top: 1em;
  }

  .system-entry {
    display: flex;
    justify-content: space-between;
    padding: 0.3em 0;
  }

  .value {
    color: #ff4444;
    font-weight: bold;
  }

  .last-seen {
    color: #888;
    font-style: italic;
  }
</style>
