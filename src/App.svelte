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

  $: userSettings = $settings;
  $: kills = $killmails;
  $: userFilterLists = $filterLists;
  $: userProfiles = $profiles;
  $: isConnected = $socketConnected;
  $: socketError = $lastSocketError;

  function handleVerified() {
    showWelcome = false;
    initializeSocketStore();
  }

  async function handleLogin(event) {
    if (event.detail.type === "credentials") {
      username = event.detail.username;
      loggedIn = true;
    } else if (event.detail.type === "eve") {
      loggedIn = true;
    }

    showLoginModal = false;
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
      }
    } catch (error) {
      console.error("Error loading initial session data:", error);
    }
  }

  async function handleLogout() {
    try {
      const response = await fetch("/api/logout", {
        method: "POST",
        credentials: "include",
      });

      if (response.ok) {
        settings.set({});
        filterLists.set([]);
        profiles.set([]);
        killmails.set([]);
        cleanup();
        loggedIn = false;
        username = "";
      }
    } catch (error) {
      console.error("Error during logout:", error);
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

  onMount(async () => {
    try {
      const response = await fetch("/api/session");
      if (response.status === 401) {
        showWelcome = true;
        checkingSession = false;
        return;
      }

      const data = await response.json();
      if (data.user) {
        loggedIn = true;
        if (data.filterLists) {
          filterLists.set(data.filterLists);
        }
        if (data.profiles) {
          profiles.set(data.profiles);
        }
        if (data.user.settings) {
          settings.set(initializeSettings(data.user.settings));
        }
        initializeSocketStore();
      } else {
        showWelcome = true;
      }
    } catch (error) {
      console.error("Error checking session:", error);
      showWelcome = true;
    } finally {
      checkingSession = false;
    }
  });

  onDestroy(() => {
    cleanup();
  });
</script>

{#if !checkingSession}
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

  <div class="min-h-screen bg-gradient-to-b from-eve-primary to-eve-primary/95">
    <nav
      class="fixed top-0 left-0 right-0 bg-eve-dark/90 backdrop-blur-md border-b border-eve-accent/20 z-40"
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
              Kills
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
              class="eve-nav-item {currentPage === 'salvage'
                ? 'bg-eve-accent/20 text-eve-accent'
                : ''}"
              on:click={() => (currentPage = "salvage")}
            >
              Salvage Fields
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
              <LocationTracker />
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

    <main class="pt-20 px-4 max-w-7xl mx-auto">
      {#if currentPage === "kills"}
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div class="eve-card">
            <SettingsManager bind:this={settingsManagerComponent} {socket} />
          </div>
          <div class="eve-card">
            <KillmailViewer {openMap} />
            <div class="mt-4">
              <button
                class="eve-button w-full"
                on:click={() => {
                  socket.emit("clearKills");
                  clearKills();
                }}
              >
                Clear All Kills
              </button>
            </div>
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
      {:else if currentPage === "salvage"}
        <div class="eve-card">
          <SalvageFields />
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
