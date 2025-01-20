<!-- SalvageFields.svelte -->
<script>
  import { onMount } from "svelte";
  import socket from "./socket.js";
  import WreckFieldDialog from "./WreckFieldDialog.svelte";
  import {
    salvageFields,
    processNewKillmail,
    initializeSalvageFields,
  } from "./salvageStore.js";
  import { killmails } from "./store.js";

  let minValue = 0;
  let showTriangulatable = false;
  let selectedSystem = null;

  // Filter and sort systems
  $: filteredSystems = Array.from($salvageFields.entries())
    .filter(([, system]) => {
      if (system.totalValue < minValue) return false;
      if (showTriangulatable && !system.isTriangulatable) return false;
      return true;
    })
    .sort(([, a], [, b]) => b.totalValue - a.totalValue);

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

  function openWreckField(system, event) {
    event.stopPropagation();
    selectedSystem = system;
  }

  onMount(() => {
    // Initialize with existing killmails
    initializeSalvageFields($killmails);

    // Listen for new killmails
    socket.on("newKillmail", (killmail) => {
      console.log("New killmail received:", {
        id: killmail?.killID,
        isT2: killmail?.shipCategories?.victim?.tier === "T2",
        category: killmail?.shipCategories?.victim?.category,
      });
      processNewKillmail(killmail);
    });

    return () => {
      socket.off("newKillmail");
    };
  });
</script>

<div class="p-4">
  <div class="flex justify-between items-center mb-4">
    <h2 class="text-xl font-bold text-white">T2 Salvage Fields</h2>
    <div class="flex gap-4 items-center">
      <div class="flex items-center gap-2">
        <label for="min-value" class="text-gray-300 whitespace-nowrap">
          Min Value:
          <input
            id="min-value"
            type="number"
            class="ml-2 bg-eve-dark border border-eve-secondary/30 text-white px-3 py-1.5 rounded w-28 focus:border-eve-accent/50 focus:outline-none"
            bind:value={minValue}
          />
        </label>
      </div>
      <label for="triangulatable" class="flex items-center gap-2 text-gray-300">
        <input
          id="triangulatable"
          type="checkbox"
          bind:checked={showTriangulatable}
          class="form-checkbox text-eve-accent rounded bg-eve-dark border-eve-secondary/30"
        />
        Triangulatable Only
      </label>
    </div>
  </div>

  {#if filteredSystems.length === 0}
    <div class="text-gray-400 text-center py-4">No active T2 wrecks found</div>
  {:else}
    <div class="overflow-x-auto rounded-lg border border-eve-secondary/30">
      <table class="w-full">
        <thead>
          <tr class="bg-eve-dark/80 text-left">
            <th class="px-4 py-3 text-gray-300 font-medium">System</th>
            <th class="px-4 py-3 text-gray-300 font-medium"
              >Nearest Celestial</th
            >
            <th class="px-4 py-3 text-gray-300 font-medium">Wrecks</th>
            <th class="px-4 py-3 text-gray-300 font-medium">Value</th>
            <th class="px-4 py-3 text-gray-300 font-medium">Time Left</th>
            <th class="px-4 py-3 text-gray-300 font-medium">Triangulation</th>
          </tr>
        </thead>
        <tbody>
          {#each filteredSystems as [systemId, system]}
            {@const earliestExpiry = Math.min(
              ...system.wrecks.map((w) => w.expiryTime)
            )}
            {@const timeLeft = getTimeRemaining(earliestExpiry)}
            <tr
              class="border-t border-eve-secondary/10 bg-eve-dark/40 hover:bg-eve-dark/60 transition-colors cursor-pointer"
              on:click={(e) => openWreckField(system, e)}
            >
              <td class="px-4 py-3 text-white">{system.systemName}</td>
              <td class="px-4 py-3 text-gray-300">{system.nearestCelestial}</td>
              <td class="px-4 py-3 text-gray-300"
                >{system.wrecks.length} wrecks</td
              >
              <td class="px-4 py-3 text-eve-accent"
                >{formatValue(system.totalValue)}</td
              >
              <td class="px-4 py-3 relative">
                <div class="text-gray-300">{timeLeft}m</div>
                <div
                  class="absolute bottom-0 left-0 h-1 transition-all {getTimeColor(
                    timeLeft
                  )}"
                  style="width: {(timeLeft / 120) * 100}%"
                ></div>
              </td>
              <td class="px-4 py-3">
                <span
                  class="inline-flex items-center justify-center w-6 h-6 rounded-full {system.isTriangulatable
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-red-500/20 text-red-400'}"
                >
                  {system.isTriangulatable ? "✓" : "×"}
                </span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

{#if selectedSystem}
  <WreckFieldDialog
    wrecks={selectedSystem.wrecks}
    totalValue={selectedSystem.totalValue}
    onClose={() => (selectedSystem = null)}
  />
{/if}
