<script>
  import { onMount, onDestroy } from "svelte";
  import CampCrusher from "./CampCrusher.svelte";
  import campManager, { activeCamps } from "./campManager.js";
  import { CAMP_PROBABILITY_FACTORS, CAPSULE_ID } from "./constants.js";
  import ContextMenu from "./ContextMenu.svelte";

  const { THREAT_SHIPS } = CAMP_PROBABILITY_FACTORS;

  let viewMode = "cards"; // "cards" or "chart"
  let isLoading = true;
  let mounted = false;

  // Reactive statement to sort camps whenever the array is updated
  // Reactive subscription to activeCamps store
  $: camps = $activeCamps.sort((a, b) => b.probability - a.probability);

  $: if (mounted && $activeCamps) {
    isLoading = false;
  }

  onMount(() => {
    mounted = true;
    campManager.startUpdates();
    return () => {
      mounted = false;
      campManager.cleanup();
    };
  });

  onDestroy(() => {
    campManager.cleanup();
  });

  function formatValue(value) {
    if (!value) return "0 ISK";
    if (value >= 1000000000) {
      return (value / 1000000000).toFixed(2) + "B";
    }
    if (value >= 1000000) {
      return (value / 1000000).toFixed(2) + "M";
    }
    return (value / 1000).toFixed(2) + "K";
  }

  function getTimeAgo(timestamp) {
    if (!timestamp) return "unknown";
    const now = new Date().getTime();
    const then = new Date(timestamp).getTime();
    const minutes = Math.floor((now - then) / (1000 * 60));

    if (minutes < 1) return "just now";
    if (minutes === 1) return "1 minute ago";
    return `${minutes} minutes ago`;
  }

  // Add context menu state
  let contextMenu = {
    show: false,
    x: 0,
    y: 0,
    options: [],
  };

  // Add setDestination function
  async function setDestination(systemId, clearOthers = true) {
    try {
      const response = await fetch("/api/session", {
        credentials: "include",
      });
      const data = await response.json();

      if (!data.user?.access_token) {
        console.error("User not authenticated with EVE SSO");
        return;
      }

      const result = await fetch(
        `https://esi.evetech.net/latest/ui/autopilot/waypoint/?add_to_beginning=false&clear_other_waypoints=${clearOthers}&datasource=tranquility&destination_id=${systemId}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${data.user.access_token}`,
          },
        }
      );

      if (!result.ok) {
        throw new Error("Failed to set destination");
      }
    } catch (error) {
      console.error("Error setting destination:", error);
    }
  }

  // Add context menu handler
  function handleContextMenu(event, camp) {
    event.preventDefault();

    // Get the container element's position
    const container =
      event.currentTarget.closest(".eve-card") ||
      event.currentTarget.closest("table");
    const containerBounds = container.getBoundingClientRect();

    // Calculate position relative to the container
    const x = event.clientX - containerBounds.left;
    const y = event.clientY - containerBounds.top;

    contextMenu = {
      show: true,
      x,
      y,
      options: [
        {
          label: "Set Destination",
          action: () => setDestination(camp.systemId, true),
        },
        {
          label: "Add Waypoint",
          action: () => setDestination(camp.systemId, false),
        },
      ],
    };
  }

  function handleMenuSelect(event) {
    const option = event.detail;
    option.action();
    contextMenu.show = false;
  }

  function getProbabilityColor(probability) {
    if (probability >= 80) return "#ff4444";
    if (probability >= 60) return "#ff8c00";
    if (probability >= 40) return "#ffd700";
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

  function getShipThreatColor(weight) {
    if (weight >= 40) return "#ff4444";
    if (weight >= 30) return "#ff8c00";
    if (weight >= 20) return "#ffd700";
    return "#90ee90";
  }

  function formatProbabilityLog(log) {
    if (!log || !Array.isArray(log)) {
      return "No probability log available.";
    }

    return log
      .map((entry) => {
        if (typeof entry === "object") {
          return JSON.stringify(entry, null, 2);
        }
        return String(entry);
      })
      .join("\n");
  }

  function openCampHistory(camp) {
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
  }
</script>

<div class="p-4">
  {#if isLoading}
    <div class="text-center py-8">
      <p class="text-gray-400">Loading camps...</p>
    </div>
  {:else if mounted}
    <div class="flex justify-center mb-8">
      <CampCrusher />
    </div>

    <div class="flex justify-between items-center mb-4">
      <h2 class="text-white text-2xl font-bold">Active Gate Camps</h2>
      <div class="flex gap-2">
        <button
          class="px-4 py-2 bg-eve-secondary rounded {viewMode === 'cards'
            ? 'text-eve-accent'
            : 'text-gray-400'}"
          on:click={() => (viewMode = "cards")}
        >
          Card View
        </button>
        <button
          class="px-4 py-2 bg-eve-secondary rounded {viewMode === 'chart'
            ? 'text-eve-accent'
            : 'text-gray-400'}"
          on:click={() => (viewMode = "chart")}
        >
          Chart View
        </button>
      </div>
    </div>

    {#if camps.length === 0}
      <p class="text-center py-8 text-gray-400 italic">Syncing camps...</p>
    {:else if viewMode === "cards"}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {#each camps as camp}
          <div class="group relative">
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div
              class="overflow-hidden rounded-lg {camp.state === 'CRASHED'
                ? 'opacity-70 grayscale-[0.7]'
                : ''}"
              on:contextmenu|preventDefault={(e) => handleContextMenu(e, camp)}
            >
              <!-- Title Bar -->
              <div
                class="bg-eve-secondary p-3 border-t-2"
                style="border-color: {getProbabilityColor(camp.probability)}"
              >
                <h3 class="text-white text-base font-bold truncate">
                  {camp.stargateName}
                </h3>
              </div>

              <!-- Card Content -->
              <button
                type="button"
                class="w-full text-left bg-eve-primary p-3"
                on:click={() => openCampHistory(camp)}
                on:keypress={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    openCampHistory(camp);
                  }
                }}
              >
                <!-- Probability and Actions Row -->
                <div class="flex justify-between items-center mb-3">
                  <div class="flex items-center gap-2">
                    {#if camp.type === "smartbomb"}
                      <span
                        class="px-2 py-1 bg-blue-600 rounded text-xl"
                        title="Smartbomb Camp">⚡</span
                      >
                    {/if}
                    <span
                      class="px-2 py-1 rounded text-black font-bold text-sm"
                      style="background-color: {getProbabilityColor(
                        camp.probability
                      )}"
                    >
                      {Math.round(camp.probability)}% Confidence
                    </span>
                  </div>
                  <button
                    type="button"
                    class="px-3 py-1 bg-eve-accent text-black font-medium rounded hover:bg-eve-accent/80 transition-colors"
                    title="View Latest Kill"
                    on:click|stopPropagation={(e) => {
                      e.preventDefault();
                      const latestKill = camp.kills[camp.kills.length - 1];
                      if (latestKill) {
                        window.open(
                          `https://zkillboard.com/kill/${latestKill.killID}/`,
                          "_blank"
                        );
                      }
                    }}
                  >
                    Last Kill
                  </button>
                </div>

                <!-- Camp Details -->
                <div class="space-y-1">
                  <div
                    class="flex justify-between py-0.5 border-b border-white/10"
                  >
                    <span class="text-gray-400">System:</span>
                    <span class="text-white">
                      {camp.kills[0]?.pinpoints?.celestialData
                        ?.solarsystemname || camp.systemId}
                    </span>
                  </div>

                  <div
                    class="flex justify-between py-0.5 border-b border-white/10"
                  >
                    <span class="text-gray-400">Duration:</span>
                    <span class="text-white">
                      {#if camp.kills && camp.kills.length > 0}
                        {(() => {
                          const firstKillTime = Math.min(
                            ...camp.kills.map((k) =>
                              new Date(k.killmail.killmail_time).getTime()
                            )
                          );
                          const duration = Math.floor(
                            (Date.now() - firstKillTime) / (1000 * 60)
                          );
                          return `${duration}m active`;
                        })()}
                      {:else}
                        0m active
                      {/if}
                    </span>
                  </div>

                  <div
                    class="flex justify-between py-0.5 border-b border-white/10"
                  >
                    <span class="text-gray-400">Activity:</span>
                    <span class="text-white flex items-center">
                      {camp.kills.filter(
                        (k) => k.killmail.victim.ship_type_id !== CAPSULE_ID
                      ).length} kills
                      {#if camp.metrics?.podKills > 0}
                        ({camp.metrics.podKills} pods)
                      {/if}
                      {#if hasInterdictor(camp.kills)}
                        <span
                          class="ml-2 cursor-help"
                          title="Interdictor/HICTOR present">⚠️</span
                        >
                      {/if}
                    </span>
                  </div>

                  <div
                    class="flex justify-between py-0.5 border-b border-white/10"
                  >
                    <span class="text-gray-400">Value:</span>
                    <span class="text-eve-danger font-bold"
                      >{formatValue(camp.totalValue)} ISK</span
                    >
                  </div>

                  <div
                    class="flex justify-between py-0.5 border-b border-white/10"
                  >
                    <span class="text-gray-400">Composition:</span>
                    <span class="text-white">
                      {#if camp.metrics?.partyMetrics}
                        {camp.metrics.partyMetrics.characters} pilots
                        {#if camp.metrics.partyMetrics.corporations > 0}
                          from {camp.metrics.partyMetrics.corporations} corps
                          {#if camp.metrics.partyMetrics.alliances > 0}
                            in {camp.metrics.partyMetrics.alliances} alliances
                          {/if}
                        {/if}
                      {:else if camp.composition}
                        {camp.composition.activeCount}/{camp.composition
                          .originalCount} active
                        {#if camp.composition.killedCount > 0}
                          <span class="text-eve-danger font-bold"
                            >(-{camp.composition.killedCount})</span
                          >
                        {/if}
                      {:else}
                        Computing...
                      {/if}
                    </span>
                  </div>

                  {#if camp.metrics?.shipCounts}
                    <div class="mt-1 p-2 bg-eve-secondary rounded">
                      <div class="flex flex-wrap gap-1">
                        {#each Object.entries(camp.metrics.shipCounts) as [shipId, count]}
                          {#if THREAT_SHIPS[shipId]}
                            <span
                              class="px-2 py-1 rounded text-sm"
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
                    <div class="text-center py-1 bg-eve-danger/50 rounded mt-1">
                      CRASHED
                    </div>
                  {/if}

                  <div
                    class="flex justify-between py-0.5 border-b border-white/10"
                  >
                    <span class="text-gray-400">Last Activity:</span>
                    <span class="text-gray-400 italic"
                      >{getTimeAgo(camp.lastKill)}</span
                    >
                  </div>
                </div>
              </button>
            </div>

            <!-- Probability Log Tooltip -->
            <div
              class="hidden group-hover:block absolute top-full left-0 right-0 z-50 mt-1"
            >
              <pre
                class="bg-eve-primary text-white p-3 rounded border border-eve-accent/20 font-mono text-xs leading-relaxed shadow-lg max-w-[500px] max-h-[400px] overflow-y-auto">
                  {formatProbabilityLog(camp.probabilityLog)}
                </pre>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <!-- Chart View -->
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead class="bg-eve-secondary">
            <tr>
              <th class="px-4 py-2 text-left">Location</th>
              <th class="px-4 py-2 text-left">Status</th>
              <th class="px-4 py-2 text-left">Activity</th>
              <th class="px-4 py-2 text-left">Value</th>
              <th class="px-4 py-2 text-left">Composition</th>
              <th class="px-4 py-2 text-left">Last Activity</th>
            </tr>
          </thead>
          <tbody>
            {#each camps as camp}
              <tr
                class="border-b border-eve-secondary/30 hover:bg-eve-secondary/20 cursor-pointer"
                on:click={() => openCampHistory(camp)}
                on:contextmenu|preventDefault={(e) =>
                  handleContextMenu(e, camp)}
                on:keypress={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    openCampHistory(camp);
                  }
                }}
                role="button"
                tabindex="0"
              >
                <td class="px-4 py-2">{camp.stargateName}</td>
                <td class="px-4 py-2">
                  <span
                    class="px-2 py-1 rounded text-black text-sm"
                    style="background-color: {getProbabilityColor(
                      camp.probability
                    )}"
                  >
                    {Math.round(camp.probability)}%
                  </span>
                </td>
                <td class="px-4 py-2">
                  {camp.kills.length} kills
                  {#if camp.metrics?.podKills > 0}
                    ({camp.metrics.podKills} pods)
                  {/if}
                </td>
                <td class="px-4 py-2 text-eve-danger">
                  {formatValue(camp.totalValue)}
                </td>
                <td class="px-4 py-2">
                  {#if camp.metrics?.partyMetrics}
                    {camp.metrics.partyMetrics.characters} pilots
                    {#if camp.metrics.partyMetrics.corporations > 0}
                      ({camp.metrics.partyMetrics.corporations} corps)
                    {/if}
                  {:else if camp.composition}
                    {camp.composition.activeCount} pilots
                  {:else}
                    Computing...
                  {/if}
                </td>
                <td class="px-4 py-2 text-gray-400">
                  {getTimeAgo(camp.lastKill)}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>

<ContextMenu
  show={contextMenu.show}
  x={contextMenu.x}
  y={contextMenu.y}
  options={contextMenu.options}
  on:select={handleMenuSelect}
/>

<style>
  :global(.killmail-section) {
    height: calc(100vh - 150px);
    overflow-y: auto;
  }
</style>
