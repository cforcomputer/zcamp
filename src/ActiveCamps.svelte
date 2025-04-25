<script>
  import { onMount, onDestroy } from "svelte";
  import CampCrusher from "./CampCrusher.svelte"; // Default import
  import activityManager, { activeActivities } from "./activityManager.js";
  import { CAMP_PROBABILITY_FACTORS, CAPSULE_ID } from "./constants.js";
  import ContextMenu from "./ContextMenu.svelte";
  import PinnedSystemsList from "./PinnedSystemsList.svelte";
  import {
    selectedCampCrusherTargetId,
    currentTargetEndTime,
    isTargetSelectionActive, // Import selection state
    cancelTarget, // Import cancelTarget from the store
  } from "./campCrusherTargetStore.js";
  import { get } from "svelte/store";
  import { getValidAccessToken } from "./tokenManager.js";

  const { THREAT_SHIPS } = CAMP_PROBABILITY_FACTORS;

  // --- Component State ---
  let viewMode = "cards";
  let isLoading = true;
  let mounted = false;
  let isLoggedIn = false;
  let pinnedSystemsComponent;
  let expandedCompositionCards = new Set();

  // --- Subscribe to stores ---
  let currentTargetId;
  let selectionActive; // Renamed from isTargetSelectionActive for brevity in template
  const unsubTarget = selectedCampCrusherTargetId.subscribe((value) => {
    currentTargetId = value;
  });
  const unsubSelection = isTargetSelectionActive.subscribe((value) => {
    selectionActive = value; // Keep local reactive variable in sync
  });
  // --- END Store Subscriptions ---

  let contextMenu = { show: false, x: 0, y: 0, options: [] };
  const classificationIcons = {
    camp: "⛺",
    smartbomb: "⚡",
    roaming_camp: "🏕️",
    battle: "⚔️",
    roam: "➡️",
    activity: "❓",
  };
  const classificationTooltips = {
    camp: "Standard Gate Camp",
    smartbomb: "Smartbomb Camp",
    roaming_camp: "Roaming Camp (Multi-System)",
    battle: "Large Battle (>40 Pilots)",
    roam: "Roaming Gang",
    activity: "Unclassified Activity",
  };

  // --- Helper Functions ---
  function toggleCompositionExpansion(e, activityId) {
    e.stopPropagation();
    if (expandedCompositionCards.has(activityId)) {
      expandedCompositionCards.delete(activityId);
    } else {
      expandedCompositionCards.add(activityId);
    }
    expandedCompositionCards = expandedCompositionCards;
  }

  function getAccurateShipCounts(activity) {
    const uniqueAttackerShips = new Map();
    (activity.kills || []).forEach((kill) => {
      (kill?.killmail?.attackers || []).forEach((attacker) => {
        if (
          attacker?.character_id &&
          attacker?.ship_type_id &&
          attacker?.ship_type_id !== CAPSULE_ID
        ) {
          const key = `${attacker.character_id}-${attacker.ship_type_id}`;
          uniqueAttackerShips.set(key, {
            characterId: attacker.character_id,
            shipTypeId: attacker.ship_type_id,
          });
        }
      });
    });
    const shipCounts = {};
    for (const { shipTypeId } of uniqueAttackerShips.values()) {
      shipCounts[shipTypeId] = (shipCounts[shipTypeId] || 0) + 1;
    }
    return shipCounts;
  }

  // Filter activities
  $: activitiesToShow = ($activeActivities || [])
    .filter(
      (activity) =>
        activity && // Ensure activity is not null/undefined
        ["camp", "smartbomb", "roaming_camp", "battle"].includes(
          activity.classification
        ) &&
        // Ensure it either has a stargate name OR is classified as a battle
        (activity.stargateName || activity.classification === "battle") &&
        // Ensure probability is valid or it's a battle (battles show regardless of probability)
        (activity.probability === undefined ||
          activity.probability > 0 ||
          activity.classification === "battle")
    )
    .sort((a, b) => (b.probability || 0) - (a.probability || 0));

  $: if (mounted && $activeActivities) isLoading = false;

  // Function to SET a target
  async function handleSetTarget(activity) {
    if (!isLoggedIn) {
      alert("Please log in to select a Camp Crusher target.");
      return;
    }
    // Require stargateName for targeting consistency, even for battles.
    if (!activity?.id || !activity?.systemId || !activity?.stargateName) {
      console.error("Invalid activity data for target selection:", activity);
      alert("Cannot select this target due to missing stargate data.");
      return;
    }
    if (currentTargetId) {
      alert("An active target already exists. Please cancel it first.");
      return;
    }

    console.log("Attempting to set target:", activity.id);
    try {
      const response = await fetch("/api/campcrushers/target", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campId: activity.id,
          systemId: activity.systemId,
          stargateName: activity.stargateName, // Required for target setting
        }),
      });
      const data = await response.json();
      if (data.success && data.endTime) {
        selectedCampCrusherTargetId.set(activity.id);
        currentTargetEndTime.set(data.endTime);
        isTargetSelectionActive.set(false); // Turn off selection mode
      } else {
        throw new Error(data.error || "Unknown error setting target");
      }
    } catch (error) {
      console.error("Error setting camp crusher target:", error);
      alert(`Failed to set target: ${error.message}`);
    }
  }

  // (cancelTarget is now imported from the store)

  onMount(async () => {
    try {
      const response = await fetch("/api/session", { credentials: "include" });
      if (response.ok) {
        const data = await response.json();
        isLoggedIn = !!data.user;
      }
    } catch (error) {
      console.error("Error checking session:", error);
    }
    mounted = true;
    activityManager.startUpdates();
  });

  onDestroy(() => {
    unsubTarget();
    unsubSelection();
  });

  // --- Other helper functions (pinSystem, formatValue, getTimeAgo, etc.) ---
  async function pinSystem(activity) {
    /* ... implementation ... */
    if (!isLoggedIn) return;
    try {
      const systemName =
        activity.kills?.[0]?.pinpoints?.celestialData?.solarsystemname ||
        activity.systemName ||
        null;
      // Require stargateName for pinning consistency.
      if (!activity.systemId || !activity.stargateName) {
        console.error(
          "Cannot pin: Missing systemId or stargateName in activity",
          activity
        );
        alert("Cannot pin this item: missing required stargate data.");
        return;
      }
      const response = await fetch("/api/pinned-systems", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          system_id: activity.systemId,
          stargate_name: activity.stargateName, // Required for pinning
          system_name: systemName,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.id) {
          pinnedSystemsComponent?.pinSystem({
            id: data.id,
            user_id: data.user_id || null,
            system_id: activity.systemId,
            stargate_name: activity.stargateName,
            system_name: data.system_name || `System ${activity.systemId}`, // Prefer API response name
            created_at: data.created_at || new Date().toISOString(),
            probability: activity.probability,
          });
        } else {
          console.error(
            "Pin API call succeeded but did not return expected data.",
            data
          );
        }
      } else {
        console.error(
          "Failed to pin system via API:",
          response.status,
          await response.text()
        );
      }
    } catch (error) {
      console.error("Error pinning system:", error);
    }
  }
  function formatValue(value) {
    /* ... */
    if (!value) return "0 ISK";
    if (value >= 1000000000) return (value / 1000000000).toFixed(2) + "B";
    if (value >= 1000000) return (value / 1000000).toFixed(2) + "M";
    return (value / 1000).toFixed(2) + "K";
  }
  function getTimeAgo(timestamp) {
    /* ... */
    if (!timestamp) return "unknown";
    const now = new Date().getTime();
    const then = new Date(timestamp).getTime();
    const minutes = Math.floor((now - then) / (1000 * 60));
    if (minutes < 1) return "just now";
    if (minutes === 1) return "1 minute ago";
    return `${minutes} minutes ago`;
  }
  async function setDestination(systemId, clearOthers = true) {
    /* ... */
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
    /* ... */
    event.preventDefault();
    const container =
      event.currentTarget.closest(".eve-card") ||
      event.currentTarget.closest("table");
    if (!container) return;
    const containerBounds = container.getBoundingClientRect();
    const x = event.clientX - containerBounds.left;
    const y = event.clientY - containerBounds.top;
    const options = [
      {
        label: "Set Destination",
        action: () => setDestination(activity.systemId, true),
      },
      {
        label: "Add Waypoint",
        action: () => setDestination(activity.systemId, false),
      },
    ];
    // Only allow pinning if it has a stargateName (consistency)
    if (
      isLoggedIn &&
      ["camp", "smartbomb", "battle"].includes(activity.classification) && // Allow pinning battles if they have stargate name
      activity.stargateName
    ) {
      options.push({ label: "Pin System", action: () => pinSystem(activity) });
    }
    contextMenu = { show: true, x, y, options };
  }
  function handleMenuSelect(event) {
    /* ... */
    const option = event.detail;
    option.action();
    contextMenu.show = false;
  }
  function getProbabilityColor(probability) {
    /* ... */
    // Treat battle classification as high probability for color
    if (probability === "battle" || probability >= 80) return "#ff4444"; // Red
    if (probability >= 60) return "#ff8c00"; // Orange
    if (probability >= 40) return "#ffd700"; // Yellow
    return "#90ee90"; // Green
  }
  function hasInterdictor(kills) {
    /* ... */
    return (kills || []).some((kill) =>
      (kill?.killmail?.attackers || []).some(
        (a) =>
          a?.ship_type_id &&
          [22456, 22464, 22452, 22460, 12013, 12017, 12021, 12025].includes(
            a.ship_type_id // Interdictor and HIC type IDs
          )
      )
    );
  }
  function formatProbabilityLog(log) {
    /* ... */
    if (!log || !Array.isArray(log)) return "No probability log available.";
    return log
      .map((entry) =>
        typeof entry === "object"
          ? JSON.stringify(entry, null, 2)
          : String(entry)
      )
      .join("\n");
  }
  function openActivityHistory(activity) {
    /* ... */
    const latestKill = (activity.kills || [])[activity.kills.length - 1];
    if (latestKill) {
      const killTime = new Date(latestKill.killmail.killmail_time);
      const formattedTime = `${killTime.getUTCFullYear()}${String(killTime.getUTCMonth() + 1).padStart(2, "0")}${String(killTime.getUTCDate()).padStart(2, "0")}${String(killTime.getUTCHours()).padStart(2, "0")}${String(killTime.getUTCMinutes()).padStart(2, "0")}`;
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
  <PinnedSystemsList bind:this={pinnedSystemsComponent} {isLoggedIn} />

  {#if isLoading}
    <div class="text-center py-8">
      <p class="text-gray-400">Loading activities...</p>
    </div>
  {:else if mounted}
    <div class="flex justify-center mb-8"><CampCrusher /></div>

    <div class="flex justify-between items-center mb-4">
      <h2 class="text-white text-2xl font-bold">Active Camps & Battles</h2>
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

    {#if activitiesToShow.length === 0}
      <p class="text-center py-8 text-gray-400 italic">
        No active camps or battles found matching filters.
      </p>
    {:else if viewMode === "cards"}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {#each activitiesToShow as activity (activity.id)}
          <div class="group relative">
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div
              class="overflow-hidden rounded-lg {activity.state === 'CRASHED'
                ? 'opacity-70 grayscale-[0.7]'
                : ''}"
              on:contextmenu|preventDefault={(e) =>
                handleContextMenu(e, activity)}
            >
              <div
                class="relative bg-eve-dark/90 bg-gradient-to-r from-eve-secondary/90 to-eve-secondary/40 p-3 border-t-2"
                style="border-color: {getProbabilityColor(
                  activity.classification === 'battle'
                    ? 'battle'
                    : activity.probability || 0
                )}"
              >
                {#if isLoggedIn}
                  {#if currentTargetId === activity.id}
                    <button
                      type="button"
                      title="Current Target (Click to Clear)"
                      class="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 ease-in-out z-10 bg-red-500 hover:bg-red-600 scale-110 ring-2 ring-white"
                      on:click|stopPropagation={cancelTarget}
                      aria-pressed={true}
                      aria-label={`Clear target ${activity.stargateName || "current target"}`}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        class="w-5 h-5 text-white"
                      >
                        <path
                          fill-rule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                          clip-rule="evenodd"
                        />
                      </svg>
                    </button>
                  {:else if selectionActive && ["camp", "smartbomb", "battle"].includes(activity.classification) && activity.stargateName}
                    <button
                      type="button"
                      title="Set as Target"
                      class="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 ease-in-out z-10 bg-gray-600 hover:bg-green-500"
                      on:click|stopPropagation={() => handleSetTarget(activity)}
                      aria-pressed={false}
                      aria-label={`Set ${activity.stargateName} as target`}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        class="w-5 h-5 text-white"
                      >
                        <path
                          fill-rule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm0-2a6 6 0 100-12 6 6 0 000 12zm0-4a2 2 0 100-4 2 2 0 000 4z"
                          clip-rule="evenodd"
                        />
                      </svg>
                    </button>
                  {/if}
                {/if}
                <h3 class="text-white text-base font-bold truncate pr-10">
                  {activity.kills?.[0]?.pinpoints?.celestialData
                    ?.solarsystemname || activity.systemId}
                  <span
                    class="ml-2 text-lg"
                    title={classificationTooltips[activity.classification] ||
                      "Activity"}
                  >
                    {classificationIcons[activity.classification] || "?"}
                  </span>
                </h3>
              </div>
              <button
                type="button"
                class="w-full text-left bg-eve-primary p-3"
                on:click={() => openActivityHistory(activity)}
              >
                <div class="flex justify-between items-center mb-3">
                  <div class="flex items-center gap-2">
                    <span
                      class="px-2 py-1 rounded text-black font-bold text-sm"
                      style="background-color: {getProbabilityColor(
                        activity.classification === 'battle'
                          ? 'battle'
                          : activity.probability || 0
                      )}"
                    >
                      {activity.classification === "battle"
                        ? "Battle"
                        : `${Math.round(activity.probability || 0)}% Conf.`}
                    </span>
                  </div>
                  <button
                    type="button"
                    class="px-3 py-1 bg-eve-accent text-black font-medium rounded hover:bg-eve-accent/80 transition-colors"
                    title="View Latest Kill"
                    on:click|stopPropagation={(e) => {
                      e.preventDefault();
                      const latestKill = (activity.kills || [])[
                        activity.kills.length - 1
                      ];
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
                <div class="space-y-1">
                  <div
                    class="flex justify-between py-0.5 border-b border-white/10"
                  >
                    <span class="text-gray-400">Location:</span>
                    <span class="text-white">
                      {activity.stargateName ||
                        (activity.classification === "battle"
                          ? "Battle Zone (System Wide)"
                          : "Unknown Location")}
                    </span>
                  </div>
                  <div
                    class="flex justify-between py-0.5 border-b border-white/10"
                  >
                    <span class="text-gray-400">Duration:</span>
                    <span class="text-white">
                      {#if activity.kills && activity.kills.length > 0}
                        {(() => {
                          const killTimes = (activity.kills || [])
                            .map((k) =>
                              new Date(k?.killmail?.killmail_time).getTime()
                            )
                            .filter((t) => !isNaN(t));
                          if (killTimes.length === 0) return "0m active";
                          const firstKillTime = Math.min(...killTimes);
                          const duration = Math.floor(
                            (Date.now() - firstKillTime) / (1000 * 60)
                          );
                          return `${duration}m active`;
                        })()}
                      {:else}0m active{/if}
                    </span>
                  </div>
                  <div
                    class="flex justify-between py-0.5 border-b border-white/10"
                  >
                    <span class="text-gray-400">Last Activity:</span>
                    <span class="text-eve-accent italic"
                      >{getTimeAgo(activity.lastKill)}</span
                    >
                  </div>
                  <div
                    class="flex justify-between py-0.5 border-b border-white/10"
                  >
                    <span class="text-gray-400">Activity:</span>
                    <span class="text-white flex items-center">
                      {(activity.kills || []).filter(
                        (k) => k?.killmail?.victim?.ship_type_id !== CAPSULE_ID
                      ).length} kills {#if activity.metrics?.podKills > 0}({activity
                          .metrics.podKills} pods){/if}
                      {#if hasInterdictor(activity.kills)}<span
                          class="ml-2 cursor-help"
                          title="Interdictor/HICTOR present">⚠️</span
                        >{/if}
                    </span>
                  </div>
                  <div
                    class="flex justify-between py-0.5 border-b border-white/10"
                  >
                    <span class="text-gray-400">Value:</span>
                    <span class="text-eve-danger font-bold"
                      >{formatValue(activity.totalValue)} ISK</span
                    >
                  </div>
                  <div
                    class="flex justify-between py-0.5 border-b border-white/10"
                  >
                    <span class="text-gray-400">Comp:</span>
                    <span class="text-white">
                      {#if activity.metrics?.partyMetrics}
                        {activity.metrics.partyMetrics.characters} pilots {#if activity.metrics.partyMetrics.corporations > 0}
                          from {activity.metrics.partyMetrics.corporations} corps
                          {#if activity.metrics.partyMetrics.alliances > 0}
                            in {activity.metrics.partyMetrics.alliances} alliances{/if}{/if}
                      {:else if activity.composition}
                        {activity.composition.activeCount || 0}/{activity
                          .composition.originalCount || 0} active {#if activity.composition.killedCount > 0}<span
                            class="text-eve-danger font-bold"
                            >(-{activity.composition.killedCount})</span
                          >{/if}
                      {:else}Computing...{/if}
                    </span>
                  </div>
                  {#if activity.state === "CRASHED"}<div
                      class="text-center py-1 bg-eve-danger/50 rounded mt-1"
                    >
                      CRASHED
                    </div>{/if}
                </div>
              </button>
              {#if activity.metrics?.shipCounts}
                <div class="mt-1 bg-eve-secondary/80 rounded">
                  <div class="flex items-center h-10 px-3">
                    <button
                      type="button"
                      class="text-eve-accent hover:text-eve-accent/80 px-3 py-1 bg-eve-dark/80 rounded flex items-center gap-1"
                      on:click={(e) =>
                        toggleCompositionExpansion(e, activity.id)}
                      aria-label={expandedCompositionCards.has(activity.id)
                        ? "Hide ship details"
                        : "Show ship details"}
                    >
                      <span
                        >{expandedCompositionCards.has(activity.id)
                          ? "Close"
                          : "Ships"}</span
                      >
                      <span class="text-xs"
                        >{expandedCompositionCards.has(activity.id)
                          ? "▲"
                          : "▼"}</span
                      >
                      {#if !expandedCompositionCards.has(activity.id)}<span
                          class="ml-1 px-1.5 py-0.5 bg-eve-accent/20 rounded-full text-xs"
                          >{Object.keys(getAccurateShipCounts(activity))
                            .length}</span
                        >{/if}
                    </button>
                  </div>
                  {#if expandedCompositionCards.has(activity.id)}
                    <div
                      class="p-3 max-h-48 overflow-y-auto border-t border-eve-accent/10"
                    >
                      <div class="flex flex-col gap-1">
                        {#each Object.entries(getAccurateShipCounts(activity)) as [shipId, count]}
                          {@const shipData = (activity.kills || [])
                            .flatMap((k) => k?.shipCategories?.attackers || [])
                            .find((ship) => ship?.shipTypeId == shipId)}
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
            <div
              class="hidden group-hover:block absolute top-full left-0 right-0 z-50 mt-1"
            >
              <pre
                class="bg-eve-primary text-white p-3 rounded border border-eve-accent/20 font-mono text-xs leading-relaxed shadow-lg max-w-[500px] max-h-[400px] overflow-y-auto">{formatProbabilityLog(
                  activity.probabilityLog
                )}</pre>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead class="bg-eve-secondary">
            <tr>
              <th class="px-4 py-2 text-left">Location</th>
              <th class="px-4 py-2 text-left">Type</th>
              <th class="px-4 py-2 text-left">Status</th>
              <th class="px-4 py-2 text-left">Activity</th>
              <th class="px-4 py-2 text-left">Value</th>
              <th class="px-4 py-2 text-left">Composition</th>
              <th class="px-4 py-2 text-left">Last Activity</th>
            </tr>
          </thead>
          <tbody>
            {#each activitiesToShow as activity}
              <tr
                class="border-b border-eve-secondary/30 hover:bg-eve-secondary/20 cursor-pointer"
                on:click={() => openActivityHistory(activity)}
                on:contextmenu|preventDefault={(e) =>
                  handleContextMenu(e, activity)}
                role="button"
                tabindex="0"
              >
                <td class="px-4 py-2">
                  {activity.stargateName ||
                    (activity.classification === "battle"
                      ? "Battle Zone (System Wide)"
                      : "Unknown Location")}
                </td>
                <td class="px-4 py-2"
                  ><span
                    class="text-lg"
                    title={classificationTooltips[activity.classification] ||
                      "Activity"}
                    >{classificationIcons[activity.classification] || "?"}</span
                  ></td
                >
                <td class="px-4 py-2"
                  ><span
                    class="px-2 py-1 rounded text-black text-sm"
                    style="background-color: {getProbabilityColor(
                      activity.classification === 'battle'
                        ? 'battle'
                        : activity.probability || 0
                    )}"
                    >{activity.classification === "battle"
                      ? "Battle"
                      : `${Math.round(activity.probability || 0)}%`}</span
                  ></td
                >
                <td class="px-4 py-2"
                  >{(activity.kills || []).length} kills {#if activity.metrics?.podKills > 0}({activity
                      .metrics.podKills} pods){/if}</td
                >
                <td class="px-4 py-2 text-eve-danger font-semibold"
                  >{formatValue(activity.totalValue)}</td
                >
                <td class="px-4 py-2"
                  >{#if activity.metrics?.partyMetrics}{activity.metrics
                      .partyMetrics.characters} pilots {#if activity.metrics.partyMetrics.corporations > 0}({activity
                        .metrics.partyMetrics.corporations} corps){/if}{:else if activity.composition}{activity
                      .composition.activeCount || 0} pilots{:else}Computing...{/if}</td
                >
                <td class="px-4 py-2 text-eve-accent"
                  >{getTimeAgo(activity.lastKill)}</td
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
  :global(.killmail-section) {
    height: calc(100vh - 150px);
    overflow-y: auto;
  }
</style>
