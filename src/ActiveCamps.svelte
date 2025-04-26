<script>
  import { onMount, onDestroy } from "svelte";
  import CampCrusher from "./CampCrusher.svelte"; // Default import for Camp Crusher panel
  import activityManager, { activeActivities } from "./activityManager.js"; // Manages fetching/updating activities
  import { CAMP_PROBABILITY_FACTORS, CAPSULE_ID } from "./constants.js"; // Shared constants
  import ContextMenu from "./ContextMenu.svelte"; // Custom right-click menu component
  import PinnedSystemsList from "./PinnedSystemsList.svelte"; // Component to display pinned systems
  import {
    selectedCampCrusherTargetId, // Store: ID of the current Camp Crusher target
    currentTargetEndTime, // Store: End time for the current target
    isTargetSelectionActive, // Store: Boolean, true if target selection mode is active
    cancelTarget, // Store: Function to cancel the current target
    isCampCrusherPanelVisible, // Store: Boolean, true if the main Camp Crusher panel is visible
  } from "./campCrusherTargetStore.js"; // Stores related to Camp Crusher feature
  import { get } from "svelte/store"; // Utility to get store value non-reactively (use sparingly)
  import { getValidAccessToken } from "./tokenManager.js"; // Utility to get valid ESI access token

  // --- Debug Flag ---
  // Set this to true to enable the probability log tooltip on hover over cards
  let debug = false;
  // --- End Debug Flag ---

  // Destructure constants if needed, ensure they are actually used.
  // const { THREAT_SHIPS } = CAMP_PROBABILITY_FACTORS;

  // --- Component State ---
  let viewMode = "cards"; // Display mode: 'cards' or 'chart'
  let isLoading = true; // True while fetching initial data or activities are not yet loaded
  let mounted = false; // Tracks if the component has successfully mounted in the DOM
  let isLoggedIn = false; // Tracks user login status (fetched onMount)
  let pinnedSystemsComponent; // Reference to the PinnedSystemsList component instance for direct calls (e.g., pinSystem)
  let expandedCompositionCards = new Set(); // Set to track which activity cards have their ship composition section expanded
  let mainContainerElement; // Reference to the main div.p-4 container element for positioning calculations

  // --- Subscribe to stores ---
  // Local variables that will reactively update when the corresponding store value changes
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

  // State for the right-click context menu management
  let contextMenu = { show: false, x: 0, y: 0, options: [] };

  // Mappings for displaying activity classification icons and their tooltips
  const classificationIcons = {
    camp: "⛺", // Standard gate camp
    smartbomb: "⚡", // Smartbombing activity
    roaming_camp: "🏕️", // Camp spanning multiple systems/gates
    battle: "⚔️", // Large-scale battle indication
    roam: "➡️", // General roaming gang activity
    activity: "❓", // Default/unclassified activity
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
   * Modifies the 'expandedCompositionCards' set to trigger UI updates.
   * @param {Event} e - The click event object.
   * @param {string} activityId - The unique ID of the activity whose composition is being toggled.
   */
  function toggleCompositionExpansion(e, activityId) {
    e.stopPropagation(); // Prevent the click from triggering parent actions (like opening history)
    if (expandedCompositionCards.has(activityId)) {
      expandedCompositionCards.delete(activityId);
    } else {
      expandedCompositionCards.add(activityId);
    }
    // Trigger Svelte's reactivity by reassigning the set
    expandedCompositionCards = expandedCompositionCards;
  }

  /**
   * Calculates the count of unique attacker ship types involved in an activity's kills.
   * This method avoids double-counting by tracking unique character-ship pairs.
   * @param {object} activity - The activity object, expected to contain a 'kills' array.
   * @returns {object} An object mapping shipTypeId (string) to its count (number).
   */
  function getAccurateShipCounts(activity) {
    const uniqueAttackerShips = new Map(); // Use a Map for efficient unique key storage

    // Iterate safely through kills and attackers, handling potential null/undefined values
    (activity.kills || []).forEach((kill) => {
      (kill?.killmail?.attackers || []).forEach((attacker) => {
        // Only count valid player attackers not in capsules
        if (
          attacker?.character_id &&
          attacker?.ship_type_id &&
          attacker?.ship_type_id !== CAPSULE_ID
        ) {
          // Create a unique key combining character ID and ship type ID
          const key = `${attacker.character_id}-${attacker.ship_type_id}`;
          // Set the key in the map. We only care that the key exists once.
          // Storing minimal info is slightly more memory efficient than storing the whole attacker object.
          if (!uniqueAttackerShips.has(key)) {
            uniqueAttackerShips.set(key, {
              shipTypeId: attacker.ship_type_id,
            });
          }
        }
      });
    });

    // Count the occurrences of each ship type ID from the unique pairs
    const shipCounts = {};
    for (const { shipTypeId } of uniqueAttackerShips.values()) {
      shipCounts[shipTypeId] = (shipCounts[shipTypeId] || 0) + 1;
    }
    return shipCounts;
  }

  // --- Reactive Data Processing ---

  // $: creates a reactive statement. This filters and sorts the activities
  // whenever the source ($activeActivities) changes.
  $: activitiesToShow = ($activeActivities || [])
    .filter(
      (activity) =>
        activity && // Ensure the activity object itself is valid
        // 1. Include only camp-like classifications (exclude 'battle' and 'roam')
        ["camp", "smartbomb", "roaming_camp"].includes(
          activity.classification
        ) &&
        // 2. Strictly require a stargate name (ensures it's on a gate)
        activity.stargateName &&
        // 3. Strictly require probability to be greater than 0
        activity.probability > 0
    )
    // Sort activities: Primarily by probability (descending), then potentially by last activity time as a tie-breaker.
    .sort((a, b) => {
      const probDiff = (b.probability || 0) - (a.probability || 0);
      if (probDiff !== 0) return probDiff;
      // Optional: Add secondary sort key, e.g., last activity time
      const timeA = new Date(a.lastKill || a.lastActivity || 0).getTime();
      const timeB = new Date(b.lastKill || b.lastActivity || 0).getTime();
      return timeB - timeA; // Sort by time descending as secondary
    });

  // Reactive statement to update loading status
  $: if (mounted && $activeActivities) isLoading = false;

  // --- Camp Crusher Interaction ---

  /**
   * Handles setting a selected activity as the Camp Crusher target via API call.
   * Performs validation checks before proceeding.
   * Updates relevant stores on success or failure.
   * @param {object} activity - The activity object selected as the target.
   */
  async function handleSetTarget(activity) {
    // Validation 1: User must be logged in.
    if (!isLoggedIn) {
      alert("Please log in to select a Camp Crusher target.");
      return;
    }

    // Validation 2: Requires essential targeting data (ID, SystemID, StargateName).
    // Backend relies on stargateName for defining the target area.
    if (!activity?.id || !activity?.systemId || !activity?.stargateName) {
      // Note: Battles are already filtered out, so specific battle message isn't strictly needed here anymore,
      // but kept for robustness in case filter changes again.
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

    // Validation 3: Prevent setting a new target if one is already active.
    // Get current target ID non-reactively for immediate check.
    if (get(selectedCampCrusherTargetId)) {
      alert(
        "An active target already exists. Please cancel it first using the red button."
      );
      return;
    }

    console.log(
      `Attempting to set Camp Crusher target: ${activity.id} (${activity.stargateName})`
    );
    try {
      const response = await fetch("/api/campcrushers/target", {
        method: "POST",
        credentials: "include", // Essential for sending session cookies
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campId: activity.id, // The unique ID of the activity
          systemId: activity.systemId, // System where the activity is primarily located
          stargateName: activity.stargateName, // Specific gate associated with the target
        }),
      });

      const data = await response.json();

      if (response.ok && data.success && data.endTime) {
        // Success: Update stores to reflect the new target state
        selectedCampCrusherTargetId.set(activity.id);
        currentTargetEndTime.set(data.endTime);
        isTargetSelectionActive.set(false); // Automatically exit selection mode
        console.log(
          `Target set successfully. Ends at: ${new Date(data.endTime).toLocaleTimeString()}`
        );
      } else {
        // Handle errors reported by the backend API
        throw new Error(
          data.error || "Unknown error setting target on backend."
        );
      }
    } catch (error) {
      console.error("Error setting camp crusher target:", error);
      alert(`Failed to set target: ${error.message}`);
      isTargetSelectionActive.set(false); // Exit selection mode even on error
    }
  }

  // --- Lifecycle Hooks ---

  /**
   * Svelte Lifecycle Function: Runs once after the component is first rendered to the DOM.
   * Used here to check the user's initial login status and start activity updates.
   */
  onMount(async () => {
    // Check session status on component load
    try {
      const response = await fetch("/api/session", { credentials: "include" });
      if (response.ok) {
        const data = await response.json();
        isLoggedIn = !!data.user; // User is logged in if the session returns user data
        console.log(
          `[ActiveCamps onMount] Session check: User ${isLoggedIn ? "IS" : "is NOT"} logged in.`
        );
      } else {
        isLoggedIn = false; // Assume not logged in if request fails or returns non-OK status
        console.log(
          `[ActiveCamps onMount] Session check failed or user not logged in (Status: ${response.status}).`
        );
      }
    } catch (error) {
      console.error("[ActiveCamps onMount] Error checking session:", error);
      isLoggedIn = false; // Assume not logged in on network or other errors
    }
    mounted = true; // Mark component as mounted
    activityManager.startUpdates(); // Start fetching/updating activity data
    console.log(
      "[ActiveCamps onMount] Component mounted, started activity updates."
    );
  });

  /**
   * Svelte Lifecycle Function: Runs just before the component is removed from the DOM.
   * Crucial for cleanup: unsubscribes from Svelte stores to prevent memory leaks.
   */
  onDestroy(() => {
    // Unsubscribe from all store subscriptions to prevent memory leaks
    unsubTarget();
    unsubSelection();
    unsubPanelVisible();
    // Optional: Consider stopping activityManager updates if this is the only component using it.
    // activityManager.stopUpdates();
    console.log(
      "[ActiveCamps onDestroy] Component destroyed, unsubscribed from stores."
    );
  });

  // --- Other Utility Functions ---

  /**
   * Pins a system associated with an activity via an API call.
   * Requires the user to be logged in.
   * @param {object} activity - The activity object containing system and location details.
   */
  async function pinSystem(activity) {
    if (!isLoggedIn) {
      alert("Login required to pin systems.");
      return;
    }

    // Determine the system name, preferring data from killmail pinpoints if available
    const systemName =
      activity.kills?.[0]?.pinpoints?.celestialData?.solarsystemname ||
      activity.systemName || // Fallback to systemName directly on the activity object
      null; // Fallback if no name is found

    // Require stargateName for pinning consistency, as this defines the specific location of interest
    // Note: Battles are filtered out upstream, but validation kept for robustness
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

    console.log(
      `Attempting to pin: ${activity.stargateName} in system ${activity.systemId}`
    );
    try {
      const response = await fetch("/api/pinned-systems", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // Send cookies for authentication
        body: JSON.stringify({
          system_id: activity.systemId,
          stargate_name: activity.stargateName, // Backend uses this to identify the pinned location
          system_name: systemName, // Send resolved system name if available
        }),
      });

      if (response.ok) {
        const data = await response.json();
        // If successful and API returns the new pin ID, update the PinnedSystemsList component UI
        if (data.id && pinnedSystemsComponent) {
          // Call the 'pinSystem' method exposed by the child component instance
          pinnedSystemsComponent.pinSystem({
            id: data.id,
            user_id: data.user_id || null, // Store user ID if provided by backend
            system_id: activity.systemId,
            stargate_name: activity.stargateName,
            system_name:
              data.system_name || systemName || `System ${activity.systemId}`, // Prefer name from API response, then local, then ID
            created_at: data.created_at || new Date().toISOString(), // Use server time or fallback to client time
            // Add any other relevant data for the pinned item display
            probability: activity.probability, // Capture probability at the time of pinning
          });
          console.log(
            `System ${activity.systemId} (${activity.stargateName}) pinned successfully.`
          );
        } else if (!pinnedSystemsComponent) {
          console.warn(
            "Pin successful, but PinnedSystemsList component reference is missing."
          );
        } else {
          console.error(
            "Pin API call succeeded but did not return expected data (ID).",
            data
          );
          alert("Pinning succeeded but failed to update list. Please refresh."); // User feedback
        }
      } else {
        // Handle API errors during pinning more specifically
        const errorText = await response.text();
        console.error(
          `Failed to pin system via API: ${response.status} ${response.statusText}`,
          errorText
        );
        alert(
          `Failed to pin system: ${response.statusText || response.status}. ${errorText || ""}`
        );
      }
    } catch (error) {
      // Handle network errors or issues with the fetch call itself
      console.error("Error pinning system:", error);
      alert(`Error pinning system: ${error.message}`);
    }
  }

  /**
   * Formats a potentially large number (like ISK value) into a shorter, more readable string
   * using K (thousands), M (millions), or B (billions) suffixes.
   * @param {number | string | null | undefined} value - The numeric value to format.
   * @returns {string} The formatted string (e.g., "1.23B ISK", "500K ISK", "0 ISK").
   */
  function formatValue(value) {
    const num = Number(value); // Ensure value is a number
    if (isNaN(num) || num === 0) return "0 ISK"; // Handle invalid or zero input

    if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + "B";
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + "M";
    if (num >= 1_000) return (num / 1_000).toFixed(2) + "K";
    return num.toFixed(0); // For values less than 1000, show the number directly
  }

  /**
   * Converts a timestamp into a human-readable relative time string (e.g., "just now", "5 minutes ago").
   * @param {string | number | Date | null | undefined} timestamp - The timestamp to format. Can be ISO string, epoch ms, or Date object.
   * @returns {string} Relative time string (e.g., "5 minutes ago", "unknown", "invalid date").
   */
  function getTimeAgo(timestamp) {
    if (timestamp === null || timestamp === undefined) return "unknown"; // Handle null/undefined input

    const then = new Date(timestamp).getTime();
    // Check if the conversion resulted in a valid date/time
    if (isNaN(then)) return "invalid date";

    const now = Date.now();
    const minutes = Math.floor((now - then) / (1000 * 60)); // Calculate difference in minutes

    if (minutes < 1) return "just now";
    if (minutes === 1) return "1 min ago"; // Slightly shorter
    return `${minutes} mins ago`; // Use "mins" for brevity
  }

  /**
   * Sets the in-game autopilot destination using the ESI UI endpoint.
   * Requires a valid ESI access token with the 'esi-ui.write_waypoint.v1' scope.
   * Provides user feedback via alerts on success or failure.
   * @param {number} systemId - The destination solar system ID.
   * @param {boolean} [clearOthers=true] - If true, clears existing waypoints; if false, adds as the next waypoint.
   * @returns {Promise<boolean>} True if the ESI call was successfully initiated (HTTP 204), false otherwise.
   */
  async function setDestination(systemId, clearOthers = true) {
    if (!systemId || typeof systemId !== "number") {
      console.error("Invalid systemId provided for setDestination:", systemId);
      alert("Cannot set destination: Invalid system ID.");
      return false;
    }

    try {
      const accessToken = await getValidAccessToken(); // Attempt to get a valid token
      if (!accessToken) {
        // If no token, prompt user (token manager might handle refresh attempts)
        alert(
          "Please log in with EVE (including ESI UI scopes) to set destination."
        );
        // Optionally trigger a re-login flow here
        return false;
      }

      // Construct the ESI URL
      const url = `https://esi.evetech.net/latest/ui/autopilot/waypoint/?add_to_beginning=false&clear_other_waypoints=${clearOthers}&datasource=tranquility&destination_id=${systemId}`;

      console.log(`Calling ESI setDestination: ${url}`);
      const result = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` }, // Include token in Authorization header
      });

      // Check the response status
      if (!result.ok) {
        // Handle common ESI errors with specific user feedback
        if (result.status === 401) {
          // Unauthorized - Token likely expired or invalid
          window.dispatchEvent(new CustomEvent("session-expired")); // Notify app about session issue
          alert(
            "EVE Session expired or token is invalid. Please log in again to set destination."
          );
        } else if (result.status === 403) {
          // Forbidden - Token valid but missing required scope
          alert(
            "Failed to set destination: Missing required ESI scope (esi-ui.write_waypoint.v1). Please re-authenticate with correct permissions."
          );
        } else if (result.status === 420) {
          // Error limited
          alert(
            "Failed to set destination: ESI rate limit exceeded. Please wait a moment and try again."
          );
        } else {
          // Other errors
          const errorBody = await result.text();
          alert(
            `Failed to set destination: ESI Error ${result.status}. ${errorBody}`
          );
        }
        // Log the error details and throw an error to be caught below
        console.error(
          `Failed ESI setDestination call. Status: ${result.status}`,
          await result.text()
        );
        throw new Error(`ESI request failed with status ${result.status}`);
      }

      // Success (ESI returns 204 No Content on success)
      console.log(
        `Destination/Waypoint set successfully via ESI for system ${systemId}.`
      );
      // Optionally provide a subtle success notification instead of an alert
      // showNotification(`Waypoint set to system ${systemId}`, 'success');
      return true;
    } catch (error) {
      // Catch errors from getValidAccessToken() or the fetch call itself
      console.error("Error during setDestination process:", error);
      // Avoid duplicate alerts if already handled in the !result.ok block
      if (!error.message.startsWith("ESI request failed")) {
        alert(
          `An error occurred while trying to set the destination: ${error.message}`
        );
      }
      return false;
    }
  }

  /**
   * Handles the 'contextmenu' (right-click) event triggered on an activity card or table row.
   * Calculates the correct position for the menu relative to the main container (`div.p-4`)
   * where the <ContextMenu> component instance lives.
   * Updates the 'contextMenu' state to display the menu.
   * @param {MouseEvent} event - The standard contextmenu mouse event.
   * @param {object} activity - The specific activity data associated with the clicked UI element.
   */
  function handleContextMenu(event, activity) {
    event.preventDefault(); // Prevent the default browser right-click menu

    // Ensure the main container element reference is available
    if (!mainContainerElement) {
      console.error(
        "Main container reference not available for context menu positioning."
      );
      return;
    }

    // Get the location of the main container relative to the viewport
    const mainContainerBounds = mainContainerElement.getBoundingClientRect();

    // Calculate the menu's desired top-left coordinates (x, y)
    // by subtracting the main container's position from the mouse click's viewport position.
    // This makes (x, y) relative to the main container's top-left corner.
    const x = event.clientX - mainContainerBounds.left;
    const y = event.clientY - mainContainerBounds.top;

    // Define the base options available for all activities with a valid system ID
    let options = [];
    if (activity?.systemId) {
      options = [
        {
          label: "Set Destination", // Option to set as primary destination (clears others)
          action: () => setDestination(activity.systemId, true),
          disabled: !isLoggedIn, // Disable if not logged in (ESI call requires auth)
          title: !isLoggedIn
            ? "Login required"
            : `Set autopilot destination to System ${activity.systemId} (clears others)`,
        },
        {
          label: "Add Waypoint", // Option to add as the next waypoint
          action: () => setDestination(activity.systemId, false),
          disabled: !isLoggedIn, // Disable if not logged in
          title: !isLoggedIn
            ? "Login required"
            : `Add System ${activity.systemId} as next waypoint`,
        },
      ];
    } else {
      // If no systemId, show a disabled placeholder or omit destination options
      options.push({ label: "Set Destination (No System ID)", disabled: true });
    }

    // Add "Pin System" option conditionally:
    // - User must be logged in.
    // - Activity must be a type suitable for pinning (camp, smartbomb, roaming_camp). Note: 'battle' excluded by upstream filter now.
    // - Activity *must* have a stargateName (required for backend pinning logic).
    if (
      isLoggedIn &&
      ["camp", "smartbomb", "roaming_camp"].includes(activity.classification) && // Adjusted list
      activity.stargateName && // Check if stargateName is present
      activity.systemId // Also ensure systemId exists for pinning
    ) {
      options.push({
        label: "Pin System/Gate",
        action: () => pinSystem(activity),
        title: `Pin ${activity.stargateName} in System ${activity.systemId}`,
      });
    }

    // Update the contextMenu state variable to display the menu at the calculated position.
    // The <ContextMenu> component uses these x/y props for its 'left' and 'top' styles,
    // positioning it correctly within the main div.p-4 (which has position: relative).
    contextMenu = { show: true, x, y, options };
    console.log(
      `Context menu opened for activity ${activity.id} at position (${x}, ${y}) relative to main container.`
    );
  }

  /**
   * Handles the 'select' event dispatched by the ContextMenu component when an option is clicked.
   * Executes the 'action' function associated with the selected menu option and hides the menu.
   * @param {CustomEvent} event - The custom event dispatched by ContextMenu.svelte, containing the selected option object in `event.detail`.
   */
  function handleMenuSelect(event) {
    const option = event.detail; // The selected option object { label, action, disabled?, title? }
    console.log(`Context menu option selected: ${option.label}`);
    // Execute the action if it exists and is a function
    if (option && typeof option.action === "function") {
      option.action();
    }
    contextMenu.show = false; // Hide the context menu after selection or dismissal
  }

  /**
   * Determines the background color for probability indicators based on the probability score.
   * Higher probability generally indicates higher confidence or danger.
   * @param {number | null | undefined} probability - The numeric probability score (expected 0-100).
   * @returns {string} A hex color code representing the probability level.
   */
  function getProbabilityColor(probability) {
    const probNum = Number(probability); // Ensure it's a number, default to 0 if invalid
    if (isNaN(probNum)) return "#90ee90"; // Default color (light green) for invalid input

    if (probNum >= 80) return "#ff4444"; // Very High / Confirmed (Red)
    if (probNum >= 60) return "#ff8c00"; // High (Orange)
    if (probNum >= 40) return "#ffd700"; // Medium (Yellow)
    // Note: Since the filter requires prob > 0, the lowest value displayed will have *some* green.
    return "#90ee90"; // Low / Initial (Light Green)
  }

  /**
   * Checks if any kill associated with the activity involves an Interdictor or Heavy Interdictor ship.
   * Useful for quickly identifying warp disruption capabilities.
   * @param {Array<object> | null | undefined} kills - The array of kill objects for the activity.
   * @returns {boolean} True if an Interdictor or HIC ship type ID is found among the attackers in any killmail.
   */
  function hasInterdictor(kills) {
    // Define EVE Type IDs for relevant ship classes
    const interdictorTypeIds = [
      // Interdictors (Bubbles)
      22456, // Flycatcher (Caldari)
      22464, // Eris (Gallente)
      22452, // Heretic (Amarr)
      22460, // Sabre (Minmatar)
      // Heavy Interdictors (Focused Point/Scriptable Bubble)
      12013, // Devoter (Amarr)
      12017, // Onyx (Caldari)
      12021, // Phobos (Gallente)
      12025, // Broadsword (Minmatar)
    ];
    // Use .some() for efficiency - stops checking as soon as one is found
    return (kills || []).some(
      (
        kill // Iterate through kills safely
      ) =>
        (kill?.killmail?.attackers || []).some(
          (
            attacker // Iterate through attackers safely
          ) =>
            attacker?.ship_type_id &&
            interdictorTypeIds.includes(attacker.ship_type_id) // Check if ship_type_id is in the list
        )
    );
  }

  /**
   * Formats the probability log array (which can contain strings or objects)
   * into a human-readable, multi-line string suitable for display in a tooltip or `<pre>` tag.
   * @param {Array<string|object> | null | undefined} log - The probability calculation log array.
   * @returns {string} A formatted string with entries separated by newlines.
   */
  function formatProbabilityLog(log) {
    if (!log || !Array.isArray(log) || log.length === 0) {
      return "No probability log available.";
    }
    // Process each entry in the log array
    return log
      .map((entry) => {
        // If the entry is an object, stringify it with indentation for readability
        if (typeof entry === "object" && entry !== null) {
          return JSON.stringify(entry, null, 2); // null replacer, 2 spaces indentation
        }
        // Otherwise, convert the entry to a string directly
        return String(entry);
      })
      .join("\n"); // Join all formatted entries with newline characters
  }

  /**
   * Opens the zKillboard "related" page for the activity, centered on the time and system
   * of the latest kill. Falls back to the system page if no kills are available.
   * @param {object} activity - The activity object containing kill data and system info.
   */
  function openActivityHistory(activity) {
    // Find the latest kill based on killmail_time
    const latestKill = (activity.kills || []).reduce((latest, current) => {
      const latestTime = latest
        ? new Date(latest.killmail?.killmail_time).getTime()
        : 0;
      const currentTime = new Date(current.killmail?.killmail_time).getTime();
      return currentTime > latestTime ? current : latest;
    }, null);

    if (latestKill && latestKill.killmail?.killmail_time && latestKill.killID) {
      const killTime = new Date(latestKill.killmail.killmail_time);
      // Format time as YYYYMMDDHHMM for zKillboard URL structure
      const formattedTime = `${killTime.getUTCFullYear()}${String(killTime.getUTCMonth() + 1).padStart(2, "0")}${String(killTime.getUTCDate()).padStart(2, "0")}${String(killTime.getUTCHours()).padStart(2, "0")}${String(killTime.getUTCMinutes()).padStart(2, "0")}`;

      // Determine the system ID to use for the link. Prefer system from the latest kill's pinpoint data if available.
      const systemToLink =
        latestKill.pinpoints?.celestialData?.solarsystemid ||
        activity.lastSystem?.id ||
        activity.systemId;

      if (systemToLink) {
        const url = `https://zkillboard.com/related/${systemToLink}/${formattedTime}/`;
        console.log(`Opening zKillboard related: ${url}`);
        window.open(url, "_blank", "noopener,noreferrer"); // Open securely in new tab
      } else {
        console.warn(
          "Could not determine system ID for zKillboard related link.",
          activity
        );
        alert("Could not determine the system for the zKillboard link.");
      }
    } else {
      // Fallback: If no kills or kill time info, open the primary system page on zKillboard
      console.warn(
        "No valid kill data found. Opening system page on zKillboard as fallback."
      );
      const systemToLink = activity.lastSystem?.id || activity.systemId;
      if (systemToLink) {
        const url = `https://zkillboard.com/system/${systemToLink}/`;
        console.log(`Opening zKillboard system: ${url}`);
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        console.warn(
          "Could not determine system ID for zKillboard system link.",
          activity
        );
        alert("Could not determine the system for the zKillboard link.");
      }
    }
  }

  /**
   * Shows the Camp Crusher panel and immediately activates target selection mode.
   * Typically called from a button click. Requires user to be logged in.
   */
  function showCampCrusherPanelAndActivate() {
    if (isLoggedIn) {
      console.log("Showing Camp Crusher Panel and Activating Selection Mode.");
      isCampCrusherPanelVisible.set(true); // Make the panel visible
      isTargetSelectionActive.set(true); // Turn on selection mode
    } else {
      // This button should ideally be hidden if not logged in, but add fallback alert.
      alert("Please log in with EVE to use Camp Crushers.");
    }
  }
