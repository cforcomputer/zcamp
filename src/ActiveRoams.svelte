<!-- ActiveRoams.svelte -->
<script>
  import { onMount, onDestroy } from "svelte";
  import roamManager, { activeRoams } from "./roamManager.js";
  import ContextMenu from "./ContextMenu.svelte";
  import socket from "./socket.js";

  let viewMode = "cards"; // "cards" or "chart"

  $: roams = $activeRoams;

  let isLoading = true;
  let mounted = false;

  onMount(() => {
    mounted = true;
    roamManager.startUpdates();
    return () => {
      mounted = false;
      roamManager.cleanup();
    };
  });

  $: if (mounted && $activeRoams) {
    isLoading = false;
  }

  onDestroy(() => {
    roamManager.cleanup();
  });

  function getRoamDuration(roam) {
    if (!roam.kills?.length) return "unknown";
    const firstKillTime = new Date(
      roam.kills[0].killmail.killmail_time
    ).getTime();
    const minutes = Math.floor((Date.now() - firstKillTime) / (1000 * 60));
    if (minutes < 1) return "just started";
    if (minutes === 1) return "1 minute";
    return `${minutes} minutes`;
  }

  function formatValue(value) {
    if (!value) return "0 ISK";
    if (value >= 1000000000) return (value / 1000000000).toFixed(2) + "B";
    if (value >= 1000000) return (value / 1000000).toFixed(2) + "M";
    return (value / 1000).toFixed(2) + "K";
  }

  function getUniqueRecentSystems(systems) {
    if (!systems?.length) return [];
    const systemMap = new Map();
    systems.forEach((system) => {
      if (
        !systemMap.has(system.id) ||
        new Date(system.time) > new Date(systemMap.get(system.id).time)
      ) {
        systemMap.set(system.id, system);
      }
    });
    return Array.from(systemMap.values())
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 5);
  }

  function getTimeAgo(timestamp) {
    if (!timestamp) return "unknown";
    const minutes = Math.floor(
      (Date.now() - new Date(timestamp).getTime()) / (1000 * 60)
    );
    if (minutes < 1) return "just now";
    if (minutes === 1) return "1 minute ago";
    return `${minutes} minutes ago`;
  }

  function getSystemCount(roam) {
    return new Set(roam.systems?.map((s) => s.id) || []).size;
  }

  function getRoamColor(roam) {
    const systemCount = getSystemCount(roam);
    const memberCount = roam.members?.length || 0;
    if (systemCount > 10 || memberCount > 20) return "#ff4444";
    if (systemCount > 5 || memberCount > 10) return "#ff8c00";
    if (systemCount > 2 || memberCount > 5) return "#ffd700";
    return "#90ee90";
  }

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

  // Component: ActiveRoams.svelte

  function handleContextMenu(event, roam) {
    event.preventDefault();

    // Get the container element based on view mode
    const container =
      viewMode === "cards"
        ? event.currentTarget.closest(".eve-card")
        : event.currentTarget.closest("tr");

    if (!container) return;

    // Get the parent container - either the grid or table container
    const parentContainer =
      viewMode === "cards"
        ? container.closest(".grid")
        : container.closest(".overflow-x-auto");

    if (!parentContainer) return;

    // Calculate scroll offsets
    const scrollLeft =
      window.pageXOffset || document.documentElement.scrollLeft;
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

    // Account for table's scroll position if in chart view
    const tableScrollLeft =
      viewMode === "chart" ? parentContainer.scrollLeft : 0;

    // Calculate position relative to the viewport
    const x = event.clientX + scrollLeft - tableScrollLeft;
    const y = event.clientY + scrollTop;

    // Get the main container bounds (the .p-4 div)
    const mainContainer = container.closest(".p-4");
    const mainContainerBounds = mainContainer.getBoundingClientRect();

    // Calculate position relative to the main container
    const relativeX = x - mainContainerBounds.left - scrollLeft;
    const relativeY = y - mainContainerBounds.top - scrollTop;

    // Check if menu would go off the right edge of the container
    const menuWidth = 200; // Approximate width of your context menu
    const adjustedX = Math.min(
      relativeX,
      mainContainerBounds.width - menuWidth
    );

    contextMenu = {
      show: true,
      x: adjustedX,
      y: relativeY,
      options: [
        {
          label: "Set Destination",
          action: () => setDestination(roam.lastSystem.id, true),
        },
        {
          label: "Add Waypoint",
          action: () => setDestination(roam.lastSystem.id, false),
        },
      ],
    };

    // Add click outside listener to close menu
    const handleClickOutside = (e) => {
      if (!e.target.closest(".context-menu")) {
        contextMenu.show = false;
        document.removeEventListener("click", handleClickOutside);
      }
    };

    // Small timeout to prevent immediate closure
    setTimeout(() => {
      document.addEventListener("click", handleClickOutside);
    }, 0);
  }
  function handleMenuSelect(event) {
    const option = event.detail;
    option.action();
    contextMenu.show = false;
  }
</script>

