<script>
  import socket from './socket.js'; // socket.js will handle the socket connection and event listening
  import { onMount } from 'svelte';
  import SettingsManager from './SettingsManager.svelte';
  import KillmailViewer from './KillmailViewer.svelte';
  import { clearKills } from './store.js';
  import Login from './Login.svelte';

  import { killmails, settings } from './store'; // Import the stores

  let loggedIn = false;
  let username = '';
  let password = '';

  // Subscribe to stores
  let userSettings = {};
  let kills = [];

  $: kills = $killmails;
  $: userSettings = $settings;

  function clearAllKills() {
    clearKills(); // Clear kills from the store
    if (socket) {
      socket.emit('clearKills'); // Notify the server to clear kills in memory
    } else {
      console.error('Socket is not initialized');
    }
  }

  function handleLogin(event) {
    username = event.detail.username;
    password = event.detail.password;
    loggedIn = true;

    if (socket) {
      socket.emit('login', { username, password });
    } else {
      console.error('Socket is not initialized');
    }
  }

  function updateSettings(event) {
    const newSettings = event.detail;
    if (socket) {
      socket.emit('updateSettings', newSettings);
    } else {
      console.error('Socket is not initialized');
    }
  }

  onMount(() => {
    if (!socket) {
      console.error('Socket is not initialized on mount');
    }

    // Note: Socket events are handled centrally in socket.js, so no need to handle them here
  });
</script>

{#if !loggedIn}
  <div class="login-form">
    <label>
      Username:
      <input type="text" bind:value={username} />
    </label>
    <label>
      Password:
      <input type="password" bind:value={password} />
    </label>
    <button on:click={() => handleLogin({ detail: { username, password } })}>Login</button>
  </div>
{:else}
  <KillmailViewer {kills}/>
  <button on:click={clearAllKills}>Clear All Kills</button>
  <SettingsManager on:updateSettings={updateSettings} {settings} />
{/if}

<head>
  <link rel="stylesheet" href="/global.css">
  <link rel="stylesheet" href="build/public/build/bundle.css"> 
  <script src="/build/bundle.js"></script>
</head>

<style>
  .login-form {
    margin: 20px;
  }
  label {
    display: block;
    margin-bottom: 10px;
  }
  button {
    padding: 5px 10px;
  }
</style>
