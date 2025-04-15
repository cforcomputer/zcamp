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
  // Any change to the $filterLists store will update this variable
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

    // Process the IDs string into an array, trimming whitespace and removing empty entries
    const ids = newListIds
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id); // Filter out empty strings

    // Prepare the data object for the new list
    const newListData = {
      name: newListName,
      ids, // Use the processed array
      enabled: true, // Default new lists to enabled
      is_exclude: newListIsExclude,
      filter_type: newListFilterType,
    };

    // Emit the 'createFilterList' event to the server via socket
    console.log(
      "[FilterListManager] Emitting createFilterList event with data:",
      newListData
    );
    socket.emit("createFilterList", newListData);

    // --- Optimistic Update ---
    // Create a temporary ID (e.g., using timestamp or a simple counter)
    // This ID will be replaced when/if the server confirms with the real ID.
    const tempId = `temp-${Date.now()}`;
    const optimisticList = {
      ...newListData,
      id: tempId,
      user_id: "optimistic", // Placeholder user_id
    };
    console.log(
      "[FilterListManager] Applying optimistic update with temp ID:",
      tempId
    );
    filterLists.update((currentLists) => [...currentLists, optimisticList]);
    // --- End Optimistic Update ---

    // Clear the form fields after submission
    newListName = "";
    newListIds = "";
    newListIsExclude = false;
    newListFilterType = ""; // Reset filter type dropdown
  }

  // Function to toggle the enabled state of a filter list
  function toggleFilterList(id) {
    // Prevent toggling for temporary items (optional, but can prevent errors if server confirmation is slow)
    // if (id.startsWith('temp-')) return;

    filterLists.update((lists) =>
      lists.map((list) =>
        // Find the list by ID and toggle its 'enabled' property
        list.id === id ? { ...list, enabled: !list.enabled } : list
      )
    );
    // Dispatch an event to notify parent components (like SettingsManager) of the change
    // This isn't strictly necessary if reactivity is handled correctly, but can be useful
    dispatch("updateFilterLists", { filterLists: $filterLists });
  }

  // Function to delete a filter list - REMOVED CONFIRMATION
  async function deleteFilterList(id) {
    console.log(
      "[FilterListManager] Emitting deleteFilterList event for ID:",
      id
    );
    // Emit the 'deleteFilterList' event to the server immediately
    socket.emit("deleteFilterList", { id });

    // --- Optimistic Update for Deletion ---
    console.log("[FilterListManager] Applying optimistic delete for ID:", id);
    filterLists.update((lists) => lists.filter((list) => list.id !== id));
    // --- End Optimistic Update ---
  }

  // --- Socket Event Handlers ---
  // Handler for when filter lists are fetched (e.g., on initial load)
  const handleFilterListsFetched = (fetchedLists) => {
    console.log("[FilterListManager] Received filter lists:", fetchedLists);
    // Update the Svelte store with the fetched lists
    filterLists.set(fetchedLists);
  };

  // Handler for when a filter list is deleted (event from server)
  // This confirms the deletion, but the UI might already be updated optimistically
  const handleFilterListDeleted = ({ id }) => {
    console.log(
      "[FilterListManager] Received confirmation for filterListDeleted event for ID:",
      id
    );
    // Ensure the item is removed if the optimistic update somehow failed or was reverted
    filterLists.update((lists) => lists.filter((list) => list.id !== id));
    // Dispatch update event (optional, depends on component structure)
    dispatch("updateFilterLists", { filterLists: $filterLists });
  };

  // Handler for when a filter list is created (event from server)
  // This replaces the optimistic update with the actual data from the server
  const handleFilterListCreated = (filterList) => {
    console.log(
      "[FilterListManager] Received filterListCreated event (server confirmation):",
      filterList
    );
    filterLists.update((currentLists) => {
      // Remove the temporary optimistic entry if it exists by finding *any* temp entry
      // (We don't know the exact temp ID here, but there should only be one recent one)
      const listsWithoutTemp = currentLists.filter(
        (l) => !l.id.startsWith("temp-")
      );
      // Check if the real list already exists (e.g., from fetch or another client)
      const existingIndex = listsWithoutTemp.findIndex(
        (l) => l.id === filterList.id
      );
      if (existingIndex !== -1) {
        // Update if already exists (less common for 'created')
        const updatedLists = [...listsWithoutTemp];
        updatedLists[existingIndex] = filterList;
        console.log(
          "[FilterListManager] Updated existing filter list in store (server confirmation):",
          filterList.id
        );
        return updatedLists;
      } else {
        // Add the confirmed list from the server
        console.log(
          "[FilterListManager] Added confirmed filter list to store:",
          filterList.id
        );
        return [...listsWithoutTemp, filterList];
      }
    });
    // Force reactivity check after store update
    localFilterLists = $filterLists;
  };

  // Component lifecycle: setup and teardown socket listeners
  onMount(() => {
    console.log("[FilterListManager] Component mounted, setting up listeners.");
    // Request initial filter lists when the component mounts
    socket.emit("fetchFilterLists");

    // Register socket event listeners
    socket.on("filterListsFetched", handleFilterListsFetched);
    socket.on("filterListDeleted", handleFilterListDeleted);
    socket.on("filterListCreated", handleFilterListCreated); // Listener for real-time updates

    // Cleanup function: remove listeners when the component is destroyed
    return () => {
      console.log(
        "[FilterListManager] Component destroying, cleaning up listeners."
      );
      socket.off("filterListsFetched", handleFilterListsFetched);
      socket.off("filterListDeleted", handleFilterListDeleted);
      socket.off("filterListCreated", handleFilterListCreated);
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
                class="form-checkbox bg-eve-secondary text-eve-accent rounded border-eve-accent/20 focus:ring-eve-accent focus:ring-2"
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
