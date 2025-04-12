<script>
  import { filteredKillmails, settings } from "./settingsStore";
  import MapVisualization from "./MapVisualization.svelte";
  import { onMount } from "svelte";
  import ContextMenu from "./ContextMenu.svelte";
  import audioManager from "./audioUtils";
  import { slide } from "svelte/transition";

  export let openMap; // Receive openMap function from App.svelte

  // Pagination configuration
  let currentPage = 1;
  let pageSize = 100;
  let pageInputValue = 1;

  // Track new killmails arriving while viewing other pages
  let newKillmailCount = 0;
  let previousKillmailCount = 0;

  let previousKillmailIds = new Set();
  let scrollContainer;
  let isUserScrolling = false;
  let shouldAutoScroll = false; // set to bottom of window if true

  // Context menu state
  let contextMenu = {
    show: false,
    x: 0,
    y: 0,
    systemId: null,
    options: [],
  };

  $: killmailsToDisplay = $filteredKillmails;

  // Track when new killmails arrive
  $: {
    if (
      previousKillmailCount > 0 &&
      killmailsToDisplay.length > previousKillmailCount &&
      currentPage > 1
    ) {
      // Only increment counter when on pages other than first
      newKillmailCount += killmailsToDisplay.length - previousKillmailCount;
    }
    previousKillmailCount = killmailsToDisplay.length;
  }

  // Sort killmails by time, most recent first
  $: sortedKillmails = Array.isArray(killmailsToDisplay)
    ? [...killmailsToDisplay].sort((a, b) => {
        return (
          new Date(b.killmail.killmail_time) -
          new Date(a.killmail.killmail_time)
        );
      })
    : [];

  // Calculate total pages based on filtered results
  $: totalPages = Math.max(1, Math.ceil(sortedKillmails.length / pageSize));

  // Get only current page of killmails to render
  $: currentPageKillmails = sortedKillmails.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  // Reset to first page when filter results change dramatically
  $: {
    if (sortedKillmails && totalPages > 0 && currentPage > totalPages) {
      currentPage = 1;
      pageInputValue = 1;
    }
  }

  // Handle auto-scrolling for live data, but only on first page
  $: if (
    currentPage === 1 &&
    sortedKillmails.length > 0 &&
    sortedKillmails.length !== previousKillmailCount &&
    shouldAutoScroll &&
    !isUserScrolling
  ) {
    setTimeout(() => {
      if (scrollContainer) scrollContainer.scrollTop = 0;
    }, 0);
  }

  // alert sounds for new killmails
  $: if ($settings.audio_alerts_enabled && $filteredKillmails?.length > 0) {
    const currentKillmailIds = new Set(
      $filteredKillmails.map((km) => km.killID)
    );

    $filteredKillmails.forEach((killmail) => {
      if (!previousKillmailIds.has(killmail.killID)) {
        // Different alerts based on value
        if (killmail.zkb.totalValue >= 1000000000) {
          // 1B+
          audioManager.playAlert("orange");
        } else if (killmail.zkb.totalValue >= 100000000) {
          // 100M+
          audioManager.playAlert("blue");
        } else {
          audioManager.playAlert("default");
        }
      }
    });

    previousKillmailIds = currentKillmailIds;
  }

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

  import { getValidAccessToken } from "./tokenManager.js";

  async function setDestination(systemId, clearOthers = true) {
    try {
      const accessToken = await getValidAccessToken();

      const result = await fetch(
        `https://esi.evetech.net/latest/ui/autopilot/waypoint/?add_to_beginning=false&clear_other_waypoints=${clearOthers}&datasource=tranquility&destination_id=${systemId}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!result.ok) {
        if (result.status === 401) {
          // Token issue - trigger session expired event
          window.dispatchEvent(new CustomEvent("session-expired"));
        }
        throw new Error(`Failed to set destination: ${result.status}`);
      }

      return true;
    } catch (error) {
      console.error("Error setting destination:", error);
      return false;
    }
  }

  function handleContextMenu(event, killmail) {
    // Get the container element's position
    const container = scrollContainer;
    const containerBounds = container.getBoundingClientRect();

    // Calculate position relative to the container, accounting for scroll
    const x = event.clientX - containerBounds.left;

    // Use pageY instead of clientY to get the absolute position
    const y = event.pageY - containerBounds.top - window.scrollY;

    // Ensure menu doesn't go off-screen
    const menuWidth = 150; // Approximate menu width
    const menuHeight = 100; // Approximate menu height
    const maxX = containerBounds.width - menuWidth;
    const maxY = container.scrollHeight - menuHeight;

    contextMenu = {
      show: true,
      x: Math.min(x, maxX),
      y: Math.min(y, maxY),
      systemId: killmail.killmail.solar_system_id,
      options: [
        {
          label: "Set Destination",
          action: () => setDestination(killmail.killmail.solar_system_id, true),
        },
        {
          label: "Add Waypoint",
          action: () =>
            setDestination(killmail.killmail.solar_system_id, false),
        },
      ],
    };
  }

  function handleMenuSelect(event) {
    const option = event.detail;
    option.action();
  }

  function getTriangulationStatus(killmail) {
    if (!killmail?.pinpoints) return "No triangulation data";

    if (killmail.pinpoints.atCelestial) {
      return `At celestial: ${killmail.pinpoints.nearestCelestial.name}`;
    }

    if (killmail.pinpoints.triangulationType === "direct_warp") {
      return `Direct warp to ${killmail.pinpoints.nearestCelestial.name} (${(killmail.pinpoints.nearestCelestial.distance / 1000).toFixed(2)} km)`;
    }

    if (killmail.pinpoints.triangulationType === "near_celestial") {
      return `Near celestial: ${killmail.pinpoints.nearestCelestial.name} (${(killmail.pinpoints.nearestCelestial.distance / 1000).toFixed(2)} km)`;
    }

    if (killmail.pinpoints.triangulationType === "via_bookspam") {
      return "Triangulation possible (requires bookspamming)";
    }

    return "Cannot be triangulated";
  }

  function formatDroppedValue(value) {
    if (!value || isNaN(value)) return "0 ISK";

    if (value >= 1_000_000_000) {
      return `${(value / 1_000_000_000).toFixed(2)} B`;
    }
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(2)} M`;
    }
    if (value >= 1_000) {
      return `${Math.floor(value / 1_000)} K`;
    }
    return `${Math.floor(value)} ISK`;
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
    shouldAutoScroll = scrollTop === 0; // Auto-scroll when at top of container
  }

  function getTriangulationIcon(killmail) {
    if (!killmail?.pinpoints) return "○"; // Empty circle for unknown/error

    switch (killmail.pinpoints.triangulationType) {
      case "at_celestial":
        return "◉"; // Filled circle for exact location
      case "direct_warp":
        return "◈"; // Diamond for direct warp
      case "near_celestial":
        return "◎"; // Double circle for nearby
      case "via_bookspam":
        return "◇"; // Empty diamond for bookmarks needed
      default:
        return "×"; // Cross for cannot triangulate
    }
  }

  function getTriangulationClass(killmail) {
    if (!killmail?.pinpoints) return "bg-red-500/20 text-red-400";

    switch (killmail.pinpoints.triangulationType) {
      case "at_celestial":
      case "direct_warp":
        return "bg-green-500/20 text-green-400";
      case "near_celestial":
        return "bg-yellow-500/20 text-yellow-400";
      case "via_bookspam":
        return "bg-pink-500/20 text-pink-400";
      default:
        return "bg-red-500/20 text-red-400";
    }
  }

  function goToPage(page) {
    const targetPage = Math.min(Math.max(1, page), totalPages);
    if (targetPage !== currentPage) {
      currentPage = targetPage;
      pageInputValue = targetPage;

      // Reset new killmail counter when going to first page
      if (targetPage === 1) {
        newKillmailCount = 0;
      }

      // Scroll back to top when changing pages
      if (scrollContainer) {
        scrollContainer.scrollTop = 0;
      }
    }
  }

  function goToLatest() {
    goToPage(1);
    newKillmailCount = 0;
  }

  function goToNextPage() {
    goToPage(currentPage + 1);
  }

  function goToPreviousPage() {
    goToPage(currentPage - 1);
  }

  onMount(() => {
    // Set initial auto-scroll behavior
    shouldAutoScroll = true;
    audioManager.init();
  });
</script>

<div
  class="flex flex-col bg-eve-dark/95 rounded-lg shadow-lg overflow-hidden relative"
>
  <!-- New Killmail Alert Banner -->
  {#if newKillmailCount > 0}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
      class="new-killmails-alert bg-eve-accent/20 text-eve-accent py-2 px-4 text-center border-b border-eve-accent/30 cursor-pointer"
      on:click={goToLatest}
      transition:slide
    >
      {newKillmailCount} new killmail{newKillmailCount === 1 ? "" : "s"} received!
      Click to view.
    </div>
  {/if}

  <div class="overflow-x-auto">
    <table class="w-full"></table>
  </div>

  <div
    class="flex flex-col bg-eve-dark/95 rounded-lg shadow-lg overflow-hidden"
  >
    <div
      class="overflow-y-auto max-h-[calc(100vh-16rem)]"
      bind:this={scrollContainer}
      on:scroll={handleScroll}
    >
      <table class="w-full">
        <tbody>
          {#each currentPageKillmails as killmail (killmail.killID)}
            <tr
              class="border-b border-eve-secondary/30 hover:bg-eve-secondary/20 transition-colors"
              on:contextmenu|preventDefault={(e) =>
                handleContextMenu(e, killmail)}
            >
              <!-- Main row content (clickable) -->
              <td
                class="px-4 py-3 cursor-pointer"
                on:click={() =>
                  window.open(
                    `https://zkillboard.com/kill/${killmail.killID}/`,
                    "_blank"
                  )}
                style="width: 85%"
              >
                <div class="flex items-center">
                  <span class="text-eve-accent w-24">
                    {formatDroppedValue(killmail.zkb.droppedValue)}
                  </span>
                  <span class="text-gray-400 w-32">
                    {calculateTimeDifference(killmail.killmail.killmail_time)}
                  </span>
                  <span class="text-white">
                    {killmail.shipCategories?.victim?.name || "Unknown Ship"}
                  </span>
                </div>
              </td>

              <!-- Actions cell (separate, not clickable) -->
              <td class="px-4 py-3" style="width: 15%">
                <div class="flex items-center gap-3">
                  <button
                    on:click={() => openMap(killmail)}
                    class="px-3 py-1 text-sm bg-eve-secondary hover:bg-eve-secondary/80 text-eve-accent rounded transition-colors"
                  >
                    Map
                  </button>
                  <span
                    class="flex items-center justify-center w-6 h-6 rounded-full {getTriangulationClass(
                      killmail
                    )}"
                    title={getTriangulationStatus(killmail)}
                  >
                    {getTriangulationIcon(killmail)}
                  </span>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>

      {#if sortedKillmails.length === 0}
        <div class="text-center py-10 text-gray-400">
          No killmails match your current filters
        </div>
      {/if}
    </div>

    <!-- Pagination controls -->
    {#if totalPages > 1}
      <div
        class="pagination flex flex-wrap justify-between items-center p-4 border-t border-eve-secondary/30"
      >
        <div class="text-gray-400">
          Showing {Math.min(
            (currentPage - 1) * pageSize + 1,
            sortedKillmails.length
          )}
          to {Math.min(currentPage * pageSize, sortedKillmails.length)}
          of {sortedKillmails.length} killmails
        </div>
        <div class="flex items-center gap-4">
          <!-- Jump to page input -->
          <div class="flex items-center gap-2">
            <span class="text-gray-400">Page</span>
            <input
              type="number"
              class="w-16 px-2 py-1 bg-eve-secondary text-white rounded border border-eve-accent/20"
              min="1"
              max={totalPages}
              bind:value={pageInputValue}
              on:keydown={(e) => {
                if (e.key === "Enter") {
                  goToPage(parseInt(pageInputValue) || 1);
                }
              }}
            />
            <span class="text-gray-400">of {totalPages}</span>
          </div>

          <div class="flex gap-2">
            <button
              class="px-3 py-1 bg-eve-secondary text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={currentPage === 1}
              on:click={goToPreviousPage}
            >
              Previous
            </button>

            {#if totalPages <= 5}
              {#each Array(totalPages) as _, i}
                <button
                  class="px-3 py-1 rounded {currentPage === i + 1
                    ? 'bg-eve-accent text-black'
                    : 'bg-eve-secondary text-white'}"
                  on:click={() => goToPage(i + 1)}
                >
                  {i + 1}
                </button>
              {/each}
            {:else}
              <!-- Show first page button -->
              <button
                class="px-3 py-1 rounded {currentPage === 1
                  ? 'bg-eve-accent text-black'
                  : 'bg-eve-secondary text-white'}"
                on:click={() => goToPage(1)}
              >
                1
              </button>

              <!-- Show ellipsis if needed -->
              {#if currentPage > 3}
                <span class="px-2 py-1 text-gray-400">...</span>
              {/if}

              <!-- Pages around current page -->
              {#each [-1, 0, 1] as offset}
                {@const pageNum = currentPage + offset}
                {#if pageNum > 1 && pageNum < totalPages}
                  <button
                    class="px-3 py-1 rounded {currentPage === pageNum
                      ? 'bg-eve-accent text-black'
                      : 'bg-eve-secondary text-white'}"
                    on:click={() => goToPage(pageNum)}
                  >
                    {pageNum}
                  </button>
                {/if}
              {/each}

              <!-- Show ellipsis if needed -->
              {#if currentPage < totalPages - 2}
                <span class="px-2 py-1 text-gray-400">...</span>
              {/if}

              <!-- Show last page button -->
              <button
                class="px-3 py-1 rounded {currentPage === totalPages
                  ? 'bg-eve-accent text-black'
                  : 'bg-eve-secondary text-white'}"
                on:click={() => goToPage(totalPages)}
              >
                {totalPages}
              </button>
            {/if}
            <button
              class="px-3 py-1 bg-eve-secondary text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={currentPage === totalPages}
              on:click={goToNextPage}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<ContextMenu
  show={contextMenu.show}
  x={contextMenu.x}
  y={contextMenu.y}
  options={contextMenu.options}
  on:select={handleMenuSelect}
/>

<style>
  .new-killmails-alert {
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0% {
      opacity: 0.8;
    }
    50% {
      opacity: 1;
    }
    100% {
      opacity: 0.8;
    }
  }

  :global(.killmail-section) {
    height: calc(100vh - 150px);
    overflow-y: auto;
  }
</style>
