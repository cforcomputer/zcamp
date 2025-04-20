<script>
  import { onMount, onDestroy } from "svelte";
  import {
    initializeSocketStore,
    cleanup,
    socketConnected,
    lastSocketError,
    socket,
  } from "./dataManager.js";
  import SettingsManager from "./SettingsManager.svelte";
  import KillmailViewer from "./KillmailViewer.svelte";
  import {
    killmails,
    settings,
    filterLists,
    profiles,
    clearKills,
    initializeSettings, // Import initializeSettings
  } from "./settingsStore.js";
  import Login from "./Login.svelte";
  import WelcomeOverlay from "./WelcomeOverlay.svelte";
  import ActiveBattles from "./ActiveBattles.svelte";
  import ActiveCamps from "./ActiveCamps.svelte";
  import ActiveRoams from "./ActiveRoams.svelte";
  import SalvageFields from "./SalvageFields.svelte";
  import Leaderboard from "./Leaderboard.svelte";
  import LocationTracker from "./LocationTracker.svelte";
  import MapVisualization from "./MapVisualization.svelte";
  import WreckFieldDialog from "./WreckFieldDialog.svelte";
  import UniverseMap from "./UniverseMap.svelte";
  import NPCPage from "./NPCPage.svelte";
  import { slide } from "svelte/transition";
  import { writable, get } from "svelte/store";
  import {
    startLocationPolling,
    stopLocationPolling,
  } from "./locationStore.js";
  // --- CHANGE: Import the new activity manager ---
  import activityManager from "./activityManager.js";
  // --- Removed old manager imports ---

  // Create a store for tracking state
  const trackingStore = writable(false);

  let showWelcome = false;
  let checkingSession = true;
  let showLoginModal = false;
  let loggedIn = false;
  let username = ""; // Keep username if needed for display, but rely on session for auth
  let settingsManagerComponent;
  let currentPage = "camps"; // Default page
  let showMapOverlay = false;
  let selectedKillmailId = null;
  let selectedKillmail = null;
  let showWreckFieldDialog = false;
  let selectedWreckData = null;
  let isTrackingEnabled = false;
  let currentUser = null; // Store user info from session

  // Reactive subscriptions
  $: userSettings = $settings;
  $: kills = $killmails;
  $: userFilterLists = $filterLists;
  $: userProfiles = $profiles;
  $: isConnected = $socketConnected;
  $: socketError = $lastSocketError;
  $: isTracking = $trackingStore; // Subscribe to tracking store

  // --- CHANGE: Update tracking logic ---
  $: {
    isTrackingEnabled = $trackingStore; // Keep local variable in sync
    console.log("Tracking state changed in App:", isTrackingEnabled);
    if (loggedIn && isTrackingEnabled) {
      // Only poll if logged in and tracking enabled
      startLocationPolling().then((success) => {
        if (!success) {
          console.error(
            "Failed to start location polling, disabling tracking."
          );
          trackingStore.set(false); // Reset tracking if polling fails to start
        }
      });
    } else {
      stopLocationPolling(); // Stop polling if not logged in or tracking disabled
    }
  }
  // --- END CHANGE ---

  // --- CHANGE: Update reactive block for page switching ---
  let mounted = false; // Track mount state for reactivity updates
  $: {
    // Optionally force an update when switching to activity-related pages
    // This can make the UI feel slightly more responsive by immediately requesting data
    if (
      mounted &&
      (currentPage === "camps" ||
        currentPage === "gangs" ||
        currentPage === "map")
    ) {
      activityManager.forceUpdate();
    }
  }
  // --- END CHANGE ---

  function handleVerified() {
    showWelcome = false;
    // Initialize socket store AFTER verification if not logged in
    if (!loggedIn) {
      initializeSocketStore();
    }
  }

  function toggleTracking() {
    if (!loggedIn) {
      alert("Please log in with EVE Online to enable location tracking.");
      return;
    }
    const newValue = !get(trackingStore);
    trackingStore.set(newValue);
    console.log("Tracking toggled to:", newValue);
  }

  // --- Updated handleLogin ---
  async function handleLogin(event) {
    // Login handled via session check after EVE SSO redirect or credential check
    // We just need to update the UI state based on the successful session check
    await checkSession(); // Re-check session to load data
    if (loggedIn) {
      showLoginModal = false;
      showWelcome = false;
      // Socket store should be initialized by checkSession if login was successful
    } else {
      // Handle case where login attempt failed (error should be shown by Login component)
      console.error("Login attempt reported but session check failed.");
    }
  }
  // --- End Updated handleLogin ---

  async function handleLogout() {
    try {
      const response = await fetch("/api/logout", {
        method: "POST",
        credentials: "include",
      });

      if (response.ok) {
        trackingStore.set(false); // Turn off tracking on logout
        // Clear client-side stores
        settings.set({});
        filterLists.set([]);
        profiles.set([]);
        killmails.set([]);
        // Cleanup socket connections and listeners
        cleanup();
        // Update UI state
        loggedIn = false;
        currentUser = null;
        username = ""; // Clear username display
        showWelcome = true; // Show welcome screen again
        // Optionally reload the page for a clean state
        // window.location.reload();
      } else {
        console.error("Logout API call failed:", response.status);
      }
    } catch (error) {
      console.error("Error during logout:", error);
    }
  }

  // --- Updated checkSession ---
  async function checkSession() {
    checkingSession = true; // Start check
    try {
      const response = await fetch("/api/session", { credentials: "include" });

      if (response.ok) {
        const data = await response.json();
        if (data.user) {
          loggedIn = true;
          showWelcome = false;
          currentUser = data.user; // Store user data

          // Initialize stores with fetched data
          if (data.filterLists) filterLists.set(data.filterLists);
          if (data.profiles) profiles.set(data.profiles);
          // Use initializeSettings to merge defaults with fetched settings
          // Ensure settings are initialized before dependent logic runs
          const initialSettings = initializeSettings(data.user.settings || {});
          settings.set(initialSettings);
          // Update tracking store based on loaded settings if necessary (or keep it independent)
          // trackingStore.set(initialSettings.trackingEnabled || false); // Example if tracking was a setting

          // Initialize socket store now that we are logged in
          initializeSocketStore();

          // Clear URL params if coming from SSO callback
          const params = new URLSearchParams(window.location.search);
          if (params.get("authenticated") === "true") {
            window.history.replaceState({}, document.title, "/");
          }
        } else {
          // API returned OK but no user data - treat as logged out
          handleLogout(); // Ensure clean state
          showWelcome = true;
        }
      } else if (response.status === 401) {
        // Not logged in
        loggedIn = false;
        currentUser = null;
        showWelcome = true;
      } else {
        // Other server error
        console.error("Error checking session status:", response.status);
        showWelcome = true; // Default to welcome screen on error
      }
    } catch (error) {
      console.error("Error checking session:", error);
      // Don't assume logged out on network error, could be temporary
      // Show welcome only if we are sure there's no active session
      if (!loggedIn) {
        showWelcome = true;
      }
    } finally {
      checkingSession = false; // Finish check
    }
  }
  // --- End Updated checkSession ---

  function openMap(killmail) {
    selectedKillmailId = killmail.killID;
    selectedKillmail = killmail;
    showMapOverlay = true;
  }

  function closeMap() {
    showMapOverlay = false;
    selectedKillmailId = null;
    selectedKillmail = null;
  }

  function handleOpenWreckField(event) {
    selectedWreckData = {
      wrecks: event.detail.wrecks,
      totalValue: event.detail.totalValue,
      nearestCelestial: event.detail.nearestCelestial,
    };
    showWreckFieldDialog = true;
  }

  function closeWreckField() {
    showWreckFieldDialog = false;
    selectedWreckData = null;
  }

  onMount(async () => {
    mounted = true; // Set mounted flag here
    await checkSession(); // Check session state when component mounts

    // Listen for session expiry events triggered by tokenManager
    const handleSessionExpiry = () => {
      console.log("Session expired event received in App.svelte");
      handleLogout(); // Trigger logout process
      showLoginModal = true; // Show login modal after logout
    };
    window.addEventListener("session-expired", handleSessionExpiry);

    // Cleanup function
    return () => {
      mounted = false; // Reset mounted flag
      window.removeEventListener("session-expired", handleSessionExpiry);
      // Socket cleanup is handled in dataManager's cleanup
      // Polling cleanup is handled by trackingStore reactivity
    };
  });
