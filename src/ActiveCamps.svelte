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
</script>

<div class="active-camps">
  <h2>Active Gate Camps</h2>
  <div class="camp-grid">
    {#each camps as camp}
      <button
        class="camp-card"
        type="button"
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
        <h3>{camp.stargateName}</h3>
        <div class="camp-stats">
          <p class="system">System: {camp.systemId}</p>
          <p class="kills">Ships Destroyed: {camp.kills.length}</p>
          <p class="value">Total Value: {formatValue(camp.totalValue)} ISK</p>
          <p class="attackers">
            Campers: {camp.numAttackers} pilots from {camp.numCorps} corps
            {#if camp.numAlliances > 0}
              in {camp.numAlliances} alliances
            {/if}
          </p>
          <p class="time">Last kill: {getTimeAgo(camp.lastKill)}</p>
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
    background: rgba(255, 0, 0, 0.1);
    border: 2px solid rgba(255, 0, 0, 0.3);
    border-radius: 8px;
    padding: 1em;
    transition: all 0.3s ease;
    width: 100%;
    text-align: left;
    font-family: inherit;
    color: inherit;
    appearance: none;
    background: none;
    margin: 0;
  }

  .camp-card:hover {
    transform: scale(1.02);
    background: rgba(255, 0, 0, 0.15);
  }

  .camp-stats {
    font-size: 0.9em;
  }

  .camp-stats p {
    margin: 0.5em 0;
  }

  .value {
    color: #ff4444;
    font-weight: bold;
  }

  .time {
    color: #666;
    font-style: italic;
  }

  .no-camps {
    grid-column: 1 / -1;
    text-align: center;
    padding: 2em;
    color: #666;
    font-style: italic;
  }
</style>
