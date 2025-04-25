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
    isCampCrusherPanelVisible, // Import panel visibility state
  } from "./campCrusherTargetStore.js";
  import { get } from "svelte/store";
  import { getValidAccessToken } from "./tokenManager.js";

  // --- Debug Flag ---
  // Set this to true to enable the probability log tooltip on hover over cards
  let debug = false;
  // --- End Debug Flag ---

  const { THREAT_SHIPS } = CAMP_PROBABILITY_FACTORS; // Assuming THREAT_SHIPS is used, otherwise remove

  // --- Component State ---
  let viewMode = "cards"; // 'cards' or 'chart'
  let isLoading = true; // True while fetching initial data or activities
  let mounted = false; // Tracks if the component has mounted
  let isLoggedIn = false; // Tracks user login status
  let pinnedSystemsComponent; // Reference to the PinnedSystemsList component instance
  let expandedCompositionCards = new Set(); // Set to track which activity cards have ship composition expanded

  // --- Subscribe to stores ---
  // These variables will reactively update when the corresponding store value changes
  let currentTargetId; // Holds the ID of the currently selected Camp Crusher target
  let selectionActive; // True if Camp Crusher target selection mode is active
  let panelVisible; // True if the main Camp Crusher panel should be visible

  // Subscribe to selectedCampCrusherTargetId store
  const unsubTarget = selectedCampCrusherTargetId.subscribe((value) => {
    currentTargetId = value;
  });

  // Subscribe to isTargetSelectionActive store
  const unsubSelection = isTargetSelectionActive.subscribe((value) => {
    selectionActive = value;
  });

  // Subscribe to isCampCrusherPanelVisible store
  const unsubPanelVisible = isCampCrusherPanelVisible.subscribe((value) => {
    panelVisible = value;
  });
  // --- END Store Subscriptions ---

  // State for the right-click context menu
  let contextMenu = { show: false, x: 0, y: 0, options: [] };

  // Mappings for activity classification icons and tooltips
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

  /**
   * Toggles the expansion state of the ship composition section for a given activity card.
   * @param {Event} e - The click event.
   * @param {string} activityId - The ID of the activity card.
   */
  function toggleCompositionExpansion(e, activityId) {
    e.stopPropagation(); // Prevent click from propagating to parent elements
    if (expandedCompositionCards.has(activityId)) {
      expandedCompositionCards.delete(activityId);
    } else {
      expandedCompositionCards.add(activityId);
    }
    // Trigger reactivity by reassigning the set
    expandedCompositionCards = expandedCompositionCards;
  }

  /**
   * Calculates the count of unique attacker ship types involved in an activity's kills.
   * It ensures each character is only counted once per ship type they flew.
   * @param {object} activity - The activity object containing kills.
   * @returns {object} An object mapping shipTypeId to its count.
   */
  function getAccurateShipCounts(activity) {
    const uniqueAttackerShips = new Map(); // Map to store unique character-ship pairs

    // Iterate through each kill associated with the activity
    (activity.kills || []).forEach((kill) => {
      // Iterate through each attacker in the killmail
      (kill?.killmail?.attackers || []).forEach((attacker) => {
        // Check if attacker is a player character and not in a capsule
        if (
          attacker?.character_id &&
          attacker?.ship_type_id &&
          attacker?.ship_type_id !== CAPSULE_ID // Exclude pods
        ) {
          // Create a unique key for this character flying this specific ship type
          const key = `${attacker.character_id}-${attacker.ship_type_id}`;
          // Store minimal data, we only care about the combination's existence
          uniqueAttackerShips.set(key, {
            characterId: attacker.character_id,
            shipTypeId: attacker.ship_type_id,
          });
        }
      });
    });

    // Count occurrences of each ship type across the unique character-ship pairs
    const shipCounts = {};
    for (const { shipTypeId } of uniqueAttackerShips.values()) {
      shipCounts[shipTypeId] = (shipCounts[shipTypeId] || 0) + 1;
    }
    return shipCounts;
  }

  // Reactive statement: Filters and sorts activities whenever activeActivities changes
  $: activitiesToShow = ($activeActivities || [])
    .filter(
      (activity) =>
        activity && // Basic check: Ensure activity object exists
        // Filter 1: Include only specific classifications relevant to this view
        ["camp", "smartbomb", "roaming_camp", "battle"].includes(
          activity.classification
        ) &&
        // Filter 2: Must have a specific stargate name OR be classified as a battle
        (activity.stargateName || activity.classification === "battle") &&
        // Filter 3: Must have a calculated probability > 0 OR be a battle
        // (Ensures battles always show up even if their calculated probability is low initially)
        (activity.probability === undefined || // Handles case before probability is calculated
          activity.probability > 0 ||
          activity.classification === "battle")
    )
    // Sort primarily by probability (descending), then by last activity time (descending)
    .sort((a, b) => (b.probability || 0) - (a.probability || 0));

  // Reactive statement: Set loading to false once component is mounted and activities are available
  $: if (mounted && $activeActivities) isLoading = false;

  /**
   * Handles setting a selected activity as the Camp Crusher target.
   * Performs validation and sends the request to the backend API.
   * @param {object} activity - The activity object selected as the target.
   */
  async function handleSetTarget(activity) {
    // Check 1: User must be logged in
    if (!isLoggedIn) {
      alert("Please log in to select a Camp Crusher target.");
      return;
    }

    // Check 2: Essential data must exist for targeting (ID, SystemID, StargateName)
    // We require stargateName even for battles for consistent targeting mechanism.
    if (!activity?.id || !activity?.systemId || !activity?.stargateName) {
      if (activity.classification === "battle" && !activity.stargateName) {
        alert(
          "Cannot target this battle: No specific stargate location identified for targeting."
        );
      } else {
        console.error("Invalid activity data for target selection:", activity);
        alert("Cannot select this target due to missing stargate data.");
      }
      return;
    }

    // Check 3: Prevent setting a new target if one is already active
    if (currentTargetId) {
      alert("An active target already exists. Please cancel it first.");
      return;
    }

    console.log("Attempting to set target:", activity.id);
    try {
      // API call to set the target
      const response = await fetch("/api/campcrushers/target", {
        method: "POST",
        credentials: "include", // Send cookies
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campId: activity.id,
          systemId: activity.systemId,
          stargateName: activity.stargateName, // Backend requires this
        }),
      });

      const data = await response.json();

      // If successful, update the stores
      if (response.ok && data.success && data.endTime) {
        selectedCampCrusherTargetId.set(activity.id);
        currentTargetEndTime.set(data.endTime);
        isTargetSelectionActive.set(false); // Turn off selection mode automatically
      } else {
        // Handle API errors
        throw new Error(
          data.error || "Unknown error setting target on backend"
        );
      }
    } catch (error) {
      console.error("Error setting camp crusher target:", error);
      alert(`Failed to set target: ${error.message}`);
    }
  }

  /**
   * Lifecycle function: Runs after the component is added to the DOM.
   * Checks login status and starts activity updates.
   */
  onMount(async () => {
    // Check initial login status
    try {
      const response = await fetch("/api/session", { credentials: "include" });
      if (response.ok) {
        const data = await response.json();
        isLoggedIn = !!data.user; // Set based on presence of user data
      }
    } catch (error) {
      console.error("Error checking session:", error);
      isLoggedIn = false; // Assume not logged in on error
    }
    mounted = true; // Mark component as mounted
    activityManager.startUpdates(); // Start fetching live activity updates
  });

  /**
   * Lifecycle function: Runs just before the component is removed from the DOM.
   * Unsubscribes from stores to prevent memory leaks.
   */
  onDestroy(() => {
    // Unsubscribe from all stores
    unsubTarget();
    unsubSelection();
    unsubPanelVisible();
    // Optionally stop activity manager updates if this component is the main driver
    // activityManager.stopUpdates();
    console.log("ActiveCamps component destroyed, unsubscribed from stores.");
  });

  // --- Other helper functions ---

  /**
   * Pins a system (associated with an activity) via an API call.
   * Requires the user to be logged in and the activity to have a stargate name.
   * @param {object} activity - The activity object containing system details.
   */
  async function pinSystem(activity) {
    if (!isLoggedIn) return; // Should ideally be prevented by UI, but double-check

    // Determine system name, preferring pinpoint data
    const systemName =
      activity.kills?.[0]?.pinpoints?.celestialData?.solarsystemname ||
      activity.systemName || // Fallback to systemName on activity object
      null;

    // Require stargateName for pinning consistency, even for battles.
    if (!activity.systemId || !activity.stargateName) {
      if (activity.classification === "battle" && !activity.stargateName) {
        alert(
          "Cannot pin this battle: No specific stargate location identified for pinning."
        );
      } else {
        console.error(
          "Cannot pin: Missing systemId or stargateName in activity",
          activity
        );
        alert("Cannot pin this item: missing required stargate data.");
      }
      return;
    }

    try {
      const response = await fetch("/api/pinned-systems", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // Send cookies for authentication
        body: JSON.stringify({
          system_id: activity.systemId,
          stargate_name: activity.stargateName, // Required by backend for pinning
          system_name: systemName, // Optional, but helpful
        }),
      });

      if (response.ok) {
        const data = await response.json();
        // If successful and API returns the new pin ID, update the PinnedSystemsList component
        if (data.id) {
          pinnedSystemsComponent?.pinSystem({
            // Call method on child component instance
            id: data.id,
            user_id: data.user_id || null, // User ID might be useful later
            system_id: activity.systemId,
            stargate_name: activity.stargateName,
            system_name: data.system_name || `System ${activity.systemId}`, // Prefer name from API response
            created_at: data.created_at || new Date().toISOString(),
            probability: activity.probability, // Include probability at time of pinning
          });
        } else {
          console.error(
            "Pin API call succeeded but did not return expected data.",
            data
          );
        }
      } else {
        // Handle API errors during pinning
        console.error(
          "Failed to pin system via API:",
          response.status,
          await response.text()
        );
        alert(
          `Failed to pin system: ${response.statusText || response.status}`
        );
      }
    } catch (error) {
      console.error("Error pinning system:", error);
      alert(`Error pinning system: ${error.message}`);
    }
  }

  /**
   * Formats a large number (ISK value) into a shorter string (K, M, B).
   * @param {number} value - The number to format.
   * @returns {string} Formatted string (e.g., "1.23B ISK").
   */
  function formatValue(value) {
    if (!value) return "0 ISK";
    if (value >= 1000000000) return (value / 1000000000).toFixed(2) + "B"; // Billions
    if (value >= 1000000) return (value / 1000000).toFixed(2) + "M"; // Millions
    return (value / 1000).toFixed(2) + "K"; // Thousands
  }

  /**
   * Formats a timestamp into a relative time string (e.g., "5 minutes ago").
   * @param {string | number | Date} timestamp - The timestamp to format.
   * @returns {string} Relative time string.
   */
  function getTimeAgo(timestamp) {
    if (!timestamp) return "unknown";
    const now = Date.now();
    const then = new Date(timestamp).getTime();
    // Check if the timestamp is valid
    if (isNaN(then)) return "invalid date";

    const minutes = Math.floor((now - then) / (1000 * 60));

    if (minutes < 1) return "just now";
    if (minutes === 1) return "1 minute ago";
    return `${minutes} minutes ago`;
  }

  /**
   * Sets the in-game autopilot destination using ESI UI endpoint.
   * Requires valid ESI token with ui scopes.
   * @param {number} systemId - The destination solar system ID.
   * @param {boolean} [clearOthers=true] - Whether to clear existing waypoints.
   * @returns {Promise<boolean>} True if successful, false otherwise.
   */
  async function setDestination(systemId, clearOthers = true) {
    try {
      const accessToken = await getValidAccessToken(); // Get token via token manager
      if (!accessToken) {
        alert(
          "Please log in with EVE (including ESI UI scopes) to set destination."
        );
        return false;
      }
      // ESI endpoint for setting waypoints
      const url = `https://esi.evetech.net/latest/ui/autopilot/waypoint/?add_to_beginning=false&clear_other_waypoints=${clearOthers}&datasource=tranquility&destination_id=${systemId}`;
      const result = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!result.ok) {
        // Handle specific ESI errors
        if (result.status === 401) {
          // Unauthorized / Token expired
          window.dispatchEvent(new CustomEvent("session-expired")); // Notify other components
          alert(
            "EVE Session expired or invalid scopes. Please log in again to set destination."
          );
        } else if (result.status === 403) {
          // Forbidden / Missing scope
          alert(
            "Failed to set destination: Missing required ESI scope (esi-ui.write_waypoint.v1). Please re-authenticate."
          );
        } else {
          // Generic error
          alert(`Failed to set destination: ESI Error ${result.status}`);
        }
        throw new Error(`Failed to set destination: ESI ${result.status}`);
      }
      console.log(`Destination set successfully to system ${systemId}`);
      return true; // Success
    } catch (error) {
      console.error("Error setting destination:", error);
      // Avoid duplicate alerts if already handled above
      return false; // Failure
    }
  }

  /**
   * Handles the contextmenu (right-click) event on activity cards or rows.
   * Displays a custom context menu with relevant actions.
   * @param {MouseEvent} event - The contextmenu event.
   * @param {object} activity - The activity object associated with the clicked item.
   */
  function handleContextMenu(event, activity) {
    event.preventDefault(); // Prevent default browser context menu

    // Find the container element (card or table) for positioning
    const container =
      event.currentTarget.closest(".eve-card") ||
      event.currentTarget.closest("table");
    if (!container) return;

    // Calculate menu position relative to the container
    const containerBounds = container.getBoundingClientRect();
    const x = event.clientX - containerBounds.left;
    const y = event.clientY - containerBounds.top;

    // Define menu options
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

    // Add "Pin System" option only if logged in and activity has a stargate name
    if (
      isLoggedIn &&
      ["camp", "smartbomb", "battle"].includes(activity.classification) &&
      activity.stargateName // Require stargateName for pinning consistency
    ) {
      options.push({ label: "Pin System", action: () => pinSystem(activity) });
    }

    // Update context menu state to show it
    contextMenu = { show: true, x, y, options };
  }

  /**
   * Handles the 'select' event emitted by the ContextMenu component.
   * Executes the selected option's action and hides the menu.
   * @param {CustomEvent} event - The event containing the selected option.
   */
  function handleMenuSelect(event) {
    const option = event.detail; // Get selected option from event detail
    if (option && typeof option.action === "function") {
      option.action(); // Execute the action
    }
    contextMenu.show = false; // Hide the menu
  }

  /**
   * Determines the background/border color based on numeric probability score.
   * @param {number} probability - The numeric probability score (0-100).
   * @returns {string} Hex color code.
   */
  function getProbabilityColor(probability) {
    const probNum = probability || 0; // Default to 0 if null/undefined
    if (probNum >= 80) return "#ff4444"; // Red (High danger)
    if (probNum >= 60) return "#ff8c00"; // Orange (Medium-High danger)
    if (probNum >= 40) return "#ffd700"; // Yellow (Medium danger)
    return "#90ee90"; // Green (Low danger / Initial state)
  }

  /**
   * Checks if any kill in the activity involves an Interdictor or HIC.
   * @param {Array<object>} kills - The array of kill objects for the activity.
   * @returns {boolean} True if an Interdictor or HIC is present among attackers.
   */
  function hasInterdictor(kills) {
    const interdictorTypeIds = [
      // Interdictors
      22456, // Flycatcher
      22464, // Eris
      22452, // Heretic
      22460, // Sabre
      // Heavy Interdictors (HICs)
      12013, // Devoter
      12017, // Onyx
      12021, // Phobos
      12025, // Broadsword
    ];
    return (kills || []).some(
      (
        kill // Iterate through kills
      ) =>
        (kill?.killmail?.attackers || []).some(
          (
            a // Iterate through attackers
          ) => a?.ship_type_id && interdictorTypeIds.includes(a.ship_type_id) // Check ship type
        )
    );
  }

  /**
   * Formats the probability log array into a readable string for display.
   * @param {Array<string|object>} log - The probability log array.
   * @returns {string} Formatted log string.
   */
  function formatProbabilityLog(log) {
    if (!log || !Array.isArray(log)) return "No probability log available.";
    // Format each entry, handling objects with JSON stringify
    return log
      .map(
        (entry) =>
          typeof entry === "object"
            ? JSON.stringify(entry, null, 2) // Pretty print objects
            : String(entry) // Convert others to string
      )
      .join("\n"); // Join entries with newlines
  }

  /**
   * Opens the zKillboard related page for the activity's time and location.
   * Falls back to the system page if no kills are available.
   * @param {object} activity - The activity object.
   */
  function openActivityHistory(activity) {
    // Find the timestamp of the latest kill
    const latestKill = (activity.kills || [])[activity.kills.length - 1];

    if (latestKill) {
      const killTime = new Date(latestKill.killmail.killmail_time);
      // Format time as YYYYMMDDHHMM for zKillboard URL
      const formattedTime = `${killTime.getUTCFullYear()}${String(killTime.getUTCMonth() + 1).padStart(2, "0")}${String(killTime.getUTCDate()).padStart(2, "0")}${String(killTime.getUTCHours()).padStart(2, "0")}${String(killTime.getUTCMinutes()).padStart(2, "0")}`;
      // Use the system ID where the *last* activity occurred, or fallback to primary system ID
      const systemToLink = activity.lastSystem?.id || activity.systemId;

      if (systemToLink) {
        const url = `https://zkillboard.com/related/${systemToLink}/${formattedTime}/`;
        console.log(`Opening zKillboard related: ${url}`);
        window.open(url, "_blank", "noopener,noreferrer"); // Open in new tab safely
      } else {
        console.warn(
          "Could not determine system ID to link for zKillboard related page."
        );
      }
    } else {
      // If no kills exist in the activity data (e.g., only classification), open system page
      console.warn(
        "No kills found in activity to link to zKillboard related page. Opening system page instead."
      );
      const systemToLink = activity.lastSystem?.id || activity.systemId;
      if (systemToLink) {
        const url = `https://zkillboard.com/system/${systemToLink}/`;
        console.log(`Opening zKillboard system: ${url}`);
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        console.warn(
          "Could not determine system ID to link for zKillboard system page."
        );
      }
    }
  }

  /**
   * Shows the main Camp Crusher panel AND immediately activates selection mode.
   * Called when the "Play Campcrushers" button is clicked.
   */
  function showCampCrusherPanelAndActivate() {
    if (isLoggedIn) {
      console.log("Showing Camp Crusher Panel and Activating Selection Mode.");
      isCampCrusherPanelVisible.set(true); // Show the panel
      isTargetSelectionActive.set(true); // Activate selection immediately
    } else {
      // Should ideally not happen if button is hidden, but provide feedback
      alert("Please log in with EVE to use Camp Crushers.");
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
    {#if isLoggedIn && !panelVisible}
      <div class="flex justify-center mb-8">
        <button
          type="button"
          class="camp-crusher-activate-button"
          on:click={showCampCrusherPanelAndActivate}
          title="Activate Camp Crushers"
        >
          Play Campcrushers
        </button>
      </div>
    {/if}

    {#if panelVisible}
      <div class="flex justify-center mb-8">
        <CampCrusher />
      </div>
    {/if}

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
              class="eve-card overflow-hidden rounded-lg {activity.state ===
              'CRASHED'
                ? 'opacity-70 grayscale-[0.7]'
                : ''}"
              class:retro-card-active={selectionActive &&
                !currentTargetId &&
                activity.state !== "CRASHED"}
              on:contextmenu|preventDefault={(e) =>
                handleContextMenu(e, activity)}
            >
              <div
                class="relative bg-eve-dark/90 bg-gradient-to-r from-eve-secondary/90 to-eve-secondary/40 p-3 border-t-2"
                style="border-color: {getProbabilityColor(
                  activity.probability || 0
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
                      class:target-button-active={selectionActive}
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
                    ?.solarsystemname ||
                    activity.systemName ||
                    activity.systemId}
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
                        activity.probability || 0
                      )}"
                    >
                      {`${Math.round(activity.probability || 0)}%`}
                    </span>
                  </div>
                  <button
                    type="button"
                    class="px-3 py-1 bg-eve-accent text-black font-medium rounded hover:bg-eve-accent/80 transition-colors"
                    title="View Latest Kill on zKillboard"
                    on:click|stopPropagation={(e) => {
                      e.preventDefault(); // Prevent card body click
                      const latestKill = (activity.kills || [])[
                        activity.kills.length - 1
                      ];
                      if (latestKill) {
                        window.open(
                          `https://zkillboard.com/kill/${latestKill.killID}/`,
                          "_blank",
                          "noopener,noreferrer"
                        );
                      } else {
                        const systemToLink =
                          activity.lastSystem?.id || activity.systemId;
                        if (systemToLink) {
                          window.open(
                            `https://zkillboard.com/system/${systemToLink}/`,
                            "_blank",
                            "noopener,noreferrer"
                          );
                        }
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
                    <span class="text-white"
                      >{activity.stargateName ||
                        (activity.classification === "battle"
                          ? "Battle Zone"
                          : "Unknown Location")}</span
                    >
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
                      >{getTimeAgo(
                        activity.lastKill || activity.lastActivity
                      )}</span
                    >
                  </div>
                  <div
                    class="flex justify-between py-0.5 border-b border-white/10"
                  >
                    <span class="text-gray-400">Activity:</span>
                    <span class="text-white flex items-center">
                      {(activity.kills || []).filter(
                        (k) => k?.killmail?.victim?.ship_type_id !== CAPSULE_ID
                      ).length} kills
                      {#if activity.metrics?.podKills > 0}({activity.metrics
                          .podKills} pods){/if}
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
                      {:else}
                        Computing...
                      {/if}
                    </span>
                  </div>
                  {#if activity.state === "CRASHED"}
                    <div class="text-center py-1 bg-eve-danger/50 rounded mt-1">
                      CRASHED
                    </div>
                  {/if}
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
                      aria-expanded={expandedCompositionCards.has(activity.id)}
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
                        >
                          {Object.keys(getAccurateShipCounts(activity)).length}
                        </span>
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
                        {:else}
                          <span class="text-gray-400 italic text-sm"
                            >No attacker ship data available.</span
                          >
                        {/each}
                      </div>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
            {#if debug}
              <div
                class="hidden group-hover:block absolute top-full left-0 right-0 z-50 mt-1"
              >
                <pre
                  class="bg-eve-primary text-white p-3 rounded border border-eve-accent/20 font-mono text-xs leading-relaxed shadow-lg max-w-[500px] max-h-[400px] overflow-y-auto">{formatProbabilityLog(
                    activity.probabilityLog
                  )}</pre>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead class="bg-eve-secondary">
            <tr>
              <th
                class="px-4 py-2 text-left text-sm font-medium text-gray-300 uppercase tracking-wider"
                >Location</th
              >
              <th
                class="px-4 py-2 text-left text-sm font-medium text-gray-300 uppercase tracking-wider"
                >Type</th
              >
              <th
                class="px-4 py-2 text-left text-sm font-medium text-gray-300 uppercase tracking-wider"
                >Status</th
              >
              <th
                class="px-4 py-2 text-left text-sm font-medium text-gray-300 uppercase tracking-wider"
                >Activity</th
              >
              <th
                class="px-4 py-2 text-left text-sm font-medium text-gray-300 uppercase tracking-wider"
                >Value</th
              >
              <th
                class="px-4 py-2 text-left text-sm font-medium text-gray-300 uppercase tracking-wider"
                >Composition</th
              >
              <th
                class="px-4 py-2 text-left text-sm font-medium text-gray-300 uppercase tracking-wider"
                >Last Activity</th
              >
            </tr>
          </thead>
          <tbody>
            {#each activitiesToShow as activity (activity.id)}
              <tr
                class="border-b border-eve-secondary/30 hover:bg-eve-secondary/20 cursor-pointer"
                on:click={() => openActivityHistory(activity)}
                on:contextmenu|preventDefault={(e) =>
                  handleContextMenu(e, activity)}
                role="button"
                tabindex="0"
                class:retro-row-active={selectionActive &&
                  !currentTargetId &&
                  activity.state !== "CRASHED"}
              >
                <td class="px-4 py-2 text-white whitespace-nowrap">
                  {activity.stargateName ||
                    (activity.classification === "battle"
                      ? "Battle Zone"
                      : "Unknown Location")}
                  <span class="text-gray-400 text-xs block"
                    >{activity.systemName || `(${activity.systemId})`}</span
                  >
                </td>
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
                    class="px-2 py-1 rounded text-black text-sm font-bold"
                    style="background-color: {getProbabilityColor(
                      activity.probability || 0
                    )}"
                  >
                    {`${Math.round(activity.probability || 0)}%`}
                  </span>
                </td>
                <td class="px-4 py-2 text-white">
                  {(activity.kills || []).length} kills
                  {#if activity.metrics?.podKills > 0}
                    <span class="text-gray-400 text-xs"
                      >({activity.metrics.podKills} pods)</span
                    >
                  {/if}
                  {#if hasInterdictor(activity.kills)}<span
                      class="ml-1"
                      title="Interdictor/HICTOR present">⚠️</span
                    >{/if}
                </td>
                <td
                  class="px-4 py-2 text-eve-danger font-semibold whitespace-nowrap"
                >
                  {formatValue(activity.totalValue)}
                </td>
                <td class="px-4 py-2 text-white whitespace-nowrap">
                  {#if activity.metrics?.partyMetrics}
                    {activity.metrics.partyMetrics.characters} pilots {#if activity.metrics.partyMetrics.corporations > 0}
                      <span class="text-gray-400 text-xs"
                        >({activity.metrics.partyMetrics.corporations} corps)</span
                      >
                    {/if}
                  {:else if activity.composition}
                    {activity.composition.activeCount || 0} pilots
                  {:else}
                    Computing...
                  {/if}
                </td>
                <td class="px-4 py-2 text-eve-accent whitespace-nowrap">
                  {getTimeAgo(activity.lastKill || activity.lastActivity)}
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
  /* --- Style for Active Target Button --- */
  .target-button-active {
    background-color: #0f0 !important; /* Neon green background */
    box-shadow:
      0 0 12px #0f0,
      0 0 6px #3f3 inset; /* Green glow */
    animation: pulse-target-button 1.5s infinite ease-in-out;
    border: 1px solid #3f3; /* Slightly brighter border */
  }
  .target-button-active:hover {
    background-color: #3f3 !important; /* Brighter green on hover */
    box-shadow:
      0 0 18px #3f3,
      0 0 8px #6f6 inset;
  }
  .target-button-active svg {
    fill: #000 !important; /* Black icon on green background */
  }

  @keyframes pulse-target-button {
    0% {
      transform: scale(1);
      box-shadow:
        0 0 10px #0f0,
        0 0 4px #3f3 inset;
    }
    50% {
      transform: scale(1.1);
      box-shadow:
        0 0 18px #3f3,
        0 0 8px #6f6 inset;
    }
    100% {
      transform: scale(1);
      box-shadow:
        0 0 10px #0f0,
        0 0 4px #3f3 inset;
    }
  }
  /* --- END Active Target Button Style --- */

  /* --- Styles for initial activate button, retro cards/rows --- */
  .camp-crusher-activate-button {
    font-family: "VT323", monospace;
    border: 2px solid #0f0;
    background: #0a0;
    padding: 8px 16px;
    border-radius: 0;
    box-shadow:
      0 0 10px #0f0,
      0 0 3px #0f0 inset,
      2px 2px 0px #050;
    text-transform: uppercase;
    color: #fff;
    cursor: pointer;
    font-size: 1.1rem;
    transition: all 0.2s ease-out;
    animation: glow 2s infinite alternate;
  }
  .camp-crusher-activate-button:hover {
    background: #0f0;
    color: #000;
    box-shadow:
      0 0 15px #0f0,
      0 0 5px #0f0 inset,
      3px 3px 0px #080;
  }
  .camp-crusher-activate-button:active {
    box-shadow:
      0 0 5px #0f0,
      0 0 2px #0f0 inset,
      1px 1px 0px #050;
    transform: translate(1px, 1px);
  }

  @keyframes glow {
    from {
      box-shadow:
        0 0 8px #0f0,
        0 0 2px #0f0 inset,
        2px 2px 0px #050;
    }
    to {
      box-shadow:
        0 0 15px #3f3,
        0 0 5px #3f3 inset,
        2px 2px 0px #050;
    }
  }

  .eve-card.retro-card-active {
    border: 3px solid #0f0;
    background: radial-gradient(
      ellipse at top,
      rgba(0, 50, 0, 0.8) 0%,
      rgba(0, 20, 0, 0.9) 100%
    );
    box-shadow:
      0 0 10px #0f0,
      0 0 5px #0f0 inset;
    animation: pulse-border 1.5s infinite;
    cursor: pointer;
  }
  .retro-row-active {
    background-color: rgba(0, 80, 0, 0.4) !important;
    outline: 2px solid #0f0;
    outline-offset: -2px;
    animation: pulse-row 1.5s infinite;
  }
  .retro-row-active:hover {
    background-color: rgba(0, 120, 0, 0.5) !important;
  }

  @keyframes pulse-border {
    0% {
      box-shadow:
        0 0 8px #0f0,
        0 0 4px #0f0 inset;
      border-color: #0f0;
    }
    50% {
      box-shadow:
        0 0 16px #3f3,
        0 0 8px #3f3 inset;
      border-color: #3f3;
    }
    100% {
      box-shadow:
        0 0 8px #0f0,
        0 0 4px #0f0 inset;
      border-color: #0f0;
    }
  }
  @keyframes pulse-row {
    0% {
      outline-color: #0f0;
    }
    50% {
      outline-color: #3f3;
    }
    100% {
      outline-color: #0f0;
    }
  }

  /* --- General/Existing Styles --- */
  :global(.killmail-section) {
    /* Example for potential global style */
    height: calc(100vh - 150px);
    overflow-y: auto;
  }
</style>
