<script>
  import { onMount, onDestroy } from "svelte";
  import { activeCamps } from "../server/campStore.js";
  import socket from "./socket.js";

  let showGame = false;
  let selectedCamp = null;
  let countdownInterval = null;
  let timeRemaining = null;
  let userBashbucks = 0;
  let leaderboard = [];
  let characterName = null;

  onMount(async () => {
    const response = await fetch("/api/session", {
      credentials: "include",
    });
    const data = await response.json();
    characterName = data.user?.character_name;

    await loadLeaderboard();
    socket.on("bashbucksAwarded", handleBashbucksAwarded);
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
    loadLeaderboard(); // Refresh leaderboard
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
    PLAY CAMPCRUSHERS
  </button>

  {#if showGame}
    {#if !characterName}
      <div class="auth-warning">
        Please log in with EVE Online to play Camp Crushers!
      </div>
    {:else}
      <div class="game-ui">
        <div class="game-header">
          <h3>Your Bashbucks: {userBashbucks}</h3>
          <p>Playing as: {characterName}</p>
          {#if selectedCamp}
            <div class="active-target">
              <h4>Current Target:</h4>
              <p>{selectedCamp.stargateName}</p>
              {#if timeRemaining}
                <p class="countdown">
                  Time remaining: {formatTime(timeRemaining)}
                </p>
              {/if}
            </div>
          {:else}
            <div class="camp-selection">
              <h4>Select a Camp to Crush:</h4>
              {#each $activeCamps as camp}
                <button class="camp-option" on:click={() => selectCamp(camp)}>
                  {camp.stargateName} ({camp.kills.length} kills)
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <div class="leaderboard">
          <h4>Top Crushers</h4>
          <div class="leaderboard-entries">
            {#each leaderboard as entry, i}
              <div class="leaderboard-entry">
                <span class="rank">
                  {#if i === 0}🥇
                  {:else if i === 1}🥈
                  {:else if i === 2}🥉
                  {:else}{i + 1}.
                  {/if}
                </span>
                <span class="name">{entry.character_name}</span>
                <span class="score">{entry.bashbucks}</span>
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .camp-crusher {
    margin-top: 1em;
  }

  .easter-egg {
    background: linear-gradient(45deg, #ff4444, #ff8c00);
    color: white;
    padding: 0.5em 1em;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: bold;
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.05);
    }
    100% {
      transform: scale(1);
    }
  }

  .game-ui {
    background: rgba(0, 0, 0, 0.8);
    padding: 1em;
    border-radius: 8px;
    margin-top: 1em;
  }

  .auth-warning {
    color: #ff4444;
    padding: 1em;
    background: rgba(255, 68, 68, 0.1);
    border-radius: 4px;
    margin-top: 1em;
  }

  .camp-option {
    display: block;
    width: 100%;
    padding: 0.5em;
    margin: 0.5em 0;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    color: white;
    cursor: pointer;
  }

  .camp-option:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .countdown {
    color: #ffd700;
    font-weight: bold;
  }

  .leaderboard {
    margin-top: 1em;
    padding-top: 1em;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  .leaderboard-entry {
    display: flex;
    justify-content: space-between;
    padding: 0.5em;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .rank {
    width: 2em;
  }

  .name {
    flex-grow: 1;
    margin: 0 1em;
  }

  .score {
    font-weight: bold;
    color: #ffd700;
  }
</style>
