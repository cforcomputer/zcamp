<!-- PinnedSystemsList.svelte -->
<script>
  import { onMount, onDestroy } from "svelte";
  import { writable } from "svelte/store";
  import socket from "./socket.js";
  import { activeCamps } from "./campManager.js";

  export let isLoggedIn = false;

  // Export the store so parent components can update it
  export const pinnedSystems = writable([]);
  export let isLoading = true;

  // Add a method to pin systems that updates the UI immediately
  export function pinSystem(system) {
    pinnedSystems.update((systems) => {
      // Check if we already have this pin (by system ID and stargate name)
      if (
        !systems.some(
          (pin) =>
            pin.system_id === system.system_id &&
            pin.stargate_name === system.stargate_name
        )
      ) {
        return [...systems, system];
      }
      return systems;
    });
  }

  // Subscribe to active camps to update probabilities
  $: camps = $activeCamps;

  // Find probability for pinned systems that are active
  $: {
    if (camps && $pinnedSystems.length > 0) {
      $pinnedSystems = $pinnedSystems.map((pin) => {
        const matchingCamp = camps.find(
          (camp) =>
            camp.systemId === pin.system_id &&
            camp.stargateName === pin.stargate_name
        );

        return {
          ...pin,
          activeCamp: matchingCamp,
          probability: matchingCamp ? matchingCamp.probability : 0,
        };
      });
    }
  }

  function getProbabilityColor(probability) {
    if (probability >= 80) return "#ff4444";
    if (probability >= 60) return "#ff8c00";
    if (probability >= 40) return "#ffd700";
    return "#90ee90";
  }

  function getSystemName(systemId) {
    // Find a camp in this system to get the system name
    const campInSystem = camps.find((camp) => camp.systemId === systemId);
    if (campInSystem?.kills?.[0]?.pinpoints?.celestialData?.solarsystemname) {
      return campInSystem.kills[0].pinpoints.celestialData.solarsystemname;
    }
    return `System ${systemId}`;
  }

  async function loadPinnedSystems() {
    if (!isLoggedIn) return;

    try {
      const response = await fetch("/api/pinned-systems", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`Failed to load pinned systems: ${response.status}`);
      }

      const data = await response.json();
      pinnedSystems.set(data);
    } catch (error) {
      console.error("Error loading pinned systems:", error);
    } finally {
      isLoading = false;
    }
  }

  async function unpinSystem(id, event) {
    if (event) {
      event.stopPropagation();
    }

    try {
      const response = await fetch(`/api/pinned-systems/${id}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`Failed to unpin system: ${response.status}`);
      }

      // Immediately update UI by removing the item from store
      pinnedSystems.update((systems) => systems.filter((sys) => sys.id !== id));
    } catch (error) {
      console.error("Error unpinning system:", error);
    }
  }

  function handleItemClick(pinnedSystem) {
    if (pinnedSystem.activeCamp) {
      const latestKill =
        pinnedSystem.activeCamp.kills[pinnedSystem.activeCamp.kills.length - 1];
      if (latestKill) {
        window.open(
          `https://zkillboard.com/kill/${latestKill.killID}/`,
          "_blank"
        );
      }
    }
  }

  onMount(() => {
    if (isLoggedIn) {
      loadPinnedSystems();

      // Make sure we're in a room for this user's ID to receive socket events
      if (socket.connected && socket.request?.session?.user?.id) {
        const userId = socket.request.session.user.id.toString();
        socket.emit("joinRoom", userId);
      }

      // Set up socket listeners for real-time updates
      socket.on("systemPinned", (newPin) => {
        console.log("Socket received new pin:", newPin);
        pinnedSystems.update((systems) => {
          // Check if we already have this pin
          if (!systems.some((sys) => sys.id === newPin.id)) {
            return [...systems, newPin];
          }
          return systems;
        });
      });

      socket.on("systemUnpinned", ({ id }) => {
        console.log("Socket received unpin event for ID:", id);
        pinnedSystems.update((systems) =>
          systems.filter((sys) => sys.id !== id)
        );
      });
    }
  });

  onDestroy(() => {
    if (isLoggedIn) {
      socket.off("systemPinned");
      socket.off("systemUnpinned");
    }
  });

  // Watch for login status changes
  $: if (isLoggedIn && isLoading) {
    loadPinnedSystems();
  }
</script>

{#if isLoggedIn}
  {#if isLoading}
    <div class="py-2 text-gray-400 text-center text-sm">Loading pins...</div>
  {:else if $pinnedSystems.length > 0}
    <div class="mb-4">
      <h3 class="text-white text-sm font-bold mb-2">Pinned Systems</h3>
      <div
        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2"
      >
        {#each $pinnedSystems as pinnedSystem (pinnedSystem.id)}
          <div
            class="bg-eve-secondary/40 border rounded p-2 flex items-center justify-between cursor-pointer hover:bg-eve-secondary/60 transition-colors"
            class:border-eve-accent={pinnedSystem.probability > 0}
            class:border-gray-600={!pinnedSystem.probability}
            on:click={() => handleItemClick(pinnedSystem)}
            role="button"
            tabindex="0"
            on:keypress={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                handleItemClick(pinnedSystem);
              }
            }}
          >
            <div class="flex flex-col">
              <span class="text-white"
                >{getSystemName(pinnedSystem.system_id)}</span
              >
              <span class="text-gray-400 text-xs"
                >{pinnedSystem.stargate_name}</span
              >
            </div>

            <div class="flex items-center gap-2">
              {#if pinnedSystem.probability > 0}
                <div
                  class="px-2 py-1 rounded text-black font-bold text-xs"
                  style="background-color: {getProbabilityColor(
                    pinnedSystem.probability
                  )}"
                >
                  {Math.round(pinnedSystem.probability)}%
                </div>
              {:else}
                <span class="text-gray-400 text-xs">No camp</span>
              {/if}

              <button
                class="text-gray-400 hover:text-eve-danger px-2"
                on:click={(e) => unpinSystem(pinnedSystem.id, e)}
                aria-label="Unpin system"
              >
                ×
              </button>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
{/if}
