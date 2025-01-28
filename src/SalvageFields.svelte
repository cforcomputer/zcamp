<script>
  import { onMount, onDestroy } from "svelte";
  import {
    filteredSalvageFields,
    initializeSalvage,
    cleanup,
  } from "./salvage.js";
  import { killmails, settings } from "./settingsStore.js";
  import WreckFieldDialog from "./WreckFieldDialog.svelte";
  import { createEventDispatcher } from "svelte";
  import ContextMenu from "./ContextMenu.svelte";

  const dispatch = createEventDispatcher();

  let minValue = 0;
  let showTriangulatable = false;
  let selectedSystem = null;
  let cleanupInterval;
  let showSecurityDropdown = false;

  // Context menu state
  let contextMenu = {
    show: false,
    x: 0,
    y: 0,
    options: [],
  };

  // Filter and sort systems
  $: filteredSystems = $filteredSalvageFields
    .filter(([, system]) => {
      if (system.totalValue < minValue) return false;
      if (showTriangulatable && !system.isTriangulatable) return false;
      return true;
    })
    .sort(([, a], [, b]) => b.totalValue - a.totalValue);

  function formatValue(value) {
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    return `${(value / 1000).toFixed(1)}K`;
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
    dispatch("openWreckField", {
      wrecks: system.wrecks,
      totalValue: system.totalValue,
      nearestCelestial: {
        type: "station",
        name: system.nearestCelestial,
      },
    });
  }

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

  function handleContextMenu(event, systemId) {
    event.preventDefault();
    event.stopPropagation();

    const row = event.currentTarget;
    const tableBounds = row.closest("table").getBoundingClientRect();

    const x = event.clientX - tableBounds.left;
    const y = event.clientY - tableBounds.top;

    contextMenu = {
      show: true,
      x,
      y,
      options: [
        {
          label: "Set Destination",
          action: () => setDestination(systemId, true),
        },
        {
          label: "Add Waypoint",
          action: () => setDestination(systemId, false),
        },
      ],
    };
  }

  function handleMenuSelect(event) {
    const option = event.detail;
    option.action();
    contextMenu.show = false;
  }

  onMount(() => {
    cleanupInterval = initializeSalvage($killmails);
  });

  onDestroy(() => {
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
    }
    cleanup();
  });
</script>

<div class="p-4">
  <div class="flex justify-between items-center mb-4">
    <h2 class="text-xl font-bold text-white">T2 Salvage Fields</h2>
    <div class="flex gap-4 items-center">
      <div class="relative">
        <button
          class="px-3 py-1.5 bg-eve-dark border border-eve-secondary/30 text-white rounded flex items-center gap-2"
          on:click={() => (showSecurityDropdown = !showSecurityDropdown)}
        >
          Security Status
          <span class="text-xs opacity-50">▼</span>
        </button>

        {#if showSecurityDropdown}
          <div
            class="absolute right-0 top-full mt-1 bg-eve-dark border border-eve-secondary/30 rounded p-2 z-10 min-w-[150px] shadow-lg"
            on:mouseleave={() => (showSecurityDropdown = false)}
          >
            {#each Object.entries($settings.location_types) as [type, enabled]}
              <label
                class="flex items-center px-2 py-1.5 hover:bg-eve-secondary/20"
              >
                <input
                  type="checkbox"
                  class="form-checkbox"
                  bind:checked={$settings.location_types[type]}
                />
                <span class="ml-2 text-white capitalize">{type}</span>
              </label>
            {/each}
          </div>
        {/if}
      </div>

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
            <th class="px-4 py-3 text-gray-300 font-medium">Security</th>
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
              on:contextmenu={(e) => handleContextMenu(e, systemId)}
              on:keydown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  openWreckField(system, e);
                }
              }}
              tabindex="0"
              role="button"
            >
              <td class="px-4 py-3 text-white">{system.systemName}</td>
              <td class="px-4 py-3 text-gray-300">{system.nearestCelestial}</td>
              <td class="px-4 py-3 text-gray-300 capitalize"
                >{system.securityType || "unknown"}</td
              >
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
                />
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

<ContextMenu
  show={contextMenu.show}
  x={contextMenu.x}
  y={contextMenu.y}
  options={contextMenu.options}
  on:select={handleMenuSelect}
/>

<style>
  .form-checkbox {
    @apply rounded border-eve-accent/50 text-eve-accent focus:ring-eve-accent;
  }
</style>
