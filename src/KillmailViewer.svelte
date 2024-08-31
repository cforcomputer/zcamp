<script>
  import { onMount } from 'svelte';
  import MapVisualization from './MapVisualization.svelte';
  import io from 'socket.io-client';

  let killmails = [];
  let settings = {};
  let socket;

  let selectedKillmailId = null;

  onMount(() => {
    // Initialize the socket connection to the correct server URL
    socket = io(); // Update this URL if needed

    // Log connection status
    socket.on('connect', () => {
      console.log('Socket connected:', socket.id);
    });

    // Handle connection errors
    socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
    });

    // Listen for initial data from the server
    socket.on('initialData', (data) => {
      console.log('Received initialData:', data); // Debugging log
      settings = data.settings;
      killmails = data.killmails;
    });

    // Listen for new killmails
    socket.on('newKillmail', (killmail) => {
      console.log('Received new killmail:', killmail); // Debugging log
      if (applyFilters(killmail)) {
        killmails = [...killmails, killmail];
      } else {
        console.log('Filtered out killmail:', killmail); // Debugging log
      }
    });
    
    socket.on('testEvent', (data) => {
      console.log('Received testEvent:', data);
    });

    // Clean up on component unmount
    return () => {
      socket.disconnect();
      console.log('Socket disconnected');
    };
  });

  function applyFilters(killmail) {
    const { dropped_value_enabled, dropped_value, time_threshold_enabled, time_threshold } = settings;

    if (dropped_value_enabled && killmail.zkb.droppedValue < dropped_value) {
      return false;
    }

    if (time_threshold_enabled) {
      const killTime = new Date(killmail.killmail.killmail_time);
      const now = new Date();
      const diff = (now - killTime) / 1000 / 60; // difference in minutes

      if (diff > time_threshold) {
        return false;
      }
    }

    return true;
  }

  function formatDroppedValue(value) {
    if (isNaN(value) || value === null || value === undefined) return '0';
    const magnitude = Math.floor(Math.log10(value) / 3);
    const scaled = value / Math.pow(1000, magnitude);
    return scaled.toFixed(2) + ['', 'K', 'M', 'B', 'T'][magnitude];
  }

  function calculateTimeDifference(killmailTime) {
    const now = new Date();
    const killTime = new Date(killmailTime);
    const diff = now - killTime;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds} seconds ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
  }

  function viewMap(killID) {
    console.log('Selected killmail ID for map:', killID); // Debugging log
    selectedKillmailId = killID;
  }

  function clearKills() {
    console.log('Clearing killmails'); // Debugging log
    killmails = [];
  }
</script>

<div class="killmail-viewer">
  <table>
    <thead>
      <tr>
        <th>Dropped Value</th>
        <th>Occurred</th>
        <th>URL</th>
        <th>Map</th>
      </tr>
    </thead>
    <tbody>
      {#each killmails as killmail}
        <tr>
          <td>{formatDroppedValue(killmail.zkb.droppedValue)}</td>
          <td>{calculateTimeDifference(killmail.killmail.killmail_time)}</td>
          <td><a href={`https://zkillboard.com/kill/${killmail.killID}/`} target="_blank">View</a></td>
          <td><button on:click={() => viewMap(killmail.killID)}>Map</button></td>
        </tr>
      {/each}
    </tbody>
  </table>
  <button on:click={clearKills}>Clear Kills</button>
</div>

{#if selectedKillmailId}
  <MapVisualization killmailId={selectedKillmailId} />
{/if}

<style>
  .killmail-viewer {
    margin-top: 20px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th, td {
    border: 1px solid #ddd;
    padding: 8px;
    text-align: left;
  }

  th {
    background-color: #f2f2f2;
  }
</style>
