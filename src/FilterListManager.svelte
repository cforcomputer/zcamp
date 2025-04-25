<script>
  import { createEventDispatcher } from "svelte";
  import socket from "./socket.js";
  import { filterLists } from "./settingsStore.js";
  import { onMount, onDestroy } from "svelte"; // Import onDestroy

  const dispatch = createEventDispatcher();

  // Form state for creating a new filter list
  let newListName = "";
  let newListIds = "";
  let newListIsExclude = false;
  let newListFilterType = ""; // Default to empty string

  // Local reactive variable bound to the store
  $: localFilterLists = $filterLists;

  // Function to handle the creation of a new filter list
  async function createFilterList() {
    // Basic validation: ensure name and IDs are provided
    if (!newListName || !newListIds) {
      console.warn("Missing required fields for filter list creation");
      alert(
        "Please provide a name and at least one ID for the new filter list."
      );
      return;
    }
    // Ensure a filter type is selected
    if (!newListFilterType) {
      alert("Please select a filter type.");
      return;
    }

    const ids = newListIds
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id); // Filter out empty strings

    const newListData = {
      name: newListName,
      ids,
      enabled: true, // Default new lists to enabled on client-side too
      is_exclude: newListIsExclude,
      filter_type: newListFilterType,
    };

    console.log(
      "[FilterListManager] Emitting createFilterList event with data:",
      newListData
    );
    socket.emit("createFilterList", newListData);

    // --- Remove Optimistic Update for creation ---
    // Rely on server confirmation via 'filterListCreated' to add the list
    // filterLists.update((currentLists) => [...currentLists, optimisticList]);

    // Clear the form fields after submission
    newListName = "";
    newListIds = "";
    newListIsExclude = false;
    newListFilterType = "";
  }

  // Function to toggle the enabled state of a filter list
  function toggleFilterList(id) {
    console.log(`[FilterListManager] Toggling filter list ID: ${id}`);

    let newEnabledState; // Variable to store the new state

    // 1. Update the local Svelte store IMMEDIATELY for UI responsiveness
    filterLists.update((lists) =>
      lists.map((list) => {
        if (list.id === id) {
          newEnabledState = !list.enabled; // Capture the new state
          console.log(
            `[FilterListManager] Updating local store for ID ${id}. New enabled state: ${newEnabledState}`
          );
          return { ...list, enabled: newEnabledState };
        }
        return list;
      })
    );

    // 2. Emit the state change to the server to PERSIST it in the session
    if (typeof newEnabledState === "boolean") {
      console.log(
        `[FilterListManager] Emitting 'updateFilterState' to server for ID ${id}, enabled: ${newEnabledState}`
      );
      socket.emit("updateFilterState", { id, enabled: newEnabledState });
    } else {
      console.warn(
        `[FilterListManager] Could not determine new enabled state for ID ${id} after toggle. Not emitting update.`
      );
    }

    // Optional: Dispatch event if other components need direct notification
    // dispatch("updateFilterLists", { filterLists: $filterLists });
  }

  // Function to delete a filter list
  async function deleteFilterList(id) {
    if (!confirm(`Are you sure you want to delete this filter list?`)) {
      // Add confirmation back if desired
      return;
    }
    console.log(
      "[FilterListManager] Emitting deleteFilterList event for ID:",
      id
    );
    // Emit the 'deleteFilterList' event to the server immediately
    socket.emit("deleteFilterList", { id });

    // --- Optimistic Update for Deletion (Keep this, it's usually safe) ---
    console.log("[FilterListManager] Applying optimistic delete for ID:", id);
    filterLists.update((lists) => lists.filter((list) => list.id !== id));
    // --- End Optimistic Update ---
  }

  // --- Socket Event Handlers ---
  const handleFilterListsFetched = (fetchedLists) => {
    console.log(
      "[FilterListManager] Received 'filterListsFetched':",
      fetchedLists
    );
    filterLists.set(fetchedLists); // Overwrite local store with server state
  };

  const handleFilterListDeleted = ({ id }) => {
    console.log(
      "[FilterListManager] Received 'filterListDeleted' confirmation for ID:",
      id
    );
    // Ensure it's removed (mostly for safety, optimistic update usually handles it)
    filterLists.update((lists) => lists.filter((list) => list.id !== id));
    // dispatch("updateFilterLists", { filterLists: $filterLists }); // Optional dispatch
  };

  const handleFilterListCreated = (newServerList) => {
    console.log(
      "[FilterListManager] Received 'filterListCreated' (server confirmation):",
      newServerList
    );
    // Add the confirmed list from the server, replacing any potential temp/optimistic one
    filterLists.update((currentLists) => {
      // Remove any potential temp items (safer than relying on specific temp ID)
      const listsWithoutTemp = currentLists.filter(
        (l) => !l.id || !l.id.startsWith("temp-")
      );
      // Check if this ID already exists (e.g., from fetch race condition)
      if (listsWithoutTemp.some((l) => l.id === newServerList.id)) {
        return listsWithoutTemp.map((l) =>
          l.id === newServerList.id ? newServerList : l
        ); // Update if exists
      }
      return [...listsWithoutTemp, newServerList]; // Add if new
    });
    localFilterLists = $filterLists; // Trigger reactivity update
  };

  // --- NEW: Handler for state changes from other clients/tabs ---
  const handleFilterStateChanged = ({ id, enabled }) => {
    console.log(
      `[FilterListManager] Received 'filterStateChanged' for ID: ${id}, Enabled: ${enabled}`
    );
    filterLists.update((lists) =>
      lists.map((list) =>
        list.id === id ? { ...list, enabled: enabled } : list
      )
    );
    localFilterLists = $filterLists; // Trigger reactivity update
  };

  // Component lifecycle: setup and teardown socket listeners
  onMount(() => {
    console.log("[FilterListManager] Component mounted, setting up listeners.");
    // Request initial filter lists when the component mounts
    socket.emit("fetchFilterLists"); // Still useful for initial load

    // Register socket event listeners
    socket.on("filterListsFetched", handleFilterListsFetched);
    socket.on("filterListDeleted", handleFilterListDeleted);
    socket.on("filterListCreated", handleFilterListCreated);
    socket.on("filterStateChanged", handleFilterStateChanged); // Add new listener

    // Cleanup function: remove listeners when the component is destroyed
    return () => {
      console.log(
        "[FilterListManager] Component destroying, cleaning up listeners."
      );
      socket.off("filterListsFetched", handleFilterListsFetched);
      socket.off("filterListDeleted", handleFilterListDeleted);
      socket.off("filterListCreated", handleFilterListCreated);
      socket.off("filterStateChanged", handleFilterStateChanged); // Remove new listener
    };
  });