</script>

<svelte:head>
  <style>
    body {
      margin: 0;
      overflow-y: scroll !important; /* Ensure scrollbar is always present to prevent layout shifts */
      padding-right: 0 !important;
    }
  </style>
</svelte:head>

{#if checkingSession}
  <div
    class="fixed inset-0 flex items-center justify-center bg-eve-primary z-50"
  >
    <p class="text-eve-accent text-xl animate-pulse">Initializing...</p>
  </div>
{:else}
  <div class="min-h-screen">
    {#if showWelcome && !loggedIn}
      <WelcomeOverlay
        on:verified={handleVerified}
        on:login={() => {
          showWelcome = false;
          showLoginModal = true;
          // Initialize socket store only if not already initialized by a previous guest session
          if (!get(socketConnected)) {
            initializeSocketStore();
          }
        }}
      />
    {/if}

    {#if showWreckFieldDialog && selectedWreckData}
      <div
        class="fixed inset-0 z-[60] flex items-center justify-center"
        on:click={closeWreckField}
        on:keydown={(e) => {
          if (e.key === "Escape") closeWreckField();
        }}
      >
        <div class="fixed inset-0 bg-black/75 backdrop-blur-sm" />
        <div class="relative z-50" on:click|stopPropagation>
          <WreckFieldDialog
            wrecks={selectedWreckData.wrecks}
            totalValue={selectedWreckData.totalValue}
            nearestCelestial={selectedWreckData.nearestCelestial}
            onClose={closeWreckField}
          />
        </div>
      </div>
    {/if}

    <div class="fixed top-0 left-0 right-0 z-40 flex flex-col">
      <nav
        class="bg-eve-dark/90 backdrop-blur-md border-b border-eve-accent/20"
      >
        <div class="max-w-7xl mx-auto px-4">
          <div class="flex items-center justify-between h-16">
            <div class="flex space-x-1">
              <button
                class="eve-nav-item {currentPage === 'camps'
                  ? 'bg-eve-accent/20 text-eve-accent'
                  : ''}"
                on:click={() => (currentPage = "camps")}>Gate Camps</button
              >
              <button
                class="eve-nav-item {currentPage === 'kills'
                  ? 'bg-eve-accent/20 text-eve-accent'
                  : ''}"
                on:click={() => (currentPage = "kills")}>KM Hunter</button
              >
              <button
                class="eve-nav-item {currentPage === 'battles'
                  ? 'bg-eve-accent/20 text-eve-accent'
                  : ''}"
                on:click={() => (currentPage = "battles")}>Battles</button
              >
              <button
                class="eve-nav-item {currentPage === 'gangs'
                  ? 'bg-eve-accent/20 text-eve-accent'
                  : ''}"
                on:click={() => (currentPage = "gangs")}>Gangs</button
              >
              <button
                class="eve-nav-item {currentPage === 'map'
                  ? 'bg-eve-accent/20 text-eve-accent'
                  : ''}"
                on:click={() => (currentPage = "map")}>Map</button
              >
              <button
                class="eve-nav-item {currentPage === 'salvage'
                  ? 'bg-eve-accent/20 text-eve-accent'
                  : ''}"
                on:click={() => (currentPage = "salvage")}
                >Salvage Fields</button
              >
              <button
                class="eve-nav-item {currentPage === 'npcs'
                  ? 'bg-eve-accent/20 text-eve-accent'
                  : ''}"
                on:click={() => (currentPage = "npcs")}>NPCs</button
              >
              <button
                class="eve-nav-item {currentPage === 'bountyboard'
                  ? 'bg-eve-accent/20 text-eve-accent'
                  : ''}"
                on:click={() => (currentPage = "bountyboard")}
                >Bountyboard</button
              >
            </div>

            <div class="flex items-center">
              {#if loggedIn}
                <div class="flex items-center gap-2 mr-4">
                  <label
                    class="relative inline-flex items-center cursor-pointer"
                    title={currentUser?.character_id
                      ? "Toggle location tracking (requires ESI scopes)"
                      : "Login with EVE to enable tracking"}
                  >
                    <input
                      type="checkbox"
                      checked={isTrackingEnabled}
                      on:change={toggleTracking}
                      class="sr-only peer"
                      disabled={!currentUser?.character_id}
                    />
                    <div
                      class="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-eve-accent peer-disabled:opacity-50 peer-disabled:cursor-not-allowed"
                    ></div>
                    <span
                      class="ms-2 text-sm font-medium text-white {!currentUser?.character_id
                        ? 'opacity-50'
                        : ''}">Track</span
                    >
                  </label>
                </div>

                {#if currentUser?.character_id}
                  <a
                    href="/trophy-page/{currentUser.character_id}"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="eve-nav-item text-eve-accent hover:bg-eve-accent/20"
                    title="View Your Trophy Page"
                  >
                    {currentUser.character_name || "Profile"}
                  </a>
                {:else}
                  <span
                    class="eve-nav-item text-gray-400"
                    title="Logged in with username/password"
                  >
                    {username || "User"}
                  </span>
                {/if}

                <button
                  class="eve-nav-item ml-4 text-eve-danger hover:bg-eve-danger/20"
                  on:click={handleLogout}
                >
                  Logout
                </button>
              {:else}
                <button
                  class="eve-nav-item ml-4 text-eve-accent hover:bg-eve-accent/20"
                  on:click={() => (showLoginModal = true)}
                >
                  Login
                </button>
              {/if}
            </div>
          </div>
        </div>
      </nav>

      {#if loggedIn && $trackingStore}
        <div
          transition:slide
          class="bg-eve-dark/80 backdrop-blur-sm border-b border-eve-accent/10"
        >
          <div class="max-w-7xl mx-auto px-4 h-12">
            <LocationTracker isTracking={isTrackingEnabled} />
          </div>
        </div>
      {/if}
    </div>

    <main
      class="pt-16 px-4 max-w-7xl mx-auto {$trackingStore && loggedIn
        ? 'mt-12'
        : ''}"
    >
      {#if currentPage === "kills"}
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div class="eve-card backdrop-blur-eve">
            <SettingsManager bind:this={settingsManagerComponent} {socket} />
          </div>
          <div class="eve-card backdrop-blur-eve">
            <KillmailViewer {openMap} />
          </div>
        </div>
      {:else if currentPage === "camps"}
        <div class="eve-card backdrop-blur-eve"><ActiveCamps /></div>
      {:else if currentPage === "battles"}
        <div class="eve-card backdrop-blur-eve"><ActiveBattles /></div>
      {:else if currentPage === "gangs"}
        <div class="eve-card backdrop-blur-eve"><ActiveRoams /></div>
      {:else if currentPage === "map"}
        <div
          class="eve-card backdrop-blur-eve"
          style="height: calc(100vh - 100px);"
        >
          <UniverseMap />
        </div>
      {:else if currentPage === "salvage"}
        <div class="eve-card backdrop-blur-eve">
          <SalvageFields on:openWreckField={handleOpenWreckField} />
        </div>
      {:else if currentPage === "npcs"}
        <div class="eve-card backdrop-blur-eve"><NPCPage /></div>
      {:else if currentPage === "bountyboard"}
        <div class="eve-card backdrop-blur-eve"><Leaderboard /></div>
      {/if}
    </main>

    {#if showLoginModal}
      <div
        class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      >
        <div class="relative">
          <Login on:login={handleLogin} />
          <button
            class="absolute top-2 right-2 text-gray-400 hover:text-white"
            on:click={() => (showLoginModal = false)}>✕</button
          >
        </div>
      </div>
    {/if}

    {#if showMapOverlay && selectedKillmailId}
      <div class="map-overlay">
        <div class="map-container">
          <MapVisualization
            killmailId={selectedKillmailId}
            kill={selectedKillmail}
          />
          <button class="close-map" on:click={closeMap}>Close Map</button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Basic styles, assuming Tailwind handles most */
  :global(body) {
    @apply bg-eve-primary text-gray-200;
    background-image: url("/bg.jpg");
    background-size: cover;
    background-position: center;
    background-attachment: fixed;
  }
  .eve-nav-item {
    @apply px-3 py-2 rounded-md text-sm font-medium text-gray-300 hover:text-white hover:bg-eve-secondary/50 transition-colors;
  }
  /* --- CHANGE: Removed backdrop-blur-eve from @apply --- */
  .eve-card {
    @apply bg-eve-card rounded-lg shadow-lg p-4 mb-6;
  } /* Reusable card style */
  /* --- END CHANGE --- */

  .map-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.75);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 50;
    backdrop-filter: blur(5px);
  }
  .map-container {
    position: relative;
    width: 80vw;
    height: 80vh;
    background-color: #222;
    border-radius: 5px;
    overflow: hidden;
  }
  .close-map {
    position: absolute;
    top: 10px;
    right: 10px;
    padding: 8px 16px;
    background-color: #dc3545;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    z-index: 60;
  }
  .close-map:hover {
    background-color: #c82333;
  }

  /* Ensure tracking toggle looks right */
  .form-checkbox {
    @apply rounded border-eve-accent/50 text-eve-accent focus:ring-eve-accent;
  }
</style>
