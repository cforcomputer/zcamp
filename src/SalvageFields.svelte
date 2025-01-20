<script>
  import { killmails } from "./store.js";
  import { SALVAGE_VALUES } from "./constants.js";

  $: systemWrecks = new Map();

  $: {
    const now = Date.now();
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;
    systemWrecks.clear();

    $killmails.forEach((killmail) => {
      const killTime = new Date(killmail.killmail.killmail_time).getTime();
      if (killTime < twoHoursAgo) return;

      // Check if it's a T2 kill
      if (killmail.shipCategories?.victim?.tier === "T2") {
        const systemId = killmail.killmail.solar_system_id;
        const systemName =
          killmail.pinpoints?.celestialData?.solarsystemname ||
          `System ${systemId}`;
        const category = killmail.shipCategories.victim.category;
        const estimatedValue =
          SALVAGE_VALUES[category] || SALVAGE_VALUES.unknown;
        const expiryTime = killTime + 2 * 60 * 60 * 1000;

        if (!systemWrecks.has(systemId)) {
          systemWrecks.set(systemId, {
            systemName,
            wrecks: [],
            totalValue: 0,
          });
        }

        const system = systemWrecks.get(systemId);
        system.wrecks.push({
          shipName: killmail.shipCategories.victim.name,
          category,
          estimatedValue,
          expiryTime,
        });
        system.totalValue += estimatedValue;
      }
    });
  }

  function formatValue(value) {
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    return `${(value / 1_000).toFixed(1)}K`;
  }

  function getTimeRemaining(expiryTime) {
    const now = Date.now();
    return Math.max(0, Math.floor((expiryTime - now) / 1000 / 60));
  }

  function getTimeColor(minutes) {
    if (minutes < 15) return "bg-red-500";
    if (minutes < 30) return "bg-orange-500";
    return "bg-green-500";
  }
</script>

<div class="p-4 space-y-4">
  <h2 class="text-xl font-bold text-white mb-4">T2 Salvage Fields</h2>

  {#if systemWrecks.size === 0}
    <div class="text-gray-400 text-center py-8">No active T2 wrecks found</div>
  {:else}
    <div class="space-y-4">
      {#each Array.from(systemWrecks).sort(([, a], [, b]) => b.totalValue - a.totalValue) as [systemId, system]}
        {@const earliestExpiry = Math.min(
          ...system.wrecks.map((w) => w.expiryTime)
        )}
        {@const timeLeft = getTimeRemaining(earliestExpiry)}
        <div
          class="bg-eve-secondary/40 rounded-lg p-4 relative overflow-hidden"
        >
          <!-- Progress bar for time remaining -->
          <div
            class="absolute bottom-0 left-0 h-1 {getTimeColor(timeLeft)}"
            style="width: {(timeLeft / 120) * 100}%"
          ></div>

          <div class="flex justify-between items-center">
            <div>
              <h3 class="text-white font-bold">{system.systemName}</h3>
              <div class="text-sm text-gray-300">
                {system.wrecks.length} T2 {system.wrecks.length === 1
                  ? "wreck"
                  : "wrecks"}
              </div>
            </div>

            <div class="text-right">
              <div class="text-eve-accent font-mono">
                Est. {formatValue(system.totalValue)}
              </div>
              <div
                class="text-sm {timeLeft < 30
                  ? 'text-red-400'
                  : 'text-gray-400'}"
              >
                {timeLeft}m remaining
              </div>
            </div>
          </div>

          <!-- Wreck details -->
          <div class="mt-2 text-sm text-gray-400">
            {#each system.wrecks as wreck}
              <div class="inline-block mr-2">
                {wreck.shipName}
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
