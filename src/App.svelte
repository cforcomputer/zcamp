<script>
  import { onMount } from "svelte";
  import socket from "./socket.js";
  import SettingsManager from "./SettingsManager.svelte";
  import KillmailViewer from "./KillmailViewer.svelte";
  import { killmails, settings, filterLists, profiles } from "./store";
  import Login from "./Login.svelte";
  import ActiveBattles from "./ActiveBattles.svelte";
  import ActiveCamps from "./ActiveCamps.svelte";
  import ActiveRoams from "./ActiveRoams.svelte";
  import SalvageFields from "./SalvageFields.svelte";
  import { initializeSettings } from "./store.js";
  import Leaderboard from "./Leaderboard.svelte";
  import LocationTracker from "./LocationTracker.svelte";
  import MapVisualization from "./MapVisualization.svelte";

  let loggedIn = false;
  let username = "";
  let settingsManagerComponent;
  let currentPage = "kills";
  let showMapOverlay = false; // Add a variable to control the map overlay
  let selectedKillmailId = null;
  let selectedKillmail = null;

  $: userSettings = $settings;
  $: kills = $killmails;
  $: userFilterLists = $filterLists;
  $: userProfiles = $profiles;

  export function clearKills() {
    killmails.set([]);
  }

  function handleLogin(event) {
    if (event.detail.type === "credentials") {
      username = event.detail.username;
      loggedIn = true;
      socket.emit("login", { username, password: event.detail.password });
    } else if (event.detail.type === "eve") {
      loggedIn = true;
    }
  }

  // Add functions to show and close the map overlay
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

  onMount(() => {
    socket.on("connect", () => {
      console.log("App.svelte - Connected to server");
    });

    socket.on("disconnect", () => {
      console.log("App.svelte - Disconnected from server");
    });

    socket.on("initialData", (data) => {
      try {
        const initializedSettings = initializeSettings(data.settings);
        settings.set(initializedSettings);
        killmails.set([]);
        filterLists.set(data.filterLists || []);
        profiles.set(data.profiles || []);
      } catch (e) {
        console.error("Error initializing data:", e);
        settings.set(DEFAULT_SETTINGS);
        killmails.set([]);
        filterLists.set([]);
        profiles.set([]);
      }
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("initialData");
    };
  });
</script>

<div class="min-h-screen bg-gradient-to-b from-eve-primary to-eve-primary/95">
  {#if !loggedIn}
    <div class="flex items-center justify-center min-h-screen px-4">
      <Login on:login={handleLogin} />
    </div>
  {:else}
    <nav
      class="fixed top-0 left-0 right-0 bg-eve-dark/90 backdrop-blur-md border-b border-eve-accent/20 z-40"
    >
      <div class="max-w-7xl mx-auto px-4">
        <div class="flex items-center justify-between h-16">
          <div class="flex space-x-1">
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
              class="eve-nav-item {currentPage === 'camps'
                ? 'bg-eve-accent/20 text-eve-accent'
                : ''}"
              on:click={() => (currentPage = "camps")}
            >
              Gate Camps
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
            <LocationTracker />
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
      {:else if currentPage === "battles"}
        <div class="eve-card">
          <ActiveBattles />
        </div>
      {:else if currentPage === "camps"}
        <div class="eve-card">
          <ActiveCamps />
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
  {/if}
</div>

{#if showMapOverlay && selectedKillmailId}
  <div class="map-overlay">
    <div class="map-container">
      <MapVisualization
        killmailId={selectedKillmailId}
        kill={selectedKillmail}
      />
      <button class="close-map" on:click={closeMap}> Close Map </button>
    </div>
  </div>
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
    z-index: 50; /* Ensure it's on top of everything */
    backdrop-filter: blur(5px); /* Add the background blur */
  }

  .map-container {
    position: relative;
    width: 80vw; /* Adjust as needed */
    height: 80vh; /* Adjust as needed */
    background-color: #222; /* Use your desired background color */
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
    z-index: 60; /* Ensure it's above the map */
  }

  .close-map:hover {
    background-color: #c82333;
  }
</style>
