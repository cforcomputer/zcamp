<script>
  import { filteredKillmails } from "./store";
  import MapVisualization from "./MapVisualization.svelte";
  import { onMount } from 'svelte';

  let selectedKillmailId = null;
  let scrollContainer;
  let isUserScrolling = false;
  let shouldAutoScroll = true;

  function viewMap(killID) {
    selectedKillmailId = killID;
  }

  function formatDroppedValue(value) {
    if (value === 0 || isNaN(value) || value === null || value === undefined) return "0 K";
    const magnitude = Math.floor(Math.log10(value) / 3);
    const scaled = value / Math.pow(1000, magnitude);
    return scaled.toFixed(2) + ["", "K", "M", "B", "T"][magnitude];
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

  function handleScroll() {
    if (!isUserScrolling) {
      isUserScrolling = true;
      setTimeout(() => isUserScrolling = false, 150);
    }

    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    shouldAutoScroll = scrollTop + clientHeight >= scrollHeight - 5;
  }

  function scrollToBottom() {
    if (scrollContainer && shouldAutoScroll) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  }

  onMount(() => {
    scrollToBottom();
  });

  $: if ($filteredKillmails && !isUserScrolling) {
    setTimeout(scrollToBottom, 0);
  }
</script>

<div class="killmail-viewer">
  <h2>Killmails from the last 24 hours</h2>
  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th>Dropped Value</th>
          <th>Occurred</th>
          <th>URL</th>
          <th>Map</th>
        </tr>
      </thead>
    </table>
    <div class="scroll-box" bind:this={scrollContainer} on:scroll={handleScroll}>
      <table>
        <tbody>
          {#each $filteredKillmails as killmail}
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
  </div>

  {#if selectedKillmailId}
    <MapVisualization killmailId={selectedKillmailId} />
  {/if}
</div>

<style>
  .killmail-viewer {
    margin-top: 20px;
  }

  .table-container {
    position: relative;
    border: 1px solid #ddd;
  }

  .scroll-box {
    height: 400px;
    overflow-y: auto;
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

  thead {
    position: sticky;
    top: 0;
    background-color: #f2f2f2;
    z-index: 1;
  }

  th {
    background-color: #f2f2f2;
  }
</style>