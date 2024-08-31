<script>
  import { killmails } from './store';
  import MapVisualization from './MapVisualization.svelte';

  let selectedKillmailId = null;

  // Subscribe to the killmails store
  let kills = [];
  $: kills = $killmails;

  function viewMap(killID) {
    selectedKillmailId = killID;
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
</script>

<div class="killmail-viewer">
  <div class="scroll-box">
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
        {#each kills as killmail}
          <tr>
            <td>{formatDroppedValue(killmail.zkb.droppedValue)}</td>
            <td>{calculateTimeDifference(killmail.killmail.killmail_time)}</td>
            <td><a href={`https://zkillboard.com/kill/${killmail.killID}/`} target="_blank">View</a></td>
            <td><button on:click={() => viewMap(killmail.killID)}>Map</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if selectedKillmailId}
    <MapVisualization killmailId={selectedKillmailId} />
  {/if}
</div>

<style>
  .killmail-viewer {
    margin-top: 20px;
  }

  .scroll-box {
    height: 400px; /* Fixed height */
    overflow-y: auto; /* Scroll vertically if content overflows */
    border: 1px solid #ddd; /* Optional: adds a border around the scrollable area */
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
