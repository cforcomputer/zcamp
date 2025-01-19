<script>
  import { onMount } from "svelte";
  import CampCrusher from "./CampCrusher.svelte";
  import socket from "./socket.js";
  import { CAMP_PROBABILITY_FACTORS, CAPSULE_ID } from "./constants.js";

  const { THREAT_SHIPS } = CAMP_PROBABILITY_FACTORS;

  let camps = [];

  // Reactive statement to sort camps whenever the array is updated
  $: camps = camps.sort((a, b) => b.probability - a.probability);

  onMount(() => {
    // Listen for initial camps data
    socket.on("initialCamps", (initialCamps) => {
      camps = initialCamps;
    });

    // Listen for camp updates
    socket.on("campUpdate", (updatedCamps) => {
      camps = updatedCamps;
    });

    // Clean up on component destroy
    return () => {
      socket.off("initialCamps");
      socket.off("campUpdate");
    };
  });

  // debug log
  $: {
    console.log("ActiveCamps component state:", {
      camps,
      count: camps.length,
    });
  }

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
</script>

<div class="p-4">
  <CampCrusher />
  <div class="flex justify-between items-center mb-4">
    <h2 class="text-white text-2xl font-bold">Active Gate Camps</h2>
  </div>

  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
    {#each camps as camp}
      <div class="group relative">
        <button
          type="button"
          class="w-full text-left bg-eve-primary border-2 rounded-lg p-3 transition-all duration-300 hover:scale-[1.02] relative z-10 hover:z-50 {camp.state ===
          'CRASHED'
            ? 'opacity-70 grayscale-[0.7]'
            : ''}"
          style="border-color: {getProbabilityColor(camp.probability)}"
          data-state={camp.state}
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
          <div class="flex justify-between items-center mb-3">
            <h3 class="text-white text-base font-bold truncate max-w-[200px]">
              {camp.stargateName}
            </h3>
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
              <button
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
          </div>

          <div class="space-y-1">
            <div class="flex justify-between py-0.5 border-b border-white/10">
              <span class="text-gray-400">System:</span>
              <span class="text-white">
                {camp.kills[0]?.pinpoints?.celestialData?.solarsystemname ||
                  camp.systemId}
              </span>
            </div>

            <div class="flex justify-between py-0.5 border-b border-white/10">
              <span class="text-gray-400">Duration:</span>
              <span class="text-white">
                {#if camp.firstKillTime}
                  {getTimeAgo(camp.firstKillTime).replace(" ago", "")}
                {:else}
                  0m active
                {/if}
              </span>
            </div>

            <div class="flex justify-between py-0.5 border-b border-white/10">
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

            <div class="flex justify-between py-0.5 border-b border-white/10">
              <span class="text-gray-400">Value:</span>
              <span class="text-eve-danger font-bold"
                >{formatValue(camp.totalValue)} ISK</span
              >
            </div>

            <div class="flex justify-between py-0.5 border-b border-white/10">
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

            <div class="flex justify-between py-0.5 border-b border-white/10">
              <span class="text-gray-400">Last Activity:</span>
              <span class="text-gray-400 italic"
                >{getTimeAgo(camp.lastKill)}</span
              >
            </div>
          </div>
        </button>

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

    {#if camps.length === 0}
      <p class="col-span-full text-center py-8 text-gray-400 italic">
        No active gate camps detected
      </p>
    {/if}
  </div>
</div>
