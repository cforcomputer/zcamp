<script>
  import { filteredKillmails, settings } from "./settingsStore";
  import MapVisualization from "./MapVisualization.svelte";
  import { onMount } from "svelte";
  import ContextMenu from "./ContextMenu.svelte";

  export let openMap; // Receive openMap function from App.svelte

  let previousKillmailIds = new Set();
  let scrollContainer;
  let isUserScrolling = false;
  let shouldAutoScroll = true;

  // Context menu state
  let contextMenu = {
    show: false,
    x: 0,
    y: 0,
    systemId: null,
    options: [],
  };

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

  async function setDestination(systemId, clearOthers = true) {
    try {
      const response = await fetch("/api/session", {
        credentials: "include",
      });
      const data = await response.json();

      if (!data.user?.access_token) {
        console.error("User not authenticated with EVE SSO");
        return;
      }

      const result = await fetch(
        `https://esi.evetech.net/latest/ui/autopilot/waypoint/?add_to_beginning=false&clear_other_waypoints=${clearOthers}&datasource=tranquility&destination_id=${systemId}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${data.user.access_token}`,
          },
        }
      );

      if (!result.ok) {
        throw new Error("Failed to set destination");
      }
    } catch (error) {
      console.error("Error setting destination:", error);
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

<div
  class="flex flex-col bg-eve-dark/95 rounded-lg shadow-lg overflow-hidden relative"
>
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
          {#each sortedKillmails as killmail (killmail.killID)}
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
</div>

<ContextMenu
  show={contextMenu.show}
  x={contextMenu.x}
  y={contextMenu.y}
  options={contextMenu.options}
  on:select={handleMenuSelect}
/>

<style>
  :global(.killmail-section) {
    height: calc(100vh - 150px);
    overflow-y: auto;
  }
</style>
