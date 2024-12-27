<!-- src/ActiveBattles.svelte -->
<script>
  import { filteredBattles } from "./battleStore.js";
  import { onMount } from "svelte";

  let minInvolved = 2;
  let battles = [];

  $: battles = $filteredBattles;

  function formatValue(value) {
    if (value >= 1000000000) {
      return (value / 1000000000).toFixed(2) + "B";
    }
    if (value >= 1000000) {
      return (value / 1000000).toFixed(2) + "M";
    }
    return (value / 1000).toFixed(2) + "K";
  }
</script>

<div class="active-battles">
  <div class="controls">
    <label>
      Minimum Involved: {minInvolved}
      <input type="range" bind:value={minInvolved} min="2" max="20" step="1" />
    </label>
  </div>

  <div class="battle-grid">
    {#each battles as battle}
      <div
        class="battle-bubble"
        style="--size: {Math.log(battle.totalValue) * 0.1}em"
      >
        <h3>{battle.systemId}</h3>
        <div class="stats">
          <p>Value Lost: {formatValue(battle.totalValue)} ISK</p>
          <p>Ships Lost: {battle.kills.length}</p>
          <p>Pilots Involved: {battle.involvedCount}</p>
          <p>Last Activity: {new Date(battle.lastKill).toLocaleTimeString()}</p>
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .active-battles {
    padding: 1em;
  }

  .controls {
    margin-bottom: 1em;
  }

  .battle-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 1em;
  }

  .battle-bubble {
    background: rgba(255, 0, 0, 0.1);
    border: 1px solid rgba(255, 0, 0, 0.3);
    border-radius: 50%;
    padding: 1em;
    width: var(--size);
    height: var(--size);
    min-width: 200px;
    min-height: 200px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    transition: all 0.3s ease;
  }

  .battle-bubble:hover {
    transform: scale(1.05);
    background: rgba(255, 0, 0, 0.2);
  }

  .stats {
    font-size: 0.9em;
  }

  input[type="range"] {
    width: 200px;
  }
</style>
