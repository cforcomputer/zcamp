<script>
  import { onMount } from "svelte";
  import socket from "./socket.js";
  import SettingsManager from "./SettingsManager.svelte";
  import KillmailViewer from "./KillmailViewer.svelte";
  import { killmails, settings, filterLists, profiles } from "./store";
  import Login from "./Login.svelte";

  let loggedIn = false;
  let username = "";
  let settingsManagerComponent;

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
    username = event.detail.username;
    loggedIn = true;
    socket.emit("login", { username, password: event.detail.password });
  }

  // Lifecycle hook
  onMount(() => {
    console.log("App.svelte - onMount");

    socket.on("connect", () => {
      console.log("App.svelte - Connected to server");
    });

    socket.on("disconnect", () => {
      console.log("App.svelte - Disconnected from server");
    });

    socket.on("initialData", (data) => {
      console.log("App.svelte - Received initialData:", data);
      killmails.set(data.killmails);
      settings.set(data.settings);
      filterLists.set(data.filterLists);
      profiles.set(data.profiles);
      console.log("App.svelte - Stores updated with initial data");
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
    <div class="dashboard">
      <div class="settings-section">
        <SettingsManager bind:this={settingsManagerComponent} {socket} />
      </div>
      <div class="killmail-section">
        <KillmailViewer />
        <button
          on:click={() => {
            socket.emit("clearKills");
            clearKills(); // Call the store's clearKills function
          }}>Clear All Kills</button
        >
      </div>
    </div>
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
    height: calc(100vh - 100px); /* Adjust based on your header height */
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
