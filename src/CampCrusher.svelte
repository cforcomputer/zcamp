<!-- CampCrusher.svelte -->
<script>
  import { onMount, onDestroy } from "svelte";
  import { writable } from "svelte/store";
  import socket from "./socket.js";
  import { activeCamps } from "./campManager.js";

  let showGame = false;
  let selectedCamp = null;
  let countdownInterval = null;
  let timeRemaining = null;
  let userBashbucks = 0;
  let leaderboard = [];
  let characterName = null;

  // Subscribe to active camps
  $: camps = $activeCamps;

  onMount(async () => {
    socket.on("bashbucksAwarded", handleBashbucksAwarded);

    const response = await fetch("/api/session", {
      credentials: "include",
    });
    const data = await response.json();
    characterName = data.user?.character_name;

    await loadLeaderboard();
  });

  onDestroy(() => {
    if (countdownInterval) clearInterval(countdownInterval);
    socket.off("bashbucksAwarded", handleBashbucksAwarded);
  });

  async function loadLeaderboard() {
    const response = await fetch("/api/campcrushers/leaderboard", {
      credentials: "include",
    });
    leaderboard = await response.json();
  }

  function handleBashbucksAwarded(data) {
    userBashbucks = data.newTotal;
    loadLeaderboard();
  }

  function formatTime(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }

  async function selectCamp(camp) {
    const response = await fetch("/api/campcrushers/target", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        campId: camp.id,
      }),
    });

    const data = await response.json();

    if (data.success) {
      selectedCamp = camp;
      startCountdown(new Date(data.endTime));
    } else {
      alert(data.error || "Failed to select target");
    }
  }

  function startCountdown(endTime) {
    if (countdownInterval) clearInterval(countdownInterval);

    countdownInterval = setInterval(() => {
      const now = new Date().getTime();
      const end = new Date(endTime).getTime();
      const remaining = end - now;

      if (remaining <= 0) {
        clearInterval(countdownInterval);
        selectedCamp = null;
        timeRemaining = null;
      } else {
        timeRemaining = remaining;
      }
    }, 1000);
  }
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

          {#if selectedCamp}
            <div class="active-target retro-panel">
              <h4 class="target-header">CURRENT TARGET:</h4>
              <p class="target-name">{selectedCamp.stargateName}</p>
              {#if timeRemaining}
                <p class="countdown">
                  TIME REMAINING: <span class="timer"
                    >{formatTime(timeRemaining)}</span
                  >
                </p>
              {/if}
            </div>
          {:else}
            <div class="camp-selection">
              <h4 class="selection-header">SELECT TARGET:</h4>
              <div class="camp-list">
                {#each camps as camp}
                  <button
                    class="camp-option retro-button"
                    on:click={() => selectCamp(camp)}
                  >
                    <span class="camp-name">{camp.stargateName}</span>
                    <span class="kill-count">KILLS: {camp.kills.length}</span>
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
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

  .camp-selection {
    margin-top: 1em;
  }

  .selection-header {
    color: #ff00ff;
    margin: 0 0 1em 0;
    text-shadow: 0 0 5px #ff00ff;
  }

  .camp-list {
    display: grid;
    gap: 0.8em;
  }

  .camp-option {
    background: rgba(255, 0, 255, 0.1);
    border: 2px solid #ff00ff;
    border-radius: 4px;
    padding: 1em;
    color: #ffffff;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .camp-option:hover {
    background: rgba(255, 0, 255, 0.2);
    box-shadow: 0 0 10px #ff00ff;
    transform: translateY(-2px);
  }

  .camp-name {
    font-weight: bold;
  }

  .kill-count {
    color: #00ffff;
  }

  .active-target {
    background: rgba(0, 255, 255, 0.1);
    padding: 1em;
    border-radius: 4px;
    border: 2px solid #00ffff;
  }

  .target-header {
    color: #00ffff;
    margin: 0 0 0.5em 0;
    text-shadow: 0 0 5px #00ffff;
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

  @keyframes glow {
    0% {
      text-shadow: 0 0 5px #ff00ff;
    }
    50% {
      text-shadow:
        0 0 20px #ff00ff,
        0 0 30px #ff00ff;
    }
    100% {
      text-shadow: 0 0 5px #ff00ff;
    }
  }
</style>
