<!-- FilterListManager.svelte -->
<script>
  import { createEventDispatcher } from "svelte";
  import socket from "./socket.js";
  import { filterLists } from "./store";
  import { onMount } from "svelte";

  const dispatch = createEventDispatcher();

  let newListName = "";
  let newListIds = "";
  let newListIsExclude = false;
  let newListFilterType = "";

  $: localFilterLists = $filterLists;

  async function createFilterList() {
    console.log("Creating new filter list with:", {
      name: newListName,
      ids: newListIds,
      isExclude: newListIsExclude,
      filterType: newListFilterType,
    });

    if (!newListName || !newListIds) {
      console.warn("Missing required fields for filter list creation");
      return;
    }

    const ids = newListIds.split(",").map((id) => id.trim());
    const newList = {
      name: newListName,
      ids,
      enabled: false,
      is_exclude: newListIsExclude,
      filter_type: newListFilterType,
    };

    console.log("Emitting createFilterList event:", newList);
    socket.emit("createFilterList", newList);

    // Clear form fields after emitting
    newListName = "";
    newListIds = "";
    newListIsExclude = false;
    newListFilterType = "";
  }

  function toggleFilterList(id) {
    console.log("Toggling filter list:", id);
    filterLists.update((lists) =>
      lists.map((list) =>
        list.id === id ? { ...list, enabled: !list.enabled } : list
      )
    );
    dispatch("updateFilterLists", { filterLists: $filterLists });
  }

  async function deleteFilterList(id) {
    console.log("Deleting filter list:", id);
    socket.emit("deleteFilterList", { id });
  }

  onMount(async () => {
    console.log("FilterListManager mounted");

    try {
      const response = await fetch("/api/session", {
        credentials: "include",
      });
      const data = await response.json();

      console.log("Session data received:", data);
      if (data.filterLists) {
        console.log(
          "Initializing filter lists from session:",
          data.filterLists
        );
        filterLists.set(data.filterLists);
      }
    } catch (err) {
      console.error("Error fetching session data:", err);
    }

    socket.on("filterListCreated", (filterList) => {
      console.log("Received filterListCreated event:", filterList);
      filterLists.update((lists) => {
        const existingList = lists.find((l) => l.id === filterList.id);
        if (existingList) {
          console.log("Updating existing filter list");
          return lists.map((l) => (l.id === filterList.id ? filterList : l));
        }
        console.log("Adding new filter list");
        return [...lists, filterList];
      });
      dispatch("updateFilterLists", { filterLists: $filterLists });
    });

    socket.on("filterListDeleted", ({ id }) => {
      console.log("Received filterListDeleted event:", id);
      filterLists.update((lists) => lists.filter((l) => l.id !== id));
      dispatch("updateFilterLists", { filterLists: $filterLists });
    });

    return () => {
      console.log("FilterListManager unmounting, removing socket listeners");
      socket.off("filterListCreated");
      socket.off("filterListDeleted");
    };
  });
</script>

<div class="filter-list-manager">
  <h2>Filter Lists</h2>

  <!-- Create New Filter List Form -->
  <div class="create-filter-list">
    <h3>Create New Filter List</h3>
    <div class="form-group">
      <input bind:value={newListName} placeholder="New list name" />
      <input bind:value={newListIds} placeholder="Comma-separated IDs" />
      <label>
        <input type="checkbox" bind:checked={newListIsExclude} />
        Exclude
      </label>
      <select bind:value={newListFilterType}>
        <option value="">Select filter type</option>
        <option value="attacker_alliance">Attacker Alliance</option>
        <option value="attacker_corporation">Attacker Corporation</option>
        <option value="attacker_ship_type">Attacker Ship Type</option>
        <option value="victim_alliance">Victim Alliance</option>
        <option value="victim_corporation">Victim Corporation</option>
        <option value="ship_type">Ship Type</option>
        <option value="solar_system">Solar System</option>
        <option value="region">Region</option>
      </select>
      <button on:click={createFilterList}>Create New List</button>
    </div>
  </div>

  <!-- Existing Filter Lists -->
  <div class="existing-lists">
    {#if localFilterLists.length === 0}
      <p>No filter lists created yet.</p>
    {:else}
      {#each localFilterLists as list (list.id)}
        <div class="filter-list-item">
          <input
            type="checkbox"
            id={`filter-list-${list.id}`}
            checked={list.enabled}
            on:change={() => toggleFilterList(list.id)}
          />
          <label for={`filter-list-${list.id}`}>
            {list.name} ({list.filter_type || "No type"})
          </label>
          <div class="filter-list-controls">
            <button on:click={() => deleteFilterList(list.id)}>Delete</button>
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .filter-list-manager {
    margin-top: 20px;
    padding: 15px;
    border: 1px solid #ddd;
    border-radius: 5px;
  }

  .create-filter-list {
    margin-bottom: 20px;
    padding-bottom: 15px;
    border-bottom: 1px solid #ddd;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 500px;
  }

  .form-group input,
  .form-group select {
    padding: 5px;
  }

  .filter-list-item {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
    padding: 5px;
  }

  .filter-list-item label {
    flex-grow: 1;
  }

  .filter-list-controls {
    display: flex;
    gap: 5px;
  }

  button {
    padding: 5px 10px;
    cursor: pointer;
  }
</style>