</script>

<div class="p-4 relative" bind:this={mainContainerElement}>
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
      <h2 class="text-white text-2xl font-bold">Active Camps</h2>
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
        No active camps found matching filters.
      </p>
    {:else if viewMode === "cards"}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {#each activitiesToShow as activity (activity.id)}
          <div class="group relative">
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div
              class="eve-card overflow-hidden rounded-lg relative
                           {activity.state === 'CRASHED'
                ? 'opacity-70 grayscale-[0.7]'
                : ''}
                           {selectionActive &&
              !currentTargetId &&
              activity.stargateName && // Still check stargateName for target eligibility
              activity.state !== 'CRASHED'
                ? 'retro-card-active'
                : ''}"
              on:contextmenu|preventDefault={(e) =>
                handleContextMenu(e, activity)}
            >
              <div
                class="relative bg-eve-dark/90 bg-gradient-to-r from-eve-secondary/90 to-eve-secondary/40 p-3 border-t-2"
                style="border-color: {getProbabilityColor(
                  activity.probability // Probability is guaranteed > 0 by filter
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
                        ><path
                          fill-rule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                          clip-rule="evenodd"
                        /></svg
                      >
                    </button>
                  {:else if selectionActive && activity.stargateName && activity.state !== "CRASHED"}
                    <button
                      type="button"
                      title="Set as Target"
                      class="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 ease-in-out z-10 bg-gray-600 hover:bg-green-500
                                   {selectionActive
                        ? 'target-button-active'
                        : ''}"
                      on:click|stopPropagation={() => handleSetTarget(activity)}
                      aria-pressed={false}
                      aria-label={`Set ${activity.stargateName} as target`}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        class="w-5 h-5 text-white"
                        ><path
                          fill-rule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm0-2a6 6 0 100-12 6 6 0 000 12zm0-4a2 2 0 100-4 2 2 0 000 4z"
                          clip-rule="evenodd"
                        /></svg
                      >
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
                class="w-full text-left bg-eve-primary p-3 hover:bg-eve-primary/80 transition-colors"
                on:click={() => openActivityHistory(activity)}
                aria-label={`View details for ${activity.stargateName || activity.systemName || "activity"}`}
              >
                <div class="flex justify-between items-center mb-3">
                  <div class="flex items-center gap-2">
                    <span
                      class="px-2 py-1 rounded text-black font-bold text-sm"
                      style="background-color: {getProbabilityColor(
                        activity.probability // Probability is guaranteed > 0
                      )}"
                      title={`Confidence: ${Math.round(activity.probability || 0)}%`}
                    >
                      {`${Math.round(activity.probability || 0)}%`}
                    </span>
                  </div>
                  <button
                    type="button"
                    class="px-3 py-1 bg-eve-accent text-black font-medium rounded hover:bg-eve-accent/80 transition-colors text-xs"
                    title="View Latest Kill on zKillboard"
                    on:click|stopPropagation={(e) => {
                      e.preventDefault(); // Prevent card body click
                      const latestKill = (activity.kills || [])[
                        activity.kills.length - 1
                      ];
                      if (latestKill?.killID) {
                        window.open(
                          `https://zkillboard.com/kill/${latestKill.killID}/`,
                          "_blank",
                          "noopener,noreferrer"
                        );
                      } else {
                        // Fallback: open system page if no specific kill link available
                        openActivityHistory(activity);
                      }
                    }}
                  >
                    Last Kill
                  </button>
                </div>

                <div class="space-y-1 text-sm">
                  <div
                    class="flex justify-between py-0.5 border-b border-white/10"
                  >
                    <span class="text-gray-400">Location:</span>
                    <span class="text-white truncate"
                      >{activity.stargateName}</span
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
                    <span class="text-gray-400">Last Seen:</span>
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
                      {#if activity.metrics?.podKills > 0}
                        ({activity.metrics.podKills} pods){/if}
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
                    <span class="text-white truncate">
                      {#if activity.metrics?.partyMetrics}
                        {activity.metrics.partyMetrics.characters} pilots {#if activity.metrics.partyMetrics.corporations > 0}
                          from {activity.metrics.partyMetrics.corporations} corps
                          {#if activity.metrics.partyMetrics.alliances > 0}
                            in {activity.metrics.partyMetrics.alliances} alliances{/if}
                        {/if}
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
                    <div
                      class="text-center py-1 bg-eve-danger/50 rounded mt-1 text-xs font-bold"
                    >
                      CRASHED
                    </div>
                  {/if}
                </div>
              </button>

              {#if activity.metrics?.shipCounts || activity.kills?.length > 0}
                <div class="mt-1 bg-eve-secondary/80 rounded">
                  <div class="flex items-center h-10 px-3">
                    <button
                      type="button"
                      class="text-eve-accent hover:text-eve-accent/80 px-3 py-1 bg-eve-dark/80 rounded flex items-center gap-1 text-sm"
                      on:click={(e) =>
                        toggleCompositionExpansion(e, activity.id)}
                      aria-expanded={expandedCompositionCards.has(activity.id)}
                      aria-controls={`composition-${activity.id}`}
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
                        {@const shipCount = Object.keys(
                          getAccurateShipCounts(activity)
                        ).length}
                        {#if shipCount > 0}
                          <span
                            class="ml-1 px-1.5 py-0.5 bg-eve-accent/20 rounded-full text-xs"
                            >{shipCount}</span
                          >
                        {/if}
                      {/if}
                    </button>
                  </div>
                  {#if expandedCompositionCards.has(activity.id)}
                    <div
                      id={`composition-${activity.id}`}
                      class="p-3 max-h-48 overflow-y-auto border-t border-eve-accent/10"
                    >
                      <div class="flex flex-col gap-1 text-sm">
                        {#each Object.entries(getAccurateShipCounts(activity)) as [shipId, count]}
                          {@const shipData = (activity.kills || [])
                            .flatMap((k) => k?.shipCategories?.attackers || [])
                            .find((ship) => ship?.shipTypeId == shipId)}
                          <div
                            class="flex justify-between items-center border-b border-eve-accent/10 py-1"
                          >
                            <span
                              class="text-white truncate"
                              title={shipData?.name || `Ship ID ${shipId}`}
                              >{shipData?.name || `Ship #${shipId}`}</span
                            >
                            <span class="text-eve-accent font-semibold"
                              >×{count}</span
                            >
                          </div>
                        {:else}
                          <span class="text-gray-400 italic text-xs"
                            >No specific attacker ship data available.</span
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
                class="hidden group-hover:block absolute top-full left-0 right-0 z-50 mt-1 max-w-full"
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
        <table class="w-full relative text-sm">
          <thead class="bg-eve-secondary sticky top-0 z-10">
            <tr>
              <th
                class="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase tracking-wider"
                >Location</th
              >
              <th
                class="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase tracking-wider"
                >Type</th
              >
              <th
                class="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase tracking-wider"
                >Status</th
              >
              <th
                class="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase tracking-wider"
                >Activity</th
              >
              <th
                class="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase tracking-wider"
                >Value</th
              >
              <th
                class="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase tracking-wider"
                >Composition</th
              >
              <th
                class="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase tracking-wider"
                >Last Seen</th
              >
            </tr>
          </thead>
          <tbody class="bg-eve-primary">
            {#each activitiesToShow as activity (activity.id)}
              <tr
                class="border-b border-eve-secondary/30 hover:bg-eve-secondary/20 cursor-pointer
                             {selectionActive &&
                !currentTargetId &&
                activity.stargateName && // Still check for target eligibility
                activity.state !== 'CRASHED'
                  ? 'retro-row-active'
                  : ''}"
                on:click={() => openActivityHistory(activity)}
                on:contextmenu|preventDefault={(e) =>
                  handleContextMenu(e, activity)}
                role="button"
                tabindex="0"
                aria-label={`View details for ${activity.stargateName || activity.systemName || "activity"}`}
                class:opacity-50={activity.state === "CRASHED"}
              >
                <td class="px-4 py-2 text-white whitespace-nowrap">
                  {activity.stargateName}
                  <span class="text-gray-400 text-xs block"
                    >{activity.systemName || `(${activity.systemId})`}</span
                  >
                </td>
                <td class="px-4 py-2 text-center">
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
                    class="px-2 py-1 rounded text-black text-xs font-bold"
                    style="background-color: {getProbabilityColor(
                      activity.probability // Guaranteed > 0
                    )}"
                    title={`Confidence: ${Math.round(activity.probability || 0)}%`}
                  >
                    {`${Math.round(activity.probability || 0)}%`}
                  </span>
                  {#if activity.state === "CRASHED"}<span
                      class="ml-1 text-red-500 text-xs font-bold"
                      >(CRASHED)</span
                    >{/if}
                </td>
                <td class="px-4 py-2 text-white whitespace-nowrap">
                  {(activity.kills || []).length} kills
                  {#if activity.metrics?.podKills > 0}
                    <span class="text-gray-400 text-xs"
                      >({activity.metrics.podKills} pods)</span
                    >{/if}
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
                    {activity.metrics.partyMetrics.characters} pilots {#if activity.metrics.partyMetrics.corporations > 0}<span
                        class="text-gray-400 text-xs"
                        >({activity.metrics.partyMetrics.corporations} corps)</span
                      >{/if}
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
  <ContextMenu
    show={contextMenu.show}
    x={contextMenu.x}
    y={contextMenu.y}
    options={contextMenu.options}
    on:select={handleMenuSelect}
    on:close={() => (contextMenu.show = false)}
  />
</div>

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
    font-family: "VT323", monospace; /* Retro font */
    border: 2px solid #0f0;
    background: #0a0;
    padding: 8px 16px;
    border-radius: 0; /* Sharp edges */
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

  .eve-card {
    position: relative;
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
    cursor: pointer;
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
    height: calc(100vh - 150px);
    overflow-y: auto;
  }
  thead th {
    position: sticky;
    top: 0;
    background-color: inherit;
    z-index: 10;
  }
  td,
  th {
    padding: 0.5rem 1rem;
  }
  tbody tr:hover {
    background-color: rgba(255, 255, 255, 0.05);
  }
  .p-4 {
    position: relative;
  }
  .eve-card {
    position: relative;
  }
  table {
    position: relative;
  }
</style>
