<!-- src/App.svelte -->
<script>
  import { onMount } from "svelte";
  import socket from "./socket.js";
  import SettingsManager from "./SettingsManager.svelte";
  import KillmailViewer from "./KillmailViewer.svelte";
  import { killmails, settings, filterLists, profiles } from "./store";
  import Login from "./Login.svelte";
  import ActiveBattles from "./ActiveBattles.svelte";
  import ActiveCamps from "./ActiveCamps.svelte";
  import { initializeSettings } from "./store.js";

  let loggedIn = false;
  let username = "";
  let settingsManagerComponent;
  let currentPage = "kills";

  // Subscribe to stores
  $: userSettings = $settings;
  $: kills = $killmails;
  $: userFilterLists = $filterLists;
  $: userProfiles = $profiles;

  $: {
    console.log("App.svelte - userProfiles updated:", userProfiles);
  }

  // Function to clear all kills
  export function clearKills() {
    killmails.set([]);
  }

  // Handle login event from Login.svelte
  function handleLogin(event) {
    if (event.detail.type === "credentials") {
      username = event.detail.username;
      loggedIn = true;
      socket.emit("login", { username, password: event.detail.password });
    } else if (event.detail.type === "eve") {
      // EVE SSO login - just set logged in state, session already exists
      loggedIn = true;
    }
  }

  // Lifecycle hook
  onMount(() => {
    console.log("App.svelte - onMount");

    // Only handle connection events here
    socket.on("connect", () => {
      console.log("App.svelte - Connected to server");
    });

    socket.on("disconnect", () => {
      console.log("App.svelte - Disconnected from server");
    });

    // This is the only place we should initialize stores
    socket.on("initialData", (data) => {
      try {
        console.log("App.svelte - Received initialData:", data);
        const initializedSettings = initializeSettings(data.settings);
        settings.set(initializedSettings); // This will properly merge defaults with saved settings
        killmails.set([]);
        filterLists.set(data.filterLists || []);
        profiles.set(data.profiles || []);
        console.log("App.svelte - Stores initialized");
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

<main>
  {#if !loggedIn}
    <Login on:login={handleLogin} />
  {:else}
    <div class="nav-tabs">
      <button
        class:active={currentPage === "kills"}
        on:click={() => (currentPage = "kills")}
      >
        Kills
      </button>
      <button
        class:active={currentPage === "battles"}
        on:click={() => (currentPage = "battles")}
      >
        Active Battles
      </button>
      <button
        class:active={currentPage === "camps"}
        on:click={() => (currentPage = "camps")}
      >
        Gate Camps
      </button>
    </div>

    {#if currentPage === "kills"}
      <div class="dashboard">
        <div class="settings-section">
          <SettingsManager bind:this={settingsManagerComponent} {socket} />
        </div>
        <div class="killmail-section">
          <KillmailViewer />
          <button
            on:click={() => {
              socket.emit("clearKills");
              clearKills();
            }}>Clear All Kills</button
          >
        </div>
      </div>
    {:else if currentPage === "battles"}
      <ActiveBattles />
    {:else}
      <ActiveCamps />
    {/if}
  {/if}
</main>

<style>
  main {
    text-align: center;
    padding: 1em;
    max-width: 1200px;
    margin: 0 auto;
  }

  .dashboard {
    display: flex;
    flex-direction: column;
    height: calc(100vh - 100px);
  }

  .settings-section {
    flex: 1;
    overflow-y: auto;
    margin-bottom: 1em;
  }

  .killmail-section {
    flex: 1;
    overflow-y: auto;
  }

  .nav-tabs {
    display: flex;
    gap: 1em;
    margin-bottom: 1em;
  }

  .nav-tabs button {
    padding: 0.5em 1em;
    border: none;
    background: #ddd;
    cursor: pointer;
    border-radius: 4px;
    transition: background-color 0.2s;
  }

  .nav-tabs button.active {
    background: #007bff;
    color: white;
  }

  .nav-tabs button:hover {
    background: #0056b3;
    color: white;
  }

  @media (min-width: 768px) {
    .dashboard {
      flex-direction: row;
    }

    .settings-section,
    .killmail-section {
      width: 50%;
    }

    .settings-section {
      margin-right: 1em;
      margin-bottom: 0;
    }
  }
</style>
