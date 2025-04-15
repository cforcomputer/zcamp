<script>
  import { onMount } from "svelte";
  import { page } from "$app/stores"; // If using SvelteKit routing (needs setup)
  // Otherwise, parse from window.location

  let characterId = null;
  let profileData = null;
  let error = null;
  let isLoading = true;

  onMount(async () => {
    // Extract characterId from URL. This depends on your routing setup.
    // If NOT using SvelteKit, you might parse window.location.pathname
    // Example for non-SvelteKit:
    const pathSegments = window.location.pathname.split("/");
    characterId = pathSegments[pathSegments.length - 1];
    // If using SvelteKit:
    // $: characterId = $page.params.characterId;

    if (characterId) {
      try {
        const response = await fetch(`/api/trophy/${characterId}`); // Fetch from the JSON API route
        if (!response.ok) {
          throw new Error(`Failed to load profile: ${response.statusText}`);
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
  });
</script>

<svelte:head>
  <title
    >{profileData
      ? `${profileData.characterName}'s Trophy Page`
      : "Trophy Page"}</title
  >
  <link rel="stylesheet" href="/global.css" />
  <link rel="stylesheet" href="/build/bundle.css" />
  <style>
    /* Minimal styling for standalone page */
    body {
      @apply bg-eve-primary text-gray-300 font-sans; /* Using Tailwind colors [cite: 461] */
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 2rem;
    }
    .trophy-card {
      @apply bg-eve-secondary p-8 rounded-lg shadow-xl border border-eve-accent/30 max-w-md w-full; /* [cite: 461] */
    }
    h1 {
      @apply text-3xl font-bold text-eve-accent mb-6 text-center; /* [cite: 461] */
    }
    .stat {
      @apply flex justify-between py-3 border-b border-gray-700;
    }
    .stat-label {
      @apply text-gray-400;
    }
    .stat-value {
      @apply text-white font-semibold text-lg;
    }
    .loading,
    .error {
      @apply text-center text-gray-400 italic;
    }
    .error {
      @apply text-eve-danger; /* [cite: 461] */
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
        <span class="stat-label">Bashbucks</span>
        <span class="stat-value"
          >{profileData.bashbucks?.toLocaleString() || 0} 💎</span
        >
      </div>
      <div class="stat">
        <span class="stat-label">Gates Crushed</span>
        <span class="stat-value"
          >{profileData.successfulAttacks?.toLocaleString() || 0} 💥</span
        >
      </div>
    </div>
  {:else}
    <p class="error">Profile not found.</p>
  {/if}
</main>
