<script>
  import { onMount, onDestroy } from "svelte";
  import { writable, get } from "svelte/store";
  import { activeActivities } from "./activityManager.js"; //
  import {
    selectedCampCrusherTargetId,
    currentTargetEndTime,
    isTargetSelectionActive,
    cancelTarget,
    isCampCrusherPanelVisible, // --- NEW: Import panel visibility ---
    hideCampCrusherPanel, // --- NEW: Import helper to hide panel ---
  } from "./campCrusherTargetStore.js"; //
  import socket from "./socket.js"; // Ensure socket is imported

  // DEBUG LOG 1: Check if import is resolved at module level
  console.log(
    "%cCampCrusher: Module Top Level - activeActivities:",
    "color: blue; font-weight: bold;",
    activeActivities //
  );

  let timeRemaining = null;
  let countdownInterval = null;
  let targetEndTime = null; // Store the Date object when countdown is active
  let characterName = null; //
  let userBashbucks = 0; // Bashbucks will be shown when this component is rendered
  let isLoadingStats = true;
  let selectedTargetObject = null; //
  let isCancelling = false; // Loading state for cancellation

  // --- Subscribe to stores ---
  let currentTargetId; //
  let currentEndTimeISO; //
  let selectionActive; //
  // No need to subscribe to isCampCrusherPanelVisible here, parent handles rendering

  const unsubTargetId = selectedCampCrusherTargetId.subscribe((value) => {
    console.log(
      "%cCampCrusher: selectedCampCrusherTargetId store changed:",
      "color: purple;",
      value
    );
    currentTargetId = value; // Keep local variable in sync if needed elsewhere
    updateSelectedTargetObject(); // Update display object when ID changes
  }); //

  const unsubEndTime = currentTargetEndTime.subscribe((value) => {
    console.log(
      "%cCampCrusher: currentTargetEndTime store changed:",
      "color: purple;",
      value
    );
    currentEndTimeISO = value; // Store the ISO string
    triggerCountdownUpdate(); // Update countdown logic when end time changes
  }); //

  const unsubSelectionActive = isTargetSelectionActive.subscribe((value) => {
    selectionActive = value; // Keep local variable in sync
  }); //

  const unsubActivities = activeActivities.subscribe((activities) => {
    if (get(selectedCampCrusherTargetId)) {
      updateSelectedTargetObject();
    }
  }); //

  // --- Functions ---

  function updateSelectedTargetObject() {
    const targetId = get(selectedCampCrusherTargetId); // Get current target ID from store
    console.log(
      "%cCampCrusher: updateSelectedTargetObject - Called. Target ID:",
      "color: green;",
      targetId
    );

    let activities;
    try {
      activities = get(activeActivities); //
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
        activities.find((a) => a && a.id === targetId) || null; // Add check for 'a'
      console.log(
        `%cCampCrusher: updateSelectedTargetObject - Found target object for ID ${targetId}:`,
        "color: green;",
        selectedTargetObject //
      );
      if (selectedTargetObject === null && activities.length > 0) {
        console.log(
          `%cCampCrusher: updateSelectedTargetObject - Target ID ${targetId} exists in store but not in current activities list (likely completed/expired).`,
          "color: orange;"
        );
      }
    } else {
      selectedTargetObject = null; //
    }
  }

  function clearCountdownDisplay() {
    if (countdownInterval) {
      clearInterval(countdownInterval); //
      countdownInterval = null;
    }
    timeRemaining = null; //
    targetEndTime = null; // Also clear the Date object
    console.log("%cCampCrusher: Cleared countdown display.", "color: gray;"); //
  }

  function updateTimer(endTimeMs, targetIdAtStart) {
    const now = Date.now(); //
    const remaining = endTimeMs - now;
    const currentSelectedId = get(selectedCampCrusherTargetId); // Check current ID inside interval

    if (currentSelectedId !== targetIdAtStart || remaining <= 0) {
      console.log(
        `%cCampCrusher: Stopping countdown for ${targetIdAtStart}. Current target: ${currentSelectedId}, Remaining ms: ${remaining}`,
        "color: orange;" //
      );
      clearCountdownDisplay(); // Clear interval and display

      if (remaining <= 0 && currentSelectedId === targetIdAtStart) {
        console.log(
          `%cCampCrusher: Target ${targetIdAtStart} expired naturally. Clearing stores.`,
          "color: orange;" //
        );
        selectedCampCrusherTargetId.set(null); //
        currentTargetEndTime.set(null); //
      }
    } else {
      timeRemaining = remaining; // Update display
    }
  }

  function startCountdown(endTimeDate, targetId) {
    if (countdownInterval) clearInterval(countdownInterval); // Clear existing interval
    const endTimeMs = endTimeDate.getTime(); //
    console.log(
      `%cCampCrusher: Starting/Restarting countdown for target ${targetId}. End time: ${endTimeDate.toISOString()}`,
      "color: cyan;" //
    );

    updateTimer(endTimeMs, targetId); //

    if (timeRemaining > 0) {
      countdownInterval = setInterval(
        () => updateTimer(endTimeMs, targetId),
        1000
      );
    } else {
      clearCountdownDisplay();
    }
  }

  function triggerCountdownUpdate() {
    console.log(
      `%cCampCrusher: triggerCountdownUpdate called. Target ID: ${currentTargetId}, EndTimeISO: ${currentEndTimeISO}`,
      "color: blue;" //
    );
    if (currentTargetId && currentEndTimeISO) {
      const endTime = new Date(currentEndTimeISO); //
      if (!isNaN(endTime.getTime())) {
        //
        if (endTime.getTime() > Date.now()) {
          targetEndTime = endTime; // Update the local Date object
          startCountdown(endTime, currentTargetId); //
        } else {
          console.log(
            "%cCampCrusher: triggerCountdownUpdate - End time is in the past. Clearing display.",
            "color: orange;" //
          );
          clearCountdownDisplay();
          if (get(selectedCampCrusherTargetId) === currentTargetId) {
            console.log(
              "%cCampCrusher: triggerCountdownUpdate - Clearing potentially stale stores for past target.",
              "color: orange;" //
            );
            selectedCampCrusherTargetId.set(null); //
            currentTargetEndTime.set(null); //
          }
        }
      } else {
        console.warn(
          `%cCampCrusher: triggerCountdownUpdate - Invalid Date from endTimeISO: ${currentEndTimeISO}. Clearing display.`,
          "color: red;"
        );
        clearCountdownDisplay();
      }
    } else {
      clearCountdownDisplay(); //
    }
  }

  function formatTime(ms) {
    if (ms === null || ms < 0) return "0m 0s"; //
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`; //
  }

  // Toggles the visibility of target selection buttons on cards AND hides panel if cancelling selection
  function toggleSelectionMode() {
    if (get(selectedCampCrusherTargetId)) return; // Don't toggle if target active

    const currentSelectionState = get(isTargetSelectionActive);
    isTargetSelectionActive.update((active) => !active); // Toggle store

    // --- NEW: If we just turned selection OFF, hide the panel ---
    if (currentSelectionState) {
      // i.e., if it *was* true and we are now turning it false
      // NOTE: Original code hid panel here, but user request implies keeping panel visible
      // If you want to hide the panel when CANCEL SELECTION is clicked, uncomment the next line:
      // hideCampCrusherPanel(); // Use the new helper function from the store
    }
    // --- END NEW ---

    console.log(
      "%cCampCrusher: Selection mode toggled to:",
      "color: magenta;",
      get(isTargetSelectionActive) //
    );
  }

  async function handleCancelClick() {
    if (isCancelling) return;
    isCancelling = true;
    try {
      const idToCancel = get(selectedCampCrusherTargetId);
      if (idToCancel) {
        console.log(`CampCrusher: Initiating cancel for target ${idToCancel}`);
        // Call the imported cancelTarget function
        await cancelTarget();
        console.log(`CampCrusher: Cancel API call finished for ${idToCancel}`);
        // Panel remains visible after cancel (as per comments in original code)
      } else {
        console.warn(
          "CampCrusher: Cancel button clicked but no target ID was set."
        );
      }
    } catch (error) {
      console.error(
        "CampCrusher: Error occurred during cancelTarget call:",
        error
      );
    } finally {
      isCancelling = false;
    }
  }

  async function fetchInitialStats() {
    isLoadingStats = true; //
    console.log("%cCampCrusher: Fetching initial stats...", "color: brown;");
    try {
      // Fetch Bashbucks
      const statsResponse = await fetch("/api/campcrushers/stats", {
        //
        credentials: "include",
      });
      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        userBashbucks = statsData.bashbucks || 0; //
        console.log("CampCrusher: Bashbucks fetched:", userBashbucks);
      } else if (statsResponse.status !== 401) {
        console.error(
          //
          "CampCrusher: Failed to fetch camp crusher stats:",
          statsResponse.status
        );
      } else {
        console.log("CampCrusher: Not logged in (stats fetch).");
      }

      // Fetch Session (for character name)
      const sessionResponse = await fetch("/api/session", {
        //
        credentials: "include",
      });
      if (sessionResponse.ok) {
        const sessionData = await sessionResponse.json();
        characterName = sessionData.user?.character_name; //
        console.log("CampCrusher: Session fetched, character:", characterName);
      } else if (sessionResponse.status !== 401) {
        console.error(
          //
          "CampCrusher: Failed to fetch session data:",
          sessionResponse.status
        );
      } else {
        console.log("CampCrusher: Not logged in (session fetch).");
      }
    } catch (error) {
      console.error("CampCrusher: Error fetching initial stats:", error); //
    } finally {
      isLoadingStats = false; //
    }
  }

  function handleBashbucksUpdate(data) {
    console.log("CampCrusher: Received bashbucksUpdate:", data); //
    if (data && typeof data.newTotal === "number") {
      userBashbucks = data.newTotal; //
    } else if (data && typeof data.change === "number") {
      userBashbucks += data.change; //
    } else {
      console.warn(
        "CampCrusher: Received invalid bashbucksUpdate data, refetching."
      );
      fetchInitialStats(); // Fallback
    }
  }

  function handleTargetCompletedOrCancelled({ targetId }) {
    console.log(
      `%cCampCrusher: Received server event for target ${targetId} completion/cancellation.`,
      "color: orange;" //
    );
    const currentSelectedId = get(selectedCampCrusherTargetId); // Get current value from store
    if (currentSelectedId === targetId) {
      console.log(
        `%cCampCrusher: Clearing currently selected target ${targetId} based on server event.`,
        "color: orange;" //
      );
      selectedCampCrusherTargetId.set(null); //
      currentTargetEndTime.set(null); //
      // Panel remains visible (as per comments in original code)
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
    socket.on("bashbucksUpdate", handleBashbucksUpdate); //
    socket.on("targetCompleted", handleTargetCompletedOrCancelled); //
    socket.on("targetCancelled", handleTargetCompletedOrCancelled); //

    // Initial check/update of target object and countdown based on current store values
    updateSelectedTargetObject(); //
    triggerCountdownUpdate(); //
  });

  onDestroy(() => {
    console.log("%cCampCrusher: Component Destroyed.", "color: blue;");
    if (countdownInterval) clearInterval(countdownInterval); //
    // Unsubscribe from stores
    unsubTargetId(); //
    unsubEndTime(); //
    unsubSelectionActive(); //
    unsubActivities(); //
    // Unsubscribe from socket events
    socket.off("bashbucksUpdate", handleBashbucksUpdate); //
    socket.off("targetCompleted", handleTargetCompletedOrCancelled); //
    socket.off("targetCancelled", handleTargetCompletedOrCancelled); //
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
  /* Removed the .close-button CSS rules from here */

  /* --- Existing Styles (mostly unchanged) --- */
  .camp-crusher {
    position: relative; /* Still needed if other absolute elements exist or might be added */
    font-family: "VT323", monospace; /* Retro pixel font */
    border: 4px solid #0f0; /* Neon green border */
    background: radial-gradient(
      ellipse at center,
      rgba(0, 20, 0, 0.9) 0%,
      rgba(0, 0, 0, 0.95) 100%
    );
    padding: 20px;
    border-radius: 0; /* Sharp corners */
    box-shadow:
      0 0 15px #0f0,
      0 0 5px #0f0 inset;
    text-transform: uppercase;
    color: #0f0; /* Neon green text */
    margin-top: 1em;
  }

  .retro-button {
    background-color: #0f0;
    color: #000;
    border: 2px solid #0f0;
    padding: 8px 15px;
    font-family: inherit;
    text-transform: inherit;
    cursor: pointer;
    transition:
      background-color 0.2s,
      color 0.2s,
      box-shadow 0.2s;
    box-shadow: 3px 3px 0px #0a0; /* Simple shadow */
    font-size: 1.1em;
  }
  .retro-button:hover:not(:disabled) {
    background-color: #000;
    color: #0f0;
    box-shadow: 3px 3px 5px #0f0;
  }
  .retro-button:active:not(:disabled) {
    box-shadow: 1px 1px 0px #0a0;
    transform: translate(2px, 2px);
  }
  .retro-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    box-shadow: 3px 3px 0px grey;
    background-color: grey;
    border-color: grey;
    color: #333;
  }

  .main-button {
    display: block;
    margin: 0 auto 15px auto; /* Center button */
    min-width: 200px;
  }

  .auth-warning,
  .loading {
    text-align: center;
    font-size: 1.2em;
    padding: 1em;
    color: #f00; /* Red for warning */
    border: 2px dashed #f00;
  }
  .loading {
    color: #0f0; /* Green for loading */
    border-color: #0f0;
  }

  .active-target,
  .idle-view {
    text-align: center;
  }

  .target-header,
  .instruction-text {
    font-size: 1.3em;
    margin-bottom: 10px;
    text-shadow: 0 0 5px #0f0;
  }

  .target-name {
    color: #fff; /* White target name */
    font-size: 1.5em;
    margin: 10px 0;
    font-weight: bold;
    text-shadow: 0 0 8px #fff;
    word-break: break-all; /* Wrap long names */
  }

  .countdown {
    margin: 15px 0;
    font-size: 1.2em;
  }

  .timer {
    font-weight: bold;
    color: #fff;
    background-color: #0f0;
    color: #000;
    padding: 2px 6px;
    min-width: 80px; /* Ensure timer width is somewhat stable */
    display: inline-block;
    box-shadow: 2px 2px 0px #0a0;
  }

  .cancel-button {
    margin-top: 15px;
    background-color: #f00; /* Red cancel button */
    color: #fff;
    border-color: #f00;
    box-shadow: 3px 3px 0px #a00;
  }
  .cancel-button:hover:not(:disabled) {
    background-color: #000;
    color: #f00;
    box-shadow: 3px 3px 5px #f00;
  }
  .cancel-button:active:not(:disabled) {
    box-shadow: 1px 1px 0px #a00;
    transform: translate(2px, 2px);
  }
  .cancel-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    box-shadow: 3px 3px 0px grey;
    background-color: grey;
    border-color: grey;
    color: #333;
  }

  .bashbucks-display {
    margin-top: 20px;
    font-size: 1.2em;
  }
  .bashbucks-display .value {
    color: #fff;
    font-weight: bold;
  }

  .blink {
    animation: blink-animation 1s steps(2, start) infinite;
  }

  @keyframes blink-animation {
    to {
      visibility: hidden;
    }
  }
</style>
