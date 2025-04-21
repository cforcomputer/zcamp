<script>
  import { onMount, onDestroy } from "svelte";
  // Import the unified activity store and manager
  import activityManager, { activeActivities } from "./activityManager.js"; // Changed import
  import ContextMenu from "./ContextMenu.svelte";
  import socket from "./socket.js";

  let viewMode = "cards"; // "cards" or "chart"
  let showOnlyRoaming = true; // Default to showing only roaming gangs

  // --- NEW: Classification Icons ---
  const classificationIcons = {
    camp: "⛺",
    smartbomb: "⚡",
    roaming_camp: "🏕️", // Tent with campfire
    battle: "⚔️",
    roam: "➡️", // Simple arrow for roam
    activity: "❓",
  };

  const classificationTooltips = {
    camp: "Stationary Gate Camp",
    smartbomb: "Smartbomb Activity",
    roaming_camp: "Roaming Camp (Multi-System)",
    battle: "Large Battle (>40 Pilots)",
    roam: "Roaming Gang",
    activity: "Unclassified Activity",
  };

  $: allActivities = $activeActivities || [];

  $: filteredActivities = allActivities.filter((activity) => {
    const isRoamingType = ["roam", "roaming_camp", "battle"].includes(
      activity.classification
    );

    if (showOnlyRoaming) {
      // Check if it's a roaming type AND has more than one system entry OR visitedSystems size > 1
      // Choose the check that accurately reflects multi-system activity based on your data structure
      const hasVisitedMultipleSystems =
        (activity.visitedSystems?.size || 0) > 1 ||
        (activity.systems?.length || 0) > 1;
      return isRoamingType && hasVisitedMultipleSystems;
    } else {
      // Show all roaming types, regardless of system count
      return isRoamingType;
    }
  });

  let isLoading = true;
  let mounted = false;

  onMount(() => {
    mounted = true;
    activityManager.startUpdates(); // Use unified manager
    return () => {
      mounted = false;
      activityManager.cleanup(); // Use unified manager
    };
  });

  $: if (mounted && $activeActivities) {
    isLoading = false;
  }

  onDestroy(() => {
    activityManager.cleanup(); // Use unified manager
  });

  function getRoamDuration(activity) {
    const startTime = activity.startTime || activity.firstKillTime;
    if (!startTime) return "unknown";
    const minutes = Math.floor(
      (Date.now() - new Date(startTime).getTime()) / (1000 * 60)
    );
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

  function getSystemCount(activity) {
    return activity.visitedSystems?.size || 1; // Use tracked count
  }

  function getRoamColor(activity) {
    const systemCount = getSystemCount(activity);
    const memberCount =
      activity.metrics?.partyMetrics?.characters ||
      activity.composition?.activeCount ||
      0;
    if (activity.classification === "battle") return "#ff0000"; // Red for battles
    if (activity.classification === "roaming_camp") return "#ff8c00"; // Orange for roaming camps
    if (systemCount > 5 || memberCount > 10) return "#ffd700"; // Yellow for larger roams
    return "#90ee90"; // Green for smaller roams
  }

  let contextMenu = { show: false, x: 0, y: 0, options: [] };

  import { getValidAccessToken } from "./tokenManager.js";

  async function setDestination(systemId, clearOthers = true) {
    try {
      const accessToken = await getValidAccessToken();
      const result = await fetch(
        `https://esi.evetech.net/latest/ui/autopilot/waypoint/?add_to_beginning=false&clear_other_waypoints=${clearOthers}&datasource=tranquility&destination_id=${systemId}`,
        { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!result.ok) {
        if (result.status === 401)
          window.dispatchEvent(new CustomEvent("session-expired"));
        throw new Error(`Failed to set destination: ${result.status}`);
      }
      return true;
    } catch (error) {
      console.error("Error setting destination:", error);
      return false;
    }
  }

  function handleContextMenu(event, activity) {
    event.preventDefault();
    const container =
      viewMode === "cards"
        ? event.currentTarget.closest(".eve-card")
        : event.currentTarget.closest("tr");
    if (!container) return;
    const parentContainer =
      viewMode === "cards"
        ? container.closest(".grid")
        : container.closest(".overflow-x-auto");
    if (!parentContainer) return;

    const scrollLeft =
      window.pageXOffset || document.documentElement.scrollLeft;
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const tableScrollLeft =
      viewMode === "chart" ? parentContainer.scrollLeft : 0;
    const x = event.clientX + scrollLeft - tableScrollLeft;
    const y = event.clientY + scrollTop;
    const mainContainer = container.closest(".p-4");
    const mainContainerBounds = mainContainer.getBoundingClientRect();
    const relativeX = x - mainContainerBounds.left - scrollLeft;
    const relativeY = y - mainContainerBounds.top - scrollTop;
    const menuWidth = 200;
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
          action: () => setDestination(activity.lastSystem.id, true),
        },
        {
          label: "Add Waypoint",
          action: () => setDestination(activity.lastSystem.id, false),
        },
      ],
    };

    const handleClickOutside = (e) => {
      if (!e.target.closest(".context-menu")) {
        contextMenu.show = false;
        document.removeEventListener("click", handleClickOutside);
      }
    };
    setTimeout(() => {
      document.addEventListener("click", handleClickOutside);
    }, 0);
  }

  function handleMenuSelect(event) {
    const option = event.detail;
    option.action();
    contextMenu.show = false;
  }

  function openActivityHistory(activity) {
    const latestKill = activity.kills[activity.kills.length - 1];
    if (latestKill) {
      const killTime = new Date(latestKill.killmail.killmail_time);
      const formattedTime = `${killTime.getUTCFullYear()}${String(killTime.getUTCMonth() + 1).padStart(2, "0")}${String(killTime.getUTCDate()).padStart(2, "0")}${String(killTime.getUTCHours()).padStart(2, "0")}${String(killTime.getUTCMinutes()).padStart(2, "0")}`;
      // Use lastSystem.id for roams/battles, systemId for camps
      const systemToLink = activity.lastSystem?.id || activity.systemId;
      if (systemToLink) {
        window.open(
          `https://zkillboard.com/related/${systemToLink}/${formattedTime}/`,
          "_blank"
        );
      }
    }
  }
