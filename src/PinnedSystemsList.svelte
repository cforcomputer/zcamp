<script>
  import { onMount, onDestroy, createEventDispatcher } from "svelte";
  import { writable } from "svelte/store";
  // Use the unified activeActivities store
  import { activeActivities } from "./activityManager.js";

  export let isLoggedIn = false;
  const dispatch = createEventDispatcher();
  // Store for the list of pinned systems fetched from the API
  let pinnedSystems = writable([]);
  let isLoading = true;
  let mounted = false;

  // --- Removed direct subscription to activeActivities ---
  // let activities = []; // Removed local variable
  // const unsubActivities = activeActivities.subscribe(...) // Removed subscription

  // Fetch initial pinned systems data when component mounts or login status changes
  async function fetchPinnedSystems() {
    if (!isLoggedIn) {
      isLoading = false;
      pinnedSystems.set([]);
      return;
    }
    isLoading = true;
    try {
      const response = await fetch("/api/pinned-systems", {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        // Set initial data with probability 0; reactive update will calculate actual probability
        const initialSystems = data.map((sys) => ({
          ...sys,
          probability: 0,
          system_name: sys.system_name || `System ${sys.system_id}`,
        }));
        pinnedSystems.set(initialSystems);
      } else if (response.status === 401) {
        console.log("Not logged in, cannot fetch pinned systems.");
        pinnedSystems.set([]);
      } else {
        console.error("Failed to fetch pinned systems:", response.status);
        pinnedSystems.set([]); // Clear on error
      }
    } catch (error) {
      console.error("Error fetching pinned systems:", error);
      pinnedSystems.set([]); // Clear on error
    } finally {
      isLoading = false;
    }
  }

  // --- Reactive Calculation for Updated Probabilities ---
  // This $: block will re-run whenever $activeActivities or $pinnedSystems changes.
  $: updatedPinnedSystemsWithProb = (() => {
    // Get the current values from the stores reactively
    const currentActivities = $activeActivities || [];
    const currentPinnedSystems = $pinnedSystems || [];

    // Only run calculations if mounted and data is available
    if (
      !mounted ||
      currentActivities.length === 0 ||
      currentPinnedSystems.length === 0
    ) {
      return currentPinnedSystems; // Return the current list if not ready
    }

    // Map over the current pinned systems to calculate new probabilities
    return currentPinnedSystems.map((pinnedSystem) => {
      // Find the corresponding activity based on system_id and stargate_name
      const campId = `${pinnedSystem.system_id}-${pinnedSystem.stargate_name}`;
      const matchedActivity = currentActivities.find(
        (activity) => activity.id === campId
      );

      // Calculate the probability (line 59 equivalent)
      const newProbability = matchedActivity
        ? matchedActivity.probability || 0
        : 0;

      // Return a new object only if the probability has actually changed
      // This helps prevent unnecessary downstream reactivity
      return pinnedSystem.probability !== newProbability
        ? { ...pinnedSystem, probability: newProbability }
        : pinnedSystem;
    });
  })(); // Immediately invoked function expression for the reactive block

  // --- Update the Store When the Derived Value Changes ---
  // This separate $: block ensures we only call .set when the calculated array *reference* changes
  $: {
    if (mounted && Array.isArray(updatedPinnedSystemsWithProb)) {
      // Compare the derived array with the current store value
      if ($pinnedSystems !== updatedPinnedSystemsWithProb) {
        pinnedSystems.set(updatedPinnedSystemsWithProb);
      }
    }
  }

  // --- Updated pinSystem function ---
  // Adds a new system optimistically with probability 0, lets the reactive block handle the real value
  export function pinSystem(systemData) {
    let alreadyPinned = false;
    pinnedSystems.update((systems) => {
      alreadyPinned = systems.some(
        (s) =>
          s.system_id === systemData.system_id &&
          s.stargate_name === systemData.stargate_name
      );
      if (!alreadyPinned) {
        // Add optimistically with initial probability 0
        return [
          ...systems,
          {
            // Use passed ID or create temporary one
            id: systemData.id || `temp-${Date.now()}`,
            user_id: systemData.user_id || null, // May not be known yet
            system_id: systemData.system_id,
            stargate_name: systemData.stargate_name,
            // Use system_name passed from the parent component (e.g., ActiveCamps)
            system_name:
              systemData.system_name || `System ${systemData.system_id}`,
            probability: 0, // Initialize probability, reactive block will update
            created_at: systemData.created_at || new Date().toISOString(),
          },
        ];
      }
      // If already pinned, return the list unchanged
      return systems;
    });
    // Optional: Refresh list from server shortly after to get the real ID,
    // or wait for the next scheduled refresh if applicable.
    // setTimeout(fetchPinnedSystems, 500);
  }

  // --- Unchanged deletePinnedSystem ---
  async function deletePinnedSystem(id) {
    // Check if it's a temporary ID and just remove locally
    if (typeof id === "string" && id.startsWith("temp-")) {
      pinnedSystems.update((systems) => systems.filter((sys) => sys.id !== id));
      return;
    }
    try {
      const response = await fetch(`/api/pinned-systems/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (response.ok) {
        // Remove from local store optimistically or after confirmation
        pinnedSystems.update((systems) =>
          systems.filter((sys) => sys.id !== id)
        );
      } else {
        console.error("Failed to delete pinned system:", response.status);
        // Optionally show an error to the user
      }
    } catch (error) {
      console.error("Error deleting pinned system:", error);
      // Optionally show an error to the user
    }
  }

  // --- Lifecycle ---
  onMount(() => {
    mounted = true;
    fetchPinnedSystems(); // Fetch initial list
    // No interval or direct subscription needed anymore
  });

  onDestroy(() => {
    mounted = false;
    // No interval to clear
    // No direct subscription to unsubscribe from
  });

  // Watch for login state changes to refetch
  $: if (mounted && typeof isLoggedIn === "boolean") {
    fetchPinnedSystems();
  }

  // --- Unchanged helper function ---
  function getProbabilityColor(probability) {
    if (probability >= 80) return "bg-red-500/30";
    if (probability >= 60) return "bg-orange-500/30";
    if (probability >= 40) return "bg-yellow-500/30";
    if (probability > 0) return "bg-green-500/30";
    return "bg-gray-500/20";
  }
</script>

<div
  class="pinned-systems-list bg-eve-secondary/50 p-3 rounded-lg mb-4 border border-eve-accent/10"
>
  <h3 class="text-lg font-semibold text-eve-accent mb-2">Pinned Systems</h3>
  {#if isLoading}
    <p class="text-gray-400 italic">Loading pinned systems...</p>
  {:else if !$pinnedSystems || $pinnedSystems.length === 0}
    <p class="text-gray-400 italic">
      {isLoggedIn ? "No systems pinned yet." : "Log in to see pinned systems."}
    </p>
  {:else}
    <ul class="space-y-1 max-h-40 overflow-y-auto pr-1">
      {#each $pinnedSystems as system (system.id)}
        <li
          class="flex justify-between items-center text-sm p-1.5 rounded hover:bg-eve-dark/50 group"
        >
          <span class="flex items-center gap-2">
            <span
              class="inline-block px-2 py-0.5 rounded text-white text-xs {getProbabilityColor(
                system.probability
              )}"
            >
              {system.probability}%
            </span>
            <span class="text-white">{system.system_name}</span>
            {#if system.stargate_name}
              <span class="text-gray-400"> - {system.stargate_name}</span>
            {/if}
          </span>
          {#if isLoggedIn}
            <button
              title="Remove pin"
              class="text-red-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
              on:click|stopPropagation={() => deletePinnedSystem(system.id)}
            >
              Remove
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  /* Simple scrollbar for webkit */
  ul::-webkit-scrollbar {
    width: 4px;
  }
  ul::-webkit-scrollbar-track {
    background: transparent;
  }
  ul::-webkit-scrollbar-thumb {
    background-color: rgba(0, 255, 255, 0.3);
    border-radius: 2px;
  }
  ul::-webkit-scrollbar-thumb:hover {
    background-color: rgba(0, 255, 255, 0.5);
  }
</style>
