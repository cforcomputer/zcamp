<script>
  import { onMount, onDestroy } from "svelte";
  import CampCrusher from "./CampCrusher.svelte";
  import campManager, { activeCamps } from "./campManager.js";
  import { CAMP_PROBABILITY_FACTORS, CAPSULE_ID } from "./constants.js";
  import ContextMenu from "./ContextMenu.svelte";
  import PinnedSystemsList from "./PinnedSystemsList.svelte"; // New import

  const { THREAT_SHIPS } = CAMP_PROBABILITY_FACTORS;

  let viewMode = "cards"; // "cards" or "chart"
  let isLoading = true;
  let mounted = false;
  let isLoggedIn = false; // New state for login status
  let pinnedSystemsComponent;
  let expandedCompositionCards = new Set();

  function toggleCompositionExpansion(e, campId) {
    e.stopPropagation();
    if (expandedCompositionCards.has(campId)) {
      expandedCompositionCards.delete(campId);
    } else {
      expandedCompositionCards.add(campId);
    }
    expandedCompositionCards = expandedCompositionCards; // Trigger reactivity
  }

  // Function to get accurate ship counts by counting unique pilot-ship combinations
  function getAccurateShipCounts(camp) {
    // Map to store unique character-ship combinations
    const uniqueAttackerShips = new Map();

    // Process all kills
    camp.kills.forEach((kill) => {
      kill.killmail.attackers.forEach((attacker) => {
        if (
          attacker.character_id &&
          attacker.ship_type_id &&
          attacker.ship_type_id !== CAPSULE_ID
        ) {
          // Create a unique key combining character and ship
          const key = `${attacker.character_id}-${attacker.ship_type_id}`;

          // Only count each character-ship combination once
          uniqueAttackerShips.set(key, {
            characterId: attacker.character_id,
            shipTypeId: attacker.ship_type_id,
          });
        }
      });
    });

    // Count unique ships by type
    const shipCounts = {};

    for (const { shipTypeId } of uniqueAttackerShips.values()) {
      shipCounts[shipTypeId] = (shipCounts[shipTypeId] || 0) + 1;
    }

    return shipCounts;
  }

  // Reactive statement to sort camps whenever the array is updated
  // Reactive subscription to activeCamps store
  // filter out camps with 0% probability.
  $: camps = $activeCamps
    .filter((camp) => camp.probability > 0)
    .sort((a, b) => b.probability - a.probability);

  $: if (mounted && $activeCamps) {
    isLoading = false;
  }

  onMount(async () => {
    // Check if user is logged in
    try {
      const response = await fetch("/api/session", {
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        isLoggedIn = !!data.user;
      }
    } catch (error) {
      console.error("Error checking session:", error);
    }

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

  async function pinSystem(camp) {
    if (!isLoggedIn) return;

    try {
      const response = await fetch("/api/pinned-systems", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          system_id: camp.systemId,
          stargate_name: camp.stargateName,
        }),
      });

      if (response.ok) {
        const data = await response.json();

        // If we get a new pin back (not just "already pinned" message)
        if (data.id) {
          // Update the PinnedSystemsList UI immediately
          pinnedSystemsComponent?.pinSystem({
            id: data.id,
            user_id: data.user_id,
            system_id: camp.systemId,
            stargate_name: camp.stargateName,
            activeCamp: camp,
            probability: camp.probability,
          });
        }
      }
    } catch (error) {
      console.error("Error pinning system:", error);
    }
  }

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

  import { getValidAccessToken } from "./tokenManager.js";

  async function setDestination(systemId, clearOthers = true) {
    try {
      const accessToken = await getValidAccessToken();

      const result = await fetch(
        `https://esi.evetech.net/latest/ui/autopilot/waypoint/?add_to_beginning=false&clear_other_waypoints=${clearOthers}&datasource=tranquility&destination_id=${systemId}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!result.ok) {
        if (result.status === 401) {
          // Token issue - trigger session expired event
          window.dispatchEvent(new CustomEvent("session-expired"));
        }
        throw new Error(`Failed to set destination: ${result.status}`);
      }

      return true;
    } catch (error) {
      console.error("Error setting destination:", error);
      return false;
    }
  }

  // Updated to add Pin option
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

    // Base options
    const options = [
      {
        label: "Set Destination",
        action: () => setDestination(camp.systemId, true),
      },
      {
        label: "Add Waypoint",
        action: () => setDestination(camp.systemId, false),
      },
    ];

    // Add pin option if logged in
    if (isLoggedIn) {
      options.push({
        label: "Pin System",
        action: () => pinSystem(camp),
      });
    }

    contextMenu = {
      show: true,
      x,
      y,
      options,
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
  <!-- Add PinnedSystemsList component -->
  <PinnedSystemsList bind:this={pinnedSystemsComponent} {isLoggedIn} />

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
              <!-- Title Bar - Improved contrast -->
              <div
                class="bg-eve-dark/90 bg-gradient-to-r from-eve-secondary/90 to-eve-secondary/40 p-3 border-t-2"
                style="border-color: {getProbabilityColor(camp.probability)}"
              >
                <h3 class="text-white text-base font-bold truncate">
                  {camp.kills[0]?.pinpoints?.celestialData?.solarsystemname ||
                    camp.systemId}
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

                <!-- Camp Details - Reordered -->
                <div class="space-y-1">
                  <div
                    class="flex justify-between py-0.5 border-b border-white/10"
                  >
                    <span class="text-gray-400">Stargate:</span>
                    <span class="text-white">
                      {camp.stargateName}
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

                  <!-- Last Activity (moved up, blue text) -->
                  <div
                    class="flex justify-between py-0.5 border-b border-white/10"
                  >
                    <span class="text-gray-400">Last Activity:</span>
                    <span class="text-eve-accent italic">
                      {getTimeAgo(camp.lastKill)}
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

                  <!-- Moved to bottom of card -->
                  <div
                    class="flex justify-between py-0.5 border-b border-white/10"
                  >
                    <span class="text-gray-400">Comp:</span>
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

                  {#if camp.state === "CRASHED"}
                    <div class="text-center py-1 bg-eve-danger/50 rounded mt-1">
                      CRASHED
                    </div>
                  {/if}
                </div>
              </button>

              <!-- Ships section - Always visible, changes between "Ships" and "Close" -->
              {#if camp.metrics?.shipCounts}
                <div class="mt-1 bg-eve-secondary/80 rounded">
                  <!-- Button Bar - Always visible, left aligned -->
                  <div class="flex items-center h-10 px-3">
                    <button
                      class="text-eve-accent hover:text-eve-accent/80 px-3 py-1 bg-eve-dark/80 rounded flex items-center gap-1"
                      on:click={(e) => toggleCompositionExpansion(e, camp.id)}
                      aria-label={expandedCompositionCards.has(camp.id)
                        ? "Hide ship details"
                        : "Show ship details"}
                    >
                      <span
                        >{expandedCompositionCards.has(camp.id)
                          ? "Close"
                          : "Ships"}</span
                      >
                      <span class="text-xs"
                        >{expandedCompositionCards.has(camp.id)
                          ? "▲"
                          : "▼"}</span
                      >
                      {#if !expandedCompositionCards.has(camp.id)}
                        <span
                          class="ml-1 px-1.5 py-0.5 bg-eve-accent/20 rounded-full text-xs"
                        >
                          {Object.keys(getAccurateShipCounts(camp)).length}
                        </span>
                      {/if}
                    </button>
                  </div>

                  <!-- Expanded content shown below the button -->
                  {#if expandedCompositionCards.has(camp.id)}
                    <div
                      class="p-3 max-h-48 overflow-y-auto border-t border-eve-accent/10"
                    >
                      <div class="flex flex-col gap-1">
                        {#each Object.entries(getAccurateShipCounts(camp)) as [shipId, count]}
                          {@const shipData = camp.kills
                            .flatMap((k) => k.shipCategories?.attackers || [])
                            .find((ship) => ship.shipTypeId == shipId)}
                          <div
                            class="flex justify-between items-center border-b border-eve-accent/10 py-1"
                          >
                            <span class="text-white"
                              >{shipData?.name || `Ship #${shipId}`}</span
                            >
                            <span class="text-eve-accent">×{count}</span>
                          </div>
                        {/each}
                      </div>
                    </div>
                  {/if}
                </div>
              {/if}
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
                <td class="px-4 py-2 text-eve-accent">
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