<div class="p-4">
  {#if isLoading}
    <div class="text-center py-8">
      <p class="text-gray-400">Loading roams...</p>
    </div>
  {:else if mounted}
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-2xl font-bold text-eve-accent">Active Gangs</h2>
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

    {#if roams.length === 0}
      <p class="col-span-full text-center py-8 text-gray-400 italic">
        Syncing roams...
      </p>
    {:else if viewMode === "cards"}
      <div
        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
      >
        {#each roams as roam (roam.id)}
          <button
            class="eve-card hover:scale-102 transition-transform duration-200 text-left w-full cursor-pointer"
            type="button"
            on:click={() => {
              const latestKill = roam.kills[roam.kills.length - 1];
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
                  `https://zkillboard.com/related/${roam.lastSystem.id}/${formattedTime}/`,
                  "_blank"
                );
              }
            }}
            on:contextmenu|preventDefault={(e) => handleContextMenu(e, roam)}
          >
            <div class="border-b border-eve-accent/20 pb-2">
              <h3 class="text-xl font-semibold text-white">
                {roam.lastSystem?.name || "Unknown System"}
              </h3>
              <span class="text-gray-400 text-sm"
                >{roam.members?.length || 0} pilots roaming for {getRoamDuration(
                  roam
                )}</span
              >
            </div>

            <div class="space-y-2 py-2">
              <div class="flex justify-between">
                <span class="text-gray-400">Kills:</span>
                <span class="text-white">{roam.kills?.length || 0}</span>
              </div>

              <div class="flex justify-between">
                <span class="text-gray-400">Total Value:</span>
                <span class="text-eve-danger font-semibold"
                  >{formatValue(roam.totalValue)}</span
                >
              </div>
            </div>

            <div class="pt-2">
              <div class="mb-2">
                <span
                  class="px-2 py-1 rounded text-sm font-semibold text-black"
                  style="background-color: {getRoamColor(roam)}"
                >
                  {getSystemCount(roam)} Systems
                </span>
              </div>
              <div class="bg-eve-dark/50 rounded p-2 h-32 overflow-y-auto">
                {#each getUniqueRecentSystems(roam.systems) as system}
                  <div
                    class="flex justify-between py-1 border-b border-eve-accent/10 last:border-0"
                  >
                    <span class="text-white text-sm"
                      >{system.name} ({system.region || "Unknown"})</span
                    >
                    <span class="text-gray-400 text-sm"
                      >{getTimeAgo(system.time)}</span
                    >
                  </div>
                {/each}
              </div>
            </div>
          </button>
        {/each}
      </div>
    {:else}
      <!-- Chart View -->
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead class="bg-eve-secondary">
            <tr>
              <th class="px-4 py-2 text-left">System</th>
              <th class="px-4 py-2 text-left">Fleet Size</th>
              <th class="px-4 py-2 text-left">Systems Visited</th>
              <th class="px-4 py-2 text-left">Activity</th>
              <th class="px-4 py-2 text-left">Total Value</th>
              <th class="px-4 py-2 text-left">Duration</th>
              <th class="px-4 py-2 text-left">Last Activity</th>
            </tr>
          </thead>
          <tbody>
            {#each roams as roam}
              <tr
                class="border-b border-eve-secondary/30 hover:bg-eve-secondary/20 cursor-pointer"
                on:click={() => {
                  const latestKill = roam.kills[roam.kills.length - 1];
                  if (latestKill) {
                    const killTime = new Date(
                      latestKill.killmail.killmail_time
                    );
                    const formattedTime = `${killTime.getUTCFullYear()}${String(
                      killTime.getUTCMonth() + 1
                    ).padStart(2, "0")}${String(killTime.getUTCDate()).padStart(
                      2,
                      "0"
                    )}${String(killTime.getUTCHours()).padStart(2, "0")}${String(
                      killTime.getUTCMinutes()
                    ).padStart(2, "0")}`;
                    window.open(
                      `https://zkillboard.com/related/${roam.lastSystem.id}/${formattedTime}/`,
                      "_blank"
                    );
                  }
                }}
                on:contextmenu|preventDefault={(e) =>
                  handleContextMenu(e, roam)}
                role="button"
                tabindex="0"
              >
                <td class="px-4 py-2">{roam.lastSystem?.name || "Unknown"}</td>
                <td class="px-4 py-2">{roam.members?.length || 0} pilots</td>
                <td class="px-4 py-2">
                  <span
                    class="px-2 py-1 rounded text-black text-sm"
                    style="background-color: {getRoamColor(roam)}"
                  >
                    {getSystemCount(roam)}
                  </span>
                </td>
                <td class="px-4 py-2">{roam.kills?.length || 0} kills</td>
                <td class="px-4 py-2 text-eve-danger font-semibold">
                  {formatValue(roam.totalValue)}
                </td>
                <td class="px-4 py-2">{getRoamDuration(roam)}</td>
                <td class="px-4 py-2 text-gray-400">
                  {getTimeAgo(
                    roam.kills[roam.kills.length - 1]?.killmail.killmail_time
                  )}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>

<!-- Context Menu Container -->
<ContextMenu
  show={contextMenu.show}
  x={contextMenu.x}
  y={contextMenu.y}
  options={contextMenu.options}
  on:select={handleMenuSelect}
/>
