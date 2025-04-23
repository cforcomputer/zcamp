<script>
  import { onMount, onDestroy } from "svelte";
  import { get } from "svelte/store"; // Keep get if needed elsewhere
  // Import stores and the cancelTarget action
  import {
    selectedCampCrusherTargetId,
    currentTargetEndTime,
    isTargetSelectionActive, // Still needed for the "ACTIVATE/CANCEL SELECTION" button logic
    cancelTarget, // Import from store
  } from "./campCrusherTargetStore.js";
  import socket from "./socket.js";

  // State variables...
  let timeRemaining = null;
  let countdownInterval = null;
  // targetEndTime removed as it's implicitly handled by currentTargetEndTime store
  let characterName = null; // Populated from session/stats API
  let userBashbucks = 0;
  let isLoadingStats = true;
  let selectedTargetObject = null;
  let isCancelling = false; // Local state for button feedback during cancel API call

  // Subscribe to stores
  let currentTargetId;
  let currentEndTimeISO; // Store the ISO string directly
  let selectionActive; // For the Activate/Cancel Selection button

  const unsubTargetId = selectedCampCrusherTargetId.subscribe((value) => {
    console.log("CampCrusher: selectedCampCrusherTargetId changed to", value);
    currentTargetId = value;
    updateSelectedTargetObject(); // Update the displayed target info
    // Countdown logic is primarily triggered by unsubEndTime now
  });

  const unsubEndTime = currentTargetEndTime.subscribe((value) => {
    console.log("CampCrusher: currentTargetEndTime changed to", value);
    currentEndTimeISO = value;
    triggerCountdownUpdate(); // Trigger countdown logic whenever end time changes
  });

  const unsubSelectionActive = isTargetSelectionActive.subscribe((value) => {
    selectionActive = value;
  });

  const unsubActivities = activeActivities.subscribe((activities) => {
    // Update selectedTargetObject if activities change while target is active
    if (currentTargetId) {
      updateSelectedTargetObject();
    }
  });

  // --- Functions ---

  // Finds the activity object matching the current target ID
  function updateSelectedTargetObject() {
    const activities = get(activeActivities); // Assuming activeActivities store exists
    if (currentTargetId && activities) {
      selectedTargetObject =
        activities.find((a) => a && a.id === currentTargetId) || null;
      console.log(
        "CampCrusher: Updated selectedTargetObject to",
        selectedTargetObject
      );
    } else {
      selectedTargetObject = null;
    }
  }

  // Clears local countdown state
  function clearCountdownDisplay() {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    timeRemaining = null; // This will hide the countdown display reactively
    console.log("CampCrusher: Cleared countdown display.");
  }

  // Calculates and updates the displayed time remaining
  function updateTimer(endTimeMs, targetIdAtStart) {
    const now = Date.now();
    const remaining = endTimeMs - now;
    const currentSelectedId = get(selectedCampCrusherTargetId); // Check current ID inside interval

    // Stop if target changed or remaining is <= 0
    if (currentSelectedId !== targetIdAtStart || remaining <= 0) {
      console.log(
        `CampCrusher: Stopping countdown for ${targetIdAtStart}. Current target: ${currentSelectedId}, Remaining ms: ${remaining}`
      );
      // Store might be cleared already by cancellation or completion event,
      // but ensure display is cleared regardless.
      clearCountdownDisplay();
      // Check if expiration is the cause and stores haven't been cleared yet
      if (remaining <= 0 && currentSelectedId === targetIdAtStart) {
        console.log(
          `CampCrusher: Target ${targetIdAtStart} expired. Clearing stores.`
        );
        selectedCampCrusherTargetId.set(null);
        currentTargetEndTime.set(null);
      }
    } else {
      timeRemaining = remaining; // Update display
    }
  }

  // Starts or restarts the countdown interval
  function startCountdown(endTimeDate, targetId) {
    if (countdownInterval) clearInterval(countdownInterval); // Clear existing interval
    const endTimeMs = endTimeDate.getTime();
    console.log(
      `CampCrusher: Starting countdown for target ${targetId}. End time: ${endTimeDate.toISOString()}, End ms: ${endTimeMs}`
    );

    // Initial update
    updateTimer(endTimeMs, targetId);

    // Set interval only if time is remaining
    if (timeRemaining > 0) {
      countdownInterval = setInterval(
        () => updateTimer(endTimeMs, targetId),
        1000
      );
    }
  }

  // **REVISED**: This function now reacts purely to store changes
  function triggerCountdownUpdate() {
    if (currentTargetId && currentEndTimeISO) {
      const endTime = new Date(currentEndTimeISO);
      console.log(
        `CampCrusher: triggerCountdownUpdate - Target: ${currentTargetId}, EndTimeISO: ${currentEndTimeISO}, EndTimeDate: ${endTime}, Now: ${new Date()}`
      );
      if (!isNaN(endTime.getTime()) && endTime.getTime() > Date.now()) {
        // Valid future end time exists, start/update countdown
        startCountdown(endTime, currentTargetId);
      } else {
        // End time is invalid or in the past
        console.log(
          "CampCrusher: triggerCountdownUpdate - End time is invalid or in the past. Clearing display."
        );
        clearCountdownDisplay();
        // If stores still hold this ID, clear them (handles edge cases)
        if (get(selectedCampCrusherTargetId) === currentTargetId) {
          console.log(
            "CampCrusher: triggerCountdownUpdate - Clearing potentially stale stores."
          );
          selectedCampCrusherTargetId.set(null);
          currentTargetEndTime.set(null);
        }
      }
    } else {
      // No target ID or end time in store, clear display
      console.log(
        "CampCrusher: triggerCountdownUpdate - No target/end time. Clearing display."
      );
      clearCountdownDisplay();
    }
  }

  function formatTime(ms) {
    /* ... implementation ... */
    if (ms === null || ms < 0) return "0m 0s";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }

  // Toggles the visibility of target selection buttons on cards
  function toggleSelectionMode() {
    if (get(selectedCampCrusherTargetId)) return; // Don't toggle if target active
    isTargetSelectionActive.update((active) => !active);
    console.log(
      "CampCrusher: Selection mode toggled to:",
      get(isTargetSelectionActive)
    );
  }

  // --- REMOVED cancelTarget function (it's now imported from store) ---

  // Fetch initial user/game stats
  async function fetchInitialStats() {
    /* ... implementation ... */
    isLoadingStats = true;
    try {
      // Fetch Bashbucks
      const statsResponse = await fetch("/api/campcrushers/stats", {
        credentials: "include",
      });
      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        userBashbucks = statsData.bashbucks || 0;
      } else if (statsResponse.status !== 401) {
        /* Handle non-auth errors */
      }

      // Fetch Session (for character name)
      const sessionResponse = await fetch("/api/session", {
        credentials: "include",
      });
      if (sessionResponse.ok) {
        const sessionData = await sessionResponse.json();
        characterName = sessionData.user?.character_name;
        // NOTE: Active target state should be loaded via store subscriptions now
      } else if (sessionResponse.status !== 401) {
        /* Handle non-auth errors */
      }
    } catch (error) {
      /* Handle fetch errors */
    } finally {
      isLoadingStats = false;
    }
  }

  // Handle WebSocket updates for bashbucks
  function handleBashbucksUpdate(data) {
    /* ... implementation ... */
    console.log("Received bashbucksUpdate:", data);
    if (data && typeof data.newTotal === "number") {
      userBashbucks = data.newTotal;
    } else if (data && typeof data.change === "number") {
      userBashbucks += data.change;
    } else {
      fetchInitialStats(); /* Fallback */
    }
  }

  // Handle WebSocket updates for target completion/cancellation
  function handleTargetCompletedOrCancelled({ targetId }) {
    console.log(
      `CampCrusher: Received server event for target ${targetId} completion/cancellation.`
    );
    const currentSelectedId = get(selectedCampCrusherTargetId);
    if (currentSelectedId === targetId) {
      console.log(
        `CampCrusher: Clearing currently selected target ${targetId} based on server event.`
      );
      // Setting stores to null will trigger reactive updates via subscriptions
      selectedCampCrusherTargetId.set(null);
      currentTargetEndTime.set(null);
    }
  }

  onMount(() => {
    fetchInitialStats();
    socket.on("bashbucksUpdate", handleBashbucksUpdate);
    socket.on("targetCompleted", handleTargetCompletedOrCancelled);
    socket.on("targetCancelled", handleTargetCompletedOrCancelled);

    // Initial check: update display based on current store values
    updateSelectedTargetObject();
    triggerCountdownUpdate();
  });

  onDestroy(() => {
    if (countdownInterval) clearInterval(countdownInterval);
    // Unsubscribe from stores
    unsubTargetId();
    unsubEndTime();
    unsubSelectionActive();
    unsubActivities();
    // Unsubscribe from socket events
    socket.off("bashbucksUpdate", handleBashbucksUpdate);
    socket.off("targetCompleted", handleTargetCompletedOrCancelled);
    socket.off("targetCancelled", handleTargetCompletedOrCancelled);
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
      {#if timeRemaining !== null && timeRemaining > 0}
        <p class="countdown">
          TIME REMAINING: <span class="timer">{formatTime(timeRemaining)}</span>
        </p>
      {:else if timeRemaining !== null}
        <p class="countdown text-red-500">TARGET EXPIRED</p>
      {/if}
      <button
        class="retro-button cancel-button"
        on:click={cancelTarget}
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
  /* ... Styles remain the same ... */
  /* Ensure styles for .text-red-500 exist if needed */
  .text-red-500 {
    color: #f56565;
  } /* Example red color */
</style>