</script>

<div class="p-4">
  {#if isLoading}
    <div class="text-center py-8">
      <p class="text-gray-400">Loading activities...</p>
    </div>
  {:else if mounted}
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-2xl font-bold text-eve-accent">Active Roams & Battles</h2>
      <div class="flex items-center gap-4">
        <label class="flex items-center gap-2 text-white cursor-pointer">
          <input
            type="checkbox"
            bind:checked={showOnlyRoaming}
            class="appearance-none h-5 w-5 border border-eve-accent/50 rounded-md bg-eve-secondary checked:bg-eve-accent checked:border-transparent focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-eve-dark focus:ring-eve-accent transition duration-200 cursor-pointer"
          />
          <span>Roaming only</span>
        </label>
        <div class="flex gap-2">
          <button
            class="px-4 py-2 bg-eve-secondary rounded {viewMode === 'cards'
              ? 'text-eve-accent'
              : 'text-gray-400'}"
            on:click={() => (viewMode = "cards")}>Card View</button
          >
          <button
            class="px-4 py-2 bg-eve-secondary rounded {viewMode === 'chart'
              ? 'text-eve-accent'
              : 'text-gray-400'}"
            on:click={() => (viewMode = "chart")}>Chart View</button
          >
        </div>
      </div>
    </div>

    {#if filteredActivities.length === 0}
      <p class="col-span-full text-center py-8 text-gray-400 italic">
        {allActivities.length > 0
          ? "No matching activities found"
          : "Syncing activities..."}
      </p>
    {:else if viewMode === "cards"}
      <div
        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
      >
        {#each filteredActivities as activity (activity.id)}
          <button
            class="eve-card hover:scale-102 transition-transform duration-200 text-left w-full cursor-pointer"
            type="button"
            on:click={() => openActivityHistory(activity)}
            on:contextmenu|preventDefault={(e) =>
              handleContextMenu(e, activity)}
          >
            <div
              class="border-b border-eve-accent/20 pb-2 flex justify-between items-center"
            >
              <div>
                <h3 class="text-xl font-semibold text-white">
                  {activity.lastSystem?.name ||
                    activity.stargateName ||
                    "Unknown Location"}
                </h3>
                <span class="text-gray-400 text-sm">
                  {activity.metrics?.partyMetrics?.characters ||
                    activity.composition?.activeCount ||
                    0} pilots active for {getRoamDuration(activity)}
                </span>
              </div>
              <span
                class="text-2xl"
                title={classificationTooltips[activity.classification] ||
                  "Activity"}
              >
                {classificationIcons[activity.classification] || "?"}
              </span>
            </div>

            <div class="space-y-2 py-2">
              <div class="flex justify-between">
                <span class="text-gray-400">Kills:</span><span
                  class="text-white">{activity.kills?.length || 0}</span
                >
              </div>
              <div class="flex justify-between">
                <span class="text-gray-400">Total Value:</span><span
                  class="text-eve-danger font-semibold"
                  >{formatValue(activity.totalValue)}</span
                >
              </div>
            </div>

            <div class="pt-2">
              <div class="mb-2">
                <span
                  class="px-2 py-1 rounded text-sm font-semibold text-black"
                  style="background-color: {getRoamColor(activity)}"
                >
                  {getSystemCount(activity)} Systems
                </span>
              </div>
              <div class="bg-eve-dark/50 rounded p-2 h-32 overflow-y-auto">
                {#each getUniqueRecentSystems(activity.systems) as system}
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
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead class="bg-eve-secondary">
            <tr>
              <th class="px-4 py-2 text-left">Last System</th>
              <th class="px-4 py-2 text-left">Type</th>
              <th class="px-4 py-2 text-left">Fleet Size</th>
              <th class="px-4 py-2 text-left">Systems Visited</th>
              <th class="px-4 py-2 text-left">Activity</th>
              <th class="px-4 py-2 text-left">Total Value</th>
              <th class="px-4 py-2 text-left">Duration</th>
              <th class="px-4 py-2 text-left">Last Activity</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredActivities as activity}
              <tr
                class="border-b border-eve-secondary/30 hover:bg-eve-secondary/20 cursor-pointer"
                on:click={() => openActivityHistory(activity)}
                on:contextmenu|preventDefault={(e) =>
                  handleContextMenu(e, activity)}
                role="button"
                tabindex="0"
              >
                <td class="px-4 py-2"
                  >{activity.lastSystem?.name || "Unknown"}</td
                >
                <td class="px-4 py-2">
                  <span
                    class="text-lg"
                    title={classificationTooltips[activity.classification] ||
                      "Activity"}
                  >
                    {classificationIcons[activity.classification] || "?"}
                  </span>
                </td>
                <td class="px-4 py-2"
                  >{activity.metrics?.partyMetrics?.characters ||
                    activity.composition?.activeCount ||
                    0} pilots</td
                >
                <td class="px-4 py-2">
                  <span
                    class="px-2 py-1 rounded text-black text-sm"
                    style="background-color: {getRoamColor(activity)}"
                    >{getSystemCount(activity)}</span
                  >
                </td>
                <td class="px-4 py-2">{activity.kills?.length || 0} kills</td>
                <td class="px-4 py-2 text-eve-danger font-semibold"
                  >{formatValue(activity.totalValue)}</td
                >
                <td class="px-4 py-2">{getRoamDuration(activity)}</td>
                <td class="px-4 py-2 text-gray-400"
                  >{getTimeAgo(activity.lastActivity || activity.lastKill)}</td
                >
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
  .form-checkbox {
    @apply rounded border-eve-accent/50 text-eve-accent focus:ring-eve-accent;
  }
</style>
