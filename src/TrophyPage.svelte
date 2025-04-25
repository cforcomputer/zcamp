<script>
  import { onMount } from "svelte";
  let characterId = null;
  let profileData = null; // Will now include { characterName, bashbucks, successfulAttacks, rank }
  let error = null;
  let isLoading = true;

  onMount(async () => {
    // Extract characterId from URL. This depends on your routing setup.
    // Example for non-SvelteKit:
    const pathSegments = window.location.pathname.split("/");
    characterId = pathSegments[pathSegments.length - 1]; // If using SvelteKit:
    // $: characterId = $page.params.characterId;
    if (characterId) {
      try {
        isLoading = true; // Ensure loading state is true
        const response = await fetch(`/api/trophy/${characterId}`); // Fetch from the updated JSON API route
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            errorData.error || `Failed to load profile: ${response.statusText}`
          );
        }
        profileData = await response.json();
      } catch (err) {
        console.error("Error loading profile:", err);
        error = err.message;
      } finally {
        isLoading = false;
      }
    } else {
      error = "No character ID found in URL.";
      isLoading = false;
    }
  }); // Helper function to format rank with ordinal suffix (1st, 2nd, 3rd, 4th...)

  function formatRank(rank) {
    if (!rank) return "N/A";
    const j = rank % 10,
      k = rank % 100;
    if (j == 1 && k != 11) {
      return rank + "st";
    }
    if (j == 2 && k != 12) {
      return rank + "nd";
    }
    if (j == 3 && k != 13) {
      return rank + "rd";
    }
    return rank + "th";
  }
</script>

<svelte:head>
  <title
    >{profileData
      ? `${profileData.characterName}'s Trophy Page`
      : "Trophy Page"}</title
  > <link rel="stylesheet" href="/global.css" />
  <link rel="stylesheet" href="/build/bundle.css" />
  <style>
    /* Minimal styling for standalone page */
    body {
      /* --- Background Image Styling --- */
      background-image: url("/bg.jpg"); /* Make sure bg.jpg is in /public */
      background-size: cover; /* Scale the image to cover the entire body */
      background-position: center center; /* Center the image */
      background-repeat: no-repeat; /* Prevent the image from repeating */
      background-attachment: fixed; /* Keep the background fixed during scroll */
      /* --- End Background Image Styling --- */

      @apply text-gray-300 font-sans; /* Original Tailwind colors */
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 2rem;
    }
    .trophy-card {
      /* Make background semi-transparent to see the body background */
      @apply bg-eve-secondary/90 p-8 rounded-lg shadow-xl border border-eve-accent/30 max-w-md w-full; /* Tailwind colors */
      backdrop-filter: blur(4px); /* Optional: Add a blur effect */
      -webkit-backdrop-filter: blur(4px); /* Safari support */
    }
    h1 {
      @apply text-3xl font-bold text-eve-accent mb-6 text-center; /* Tailwind colors */
      text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5); /* Add subtle text shadow */
    }
    .stat {
      @apply flex justify-between items-center py-3 border-b border-gray-700/50; /* Make border lighter */
    }
    .stat-label {
      @apply text-gray-400;
    }
    .stat-value {
      @apply text-white font-semibold text-lg;
    }
    .loading,
    .error {
      @apply text-center text-gray-300 italic; /* Make loading text lighter */
    }
    .error {
      @apply text-eve-danger; /* Tailwind colors */
    }
  </style>
</svelte:head>

<main class="trophy-card">
  {#if isLoading}
    <p class="loading">Loading profile...</p>
  {:else if error}
    <p class="error">Error: {error}</p>
  {:else if profileData}
    <h1>{profileData.characterName}</h1>
    <div class="space-y-4">
      <div class="stat">
        <span class="stat-label">Leaderboard Rank</span>
        <span class="stat-value">
          {#if profileData.rank}
            {formatRank(profileData.rank)} <span aria-hidden="true">🏆</span>
          {:else}
            Unranked
          {/if}
        </span>
      </div>
      <div class="stat">
        <span class="stat-label">Bashbucks</span>
        <span class="stat-value"
          >{profileData.bashbucks?.toLocaleString() || 0}
          <span aria-hidden="true">💎</span></span
        >
      </div>
      <div class="stat">
        <span class="stat-label">Gates Crushed</span>
        <span class="stat-value"
          >{profileData.successfulAttacks?.toLocaleString() || 0}
          <span aria-hidden="true">💥</span></span
        >
      </div>
    </div>
  {:else}
    <p class="error">Profile not found.</p>
  {/if}
</main>
