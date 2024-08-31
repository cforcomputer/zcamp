<script>
  import socket from './socket.js';
  import { onMount } from 'svelte';
  import SettingsManager from './SettingsManager.svelte';
  import KillmailViewer from './KillmailViewer.svelte';
  import Login from './Login.svelte';
  import io from 'socket.io-client';

  let loggedIn = false;
  let username = '';
  let password = '';
  let settings = {};
  let killmails = [];

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

  function clearKills() {
      if (socket) {
          socket.emit('clearKills');
      }
  }

  onMount(() => {
      if (!socket) {
          console.error('Socket is not initialized on mount');
      }

      socket.on('initialData', ({ killmails: initialKillmails, settings: userSettings }) => {
          killmails = initialKillmails;
          settings = userSettings;
      });

      socket.on('newKillmail', (killmail) => {
        console.log('Received new killmail:', killmail); // Add this log to verify reception
        killmails = [...killmails, killmail];
      });

      function clearKills() { // implement this
      socket.emit('clearKills');
      }



      socket.on('settings', (updatedSettings) => {
          settings = updatedSettings;
      });
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
  <KillmailViewer {killmails} clearKills={clearKills} />
  <SettingsManager on:updateSettings={updateSettings} {settings} />
{/if}

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
