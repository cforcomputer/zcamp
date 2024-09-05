<script>
  import socket from './socket.js';
  import { onMount } from 'svelte';
  import SettingsManager from './SettingsManager.svelte';
  import KillmailViewer from './KillmailViewer.svelte';
  import { clearKills, killmails, settings, filterLists } from './store';
  import Login from './Login.svelte';

  let loggedIn = false;
  let username = '';

  // Subscribe to stores
  let userSettings = {};
  let kills = [];
  let userFilterLists = [];

  // Reactive statements for stores
  $: kills = $killmails;
  $: userSettings = $settings;
  $: userFilterLists = $filterLists;

  // Function to clear all kills
  function clearAllKills() {
    clearKills();
    if (socket) {
      socket.emit('clearKills');
    } else {
      console.error('Socket is not initialized');
    }
  }

  // Handle login event from Login.svelte
  function handleLogin(event) {
    username = event.detail.username;
    loggedIn = true;

    if (socket) {
      socket.emit('login', { username, password: event.detail.password });
    } else {
      console.error('Socket is not initialized');
    }
  }

  // Handle settings update event from SettingsManager
  function updateSettings(event) {
    const newSettings = event.detail;
    if (socket) {
      socket.emit('updateSettings', newSettings);
    } else {
      console.error('Socket is not initialized');
    }
  }

  // Lifecycle hook
  onMount(() => {
    if (!socket) {
      console.error('Socket is not initialized on mount');
    }
  });
</script>

<main>
  <h1>KM Hunter</h1>
  
  {#if !loggedIn}
    <Login on:login={handleLogin} />
  {:else}
    <div class="dashboard">
      <div class="settings-section">
        <SettingsManager 
          on:updateSettings={updateSettings} 
          {userSettings}
          {userFilterLists}
        />
      </div>
      <div class="killmail-section">
        <KillmailViewer {kills}/>
        <button on:click={clearAllKills}>Clear All Kills</button>
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

  h1 {
    color: #ff3e00;
    text-transform: uppercase;
    font-size: 2em;
    font-weight: 100;
    margin-bottom: 0.5em;
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

    .settings-section, .killmail-section {
      width: 50%;
    }

    .settings-section {
      margin-right: 1em;
      margin-bottom: 0;
    }
  }
</style>