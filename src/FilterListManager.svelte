<script>
    import { createEventDispatcher } from 'svelte';
    import { filterLists } from './store.js';
    import socket from './socket.js';
  
    const dispatch = createEventDispatcher();
  
    function toggleFilterList(id) {
      filterLists.update(lists => 
        lists.map(list => 
          list.id === id ? {...list, enabled: !list.enabled} : list
        )
      );
      updateFilterList(id);
    }
  
    function toggleExclude(id) {
      filterLists.update(lists => 
        lists.map(list => 
          list.id === id ? {...list, is_exclude: !list.is_exclude} : list
        )
      );
      updateFilterList(id);
    }
  
    function updateFilterList(id) {
      const list = $filterLists.find(l => l.id === id);
      if (list) {
        socket.emit('updateFilterList', list);
        dispatch('updateFilterLists', {filterLists: $filterLists});
      }
    }
  
    function deleteFilterList(id) {
      socket.emit('deleteFilterList', { id });
      filterLists.update(lists => lists.filter(list => list.id !== id));
      dispatch('updateFilterLists', {filterLists: $filterLists});
    }
  </script>
  
  <div class="filter-list-manager">
    <h2>Filter Lists</h2>
    {#if $filterLists.length === 0}
      <p>No filter lists created yet. Create one to get started!</p>
    {:else}
      {#each $filterLists as list (list.id)}
        <div class="filter-list-item">
          <input
            type="checkbox"
            id={`filter-list-${list.id}`}
            checked={list.enabled}
            on:change={() => toggleFilterList(list.id)}
          />
          <label for={`filter-list-${list.id}`}>
            {list.name} ({list.filter_type})
          </label>
          <select 
            value={list.is_exclude ? 'exclude' : 'include'} 
            on:change={() => toggleExclude(list.id)}
          >
            <option value="include">Include</option>
            <option value="exclude">Exclude</option>
          </select>
          <button on:click={() => deleteFilterList(list.id)}>Delete</button>
        </div>
      {/each}
    {/if}
  </div>
  
  <style>
    .filter-list-manager {
      margin-top: 20px;
      padding: 15px;
      border: 1px solid #ddd;
      border-radius: 5px;
    }
  
    .filter-list-item {
      display: flex;
      align-items: center;
      margin-bottom: 10px;
    }
  
    .filter-list-item label {
      margin-left: 10px;
      flex-grow: 1;
    }
  
    select, button {
      margin-left: 10px;
    }
  </style>