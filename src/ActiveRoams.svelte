<!-- ActiveRoams.svelte -->
<script>
  import { onMount, onDestroy } from "svelte";
  import roamManager, { activeRoams } from "./roamManager.js";
  import ContextMenu from "./ContextMenu.svelte";

  // Subscribe to active roams store
  $: roams = $activeRoams;

  onMount(() => {
    roamManager.startUpdates();
  });

  onDestroy(() => {
    roamManager.cleanup();
  });

  function getRoamDuration(roam) {
    if (!roam.kills?.length) return "unknown";

    const firstKillTime = new Date(
      roam.kills[0].killmail.killmail_time
    ).getTime();

    const minutes = Math.floor((Date.now() - firstKillTime) / (1000 * 60));

    if (minutes < 1) return "just started";
    if (minutes === 1) return "1 minute";
    return `${minutes} minutes`;
  }

  function formatValue(value) {
    if (!value) return "0 ISK";
    if (value >= 1000000000) return (value / 1000000000).toFixed(2) + "B";
    if (value >= 1000000) return (value / 1000000).toFixed(2) + "M";
    return (value / 1000).toFixed(2) + "K";
  }

  function getUniqueRecentSystems(systems) {
    if (!systems?.length) return [];

    const systemMap = new Map();

    systems.forEach((system) => {
      if (
        !systemMap.has(system.id) ||
        new Date(system.time) > new Date(systemMap.get(system.id).time)
      ) {
        systemMap.set(system.id, system);
      }
    });

    return Array.from(systemMap.values())
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 5);
  }

  function getTimeAgo(timestamp) {
    if (!timestamp) return "unknown";
    const minutes = Math.floor(
      (Date.now() - new Date(timestamp).getTime()) / (1000 * 60)
    );
    if (minutes < 1) return "just now";
    if (minutes === 1) return "1 minute ago";
    return `${minutes} minutes ago`;
  }

  function getSystemCount(roam) {
    return new Set(roam.systems?.map((s) => s.id) || []).size;
  }

  function getRoamColor(roam) {
    const systemCount = getSystemCount(roam);
    const memberCount = roam.members?.length || 0;

    if (systemCount > 10 || memberCount > 20) return "#ff4444";
    if (systemCount > 5 || memberCount > 10) return "#ff8c00";
    if (systemCount > 2 || memberCount > 5) return "#ffd700";
    return "#90ee90";
  }

  let contextMenu = {
    show: false,
    x: 0,
    y: 0,
    options: [],
  };

  // Add setDestination function
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

  // Add context menu handlers
  function handleContextMenu(event, roam) {
    event.preventDefault();

    // Get the container element's position
    const container = event.currentTarget;
    const containerBounds = container.getBoundingClientRect();

    // Calculate position relative to the container
    const x = event.clientX - containerBounds.left;
    const y = event.clientY - containerBounds.top;

    contextMenu = {
      show: true,
      x,
      y,
      options: [
        {
          label: "Set Destination",
          action: () => setDestination(roam.lastSystem.id, true),
        },
        {
          label: "Add Waypoint",
          action: () => setDestination(roam.lastSystem.id, false),
        },
      ],
    };
  }

  function handleMenuSelect(event) {
    const option = event.detail;
    option.action();
    contextMenu.show = false;
  }
</script>

<div class="active-roams">
  <h2>Active Gangs</h2>
  <div class="roam-grid">
    {#each roams as roam (roam.id)}
      <button
        class="roam-card"
        type="button"
        on:click={() => {
          const latestKill = roam.kills[roam.kills.length - 1];
          if (latestKill) {
            const killTime = new Date(latestKill.killmail.killmail_time);
            const formattedTime = `${killTime.getUTCFullYear()}${String(
              killTime.getUTCMonth() + 1
            ).padStart(2, "0")}${String(killTime.getUTCDate()).padStart(
              2,
              "0"
            )}${String(killTime.getUTCHours()).padStart(2, "0")}${String(
              killTime.getUTCMinutes()
            ).padStart(2, "0")}`;
            window.open(
              `https://zkillboard.com/related/${roam.lastSystem.id}/${formattedTime}/`,
              "_blank"
            );
          }
        }}
        on:contextmenu|preventDefault={(e) => handleContextMenu(e, roam)}
      >
        <div class="roam-header">
          <h3>{roam.lastSystem?.name || "Unknown System"}</h3>
          <span class="roam-description"
            >{roam.members?.length || 0} pilots roaming for {getRoamDuration(
              roam
            )}</span
          >
        </div>

        <div class="roam-stats">
          <div class="stat-row">
            <span class="stat-label">Kills:</span>
            <span class="stat-value">{roam.kills?.length || 0}</span>
          </div>

          <div class="stat-row">
            <span class="stat-label">Total Value:</span>
            <span class="stat-value value">{formatValue(roam.totalValue)}</span>
          </div>
        </div>

        <div class="system-history">
          <div class="system-header">
            <span
              class="system-count"
              style="background-color: {getRoamColor(roam)}"
            >
              {getSystemCount(roam)} Systems
            </span>
          </div>
          <div class="system-list">
            {#each getUniqueRecentSystems(roam.systems) as system}
              <div class="system-entry">
                <span class="system-name"
                  >{system.name} ({system.region || "Unknown"})</span
                >
                <span class="system-time">{getTimeAgo(system.time)}</span>
              </div>
            {/each}
          </div>
        </div>
      </button>
    {/each}

    {#if roams.length === 0}
      <p class="no-roams">No active roaming gangs detected</p>
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
  .active-roams {
    padding: 1em;
  }

  .roam-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1em;
  }

  .roam-card {
    cursor: pointer;
    background: rgba(0, 0, 0, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 1em;
    transition: all 0.2s ease;
    width: 100%;
    text-align: left;
    font-family: inherit;
    color: white;
  }

  .roam-card:hover {
    transform: scale(1.02);
    border-color: rgba(255, 255, 255, 0.3);
  }

  .roam-header {
    margin-bottom: 1em;
  }

  .roam-header h3 {
    margin: 0;
    color: white;
    font-size: 1.2em;
  }

  .roam-description {
    display: block;
    color: #888;
    font-size: 0.9em;
    margin-top: 0.3em;
  }

  .system-header {
    margin-bottom: 0.5em;
  }

  .system-count {
    padding: 0.3em 0.6em;
    border-radius: 4px;
    font-size: 0.9em;
    font-weight: bold;
    color: black;
  }

  .system-list {
    background: rgba(0, 0, 0, 0.3);
    border-radius: 4px;
    padding: 0.5em;
  }

  .system-entry {
    display: flex;
    justify-content: space-between;
    padding: 0.3em 0;
    font-size: 0.9em;
  }

  .system-entry:not(:last-child) {
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .system-name {
    color: #fff;
  }

  .system-time {
    color: #888;
  }

  .roam-stats {
    margin: 1em 0;
  }

  .stat-row {
    display: flex;
    justify-content: space-between;
    margin: 0.3em 0;
  }

  .stat-label {
    color: #888;
  }

  .value {
    color: #ff4444;
    font-weight: bold;
  }

  .no-roams {
    grid-column: 1 / -1;
    text-align: center;
    padding: 2em;
    color: #888;
    font-style: italic;
  }
</style>
