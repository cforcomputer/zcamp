<script>
    import { createEventDispatcher } from 'svelte';
    import socket from './socket.js'; // Import the initialized socket instance
  
    export let settings = {};
  
    const dispatch = createEventDispatcher();
  
    // Function to update a single setting
    function updateSetting(key, value) {
      const newSettings = { ...settings };
      newSettings[key] = value;
      console.log(newSettings);
      dispatch('updateSettings', newSettings); // Emit event to parent component
    }
  
    // Function to update settings inside a filter list
    function updateFilterList(index, key, value) {
      if (settings.filter_lists) {
        const newSettings = { ...settings };
        newSettings.filter_lists = [...settings.filter_lists];
        newSettings.filter_lists[index] = { ...newSettings.filter_lists[index] };
        newSettings.filter_lists[index][key] = value;
        dispatch('updateSettings', newSettings); // Emit event to parent component
      }
    }
  </script>
  
  <div class="settings-manager">
    <h2>Settings</h2>
    {#if settings}
      <label>
        <input type="checkbox" bind:checked={settings.dropped_value_enabled} on:change={() => updateSetting('dropped_value_enabled', settings.dropped_value_enabled)}>
        Enable Dropped Value Filter
      </label>
      <label>
        <input type="checkbox" bind:checked={settings.time_threshold_enabled} on:change={() => updateSetting('time_threshold_enabled', settings.time_threshold_enabled)}>
        Enable Time Threshold
      </label>
      <label>
        Time Threshold (seconds):
        <input type="number" bind:value={settings.time_threshold} on:input={() => updateSetting('time_threshold', settings.time_threshold)}>
      </label>
      <label>
        Minimum Dropped Value:
        <input type="number" bind:value={settings.dropped_value} on:input={() => updateSetting('dropped_value', settings.dropped_value)}>
      </label>
      <label>
        <input type="checkbox" bind:checked={settings.audio_alerts_enabled} on:change={() => updateSetting('audio_alerts_enabled', settings.audio_alerts_enabled)}>
        Enable Audio Alerts
      </label>
      <label>
        <input type="checkbox" bind:checked={settings.npc_only} on:change={() => updateSetting('npc_only', settings.npc_only)}>
        NPC Only
      </label>
      <label>
        <input type="checkbox" bind:checked={settings.solo} on:change={() => updateSetting('solo', settings.solo)}>
        Solo Only
      </label>
      <label>
        <input type="checkbox" bind:checked={settings.triangulation_check} on:change={() => updateSetting('triangulation_check', settings.triangulation_check)}>
        Triangulation Check
      </label>
  
      <h3>Filter Lists</h3>
      {#if settings.filter_lists}
        {#each settings.filter_lists as filter, index}
          <div class="filter-list">
            <h4>{filter.file}</h4>
            <label>
              <input type="checkbox" bind:checked={filter.enabled} on:change={() => updateFilterList(index, 'enabled', filter.enabled)}>
              Enabled
            </label>
            <label>
              Color:
              <input type="text" bind:value={filter.color} on:input={() => updateFilterList(index, 'color', filter.color)}>
            </label>
            <label>
              <input type="checkbox" bind:checked={filter.webhook} on:change={() => updateFilterList(index, 'webhook', filter.webhook)}>
              Webhook
            </label>
            <label>
              Sound:
              <input type="text" bind:value={filter.sound} on:input={() => updateFilterList(index, 'sound', filter.sound)}>
            </label>
            <label>
              <input type="checkbox" bind:checked={filter.ignore_dropped_value} on:change={() => updateFilterList(index, 'ignore_dropped_value', filter.ignore_dropped_value)}>
              Ignore Dropped Value
            </label>
            <label>
              List Check ID:
              <input type="text" bind:value={filter.list_check_id} on:input={() => updateFilterList(index, 'list_check_id', filter.list_check_id)}>
            </label>
          </div>
        {/each}
      {/if}
    {/if}
  </div>
  
  <style>
    .settings-manager {
      margin-top: 20px;
      text-align: left;
    }
  
    label {
      display: block;
      margin-bottom: 10px;
    }
  
    input[type="number"], input[type="text"] {
      width: 100px;
    }
  
    .filter-list {
      margin-bottom: 20px;
      padding: 10px;
      border: 1px solid #ccc;
      border-radius: 5px;
    }
  </style>
  