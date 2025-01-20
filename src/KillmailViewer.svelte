<script>
  import { filteredKillmails, settings } from "./settingsStore";
  import MapVisualization from "./MapVisualization.svelte";
  import { onMount } from "svelte";

  export let openMap; // Receive openMap function from App.svelte

  let previousKillmailIds = new Set();
  let scrollContainer;
  let isUserScrolling = false;
  let shouldAutoScroll = true;

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

  // Subscribe to filtered killmails
  $: if (
    $filteredKillmails &&
    $settings.webhook_enabled &&
    $settings.webhook_url
  ) {
    const currentKillmailIds = new Set(
      $filteredKillmails.map((km) => km.killID)
    );

    $filteredKillmails.forEach((killmail) => {
      if (!previousKillmailIds.has(killmail.killID)) {
        const webhookUrl = $settings.webhook_url;
        const zkillUrl = `https://zkillboard.com/kill/${killmail.killID}/`;

        fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content: zkillUrl,
          }),
        }).catch((error) => console.error("Error sending webhook:", error));
      }
    });

    previousKillmailIds = currentKillmailIds;
  }

  function getTriangulationStatus(killmail) {
    if (!killmail?.pinpoints) return "No triangulation data";

    if (killmail.pinpoints.atCelestial) {
      return "At celestial";
    } else if (
      killmail.pinpoints.triangulationPossible &&
      killmail.pinpoints.nearestCelestial
    ) {
      return `Near celestial: ${killmail.pinpoints.nearestCelestial.name}`;
    } else if (killmail.pinpoints.hasTetrahedron) {
      return "Triangulation possible";
    } else {
      return "Cannot be triangulated";
    }
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

<div class="flex flex-col bg-eve-dark/95 rounded-lg shadow-lg overflow-hidden">
  <div class="overflow-x-auto">
    <table class="w-full">
      <thead>
        <tr class="text-left bg-eve-secondary/80">
          <th class="px-4 py-3 text-sm font-medium text-gray-300">Value</th>
          <th class="px-4 py-3 text-sm font-medium text-gray-300">Time</th>
          <th class="px-4 py-3 text-sm font-medium text-gray-300">Link</th>
          <th class="px-4 py-3 text-sm font-medium text-gray-300">Actions</th>
        </tr>
      </thead>
    </table>
  </div>

  <div
    class="overflow-y-auto max-h-[calc(100vh-16rem)]"
    bind:this={scrollContainer}
    on:scroll={handleScroll}
  >
    <table class="w-full">
      <tbody>
        {#each sortedKillmails as killmail (killmail.killID)}
          <tr
            class="border-b border-eve-secondary/30 hover:bg-eve-secondary/20 transition-colors"
          >
            <td class="px-4 py-3 text-eve-accent">
              {formatDroppedValue(killmail.zkb.droppedValue)}
            </td>
            <td class="px-4 py-3 text-gray-400">
              {calculateTimeDifference(killmail.killmail.killmail_time)}
            </td>
            <td class="px-4 py-3">
              <a
                href={`https://zkillboard.com/kill/${killmail.killID}/`}
                target="_blank"
                class="text-eve-accent hover:text-eve-accent/80 transition-colors"
              >
                View
              </a>
            </td>
            <td class="px-4 py-3">
              <div class="flex items-center gap-3">
                <button
                  on:click={() => openMap(killmail)}
                  class="px-3 py-1 text-sm bg-eve-secondary hover:bg-eve-secondary/80 text-eve-accent rounded transition-colors"
                >
                  Map
                </button>
                <span
                  class="flex items-center justify-center w-6 h-6 rounded-full {killmail
                    ?.pinpoints?.triangulationPossible
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-red-500/20 text-red-400'}"
                  title={getTriangulationStatus(killmail)}
                >
                  {killmail?.pinpoints?.triangulationPossible ? "✓" : "×"}
                </span>
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  :global(.killmail-section) {
    height: calc(100vh - 150px);
    overflow-y: auto;
  }
</style>
