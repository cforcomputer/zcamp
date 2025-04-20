<script>
  import { onMount, onDestroy } from "svelte";
  import { writable, get } from "svelte/store"; // Import get
  import socket from "./socket.js";
  import { activeActivities } from "./activityManager.js";
  // Import the new store for target management
  import {
    selectedCampCrusherTargetId,
    currentTargetEndTime,
  } from "./campCrusherTargetStore.js";

  let showGame = false;
  let countdownInterval = null;
  let timeRemaining = null; // Milliseconds remaining for the countdown timer
  let userBashbucks = 0; // Current user's Bashbucks
  let leaderboard = []; // Leaderboard data
  let characterName = null; // Current logged-in user's character name
  let isLoadingStats = true; // Loading state for user stats

  // --- State derived from stores ---
  let currentTargetId = null; // ID of the currently selected target
  let targetEndTime = null; // JS Date object for the target end time
  let selectedTarget = null; // The full activity object for the selected target

  // Subscribe to changes in the selected target ID store
  const unsubTargetId = selectedCampCrusherTargetId.subscribe((value) => {
    currentTargetId = value; // Update the local ID tracker

    // --- FIX: Use get() to safely access store value inside callback ---
    const currentActivitiesValue = get(activeActivities); // Get current value NOW
    // Find the corresponding activity object using the current value of activeActivities
    selectedTarget = value
      ? currentActivitiesValue.find((a) => a.id === value)
      : null;
    // --- END FIX ---

    // Clear any existing countdown interval when the target changes
    if (countdownInterval) clearInterval(countdownInterval);
    timeRemaining = null; // Reset the display timer

    // If a valid target is now selected...
    if (selectedTarget) {
      const endTimeISO = get(currentTargetEndTime); // Get the end time from its dedicated store
      if (endTimeISO) {
        const endTime = new Date(endTimeISO); // Convert ISO string to Date object
        // Check if the target's end time is in the future
        if (endTime.getTime() > Date.now()) {
          // console.log("Starting countdown from store endTime:", endTime);
          targetEndTime = endTime; // Store the end time (e.g., for display)
          startCountdown(endTime); // Start the visual countdown timer
        } else {
          // If the target from the store is already expired, clear the selection
          // console.log("End time from store is in the past, clearing target.");
          selectedCampCrusherTargetId.set(null);
          currentTargetEndTime.set(null);
          selectedTarget = null; // Clear the local derived value too
        }
      } else {
        // If no end time is found in the store, the state might be inconsistent or waiting for API confirmation
        // Clear the potentially stale target selection
        // console.warn("No valid endTime in store for new target ID", value, "Clearing selection.");
        selectedCampCrusherTargetId.set(null);
        selectedTarget = null;
      }
    } else {
      targetEndTime = null; // Clear local end time if no target is selected
    }
  });

  // Subscribe to changes in the main activities list
  const unsubActivities = activeActivities.subscribe((activities) => {
    // If we have a selected target ID, find its updated details in the new activities list
    if (currentTargetId) {
      const updatedTarget = activities.find((a) => a.id === currentTargetId);
      if (updatedTarget) {
        selectedTarget = updatedTarget; // Update the local selectedTarget object
      } else {
        // If the target activity is no longer in the main list (e.g., expired and removed)
        // console.log("Selected target disappeared from active list, clearing.");
        // Check the store again before clearing to prevent race conditions
        if (get(selectedCampCrusherTargetId) === currentTargetId) {
          selectedCampCrusherTargetId.set(null);
          currentTargetEndTime.set(null);
        }
        selectedTarget = null; // Clear the local object
      }
    } else {
      // If no target ID is selected, ensure the local object is also null
      selectedTarget = null;
    }
  });

  // Function to fetch initial user stats (Bashbucks)
  async function fetchInitialStats() {
    isLoadingStats = true;
    try {
      const response = await fetch("/api/campcrushers/stats", {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        userBashbucks = data.bashbucks || 0;
      } else if (response.status !== 401) {
        console.error("Failed to fetch camp crusher stats:", response.status);
      }
    } catch (error) {
      console.error("Error fetching camp crusher stats:", error);
    } finally {
      isLoadingStats = false;
    }
  }

  // Function to load the leaderboard data
  async function loadLeaderboard() {
    try {
      const response = await fetch("/api/campcrushers/leaderboard", {
        credentials: "include",
      });
      if (response.ok) {
        leaderboard = await response.json();
      } else {
        console.error("Failed to load leaderboard:", response.status);
      }
    } catch (error) {
      console.error("Error loading leaderboard:", error);
    }
  }

  // Handler for when Bashbucks are awarded via socket event
  function handleBashbucksAwarded(data) {
    // Assuming data contains { newTotal: number }
    if (data && typeof data.newTotal === "number") {
      userBashbucks = data.newTotal;
      loadLeaderboard(); // Refresh leaderboard after update
    } else {
      // Fallback: Fetch stats again if data is not as expected
      fetchInitialStats();
      loadLeaderboard();
    }
  }

  // Format milliseconds into minutes and seconds string
  function formatTime(ms) {
    if (ms === null || ms < 0) return "0m 0s";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
  }

  // Starts the visual countdown timer
  function startCountdown(endTimeDate) {
    if (countdownInterval) clearInterval(countdownInterval); // Clear previous interval
    const endTimeMs = endTimeDate.getTime();

    const updateTimer = () => {
      const now = Date.now();
      const remaining = endTimeMs - now;

      if (remaining <= 0) {
        clearInterval(countdownInterval);
        // Check if this target is still the selected one before clearing the store
        if (get(selectedCampCrusherTargetId) === currentTargetId) {
          selectedCampCrusherTargetId.set(null);
          currentTargetEndTime.set(null);
        }
        timeRemaining = null; // Update local state for display
        loadLeaderboard(); // Refresh leaderboard when target expires
      } else {
        timeRemaining = remaining; // Update local state for display
      }
    };

    updateTimer(); // Initial update
    countdownInterval = setInterval(updateTimer, 1000); // Update every second
  }

  // Check for an existing active target from the leaderboard on mount/login
  async function checkActiveTarget() {
    if (!characterName) return; // Need character name to check leaderboard
    // console.log("Checking for active target...");
    await loadLeaderboard(); // Ensure leaderboard is fresh
    const myEntry = leaderboard.find((p) => p.character_name === characterName);

    if (myEntry?.target_camp_id && myEntry?.target_start_time) {
      const targetId = myEntry.target_camp_id;
      const startTime = new Date(myEntry.target_start_time).getTime();
      const endTime = new Date(startTime + 60 * 60 * 1000); // Assume 1 hour duration

      if (endTime.getTime() > Date.now()) {
        // Found an active target
        // console.log("Found active target from leaderboard:", targetId);
        // Sync the stores only if necessary to prevent infinite loops
        if (get(selectedCampCrusherTargetId) !== targetId) {
          selectedCampCrusherTargetId.set(targetId);
        }
        if (get(currentTargetEndTime) !== endTime.toISOString()) {
          currentTargetEndTime.set(endTime.toISOString());
        }
        // Countdown will start automatically via the selectedCampCrusherTargetId store subscription
      } else {
        // Found an expired target from the leaderboard
        // console.log("Found expired target from leaderboard:", targetId);
        // Clear the stores if they currently hold this expired target ID
        if (get(selectedCampCrusherTargetId) === targetId) {
          selectedCampCrusherTargetId.set(null);
          currentTargetEndTime.set(null);
        }
      }
    } else {
      // No active target found on the leaderboard for this user
      // console.log("No active target found from leaderboard.");
      // Ensure stores are clear if no active target is found
      if (get(selectedCampCrusherTargetId) !== null) {
        selectedCampCrusherTargetId.set(null);
      }
      if (get(currentTargetEndTime) !== null) {
        currentTargetEndTime.set(null);
      }
    }
  }

  // Component Lifecycle: Mount
  onMount(async () => {
    // Listen for server events awarding Bashbucks
    socket.on("bashbucksAwarded", handleBashbucksAwarded);

    // Fetch initial session data to get character name
    try {
      const response = await fetch("/api/session", { credentials: "include" });
      if (response.ok) {
        const data = await response.json();
        characterName = data.user?.character_name; // Store character name
        if (characterName) {
          await fetchInitialStats(); // Fetch initial Bashbucks
          // Check for an active target after a short delay to allow activities to load
          setTimeout(() => checkActiveTarget(), 500);
        } else {
          // Not logged in with EVE SSO
          isLoadingStats = false;
        }
      } else {
        console.warn("Could not fetch session data on mount.");
        isLoadingStats = false;
      }
    } catch (error) {
      console.error("Error fetching session on mount:", error);
      isLoadingStats = false;
    }
  });

  // Component Lifecycle: Destroy
  onDestroy(() => {
    if (countdownInterval) clearInterval(countdownInterval); // Clear timer
    socket.off("bashbucksAwarded", handleBashbucksAwarded); // Remove listener
    // Unsubscribe from Svelte stores
    unsubTargetId();
    unsubActivities();
  });
</script>

<div class="camp-crusher">
  <button class="easter-egg" on:click={() => (showGame = !showGame)}>
    <span class="neon-text">PLAY CAMPCRUSHERS</span>
  </button>

  {#if showGame}
    {#if !characterName}
      <div class="auth-warning retro-box">
        <span class="blink">!</span> Please log in with EVE Online to play Camp
        Crushers! <span class="blink">!</span>
      </div>
    {:else}
      <div class="game-ui retro-box">
        <div class="game-header">
          <div class="player-info">
            <h3 class="neon-text">
              BASHBUCKS: <span class="value">{userBashbucks}</span>
            </h3>
            <p class="pilot-name">
              PILOT: <span class="value">{characterName}</span>
            </p>
          </div>

          {#if selectedTarget}
            <div class="active-target retro-panel">
              <h4 class="target-header">CURRENT TARGET:</h4>
              <p class="target-name">
                {selectedTarget.stargateName || selectedTarget.id}
              </p>
              {#if timeRemaining !== null}
                <p class="countdown">
                  TIME REMAINING: <span class="timer"
                    >{formatTime(timeRemaining)}</span
                  >
                </p>
              {/if}
              <button
                class="clear-target-button retro-button"
                on:click={() => {
                  selectedCampCrusherTargetId.set(null); // Clear target ID store
                  currentTargetEndTime.set(null); // Clear end time store
                  if (countdownInterval) clearInterval(countdownInterval); // Stop timer
                  timeRemaining = null; // Reset display timer
                  // TODO: Optionally call backend API to clear target if necessary
                }}
              >
                Clear Target
              </button>
            </div>
          {:else}
            <div class="no-target retro-panel">
              <h4 class="selection-header">NO ACTIVE TARGET</h4>
              <p class="text-gray-400 italic">
                Select a target from the Active Camps list.
              </p>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  /* Styles remain the same as previous version */
  .camp-crusher {
    margin-top: 1em;
    font-family: "Courier New", monospace;
  }

  .easter-egg {
    background: linear-gradient(45deg, #ff00ff, #00ffff);
    border: 3px solid #ffffff;
    border-radius: 8px;
    padding: 0.8em 1.5em;
    cursor: pointer;
    position: relative;
    overflow: hidden;
    transition: all 0.3s ease;
    box-shadow:
      0 0 10px #ff00ff,
      0 0 20px #00ffff;
  }

  .easter-egg:hover {
    transform: scale(1.05);
    box-shadow:
      0 0 20px #ff00ff,
      0 0 40px #00ffff;
  }

  .neon-text {
    color: #ffffff;
    text-shadow:
      0 0 5px #ffffff,
      0 0 10px #ffffff,
      0 0 15px #ff00ff,
      0 0 20px #ff00ff;
    font-weight: bold;
    letter-spacing: 2px;
  }

  .retro-box {
    background: rgba(0, 0, 0, 0.9);
    border: 2px solid #00ffff;
    border-radius: 8px;
    padding: 1.5em;
    margin-top: 1em;
    box-shadow: 0 0 10px #00ffff inset;
  }

  .game-ui {
    color: #00ffff;
  }

  .player-info {
    margin-bottom: 1.5em;
    padding: 1em;
    background: rgba(0, 255, 255, 0.1);
    border-radius: 4px;
  }

  .player-info h3 {
    margin: 0;
    font-size: 1.5em;
  }

  .value {
    color: #ff00ff;
    font-weight: bold;
  }

  .pilot-name {
    margin: 0.5em 0 0 0;
    color: #ffffff;
  }

  .active-target,
  .no-target {
    background: rgba(0, 255, 255, 0.1);
    padding: 1em;
    border-radius: 4px;
    border: 2px solid #00ffff;
    margin-top: 1em;
  }
  .no-target {
    border-color: #555; /* Grey border if no target */
    color: #aaa;
  }

  .target-header,
  .selection-header {
    color: #00ffff;
    margin: 0 0 0.5em 0;
    text-shadow: 0 0 5px #00ffff;
  }
  .no-target .selection-header {
    color: #aaa;
    text-shadow: none;
  }

  .target-name {
    color: #ff00ff;
    font-size: 1.2em;
    margin: 0.5em 0;
    font-weight: bold;
  }

  .countdown {
    margin: 1em 0 0 0;
    color: #ffffff;
  }

  .timer {
    color: #ff00ff;
    font-weight: bold;
    font-size: 1.2em;
    text-shadow: 0 0 5px #ff00ff;
  }

  .clear-target-button {
    background: rgba(255, 0, 0, 0.2);
    border: 1px solid #ff0000;
    color: #ffaaaa;
    padding: 0.3em 0.6em;
    font-size: 0.8em;
    margin-top: 0.8em;
    cursor: pointer;
    transition: background-color 0.2s;
  }
  .clear-target-button:hover {
    background: rgba(255, 0, 0, 0.4);
    color: #ffffff;
  }

  .auth-warning {
    color: #ff0000;
    text-align: center;
    font-size: 1.2em;
    padding: 2em;
  }

  .blink {
    animation: blink 1s steps(2, start) infinite;
    color: #ff0000;
  }

  @keyframes blink {
    to {
      visibility: hidden;
    }
  }
</style>
