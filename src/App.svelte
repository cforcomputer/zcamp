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
  } from "./settingsStore.js";
  import Login from "./Login.svelte";
  import WelcomeOverlay from "./WelcomeOverlay.svelte";
  import ActiveBattles from "./ActiveBattles.svelte";
  import ActiveCamps from "./ActiveCamps.svelte";
  import ActiveRoams from "./ActiveRoams.svelte";
  import SalvageFields from "./SalvageFields.svelte";
  import { initializeSettings } from "./settingsStore.js";
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
  import campManager from "./campManager.js";
  import roamManager from "./roamManager.js";

  // Create a store for tracking state
  const trackingStore = writable(false);

  let showWelcome = false;
  let checkingSession = true;
  let showLoginModal = false;
  let loggedIn = false;
  let username = "";
  let settingsManagerComponent;
  let currentPage = "camps";
  let showMapOverlay = false;
  let selectedKillmailId = null;
  let selectedKillmail = null;
  let showWreckFieldDialog = false;
  let selectedWreckData = null;
  let isTrackingEnabled = false;
  let currentUser = null;

  $: userSettings = $settings;
  $: kills = $killmails;
  $: userFilterLists = $filterLists;
  $: userProfiles = $profiles;
  $: isConnected = $socketConnected;
  $: socketError = $lastSocketError;
  $: isTracking = $trackingStore;

  $: {
    isTrackingEnabled = $trackingStore;
    console.log("Tracking state:", isTrackingEnabled);
    if (isTrackingEnabled) {
      // Initialize location polling when tracking is enabled
      const startPolling = async () => {
        const success = await startLocationPolling();
        if (!success) {
          trackingStore.set(false); // Reset if polling fails
        }
      };
      startPolling();
    } else {
      stopLocationPolling();
    }
  }

  $: {
    if (currentPage === "camps") {
      campManager.forceUpdate();
    } else if (currentPage === "gangs") {
      roamManager.forceUpdate();
    }
  }

  function handleVerified() {
    showWelcome = false;
    initializeSocketStore();
  }

  function toggleTracking() {
    const newValue = !get(trackingStore);
    trackingStore.set(newValue);
    console.log("Tracking toggled to:", newValue); // Debug log
  }

  async function handleLogin(event) {
    try {
      if (event.detail.type === "credentials") {
        username = event.detail.username;
        loggedIn = true;
      } else if (event.detail.type === "eve") {
        loggedIn = true;
      }
      currentUser = data.user;

      showLoginModal = false;
      showWelcome = false;
      initializeSocketStore();

      try {
        const response = await fetch("/api/session");
        const data = await response.json();

        if (data.user) {
          if (data.filterLists) {
            filterLists.set(data.filterLists);
          }
          if (data.profiles) {
            profiles.set(data.profiles);
          }
          if (data.user.settings) {
            settings.set(initializeSettings(data.user.settings));
          }
          socket.emit("requestInitialKillmails");
        }
      } catch (error) {
        console.error("Error loading initial session data:", error);
        settings.set(initializeSettings({}));
      }

      window.history.replaceState({}, document.title, "/");
    } catch (error) {
      console.error("Error during login:", error);
    }
  }

  async function handleLogout() {
    try {
      const response = await fetch("/api/logout", {
        method: "POST",
        credentials: "include",
      });

      if (response.ok) {
        if (isTrackingEnabled) {
          stopLocationPolling(); // Stop polling before clearing state
        }
        settings.set({});
        filterLists.set([]);
        profiles.set([]);
        killmails.set([]);
        cleanup();
        loggedIn = false;
        currentUser = null;
        username = "";
        showWelcome = true;
        trackingStore.set(false);
        window.location.reload();
      }
    } catch (error) {
      console.error("Error during logout:", error);
    }
  }

  async function checkSession() {
    try {
      const params = new URLSearchParams(window.location.search);
      const isAuthCallback = params.get("authenticated") === "true";

      if (loggedIn) {
        showWelcome = false;
        return;
      }

      const response = await fetch("/api/check-session", {
        credentials: "include",
      });

      const data = await response.json();

      if (data.validSession && data.user) {
        loggedIn = true;
        showWelcome = false;
        currentUser = data.user;

        try {
          const filterListsResponse = await fetch(
            "/api/filter-lists/" + data.user.id,
            {
              credentials: "include",
            }
          );
          const filterListsData = await filterListsResponse.json();
          if (filterListsData.success) {
            filterLists.set(filterListsData.filterLists);
          }
        } catch (error) {
          console.error("Error fetching filter lists:", error);
        }

        try {
          const profilesResponse = await fetch(
            "/api/profiles/" + data.user.id,
            {
              credentials: "include",
            }
          );
          const profilesData = await profilesResponse.json();
          if (profilesData.success) {
            profiles.set(profilesData.profiles);
          }
        } catch (error) {
          console.error("Error fetching profiles:", error);
        }

        if (data.user.settings) {
          settings.set(initializeSettings(data.user.settings));
        }

        initializeSocketStore();
        socket.emit("requestInitialKillmails");

        if (isAuthCallback) {
          window.history.replaceState({}, document.title, "/");
        }
      } else if (!isAuthCallback && response.status === 401) {
        showWelcome = true;
      }
    } catch (error) {
      console.error("Error checking session:", error);
      if (!loggedIn && !window.location.search.includes("authenticated=true")) {
        showWelcome = true;
      }
    } finally {
      checkingSession = false;
    }
  }

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
    await checkSession();
    const handleSessionExpiry = () => {
      loggedIn = false;
      showLoginModal = true;
      settings.set({});
      filterLists.set([]);
      profiles.set([]);
      killmails.set([]);
      trackingStore.set(false);
      cleanup();
    };

    window.addEventListener("session-expired", handleSessionExpiry);
    return () => {
      window.removeEventListener("session-expired", handleSessionExpiry);
    };
  });

  onDestroy(() => {
    if (isTrackingEnabled) {
      stopLocationPolling();
    }
    cleanup();
  });
