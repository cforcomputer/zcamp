<script>
  import { onMount, onDestroy } from "svelte";
  import { writable, get } from "svelte/store";
  import { activeActivities } from "./activityManager.js"; // [cite: 1793]
  import {
    selectedCampCrusherTargetId,
    currentTargetEndTime,
    isTargetSelectionActive,
    // cancelTarget, // Assuming cancelTarget is handled elsewhere or via dispatch if needed here
  } from "./campCrusherTargetStore.js"; // [cite: 1793]
  import socket from "./socket.js"; // Ensure socket is imported [cite: 1794]

  // DEBUG LOG 1: Check if import is resolved at module level
  console.log(
    "%cCampCrusher: Module Top Level - activeActivities:",
    "color: blue; font-weight: bold;",
    activeActivities // [cite: 1793]
  );

  let timeRemaining = null;
  let countdownInterval = null;
  let targetEndTime = null; // Store the Date object when countdown is active
  let characterName = null; // [cite: 1795]
  let userBashbucks = 0;
  let isLoadingStats = true;
  let selectedTargetObject = null; // [cite: 1796]
  let isCancelling = false; // Loading state for cancellation [cite: 1797]
  // Removed isSetting as it wasn't used

  // --- Subscribe to stores ---
  // Use reactive variables derived from stores where possible
  // Let the subscriptions primarily trigger updates via functions
  let currentTargetId; // [cite: 1797]
  let currentEndTimeISO; // [cite: 1798]
  let selectionActive; // [cite: 1799]

  const unsubTargetId = selectedCampCrusherTargetId.subscribe((value) => {
    console.log(
      "%cCampCrusher: selectedCampCrusherTargetId store changed:",
      "color: purple;",
      value
    );
    currentTargetId = value; // Keep local variable in sync if needed elsewhere
    updateSelectedTargetObject(); // Update display object when ID changes
    // triggerCountdownUpdate(); // Countdown is now triggered by endTimeISO change
  }); // [cite: 1799]

  const unsubEndTime = currentTargetEndTime.subscribe((value) => {
    console.log(
      "%cCampCrusher: currentTargetEndTime store changed:",
      "color: purple;",
      value
    );
    currentEndTimeISO = value; // Store the ISO string
    triggerCountdownUpdate(); // Update countdown logic when end time changes
  }); // [cite: 1800]

  const unsubSelectionActive = isTargetSelectionActive.subscribe((value) => {
    // console.log('CampCrusher: isTargetSelectionActive store changed:', value); // Less critical log
    selectionActive = value; // Keep local variable in sync
  }); // [cite: 1801]

  // Subscribing to activeActivities is necessary to update selectedTargetObject if the underlying activity data changes
  const unsubActivities = activeActivities.subscribe((activities) => {
    // console.log('CampCrusher: activeActivities store changed, updating selected target object if needed.'); // Can be noisy
    // Update selectedTargetObject if activities change while a target is active
    if (get(selectedCampCrusherTargetId)) {
      // Use get() here
      updateSelectedTargetObject();
    }
  }); // [cite: 1802]

  // --- Functions ---

  // Finds the activity object matching the current target ID
  function updateSelectedTargetObject() {
    const targetId = get(selectedCampCrusherTargetId); // Get current target ID from store [cite: 1803]

    // DEBUG LOG 2: Log status at function entry
    console.log(
      "%cCampCrusher: updateSelectedTargetObject - Called. Target ID:",
      "color: green;",
      targetId
    );

    // DEBUG LOG 3: Log activeActivities *before* calling get()
    console.log(
      "%cCampCrusher: updateSelectedTargetObject - activeActivities at entry:",
      "color: green; font-style: italic;",
      activeActivities // [cite: 1803]
    );

    let activities;
    try {
      // DEBUG LOG 4: Log just before the potential error
      console.log(
        "%cCampCrusher: updateSelectedTargetObject - About to call get(activeActivities)",
        "color: green; font-weight: bold;"
      );

      activities = get(activeActivities); // <<< Error happens here according to user [cite: 1803]

      // DEBUG LOG 5: Log the result *after* calling get()
      console.log(
        "%cCampCrusher: updateSelectedTargetObject - Result of get(activeActivities):",
        "color: green;",
        activities // [cite: 1803]
      );
    } catch (e) {
      console.error(
        "%cCampCrusher: updateSelectedTargetObject - ERROR during get(activeActivities):",
        "color: red; font-weight: bold;",
        e
      );
      selectedTargetObject = null; // Clear target if error occurs
      return; // Stop execution of this function
    }

    if (!Array.isArray(activities)) {
      console.warn(
        "CampCrusher: updateSelectedTargetObject - activities from store is not an array:",
        activities
      );
      selectedTargetObject = null;
      return;
    }

    if (targetId) {
      selectedTargetObject =
        activities.find((a) => a && a.id === targetId) || null; // Add check for 'a' [cite: 1804]
      console.log(
        `%cCampCrusher: updateSelectedTargetObject - Found target object for ID ${targetId}:`,
        "color: green;",
        selectedTargetObject // [cite: 1805]
      );
      if (selectedTargetObject === null && activities.length > 0) {
        // Target ID exists in store, but not found in current activity list
        // This is now expected if the activity expired/completed and was removed server-side
        console.log(
          `%cCampCrusher: updateSelectedTargetObject - Target ID ${targetId} exists in store but not in current activities list (likely completed/expired).`,
          "color: orange;"
        );
        // The stores should be cleared by countdown expiry or server event, but double-check later if needed
      }
    } else {
      selectedTargetObject = null; // [cite: 1807]
      // console.log('CampCrusher: updateSelectedTargetObject - No target ID set.'); // Less critical log
    }
  }

  // Clears local countdown state
  function clearCountdownDisplay() {
    if (countdownInterval) {
      clearInterval(countdownInterval); // [cite: 1808]
      countdownInterval = null;
    }
    timeRemaining = null; // [cite: 1809]
    targetEndTime = null; // Also clear the Date object
    console.log("%cCampCrusher: Cleared countdown display.", "color: gray;"); // [cite: 1810]
  }

  // Calculates and updates the displayed time remaining
  function updateTimer(endTimeMs, targetIdAtStart) {
    const now = Date.now(); // [cite: 1811]
    const remaining = endTimeMs - now;
    const currentSelectedId = get(selectedCampCrusherTargetId); // Check current ID inside interval [cite: 1812]

    // Stop if target changed or remaining is <= 0
    if (currentSelectedId !== targetIdAtStart || remaining <= 0) {
      console.log(
        `%cCampCrusher: Stopping countdown for ${targetIdAtStart}. Current target: ${currentSelectedId}, Remaining ms: ${remaining}`,
        "color: orange;" // [cite: 1813]
      );
      clearCountdownDisplay(); // Clear interval and display [cite: 1814]

      // If expiration is the cause and stores haven't been cleared yet by other means (like server event)
      if (remaining <= 0 && currentSelectedId === targetIdAtStart) {
        console.log(
          `%cCampCrusher: Target ${targetIdAtStart} expired naturally. Clearing stores.`,
          "color: orange;" // [cite: 1815]
        );
        selectedCampCrusherTargetId.set(null); // [cite: 1815]
        currentTargetEndTime.set(null); // [cite: 1815]
      }
    } else {
      timeRemaining = remaining; // Update display [cite: 1816]
    }
  }

  // Starts or restarts the countdown interval
  function startCountdown(endTimeDate, targetId) {
    if (countdownInterval) clearInterval(countdownInterval); // Clear existing interval [cite: 1817]
    const endTimeMs = endTimeDate.getTime(); // [cite: 1818]
    console.log(
      `%cCampCrusher: Starting/Restarting countdown for target ${targetId}. End time: ${endTimeDate.toISOString()}`,
      "color: cyan;" // [cite: 1819]
    );

    // Initial update
    updateTimer(endTimeMs, targetId); // [cite: 1820]

    // Set interval only if time is still remaining after initial update
    if (timeRemaining > 0) {
      countdownInterval = setInterval(
        () => updateTimer(endTimeMs, targetId),
        1000
      );
    } else {
      // If already expired on start, ensure display is clear
      clearCountdownDisplay();
    }
  }

  // **REVISED**: This function now reacts purely to store changes for endTimeISO
  function triggerCountdownUpdate() {
    // Removed redundant gets, use module-level currentTargetId and currentEndTimeISO
    console.log(
      `%cCampCrusher: triggerCountdownUpdate called. Target ID: ${currentTargetId}, EndTimeISO: ${currentEndTimeISO}`,
      "color: blue;" // [cite: 1821]
    );
    if (currentTargetId && currentEndTimeISO) {
      const endTime = new Date(currentEndTimeISO); // [cite: 1821]
      if (!isNaN(endTime.getTime())) {
        // [cite: 1822]
        // Check if date is valid
        if (endTime.getTime() > Date.now()) {
          // Valid future end time exists, start/update countdown
          targetEndTime = endTime; // Update the local Date object
          startCountdown(endTime, currentTargetId); // [cite: 1823]
        } else {
          // End time is valid but in the past
          console.log(
            "%cCampCrusher: triggerCountdownUpdate - End time is in the past. Clearing display.",
            "color: orange;" // [cite: 1824]
          );
          clearCountdownDisplay();
          // If stores still hold this ID (e.g., edge case), clear them.
          if (get(selectedCampCrusherTargetId) === currentTargetId) {
            console.log(
              "%cCampCrusher: triggerCountdownUpdate - Clearing potentially stale stores for past target.",
              "color: orange;" // [cite: 1825]
            );
            selectedCampCrusherTargetId.set(null); // [cite: 1825]
            currentTargetEndTime.set(null); // [cite: 1825]
          }
        }
      } else {
        // End time ISO string was invalid
        console.warn(
          `%cCampCrusher: triggerCountdownUpdate - Invalid Date from endTimeISO: ${currentEndTimeISO}. Clearing display.`,
          "color: red;"
        );
        clearCountdownDisplay();
      }
    } else {
      // No target ID or end time in store, ensure display and local state are clear
      // console.log('CampCrusher: triggerCountdownUpdate - No target/end time. Clearing display.'); // Less critical log
      clearCountdownDisplay(); // [cite: 1826]
    }
  }

  function formatTime(ms) {
    if (ms === null || ms < 0) return "0m 0s"; // [cite: 1827]
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`; // [cite: 1828]
  }

  // Toggles the visibility of target selection buttons on cards
  function toggleSelectionMode() {
    if (get(selectedCampCrusherTargetId)) return; // Don't toggle if target active [cite: 1829]
    isTargetSelectionActive.update((active) => !active); // [cite: 1830]
    console.log(
      "%cCampCrusher: Selection mode toggled to:",
      "color: magenta;",
      get(isTargetSelectionActive) // [cite: 1831]
    );
  }

  // --- Use cancelTarget from the store ---
  async function handleCancelClick() {
    // Local state to prevent double-clicks while API call is in progress
    if (isCancelling) return;
    isCancelling = true;
    try {
      // We need to get the ID *before* calling the async function
      // as the store might change while the API call is running
      const idToCancel = get(selectedCampCrusherTargetId);
      if (idToCancel) {
        console.log(`CampCrusher: Initiating cancel for target ${idToCancel}`);
        // Call the imported cancelTarget function (assuming it exists in campCrusherTargetStore.js)
        await cancelTarget();
        console.log(`CampCrusher: Cancel API call finished for ${idToCancel}`);
      } else {
        console.warn(
          "CampCrusher: Cancel button clicked but no target ID was set."
        );
      }
    } catch (error) {
      // The cancelTarget function should handle its own errors/alerts
      console.error(
        "CampCrusher: Error occurred during cancelTarget call:",
        error
      );
    } finally {
      isCancelling = false; // Reset loading state regardless of outcome
    }
  }

  // Fetch initial user/game stats
  async function fetchInitialStats() {
    isLoadingStats = true; // [cite: 1832]
    console.log("%cCampCrusher: Fetching initial stats...", "color: brown;");
    try {
      // Fetch Bashbucks
      const statsResponse = await fetch("/api/campcrushers/stats", {
        // [cite: 1832]
        credentials: "include",
      });
      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        userBashbucks = statsData.bashbucks || 0; // [cite: 1834]
        console.log("CampCrusher: Bashbucks fetched:", userBashbucks);
      } else if (statsResponse.status !== 401) {
        console.error(
          // [cite: 1834]
          "CampCrusher: Failed to fetch camp crusher stats:",
          statsResponse.status
        );
      } else {
        console.log("CampCrusher: Not logged in (stats fetch).");
      }

      // Fetch Session (for character name)
      const sessionResponse = await fetch("/api/session", {
        // [cite: 1835]
        credentials: "include",
      });
      if (sessionResponse.ok) {
        const sessionData = await sessionResponse.json();
        characterName = sessionData.user?.character_name; // [cite: 1836]
        console.log("CampCrusher: Session fetched, character:", characterName);
        // Initial target state should be set by store subscriptions
      } else if (sessionResponse.status !== 401) {
        console.error(
          // [cite: 1836]
          "CampCrusher: Failed to fetch session data:",
          sessionResponse.status
        );
      } else {
        console.log("CampCrusher: Not logged in (session fetch).");
      }
    } catch (error) {
      console.error("CampCrusher: Error fetching initial stats:", error); // [cite: 1837]
    } finally {
      isLoadingStats = false; // [cite: 1837]
    }
  }

  // Handle WebSocket updates for bashbucks
  function handleBashbucksUpdate(data) {
    console.log("CampCrusher: Received bashbucksUpdate:", data); // [cite: 1838]
    if (data && typeof data.newTotal === "number") {
      userBashbucks = data.newTotal; // [cite: 1839]
    } else if (data && typeof data.change === "number") {
      userBashbucks += data.change; // [cite: 1840]
    } else {
      console.warn(
        "CampCrusher: Received invalid bashbucksUpdate data, refetching."
      );
      fetchInitialStats(); // Fallback [cite: 1840]
    }
  }

  // Handle WebSocket updates for target completion/cancellation from server
  function handleTargetCompletedOrCancelled({ targetId }) {
    console.log(
      `%cCampCrusher: Received server event for target ${targetId} completion/cancellation.`,
      "color: orange;" // [cite: 1841]
    );
    const currentSelectedId = get(selectedCampCrusherTargetId); // Get current value from store [cite: 1841]
    if (currentSelectedId === targetId) {
      console.log(
        `%cCampCrusher: Clearing currently selected target ${targetId} based on server event.`,
        "color: orange;" // [cite: 1842]
      );
      // Setting stores to null will trigger reactive updates via subscriptions
      selectedCampCrusherTargetId.set(null); // [cite: 1843]
      currentTargetEndTime.set(null); // [cite: 1843]
      // clearTargetLocally() will be called via subscription to currentTargetEndTime
    } else {
      console.log(
        `%cCampCrusher: Server event for ${targetId} does not match current target ${currentSelectedId}. Ignoring.`,
        "color: gray;"
      );
    }
  }

  onMount(() => {
    console.log("%cCampCrusher: Component Mounted.", "color: blue;");
    fetchInitialStats();
    socket.on("bashbucksUpdate", handleBashbucksUpdate); // [cite: 1844]
    socket.on("targetCompleted", handleTargetCompletedOrCancelled); // Listen for completion [cite: 1844]
    socket.on("targetCancelled", handleTargetCompletedOrCancelled); // Listen for cancellation [cite: 1844]

    // Initial check/update of target object and countdown based on current store values
    updateSelectedTargetObject(); // [cite: 1844]
    triggerCountdownUpdate(); // [cite: 1844]
  });

  onDestroy(() => {
    console.log("%cCampCrusher: Component Destroyed.", "color: blue;");
    if (countdownInterval) clearInterval(countdownInterval); // [cite: 1844]
    // Unsubscribe from stores
    unsubTargetId(); // [cite: 1844]
    unsubEndTime(); // [cite: 1844]
    unsubSelectionActive(); // [cite: 1844]
    unsubActivities(); // [cite: 1844]
    // Unsubscribe from socket events
    socket.off("bashbucksUpdate", handleBashbucksUpdate); // [cite: 1844]
    socket.off("targetCompleted", handleTargetCompletedOrCancelled); // [cite: 1844]
    socket.off("targetCancelled", handleTargetCompletedOrCancelled); // [cite: 1844]
  });
</script>

<div class="camp-crusher retro-box">
  {#if !characterName && !isLoadingStats}
    <div class="auth-warning">
      <span class="blink">!</span> Log in with EVE to play!
      <span class="blink">!</span>
    </div>
  {:else if currentTargetId && selectedTargetObject}
    <div class="active-target">
      <h3 class="target-header">TARGET ACQUIRED:</h3>
      <p class="target-name">
        {selectedTargetObject?.stargateName ||
          selectedTargetObject?.systemId ||
          "Loading Target..."}
        {#if selectedTargetObject?.systemName}({selectedTargetObject.systemName}){/if}
      </p>
      {#if timeRemaining !== null}
        <p class="countdown">
          TIME REMAINING: <span class="timer">{formatTime(timeRemaining)}</span>
        </p>
      {/if}
      <button
        class="retro-button cancel-button"
        on:click={handleCancelClick}
        disabled={isCancelling}
      >
        {isCancelling ? "Cancelling..." : "Cancel Target"}
      </button>
      <p class="bashbucks-display">
        BASHBUCKS: <span class="value">{userBashbucks}</span>
      </p>
    </div>
  {:else if !isLoadingStats && characterName}
    <div class="idle-view">
      <button
        class="retro-button main-button"
        on:click={toggleSelectionMode}
        disabled={!!currentTargetId}
      >
        {selectionActive ? "CANCEL SELECTION" : "ACTIVATE CAMP CRUSHERS"}
      </button>
      {#if selectionActive}
        <p class="instruction-text blink">
          SELECT TARGET FROM ACTIVE CAMPS LIST
        </p>
      {/if}
      <p class="bashbucks-display">
        BASHBUCKS: <span class="value">{userBashbucks}</span>
      </p>
    </div>
  {:else if isLoadingStats}
    <div class="loading">Loading Stats...</div>
  {/if}
</div>

<style>
  /* Styles identical to previous response */
  .camp-crusher {
    font-family: "VT323", monospace; /* Retro pixel font */ /* */
    border: 4px solid #0f0; /* Neon green border */ /* */
    background: radial-gradient(
      ellipse at center,
      rgba(0, 20, 0, 0.9) 0%,
      rgba(0, 0, 0, 0.95) 100%
    );
    padding: 20px;
    border-radius: 0; /* Sharp corners */ /* */
    box-shadow:
      0 0 15px #0f0,
      0 0 5px #0f0 inset; /* */
    text-transform: uppercase; /* */
    color: #0f0; /* Neon green text */ /* */
    margin-top: 1em; /* */
  }

  .retro-button {
    background-color: #0f0; /* */
    color: #000; /* */
    border: 2px solid #0f0; /* */
    padding: 8px 15px; /* */
    font-family: inherit; /* */
    text-transform: inherit; /* */
    cursor: pointer; /* */
    transition:
      background-color 0.2s,
      color 0.2s,
      box-shadow 0.2s; /* */
    box-shadow: 3px 3px 0px #0a0; /* Simple shadow */ /* */
    font-size: 1.1em; /* */
  }
  .retro-button:hover:not(:disabled) {
    /* Added :not(:disabled) */
    background-color: #000; /* */
    color: #0f0; /* */
    box-shadow: 3px 3px 5px #0f0; /* */
  }
  .retro-button:active:not(:disabled) {
    /* Added :not(:disabled) */
    box-shadow: 1px 1px 0px #0a0; /* */
    transform: translate(2px, 2px); /* */
  }
  .retro-button:disabled {
    /* Style for disabled state */
    opacity: 0.5;
    cursor: not-allowed;
    box-shadow: 3px 3px 0px grey;
    background-color: grey;
    border-color: grey;
    color: #333;
  }

  .main-button {
    display: block; /* */
    margin: 0 auto 15px auto; /* Center button */ /* */
    min-width: 200px; /* */
  }

  .auth-warning,
  .loading {
    text-align: center; /* */
    font-size: 1.2em; /* */
    padding: 1em; /* */
    color: #f00; /* Red for warning */ /* */
    border: 2px dashed #f00; /* */
  }
  .loading {
    color: #0f0; /* Green for loading */ /* */
    border-color: #0f0; /* */
  }

  .active-target,
  .idle-view {
    text-align: center; /* */
  }

  .target-header,
  .instruction-text {
    font-size: 1.3em; /* */
    margin-bottom: 10px; /* */
    text-shadow: 0 0 5px #0f0; /* */
  }

  .target-name {
    color: #fff; /* White target name */ /* */
    font-size: 1.5em; /* */
    margin: 10px 0; /* */
    font-weight: bold; /* */
    text-shadow: 0 0 8px #fff; /* */
    word-break: break-all; /* Wrap long names */
  }

  .countdown {
    margin: 15px 0; /* */
    font-size: 1.2em; /* */
  }

  .timer {
    font-weight: bold; /* */
    color: #fff; /* */
    background-color: #0f0; /* */
    color: #000; /* */
    padding: 2px 6px; /* */
    min-width: 80px; /* Ensure timer width is somewhat stable */ /* */
    display: inline-block; /* */
    box-shadow: 2px 2px 0px #0a0; /* */
  }

  .cancel-button {
    margin-top: 15px; /* */
    background-color: #f00; /* Red cancel button */ /* */
    color: #fff; /* */
    border-color: #f00; /* */
    box-shadow: 3px 3px 0px #a00; /* */
  }
  .cancel-button:hover:not(:disabled) {
    /* Add :not(:disabled) */
    background-color: #000; /* */
    color: #f00; /* */
    box-shadow: 3px 3px 5px #f00; /* */
  }
  .cancel-button:active:not(:disabled) {
    /* Add :not(:disabled) */
    box-shadow: 1px 1px 0px #a00; /* */
    transform: translate(2px, 2px); /* */
  }
  /* Add disabled style for cancel button */
  .cancel-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    box-shadow: 3px 3px 0px grey;
    background-color: grey;
    border-color: grey;
    color: #333;
  }

  .bashbucks-display {
    margin-top: 20px; /* */
    font-size: 1.2em; /* */
  }
  .bashbucks-display .value {
    color: #fff; /* */
    font-weight: bold; /* */
  }

  .blink {
    animation: blink-animation 1s steps(2, start) infinite; /* */
  }

  @keyframes blink-animation {
    /* */
    to {
      /* */
      visibility: hidden; /* */
    } /* */
  } /* */
</style>
