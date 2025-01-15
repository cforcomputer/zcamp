<!-- src/Leaderboard.svelte -->
<script>
  import { onMount } from "svelte";

  let leaderboard = [];
  let loading = true;
  let error = null;
  let expandedPlayer = null;

  onMount(async () => {
    try {
      const response = await fetch("/api/campcrushers/leaderboard", {
        credentials: "include",
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch leaderboard data");
      }

      leaderboard = await response.json();
      loading = false;
    } catch (err) {
      console.error("Error fetching leaderboard:", err);
      error = err.message || "Failed to load leaderboard data";
      loading = false;
    }
  });

  function formatNumber(number) {
    return new Intl.NumberFormat().format(number);
  }

  function formatDate(dateString) {
    return new Date(dateString).toLocaleString();
  }

  function togglePlayerHistory(characterId) {
    expandedPlayer = expandedPlayer === characterId ? null : characterId;
  }

  function handleKeyDown(event, characterId) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      togglePlayerHistory(characterId);
    }
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
        <span class="camps">Camps Crushed</span>
        <span class="bashbucks">Bashbucks</span>
      </div>
      {#each leaderboard as { character_name, bashbucks, total_camps_crushed, recent_crushes, character_id }, index}
        <div class="leaderboard-entry" class:podium={index < 3}>
          <button
            type="button"
            class="main-row"
            on:click={() => togglePlayerHistory(character_id)}
            on:keydown={(e) => handleKeyDown(e, character_id)}
            aria-expanded={expandedPlayer === character_id}
            aria-controls="history-{character_id}"
          >
            <span class="rank">
              {#if index === 0}
                <span class="trophy gold" aria-label="Gold Trophy">🏆</span>
              {:else if index === 1}
                <span class="trophy silver" aria-label="Silver Medal">🥈</span>
              {:else if index === 2}
                <span class="trophy bronze" aria-label="Bronze Medal">🥉</span>
              {:else}
                {index + 1}
              {/if}
            </span>
            <span class="character">{character_name}</span>
            <span class="camps">{total_camps_crushed || 0}</span>
            <span class="bashbucks">{formatNumber(bashbucks)}</span>
          </button>

          {#if expandedPlayer === character_id && recent_crushes?.length > 0}
            <div
              id="history-{character_id}"
              class="history-container"
              role="region"
              aria-label="Recent camp crushes for {character_name}"
            >
              <h4>Recent Camp Crushes</h4>
              <div class="history-list">
                {#each recent_crushes as crush}
                  <div class="history-item">
                    <span class="system"
                      >{crush.system_name || crush.camp_id}</span
                    >
                    <span class="time">{formatDate(crush.end_time)}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
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
    grid-template-columns: 100px 1fr 120px 150px;
    padding: 1rem;
    background: rgba(255, 255, 255, 0.1);
    font-weight: bold;
    border-bottom: 2px solid rgba(255, 255, 255, 0.1);
  }

  .leaderboard-entry {
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .main-row {
    display: grid;
    grid-template-columns: 100px 1fr 120px 150px;
    padding: 1rem;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: inherit;
    font-size: inherit;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .main-row:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .main-row:focus {
    outline: 2px solid #007bff;
    outline-offset: -2px;
    background: rgba(255, 255, 255, 0.05);
  }

  .podium {
    background: rgba(255, 215, 0, 0.05);
  }

  .podium .main-row:hover {
    background: rgba(255, 215, 0, 0.1);
  }

  .rank {
    text-align: center;
    font-weight: bold;
  }

  .character {
    color: #fff;
  }

  .camps {
    text-align: center;
    color: #7fdbff;
    font-family: monospace;
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

  .history-container {
    padding: 1rem;
    background: rgba(0, 0, 0, 0.3);
    margin: 0 1rem 1rem;
    border-radius: 4px;
  }

  .history-container h4 {
    color: #ffd700;
    margin: 0 0 0.5rem 0;
  }

  .history-list {
    display: grid;
    gap: 0.5rem;
  }

  .history-item {
    display: flex;
    justify-content: space-between;
    padding: 0.5rem;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 4px;
  }

  .history-item .system {
    color: #fff;
  }

  .history-item .time {
    color: #888;
    font-size: 0.9em;
  }
</style>
