<script>
  import { onMount, onDestroy } from "svelte";
  import CampCrusher from "./CampCrusher.svelte";
  import activityManager, { activeActivities } from "./activityManager.js";
  import { CAMP_PROBABILITY_FACTORS, CAPSULE_ID } from "./constants.js";
  import ContextMenu from "./ContextMenu.svelte";
  import PinnedSystemsList from "./PinnedSystemsList.svelte";
  // --- CHANGE: Import target store ---
  import {
    selectedCampCrusherTargetId,
    currentTargetEndTime,
  } from "./campCrusherTargetStore.js";
  // --- END CHANGE ---
  import { get } from "svelte/store"; // Import get
  import { getValidAccessToken } from "./tokenManager.js"; // Import ESI helper

  const { THREAT_SHIPS } = CAMP_PROBABILITY_FACTORS;

  let viewMode = "cards";
  let isLoading = true;
  let mounted = false;
  let isLoggedIn = false;
  let pinnedSystemsComponent;
  let expandedCompositionCards = new Set();

  // --- CHANGE: Subscribe to target store ---
  let currentTargetId = get(selectedCampCrusherTargetId); // Get initial value
  const unsubTarget = selectedCampCrusherTargetId.subscribe((value) => {
    currentTargetId = value;
  });
  // --- END CHANGE ---

  // Declare contextMenu state variable here
  let contextMenu = { show: false, x: 0, y: 0, options: [] };

  const classificationIcons = {
    camp: "⛺", // Tent for standard camp
    smartbomb: "⚡", // Lightning for smartbomb
    roaming_camp: "🏕️", // Tent with campfire for roaming camp
    gate_battle: "⚔️", // Crossed swords for battle
    roam: "➡️", // Arrow for roam (though likely filtered out here)
    activity: "❓", // Question mark for unknown/default
  };
  const classificationTooltips = {
    camp: "Standard Gate Camp",
    smartbomb: "Smartbomb Camp",
    roaming_camp: "Roaming Camp (Multi-System)",
    battle: "Large Battle (>40 Pilots)",
    roam: "Roaming Gang",
    activity: "Unclassified Activity",
  };

  function toggleCompositionExpansion(e, activityId) {
    e.stopPropagation();
    if (expandedCompositionCards.has(activityId)) {
      expandedCompositionCards.delete(activityId);
    } else {
      expandedCompositionCards.add(activityId);
    }
    expandedCompositionCards = expandedCompositionCards; // Trigger reactivity
  }
  function getAccurateShipCounts(activity) {
    const uniqueAttackerShips = new Map();
    (activity.kills || []).forEach((kill) => {
      // Add default empty array
      (kill?.killmail?.attackers || []).forEach((attacker) => {
        // Add null checks
        if (
          attacker?.character_id && // Add null check
          attacker?.ship_type_id && // Add null check
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

  $: activitiesToShow = ($activeActivities || [])
    .filter(
      (activity) =>
        // --- MODIFIED filter ---
        // Show standard camps, smartbombs, roaming camps (if they occur at gates),
        // and the new gate_battles. Explicitly exclude 'roam' and 'activity'.
        ["camp", "smartbomb", "roaming_camp", "gate_battle"].includes(
          // Added gate_battle, removed battle
          activity.classification
        ) &&
        // Ensure the activity has a stargate association, unless it's a battle
        // (which we now know is specifically a gate_battle)
        (activity.stargateName || activity.classification === "gate_battle") && // Keep gate_battle even if stargateName is briefly null? Or rely on classification? Let's rely on classification primarily.
        // Keep battles only if they meet the new gate_battle criteria (handled by the inclusion above)
        // Keep other camp types only if they have > 0 probability
        (activity.probability === undefined ||
          activity.probability > 0 ||
          activity.classification === "gate_battle") // Keep gate_battle even if probability dips
    )
    .sort((a, b) => (b.probability || 0) - (a.probability || 0)); // Sort by probability

  $: if (mounted && $activeActivities) isLoading = false;

  // --- CHANGE: Function to handle target selection ---
  async function handleTargetSelection(activity) {
    if (!isLoggedIn) {
      alert("Please log in to select a Camp Crusher target.");
      return;
    }
    // Ensure activity has necessary properties for the API call
    if (
      !activity ||
      !activity.id ||
      !activity.systemId ||
      !activity.stargateName
    ) {
      console.error("Invalid activity data for target selection:", activity);
      alert("Cannot select this target due to missing data.");
      return;
    }

    // Check if already selected
    if (currentTargetId === activity.id) {
      // Optional: Allow deselecting? For now, just clear it.
      console.log("Clearing current target.");
      selectedCampCrusherTargetId.set(null);
      currentTargetEndTime.set(null);
      // TODO: Call backend API to clear target if necessary
      return;
    }

    console.log("Attempting to set target:", activity.id);
    try {
      const response = await fetch("/api/campcrushers/target", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campId: activity.id, // Use activity.id
          systemId: activity.systemId, // Pass systemId
          stargateName: activity.stargateName, // Pass stargateName
        }),
      });

      const data = await response.json();

      if (data.success && data.endTime) {
        console.log("Target set successfully. End time:", data.endTime);
        selectedCampCrusherTargetId.set(activity.id); // Update store
        currentTargetEndTime.set(data.endTime); // Update end time store
      } else {
        console.error("Failed to set target:", data.error);
        alert(`Failed to set target: ${data.error || "Unknown error"}`);
        // Clear selection if API failed
        selectedCampCrusherTargetId.set(null);
        currentTargetEndTime.set(null);
      }
    } catch (error) {
      console.error("Error setting camp crusher target:", error);
      alert("An error occurred while setting the target.");
      selectedCampCrusherTargetId.set(null);
      currentTargetEndTime.set(null);
    }
  }
  // --- END CHANGE ---

  onMount(async () => {
    // ... (existing onMount logic for session check) ...
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
    return () => {
      mounted = false;
      // activityManager.cleanup(); // Cleanup moved potentially? Check App.svelte
    };
  });

  onDestroy(() => {
    // --- CHANGE: Unsubscribe from target store ---
    unsubTarget();
    // --- END CHANGE ---
    // activityManager.cleanup(); // Ensure cleanup happens
  });

  async function pinSystem(activity) {
    if (!isLoggedIn) return;
    try {
      const response = await fetch("/api/pinned-systems", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          system_id: activity.systemId,
          stargate_name: activity.stargateName, // Assuming camps still have stargateName
        }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.id) {
          pinnedSystemsComponent?.pinSystem({
            id: data.id,
            user_id: data.user_id,
            system_id: activity.systemId,
            stargate_name: activity.stargateName,
            activeCamp: activity, // Pass the whole activity
            probability: activity.probability,
          });
        }
      }
    } catch (error) {
      console.error("Error pinning system:", error);
    }
  }
  function formatValue(value) {
    if (!value) return "0 ISK";
    if (value >= 1000000000) return (value / 1000000000).toFixed(2) + "B";
    if (value >= 1000000) return (value / 1000000).toFixed(2) + "M";
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
      event.currentTarget.closest(".eve-card") ||
      event.currentTarget.closest("table");
    if (!container) return; // Check if container exists
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
    if (
      isLoggedIn &&
      activity.classification !== "battle" &&
      activity.classification !== "roaming_camp" &&
      activity.stargateName // Ensure it's a gate camp for pinning
    ) {
      // Only allow pinning for standard/SB camps at gates
      options.push({ label: "Pin System", action: () => pinSystem(activity) });
    }
    // Update the contextMenu state variable declared earlier
    contextMenu = { show: true, x, y, options };
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
    return (kills || []).some(
      (
        kill // Add default empty array
      ) =>
        (kill?.killmail?.attackers || []).some(
          // Add null checks
          (a) =>
            a?.ship_type_id && // Add null check
            [22456, 22464, 22452, 22460, 12013, 12017, 12021, 12025].includes(
              a.ship_type_id
            )
        )
    );
  }
  function formatProbabilityLog(log) {
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
    const latestKill = (activity.kills || [])[activity.kills.length - 1]; // Add default empty array
    if (latestKill) {
      const killTime = new Date(latestKill.killmail.killmail_time);
      const formattedTime = `${killTime.getUTCFullYear()}${String(killTime.getUTCMonth() + 1).padStart(2, "0")}${String(killTime.getUTCDate()).padStart(2, "0")}${String(killTime.getUTCHours()).padStart(2, "0")}${String(killTime.getUTCMinutes()).padStart(2, "0")}`;
      window.open(
        `https://zkillboard.com/related/${activity.systemId}/${formattedTime}/`,
        "_blank"
      );
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
                  activity.probability || 0
                )}"
              >
                {#if isLoggedIn && ["camp", "smartbomb"].includes(activity.classification) && activity.stargateName}
                  <button
                    type="button"
                    title={currentTargetId === activity.id
                      ? "Current Target (Click to Clear)"
                      : "Set as Target"}
                    class="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 ease-in-out z-10
                               {currentTargetId === activity.id
                      ? 'bg-red-500 hover:bg-red-600 scale-110 ring-2 ring-white'
                      : 'bg-gray-600 hover:bg-gray-500'}"
                    on:click|stopPropagation={() =>
                      handleTargetSelection(activity)}
                    aria-pressed={currentTargetId === activity.id}
                    aria-label={currentTargetId === activity.id
                      ? `Clear target ${activity.stargateName}`
                      : `Set ${activity.stargateName} as target`}
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
                on:keypress={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    openActivityHistory(activity);
                  }
                }}
              >
                <div class="flex justify-between items-center mb-3">
                  <div class="flex items-center gap-2">
                    <span
                      class="px-2 py-1 rounded text-black font-bold text-sm"
                      style="background-color: {getProbabilityColor(
                        activity.probability || 0
                      )}"
                    >
                      {Math.round(activity.probability || 0)}% Confidence
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
                        (activity.classification === "gate_battle"
                          ? "Gate Battle"
                          : "Unknown Gate")}
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
                        {activity.metrics.partyMetrics.characters} pilots
                        {#if activity.metrics.partyMetrics.corporations > 0}
                          from {activity.metrics.partyMetrics.corporations} corps{#if activity.metrics.partyMetrics.alliances > 0}
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
                      {#if !expandedCompositionCards.has(activity.id)}
                        <span
                          class="ml-1 px-1.5 py-0.5 bg-eve-accent/20 rounded-full text-xs"
                          >{Object.keys(getAccurateShipCounts(activity))
                            .length}</span
                        >
                      {/if}
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
                on:keypress={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    openActivityHistory(activity);
                  }
                }}
                role="button"
                tabindex="0"
              >
                <td class="px-4 py-2"
                  >{activity.stargateName || "Battle Zone"}</td
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
                <td class="px-4 py-2">
                  <span
                    class="px-2 py-1 rounded text-black text-sm"
                    style="background-color: {getProbabilityColor(
                      activity.probability || 0
                    )}">{Math.round(activity.probability || 0)}%</span
                  >
                </td>
                <td class="px-4 py-2">
                  {(activity.kills || []).length} kills {#if activity.metrics?.podKills > 0}({activity
                      .metrics.podKills} pods){/if}
                </td>
                <td class="px-4 py-2 text-eve-danger"
                  >{formatValue(activity.totalValue)}</td
                >
                <td class="px-4 py-2">
                  {#if activity.metrics?.partyMetrics}{activity.metrics
                      .partyMetrics.characters} pilots {#if activity.metrics.partyMetrics.corporations > 0}({activity
                        .metrics.partyMetrics.corporations} corps){/if}
                  {:else if activity.composition}{activity.composition
                      .activeCount || 0} pilots
                  {:else}Computing...{/if}
                </td>
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
