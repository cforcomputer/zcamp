<!-- new src/ActiveCamps.svelte -->
<script>
  import { filteredCamps } from "../server/campStore.js";
  import LocationTracker from "./LocationTracker.svelte";
  import { CAMP_PROBABILITY_FACTORS } from "../server/campStore.js";
  const { THREAT_SHIPS } = CAMP_PROBABILITY_FACTORS;

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
    if (kills.length === 0) return "N/A";

    const now = Date.now();
    const oldestKillTime = new Date(kills[0].killmail.killmail_time).getTime();

    const timeSpanMilliseconds = now - oldestKillTime;
    const timeSpanHours = Math.floor(timeSpanMilliseconds / (1000 * 60 * 60));
    const timeSpanMinutes = Math.floor(
      (timeSpanMilliseconds % (1000 * 60 * 60)) / (1000 * 60)
    );

    if (timeSpanHours > 0) {
      return `Detected ${timeSpanHours}h ${timeSpanMinutes}m ago`;
    } else {
      return `Detected ${timeSpanMinutes}m ago`;
    }
  }

  function getShipIcon(category) {
    const icons = {
      dictor: "🔲",
      hic: "⬛",
      ewar: "📡",
      tackle: "🔗",
      dps: "⚔️",
      smartbomb: "⚡",
    };
    return icons[category] || "🚀";
  }

  function getShipName(shipId) {
    return THREAT_SHIPS[shipId]?.name || `Ship ID ${shipId}`;
  }

  function getShipThreatColor(weight) {
    if (weight >= 40) return "#ff4444";
    if (weight >= 30) return "#ff8c00";
    if (weight >= 20) return "#ffd700";
    return "#90ee90";
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
  <div class="header">
    <h2>Active Gate Camps</h2>
    <LocationTracker />
  </div>
  <div class="camp-grid">
    {#each camps as camp}
      <button
        class="camp-card"
        type="button"
        data-state={camp.state}
        style="border-color: {getProbabilityColor(camp.probability)}"
        on:click={() => {
          const latestKill = camp.kills[camp.kills.length - 1];
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
              `https://zkillboard.com/related/${camp.systemId}/${formattedTime}/`,
              "_blank"
            );
          }
        }}
      >
        <div class="camp-header">
          <h3>{camp.stargateName}</h3>
          <div class="camp-indicators">
            {#if camp.type === "smartbomb"}
              <span class="camp-type smartbomb" title="Smartbomb Camp">⚡</span>
            {/if}
            <span
              class="probability"
              style="background-color: {getProbabilityColor(camp.probability)}"
            >
              {Math.round(camp.probability)}% Confidence
            </span>
          </div>
        </div>

        <div class="camp-stats">
          <div class="stat-row">
            <span class="stat-label">System:</span>
            <span class="stat-value"
              >{camp.kills[0]?.pinpoints?.celestialData?.solarsystemname ||
                camp.systemId}</span
            >
          </div>

          <div class="stat-row">
            <span class="stat-label">Duration:</span>
            <span class="stat-value">
              {#if camp.metrics?.campDuration}
                {Math.floor(camp.metrics.campDuration)}m active
                {#if camp.metrics.inactivityDuration > 0}
                  ({Math.floor(camp.metrics.inactivityDuration)}m since last
                  kill)
                {/if}
              {/if}
            </span>
          </div>

          <div class="stat-row">
            <span class="stat-label">Activity:</span>
            <span class="stat-value">
              {camp.kills.length} kills
              {#if camp.metrics?.podKills > 0}
                ({camp.metrics.podKills} pods)
              {/if}
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
              {#if camp.metrics?.partyMetrics}
                {camp.metrics.partyMetrics.characters} pilots
                {#if camp.metrics.partyMetrics.corporations > 0}
                  from {camp.metrics.partyMetrics.corporations} corps
                  {#if camp.metrics.partyMetrics.alliances > 0}
                    in {camp.metrics.partyMetrics.alliances} alliances
                  {/if}
                {/if}
              {:else if camp.composition}
                {camp.composition.activeCount}/{camp.composition.originalCount} active
                {#if camp.composition.killedCount > 0}
                  <span class="killed-count"
                    >(-{camp.composition.killedCount})</span
                  >
                {/if}
              {:else}
                Computing...
              {/if}
            </span>
          </div>

          {#if camp.metrics?.shipCounts}
            <div class="ship-composition">
              <div class="threat-ships">
                {#each Object.entries(camp.metrics.shipCounts) as [shipId, count]}
                  {#if THREAT_SHIPS[shipId]}
                    <span
                      class="ship-indicator"
                      style="background-color: {getShipThreatColor(
                        THREAT_SHIPS[shipId].weight
                      )}"
                      title="Threat Ship x{count}"
                    >
                      {getShipIcon(THREAT_SHIPS[shipId].category)}
                    </span>
                  {/if}
                {/each}
              </div>
            </div>
          {/if}

          {#if camp.state === "CRASHED"}
            <div class="crashed-banner">CRASHED</div>
          {/if}

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

  .camp-indicators {
    display: flex;
    align-items: center;
    gap: 0.5em;
  }

  .camp-type {
    padding: 0.3em;
    border-radius: 4px;
    font-size: 1.2em;
  }

  .camp-type.smartbomb {
    background-color: #ff4444;
  }

  .ship-composition {
    margin-top: 0.5em;
    padding: 0.5em;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 4px;
  }

  .threat-ships {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3em;
  }

  .ship-indicator {
    padding: 0.2em 0.4em;
    border-radius: 3px;
    font-size: 0.9em;
  }

  .killed-count {
    color: #ff4444;
    font-weight: bold;
  }

  .crashed-banner {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-15deg);
    background: #ff4444;
    color: white;
    padding: 0.5em 1em;
    font-weight: bold;
    border-radius: 4px;
    z-index: 1;
  }

  .camp-card[data-state="CRASHED"] {
    opacity: 0.7;
    filter: grayscale(0.7);
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

  .header {
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
