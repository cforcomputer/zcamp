<script>
  import { filteredKillmails } from "./store";
  import MapVisualization from "./MapVisualization.svelte";
  import { onMount } from "svelte";

  let selectedKillmailId = null;
  let scrollContainer;
  let isUserScrolling = false;
  let shouldAutoScroll = true;
  let showMap = false;

  $: killmailsToDisplay = $filteredKillmails;

  // Sort killmails by time, most recent first
  $: sortedKillmails = Array.isArray(killmailsToDisplay)
    ? [...killmailsToDisplay].sort((a, b) => {
        return (
          new Date(b.killmail.killmail_time) -
          new Date(a.killmail.killmail_time)
        );
      })
    : [];

  function viewMap(killID) {
    selectedKillmailId = killID;
    showMap = true;
  }

  function formatDroppedValue(value) {
    if (value === 0 || isNaN(value) || value === null || value === undefined) {
      return "0 ISK";
    }
    const magnitude = Math.floor(Math.log10(value) / 3);
    const scaled = value / Math.pow(1000, magnitude);
    return scaled.toFixed(2) + " " + ["ISK", "K", "M", "B", "T"][magnitude];
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
      setTimeout(() => (isUserScrolling = false), 150);
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

  $: {
    if (sortedKillmails.length && !isUserScrolling && shouldAutoScroll) {
      setTimeout(scrollToBottom, 0);
    }
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
    <div
      class="scroll-box"
      bind:this={scrollContainer}
      on:scroll={handleScroll}
    >
      <table>
        <tbody>
          {#each sortedKillmails as killmail (killmail.killID)}
            <tr>
              <td>{formatDroppedValue(killmail.zkb.droppedValue)}</td>
              <td>{calculateTimeDifference(killmail.killmail.killmail_time)}</td
              >
              <td>
                <a
                  href={`https://zkillboard.com/kill/${killmail.killID}/`}
                  target="_blank"
                >
                  View
                </a>
              </td>
              <td>
                <button on:click={() => viewMap(killmail.killID)}>Map</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  {#if showMap && selectedKillmailId}
    <div class="map-overlay">
      <div class="map-container">
        <MapVisualization killmailId={selectedKillmailId} />
        <button class="close-map" on:click={() => (showMap = false)}>
          Close Map
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .killmail-viewer {
    margin-top: 20px;
  }

  .table-container {
    position: relative;
    border: 1px solid #ddd;
    border-radius: 4px;
    overflow: hidden;
  }

  .scroll-box {
    height: 400px;
    overflow-y: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    background-color: white;
  }

  th,
  td {
    border: 1px solid #ddd;
    padding: 8px;
    text-align: left;
  }

  thead {
    position: sticky;
    top: 0;
    background-color: #f8f9fa;
    z-index: 1;
  }

  th {
    background-color: #f8f9fa;
    font-weight: 600;
  }

  tr:nth-child(even) {
    background-color: #f8f9fa;
  }

  .map-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.75);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
  }

  .map-container {
    position: relative;
    width: 80%;
    height: 80%;
    background-color: black;
    border-radius: 8px;
    overflow: hidden;
  }

  .close-map {
    position: absolute;
    top: 16px;
    right: 16px;
    padding: 8px 16px;
    background-color: #dc3545;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  button:hover {
    opacity: 0.9;
  }
</style>