</script>

<svelte:head>
  <style>
    body {
      margin: 0;
      overflow-y: scroll !important;
      padding-right: 0 !important;
    }
  </style>
</svelte:head>

{#if !checkingSession}
  <div class="min-h-screen">
    {#if showWelcome}
      <WelcomeOverlay
        on:verified={handleVerified}
        on:login={() => {
          showWelcome = false;
          showLoginModal = true;
          initializeSocketStore();
        }}
      />
    {/if}

    {#if showWreckFieldDialog && selectedWreckData}
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div
        class="fixed inset-0 z-50 flex items-center justify-center"
        on:click={closeWreckField}
        on:keydown={(e) => {
          if (e.key === "Escape") closeWreckField();
        }}
      >
        <div class="fixed inset-0 bg-black/75 backdrop-blur-sm" />
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
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
                on:click={() => (currentPage = "camps")}
              >
                Gate Camps
              </button>
              <button
                class="eve-nav-item {currentPage === 'kills'
                  ? 'bg-eve-accent/20 text-eve-accent'
                  : ''}"
                on:click={() => (currentPage = "kills")}
              >
                KM Hunter
              </button>
              <button
                class="eve-nav-item {currentPage === 'battles'
                  ? 'bg-eve-accent/20 text-eve-accent'
                  : ''}"
                on:click={() => (currentPage = "battles")}
              >
                Battles
              </button>
              <button
                class="eve-nav-item {currentPage === 'gangs'
                  ? 'bg-eve-accent/20 text-eve-accent'
                  : ''}"
                on:click={() => (currentPage = "gangs")}
              >
                Gangs
              </button>
              <button
                class="eve-nav-item {currentPage === 'map'
                  ? 'bg-eve-accent/20 text-eve-accent'
                  : ''}"
                on:click={() => (currentPage = "map")}
              >
                Map
              </button>
              <button
                class="eve-nav-item {currentPage === 'salvage'
                  ? 'bg-eve-accent/20 text-eve-accent'
                  : ''}"
                on:click={() => (currentPage = "salvage")}
              >
                Salvage Fields
              </button>
              <button
                class="eve-nav-item {currentPage === 'npcs'
                  ? 'bg-eve-accent/20 text-eve-accent'
                  : ''}"
                on:click={() => (currentPage = "npcs")}
              >
                NPCs
              </button>
              <button
                class="eve-nav-item {currentPage === 'bountyboard'
                  ? 'bg-eve-accent/20 text-eve-accent'
                  : ''}"
                on:click={() => (currentPage = "bountyboard")}
              >
                Bountyboard
              </button>
            </div>

            <div class="flex items-center">
              {#if loggedIn}
                <div class="flex items-center gap-2">
                  <label
                    class="relative inline-flex items-center cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={isTrackingEnabled}
                      on:change={toggleTracking}
                      class="sr-only peer"
                    />
                    <div
                      class="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-eve-accent"
                    />
                    <span class="ml-2 text-sm font-medium text-white"
                      >Track</span
                    >
                  </label>
                </div>

                {#if currentUser?.character_id}
                  <a
                    href="/trophy-page/{currentUser.character_id}"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="eve-nav-item ml-4 text-eve-accent hover:bg-eve-accent/20"
                    title="View Your Trophy Page"
                  >
                    {currentUser.character_name || "Profile"}
                  </a>
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

    <!-- Main content -->
    <main class="pt-16 px-4 max-w-7xl mx-auto {$trackingStore ? 'mt-12' : ''}">
      {#if currentPage === "kills"}
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div class="eve-card">
            <SettingsManager bind:this={settingsManagerComponent} {socket} />
          </div>
          <div class="eve-card">
            <KillmailViewer {openMap} />
          </div>
        </div>
      {:else if currentPage === "camps"}
        <div class="eve-card">
          <ActiveCamps />
        </div>
      {:else if currentPage === "battles"}
        <div class="eve-card">
          <ActiveBattles />
        </div>
      {:else if currentPage === "gangs"}
        <div class="eve-card">
          <ActiveRoams />
        </div>
      {:else if currentPage === "map"}
        <div class="eve-card" style="height: calc(100vh - 100px);">
          <UniverseMap />
        </div>
      {:else if currentPage === "salvage"}
        <div class="eve-card">
          <SalvageFields on:openWreckField={handleOpenWreckField} />
        </div>
      {:else if currentPage === "npcs"}
        <div class="eve-card">
          <NPCPage />
        </div>
      {:else if currentPage === "bountyboard"}
        <div class="eve-card">
          <Leaderboard />
        </div>
      {/if}
    </main>
  </div>

  {#if showLoginModal}
    <div
      class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
    >
      <div class="relative">
        <Login on:login={handleLogin} />
        <button
          class="absolute top-2 right-2 text-gray-400 hover:text-white"
          on:click={() => (showLoginModal = false)}
        >
          ✕
        </button>
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
{/if}

<style>
  :global(body) {
    @apply bg-eve-primary text-gray-200;
    background-image: url("/bg.jpg");
    background-size: cover;
    background-position: center;
    background-attachment: fixed;
  }

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
</style>
