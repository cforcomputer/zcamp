<!-- src/ActiveCamps.svelte -->
<script>
  import { filteredCamps } from "./campStore.js";
  import { onMount } from "svelte";

  let camps = [];

  $: camps = $filteredCamps;

  function formatValue(value) {
    if (value >= 1000000000) {
      return (value / 1000000000).toFixed(2) + "B";
    }
    if (value >= 1000000) {
      return (value / 1000000).toFixed(2) + "M";
    }
    return (value / 1000).toFixed(2) + "K";
  }

  function getTimeAgo(timestamp) {
    const now = new Date().getTime();
    const then = new Date(timestamp).getTime();
    const minutes = Math.floor((now - then) / (1000 * 60));

    if (minutes < 1) return "just now";
    if (minutes === 1) return "1 minute ago";
    return `${minutes} minutes ago`;
  }

  function getProbabilityColor(probability) {
    if (probability >= 80) return "#ff4444";
    if (probability >= 60) return "#ff8c00";
    if (probability >= 40) return "#ffd700";
    return "#90ee90";
  }

  function getKillFrequency(kills) {
    const timeSpan =
      new Date(kills[kills.length - 1].killmail.killmail_time) -
      new Date(kills[0].killmail.killmail_time);
    const minutes = timeSpan / (1000 * 60);
    const rate = kills.length / (minutes || 1);
    return `${rate.toFixed(1)} kills/min`;
  }

  function hasInterdictor(kills) {
    return kills.some((kill) =>
      kill.killmail.attackers.some(
        (a) =>
          a.ship_type_id &&
          [22456, 22464, 22452, 22460, 12013, 12017, 12021, 12025].includes(
            a.ship_type_id
          )
      )
    );
  }
</script>

<div class="active-camps">
  <h2>Active Gate Camps</h2>
  <div class="camp-grid">
    {#each camps as camp}
      <button
        class="camp-card"
        type="button"
        style="border-color: {getProbabilityColor(camp.probability)}"
        on:click={() => {
          const latestKill = camp.kills[camp.kills.length - 1];
          if (latestKill) {
            window.open(
              `https://zkillboard.com/kill/${latestKill.killID}/`,
              "_blank"
            );
          }
        }}
        aria-label={`View latest kill for gate camp at ${camp.stargateName}`}
      >
        <div class="camp-header">
          <h3>{camp.stargateName}</h3>
          <span
            class="probability"
            style="background-color: {getProbabilityColor(camp.probability)}"
          >
            {Math.round(camp.probability)}% Confidence
          </span>
        </div>

        <div class="camp-stats">
          <div class="stat-row">
            <span class="stat-label">System:</span>
            <span class="stat-value">{camp.systemId}</span>
          </div>

          <div class="stat-row">
            <span class="stat-label">Activity:</span>
            <span class="stat-value">
              {camp.kills.length} kills ({getKillFrequency(camp.kills)})
              {#if hasInterdictor(camp.kills)}
                <span
                  class="interdictor-badge"
                  title="Interdictor/HICTOR present">⚠️</span
                >
              {/if}
            </span>
          </div>

          <div class="stat-row">
            <span class="stat-label">Value:</span>
            <span class="stat-value value"
              >{formatValue(camp.totalValue)} ISK</span
            >
          </div>

          <div class="stat-row">
            <span class="stat-label">Composition:</span>
            <span class="stat-value">
              {camp.numAttackers} pilots from {camp.numCorps} corps
              {#if camp.numAlliances > 0}
                in {camp.numAlliances} alliances
              {/if}
            </span>
          </div>

          <div class="stat-row">
            <span class="stat-label">Last Activity:</span>
            <span class="stat-value time">{getTimeAgo(camp.lastKill)}</span>
          </div>
        </div>
      </button>
    {/each}

    {#if camps.length === 0}
      <p class="no-camps">No active gate camps detected</p>
    {/if}
  </div>
</div>

<style>
  .active-camps {
    padding: 1em;
  }

  .camp-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1em;
  }

  .camp-card {
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

  .camp-card:hover {
    transform: scale(1.02);
    filter: brightness(1.2);
  }

  .camp-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1em;
  }

  .probability {
    padding: 0.3em 0.6em;
    border-radius: 4px;
    font-size: 0.9em;
    font-weight: bold;
  }

  .camp-stats {
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

  .value {
    color: #ff4444;
    font-weight: bold;
  }

  .time {
    color: #888;
    font-style: italic;
  }

  .interdictor-badge {
    margin-left: 0.5em;
    cursor: help;
  }

  .no-camps {
    grid-column: 1 / -1;
    text-align: center;
    padding: 2em;
    color: #888;
    font-style: italic;
  }

  h2 {
    color: white;
    margin-bottom: 1em;
  }

  h3 {
    margin: 0;
    color: white;
  }
</style>
