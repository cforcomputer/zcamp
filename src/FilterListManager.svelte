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

    socket.emit("createFilterList", newList);

    // Clear form fields after emitting
    newListName = "";
    newListIds = "";
    newListIsExclude = false;
    newListFilterType = "";
  }

  function toggleFilterList(id) {
    filterLists.update((lists) =>
      lists.map((list) =>
        list.id === id ? { ...list, enabled: !list.enabled } : list
      )
    );
    dispatch("updateFilterLists", { filterLists: $filterLists });
  }

  async function deleteFilterList(id) {
    socket.emit("deleteFilterList", { id });
  }

  onMount(async () => {
    try {
      const response = await fetch("/api/session", {
        credentials: "include",
      });
      const data = await response.json();

      if (data.filterLists) {
        filterLists.set(data.filterLists);
      }
    } catch (err) {
      console.error("Error fetching session data:", err);
    }

    socket.on("filterListCreated", (filterList) => {
      filterLists.update((lists) => {
        const existingList = lists.find((l) => l.id === filterList.id);
        if (existingList) {
          return lists.map((l) => (l.id === filterList.id ? filterList : l));
        }
        return [...lists, filterList];
      });
      dispatch("updateFilterLists", { filterLists: $filterLists });
    });

    socket.on("filterListDeleted", ({ id }) => {
      filterLists.update((lists) => lists.filter((l) => l.id !== id));
      dispatch("updateFilterLists", { filterLists: $filterLists });
    });

    return () => {
      socket.off("filterListCreated");
      socket.off("filterListDeleted");
    };
  });
</script>

<div class="bg-eve-dark/95 rounded-lg p-6 space-y-6">
  <h2 class="text-2xl font-bold text-eve-accent">Filter Lists</h2>

  <!-- Create New Filter List Form -->
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

      <div class="flex flex-col md:flex-row gap-4">
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
        >
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
      </div>

      <button
        on:click={createFilterList}
        class="w-full bg-eve-accent/20 hover:bg-eve-accent/30 text-eve-accent px-4 py-2 rounded transition-colors duration-200"
      >
        Create New List
      </button>
    </div>
  </div>

  <!-- Existing Filter Lists -->
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
                class="flex-grow text-gray-200"
              >
                <span class="font-medium">{list.name}</span>
                <span class="text-gray-400 text-sm ml-2">
                  ({list.filter_type || "No type"})
                </span>
              </label>
            </div>

            <button
              on:click={() => deleteFilterList(list.id)}
              class="bg-eve-danger/20 hover:bg-eve-danger/30 text-eve-danger px-4 py-2 rounded transition-colors duration-200"
            >
              Delete
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
