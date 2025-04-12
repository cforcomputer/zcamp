<!-- NPCPage.svelte -->
<script>
  import { onMount } from "svelte";
  import { killmails, settings } from "./settingsStore.js";
  //   import { createEventDispatcher } from "svelte";
  import ContextMenu from "./ContextMenu.svelte";
  import { NPC_CATEGORIES } from "./constants.js"; // Import NPC categories from constants
  import audioManager from "./audioUtils.js";

  //   const dispatch = createEventDispatcher();

  // NPC categories with their IDs and display colors

  // Create a flat array of all NPC IDs for easy lookup
  const ALL_NPC_IDS = Object.values(NPC_CATEGORIES).flatMap(
    (category) => category.ids
  );

  // State variables
  let selectedCategories = {
    MORDUS_LEGION: true,
    OFFICERS: true,
    BELT_COMMANDERS: true,
  };

  let showSecurityDropdown = false;
  let filteredKillmails = [];
  let enableAudioAlerts = false;

  const SOUND_SETTINGS = {
    MORDUS_LEGION: "blue", // Blue alert for Mordus
    OFFICERS: "orange", // Orange alert for Officers (highest value)
    BELT_COMMANDERS: "default", // Default alert for Belt Commanders
  };

  onMount(() => {
    audioManager.init();
  });

  // Filter killmails for NPCs
  $: {
    // Get all selected NPC IDs
    const selectedNpcIds = Object.entries(selectedCategories)
      .filter(([_, selected]) => selected)
      .flatMap(([key, _]) => NPC_CATEGORIES[key].ids);

    const newFilteredKillmails = $killmails.filter((killmail) => {
      // Check if any attacker's character_id is in our NPC list
      const hasNpcAttacker = killmail.killmail.attackers.some((attacker) =>
        selectedNpcIds.includes(attacker.character_id)
      );

      // Apply security status filter if enabled
      if ($settings.location_type_filter_enabled) {
        const locationTypes = $settings.location_types;
        const hasEnabledTypes = Object.values(locationTypes).some(
          (enabled) => enabled
        );

        if (hasEnabledTypes) {
          const selectedTypes = Object.entries(locationTypes)
            .filter(([_, enabled]) => enabled)
            .map(([type, _]) => `loc:${type}`);

          const hasLocationLabel = killmail.zkb.labels.some((label) =>
            selectedTypes.includes(label)
          );

          if (!hasLocationLabel) return false;
        }
      }

      return hasNpcAttacker;
    });

    // Sort by most recent first
    newFilteredKillmails.sort((a, b) => {
      return (
        new Date(b.killmail.killmail_time) - new Date(a.killmail.killmail_time)
      );
    });

    // Check for new killmails to play alerts
    if (enableAudioAlerts && newFilteredKillmails.length > 0) {
      const currentIds = new Set(newFilteredKillmails.map((km) => km.killID));

      // Find killmails that weren't in the previous set
      const newKillmails = newFilteredKillmails.filter(
        (km) => !previousKillmailIds.has(km.killID)
      );

      // Play audio alerts for new killmails
      newKillmails.forEach((killmail) => {
        // Find NPC type for this killmail
        const npcAttackers = killmail.killmail.attackers.filter((attacker) =>
          ALL_NPC_IDS.includes(attacker.character_id)
        );

        if (npcAttackers.length > 0) {
          // Get the primary NPC's category
          let alertType = "default";

          for (const [categoryKey, category] of Object.entries(
            NPC_CATEGORIES
          )) {
            if (category.ids.includes(npcAttackers[0].character_id)) {
              alertType = SOUND_SETTINGS[categoryKey];
              break;
            }
          }

          // Play appropriate alert
          audioManager.playAlert(alertType);
        }
      });

      // Update previous killmail IDs
      previousKillmailIds = currentIds;
    }

    filteredKillmails = newFilteredKillmails;
  }

  // Context menu state
  let contextMenu = {
    show: false,
    x: 0,
    y: 0,
    options: [],
  };

  function getNpcCategory(characterId) {
    for (const [key, category] of Object.entries(NPC_CATEGORIES)) {
      if (category.ids.includes(characterId)) {
        return { key, ...category };
      }
    }
    return null;
  }

  function getTimeAgo(timestamp) {
    if (!timestamp) return "unknown";
    const now = new Date().getTime();
    const then = new Date(timestamp).getTime();
    const minutes = Math.floor((now - then) / (1000 * 60));

    if (minutes < 1) return "just now";
    if (minutes === 1) return "1 minute ago";
    if (minutes < 60) return `${minutes} minutes ago`;

    const hours = Math.floor(minutes / 60);
    if (hours === 1) return "1 hour ago";
    if (hours < 24) return `${hours} hours ago`;

    const days = Math.floor(hours / 24);
    if (days === 1) return "1 day ago";
    return `${days} days ago`;
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
    event.preventDefault();
    event.stopPropagation();

    const row = event.currentTarget;
    const tableBounds = row.closest("table").getBoundingClientRect();

    const x = event.clientX - tableBounds.left;
    const y = event.clientY - tableBounds.top;

    contextMenu = {
      show: true,
      x,
      y,
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
    contextMenu.show = false;
  }
</script>

<div class="p-4">
  <div class="flex justify-between items-center mb-4">
    <h2 class="text-xl font-bold text-white">NPC Hunter</h2>
    <div class="flex gap-4 items-center">
      <div class="relative">
        <!-- Audio alerts toggle -->
        <label
          class="flex items-center gap-2 px-3 py-1.5 rounded bg-eve-dark/80 border border-eve-accent/30"
        >
          <input
            type="checkbox"
            class="form-checkbox"
            bind:checked={enableAudioAlerts}
          />
          <span class="text-eve-accent">Audio Alerts</span>
        </label>
        <!-- Security status dropdown -->
        <button
          class="px-3 py-1.5 bg-eve-dark border border-eve-secondary/30 text-white rounded flex items-center gap-2"
          on:click={() => (showSecurityDropdown = !showSecurityDropdown)}
        >
          Security Status
          <span class="text-xs opacity-50">▼</span>
        </button>

        {#if showSecurityDropdown}
          <div
            class="absolute right-0 top-full mt-1 bg-eve-dark border border-eve-secondary/30 rounded p-2 z-10 min-w-[150px] shadow-lg"
            on:mouseleave={() => (showSecurityDropdown = false)}
          >
            {#each Object.entries($settings.location_types) as [type, enabled]}
              <label
                class="flex items-center px-2 py-1.5 hover:bg-eve-secondary/20"
              >
                <input
                  type="checkbox"
                  class="form-checkbox"
                  bind:checked={$settings.location_types[type]}
                />
                <span class="ml-2 text-white capitalize">{type}</span>
              </label>
            {/each}
          </div>
        {/if}
      </div>

      <div class="flex gap-2">
        {#each Object.entries(NPC_CATEGORIES) as [key, category]}
          <label
            class="flex items-center gap-2 px-3 py-1.5 rounded"
            style="background: {category.color}40; border: 1px solid {category.color}"
          >
            <input
              type="checkbox"
              class="form-checkbox"
              bind:checked={selectedCategories[key]}
            />
            <span class="text-white">{category.name}</span>
          </label>
        {/each}
      </div>
    </div>
  </div>

  {#if filteredKillmails.length === 0}
    <div class="text-gray-400 text-center py-4">No NPC kills found</div>
  {:else}
    <div class="overflow-x-auto rounded-lg border border-eve-secondary/30">
      <table class="w-full">
        <thead>
          <tr class="bg-eve-dark/80 text-left">
            <th class="px-4 py-3 text-gray-300 font-medium">NPC Type</th>
            <th class="px-4 py-3 text-gray-300 font-medium">System</th>
            <th class="px-4 py-3 text-gray-300 font-medium">Security</th>
            <th class="px-4 py-3 text-gray-300 font-medium">Time</th>
            <th class="px-4 py-3 text-gray-300 font-medium">Triangulation</th>
          </tr>
        </thead>
        <tbody>
          {#each filteredKillmails as killmail}
            {@const npcAttackers = killmail.killmail.attackers.filter(
              (attacker) => ALL_NPC_IDS.includes(attacker.character_id)
            )}
            {#if npcAttackers.length > 0}
              {@const primaryNpcAttacker = npcAttackers[0]}
              {@const category = getNpcCategory(
                primaryNpcAttacker.character_id
              )}
              {#if category}
                <tr
                  class="border-t border-eve-secondary/10 bg-eve-dark/40 hover:bg-eve-dark/60 transition-colors cursor-pointer"
                  on:click={() =>
                    window.open(
                      `https://zkillboard.com/kill/${killmail.killID}/`,
                      "_blank"
                    )}
                  on:contextmenu={(e) => handleContextMenu(e, killmail)}
                  on:keydown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      window.open(
                        `https://zkillboard.com/kill/${killmail.killID}/`,
                        "_blank"
                      );
                    }
                  }}
                  tabindex="0"
                  role="button"
                >
                  <td class="px-4 py-3">
                    <span
                      class="px-2 py-1 rounded text-white"
                      style="background-color: {category.color}"
                    >
                      {category.name}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-white">
                    {killmail.pinpoints?.celestialData?.solarsystemname ||
                      killmail.killmail.solar_system_id}
                  </td>
                  <td class="px-4 py-3 text-gray-300 capitalize">
                    {killmail.zkb?.labels
                      ?.find((l) => l.startsWith("loc:"))
                      ?.replace("loc:", "") || "unknown"}
                  </td>
                  <td class="px-4 py-3 text-gray-300">
                    {getTimeAgo(killmail.killmail.killmail_time)}
                  </td>
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-2">
                      <span
                        class="inline-flex items-center justify-center w-6 h-6 rounded-full {getTriangulationClass(
                          killmail
                        )}"
                        title={getTriangulationStatus(killmail)}
                      >
                        {getTriangulationIcon(killmail)}
                      </span>
                      <span class="text-gray-300 text-sm">
                        {#if killmail.pinpoints?.atCelestial}
                          At {killmail.pinpoints.nearestCelestial.name}
                        {:else if killmail.pinpoints?.triangulationType === "direct_warp"}
                          Direct warp
                        {:else if killmail.pinpoints?.triangulationType === "near_celestial"}
                          Near celestial
                        {:else if killmail.pinpoints?.triangulationType === "via_bookspam"}
                          Bookspam
                        {:else}
                          Not triangulatable
                        {/if}
                      </span>
                    </div>
                  </td>
                </tr>
              {/if}
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<ContextMenu
  show={contextMenu.show}
  x={contextMenu.x}
  y={contextMenu.y}
  options={contextMenu.options}
  on:select={handleMenuSelect}
/>

<style>
  .form-checkbox {
    @apply rounded border-eve-accent/50 text-eve-accent focus:ring-eve-accent;
  }
</style>
