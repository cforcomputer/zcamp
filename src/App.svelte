<script>
  import socket from './socket.js'; // socket.js will handle the socket connection and event listening
  import { onMount } from 'svelte';
  import SettingsManager from './SettingsManager.svelte';
  import KillmailViewer from './KillmailViewer.svelte';
  import { clearKills, killmails, settings } from './store'; // Import the stores and clearKills function
  import Login from './Login.svelte'; // Import the Login component

  let loggedIn = false;
  let username = '';

  // Subscribe to stores
  let userSettings = {};
  let kills = [];

  // Reactive statements for stores
  $: kills = $killmails;
  $: userSettings = $settings;

  // Function to clear all kills
  function clearAllKills() {
    clearKills(); // Clear kills from the store
    if (socket) {
      socket.emit('clearKills'); // Notify the server to clear kills in memory
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

<!-- Render the login form or the main app based on login status -->
{#if !loggedIn}
  <Login on:login={handleLogin} /> <!-- Use the Login component and listen for the login event -->
{:else}
  <KillmailViewer {kills}/>
  <button on:click={clearAllKills}>Clear All Kills</button>
  <SettingsManager on:updateSettings={updateSettings} {settings} />
{/if}