</script>

<div class="bg-eve-dark/95 rounded-lg p-6 space-y-6">
  <h2 class="text-2xl font-bold text-eve-accent">Filter Lists</h2>

  <div class="space-y-4 border-b border-eve-accent/20 pb-6">
    <h3 class="text-lg font-semibold text-eve-accent">
      Create New Filter List
    </h3>
    <div class="space-y-4">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <input
          bind:value={newListName}
          placeholder="New list name"
          class="bg-eve-secondary text-gray-200 rounded px-4 py-2 border border-eve-accent/20 focus:border-eve-accent focus:ring-1 focus:ring-eve-accent outline-none"
        />
        <input
          bind:value={newListIds}
          placeholder="Comma-separated IDs"
          class="bg-eve-secondary text-gray-200 rounded px-4 py-2 border border-eve-accent/20 focus:border-eve-accent focus:ring-1 focus:ring-eve-accent outline-none"
        />
      </div>

      <div class="flex flex-col md:flex-row gap-4 items-center">
        <label class="flex items-center space-x-2 text-gray-200">
          <input
            type="checkbox"
            bind:checked={newListIsExclude}
            class="form-checkbox bg-eve-secondary text-eve-accent rounded border-eve-accent/20 focus:ring-eve-accent focus:ring-2"
          />
          <span>Exclude</span>
        </label>

        <select
          bind:value={newListFilterType}
          class="flex-grow bg-eve-secondary text-gray-200 rounded px-4 py-2 border border-eve-accent/20 focus:border-eve-accent focus:ring-1 focus:ring-eve-accent outline-none"
          required
        >
          <option value="" disabled>Select filter type *</option>
          <option value="attacker_alliance">Attacker Alliance ID</option>
          <option value="attacker_corporation">Attacker Corporation ID</option>
          <option value="attacker_character_id">Attacker Character ID</option>
          <option value="attacker_ship_type">Attacker Ship Type ID</option>
          <option value="victim_alliance">Victim Alliance ID</option>
          <option value="victim_corporation">Victim Corporation ID</option>
          <option value="victim_character_id">Victim Character ID</option>
          <option value="ship_type">Victim Ship Type ID</option>
          <option value="solar_system">Solar System ID</option>
          <option value="region">Region ID/Name</option>
        </select>
      </div>

      <button
        on:click={createFilterList}
        class="w-full bg-eve-accent/20 hover:bg-eve-accent/30 text-eve-accent px-4 py-2 rounded transition-colors duration-200"
      >
        Create New List
      </button>
    </div>
  </div>

  <div class="space-y-4">
    <h3 class="text-lg font-semibold text-eve-accent">Active Filters</h3>

    {#if localFilterLists.length === 0}
      <p class="text-gray-400 italic">No filter lists created yet.</p>
    {:else}
      <div class="space-y-2">
        {#each localFilterLists as list (list.id)}
          <div
            class="filter-list-item bg-eve-secondary/40 rounded-lg p-4 flex items-center justify-between gap-4"
          >
            <div class="flex items-center gap-4 flex-grow">
              <input
                type="checkbox"
                id={`filter-list-${list.id}`}
                checked={list.enabled}
                on:change={() => toggleFilterList(list.id)}
                class="form-checkbox bg-eve-secondary text-eve-accent rounded border-eve-accent/20 focus:ring-eve-accent focus:ring-2 cursor-pointer"
              />
              <label
                for={`filter-list-${list.id}`}
                class="flex-grow text-gray-200 cursor-pointer"
              >
                <span class="font-medium">{list.name}</span>
                <span class="text-gray-400 text-sm ml-2">
                  ({list.filter_type?.replace(/_/g, " ") || "No type"})
                  {#if list.is_exclude}(Exclude){/if}
                </span>
              </label>
            </div>

            <button
              on:click={() => deleteFilterList(list.id)}
              class="bg-eve-danger/20 hover:bg-eve-danger/30 text-eve-danger px-3 py-1 rounded text-sm transition-colors duration-200"
              aria-label={`Delete filter list ${list.name}`}
            >
              Delete
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
</style>
