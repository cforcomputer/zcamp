<!-- src/Leaderboard.svelte -->
<script>
  import { onMount } from "svelte";

  let leaderboard = [];
  let loading = true;
  let error = null;

  onMount(async () => {
    try {
      const response = await fetch("/api/campcrushers/leaderboard", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch leaderboard data");
      }

      leaderboard = await response.json();
      loading = false;
    } catch (err) {
      console.error("Error fetching leaderboard:", err);
      error = "Failed to load leaderboard data";
      loading = false;
    }
  });

  function formatNumber(number) {
    return new Intl.NumberFormat().format(number);
  }
</script>

<div class="leaderboard-container">
  <h1>CampCrushers Leaderboard</h1>

  {#if loading}
    <div class="loading">Loading leaderboard data...</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else}
    <div class="leaderboard">
      <div class="leaderboard-header">
        <span class="rank">Rank</span>
        <span class="character">Character</span>
        <span class="bashbucks">Bashbucks</span>
      </div>
      {#each leaderboard as { character_name, bashbucks }, index}
        <div class="leaderboard-entry" class:podium={index < 3}>
          <span class="rank">
            {#if index === 0}
              <span class="trophy gold">🏆</span>
            {:else if index === 1}
              <span class="trophy silver">🥈</span>
            {:else if index === 2}
              <span class="trophy bronze">🥉</span>
            {:else}
              {index + 1}
            {/if}
          </span>
          <span class="character">{character_name}</span>
          <span class="bashbucks">{formatNumber(bashbucks)}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .leaderboard-container {
    max-width: 800px;
    margin: 2rem auto;
    padding: 1rem;
  }

  h1 {
    color: #ffd700;
    text-align: center;
    margin-bottom: 2rem;
    font-size: 2.5rem;
    text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
  }

  .leaderboard {
    background: rgba(0, 0, 0, 0.8);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
  }

  .leaderboard-header {
    display: grid;
    grid-template-columns: 100px 1fr 150px;
    padding: 1rem;
    background: rgba(255, 255, 255, 0.1);
    font-weight: bold;
    border-bottom: 2px solid rgba(255, 255, 255, 0.1);
  }

  .leaderboard-entry {
    display: grid;
    grid-template-columns: 100px 1fr 150px;
    padding: 1rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    transition: background-color 0.2s ease;
  }

  .leaderboard-entry:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .podium {
    background: rgba(255, 215, 0, 0.05);
  }

  .rank {
    text-align: center;
    font-weight: bold;
  }

  .character {
    color: #fff;
  }

  .bashbucks {
    text-align: right;
    color: #ffd700;
    font-family: monospace;
    font-size: 1.1em;
  }

  .trophy {
    font-size: 1.5em;
    display: inline-block;
    animation: float 2s ease-in-out infinite;
  }

  .trophy.gold {
    color: #ffd700;
    text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
  }

  .trophy.silver {
    color: #c0c0c0;
    text-shadow: 0 0 10px rgba(192, 192, 192, 0.5);
  }

  .trophy.bronze {
    color: #cd7f32;
    text-shadow: 0 0 10px rgba(205, 127, 50, 0.5);
  }

  @keyframes float {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-5px);
    }
  }

  .loading {
    text-align: center;
    color: #888;
    padding: 2rem;
  }

  .error {
    text-align: center;
    color: #ff4444;
    padding: 2rem;
    background: rgba(255, 68, 68, 0.1);
    border-radius: 4px;
  }
</style>
