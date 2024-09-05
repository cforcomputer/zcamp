<script>
  import { onMount } from 'svelte';
  import socket from './socket.js';
  import SettingsManager from './SettingsManager.svelte';
  import KillmailViewer from './KillmailViewer.svelte';
  import { clearKills, killmails, settings, filterLists } from './store';
  import Login from './Login.svelte';

  let loggedIn = false;
  let username = '';
  let settingsManagerComponent;
  let userProfiles = [];

  // Subscribe to stores
  $: userSettings = $settings;
  $: kills = $killmails;
  $: userFilterLists = $filterLists;

  // Function to clear all kills
  function clearAllKills() {
    clearKills();
    socket.emit('clearKills');
  }

  // Handle login event from Login.svelte
  function handleLogin(event) {
    username = event.detail.username;
    loggedIn = true;
    socket.emit('login', { username, password: event.detail.password });
  }

  // Lifecycle hook
  onMount(() => {
    socket.on('connect', () => {
      console.log('Connected to server');
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from server');
    });

    socket.on('initialData', (data) => {
      killmails.set(data.killmails);
      settings.set(data.settings);
      filterLists.set(data.filterLists);
      userProfiles = data.profiles;
      console.log('Initial profiles received:', userProfiles);
      if (settingsManagerComponent) {
        settingsManagerComponent.setProfiles(userProfiles);
      }
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('initialData');
    };
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
          bind:this={settingsManagerComponent}
          {userSettings}
          {userFilterLists}
          {socket}
          profiles={userProfiles}
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