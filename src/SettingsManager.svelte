<!-- settingsmanager.svelte -->
<script>
  import { createEventDispatcher } from 'svelte';
  import socket from './socket'; // Import the socket instance
  import { settings } from './store'; // Import the settings store
  import { onMount } from 'svelte';

  const dispatch = createEventDispatcher();

  // Local copy of settings to bind to inputs
  let localSettings;

  // Subscribe to the settings store and keep the local copy in sync
  settings.subscribe(value => {
    localSettings = { ...value };
  });

  // Function to update a single setting
  function updateSetting(key, value) {
    localSettings[key] = value;
    settings.set(localSettings); // Update the store with new settings
    socket.emit('updateSettings', localSettings); // Emit the updated settings to the server
  }

  // Function to update settings inside a filter list
  function updateFilterList(index, key, value) {
    if (localSettings.filter_lists) {
      localSettings.filter_lists = [...localSettings.filter_lists];
      localSettings.filter_lists[index] = { ...localSettings.filter_lists[index], [key]: value };
      settings.set(localSettings); // Update the store
      console.log(localSettings);
      socket.emit('updateSettings', localSettings); // Emit updated settings to server
    }
  }
</script>

<div class="settings-manager">
  <h2>Settings</h2>
  {#if localSettings}
    <label>
      <input type="checkbox" bind:checked={localSettings.dropped_value_enabled} on:change={() => updateSetting('dropped_value_enabled', localSettings.dropped_value_enabled)}>
      Enable Dropped Value Filter
    </label>
    <label>
      <input type="checkbox" bind:checked={localSettings.time_threshold_enabled} on:change={() => updateSetting('time_threshold_enabled', localSettings.time_threshold_enabled)}>
      Enable Time Threshold
    </label>
    <label>
      Time Threshold (seconds):
      <input type="number" bind:value={localSettings.time_threshold} on:input={() => updateSetting('time_threshold', localSettings.time_threshold)}>
    </label>
    <label>
      Minimum Dropped Value:
      <input type="number" bind:value={localSettings.dropped_value} on:input={() => updateSetting('dropped_value', localSettings.dropped_value)}>
    </label>
    <label>
      <input type="checkbox" bind:checked={localSettings.audio_alerts_enabled} on:change={() => updateSetting('audio_alerts_enabled', localSettings.audio_alerts_enabled)}>
      Enable Audio Alerts
    </label>
    <label>
      <input type="checkbox" bind:checked={localSettings.npc_only} on:change={() => updateSetting('npc_only', localSettings.npc_only)}>
      NPC Only
    </label>
    <label>
      <input type="checkbox" bind:checked={localSettings.solo} on:change={() => updateSetting('solo', localSettings.solo)}>
      Solo Only
    </label>
    <label>
      <input type="checkbox" bind:checked={localSettings.triangulation_check} on:change={() => updateSetting('triangulation_check', localSettings.triangulation_check)}>
      Triangulation Check
    </label>

    <h3>Filter Lists</h3>
    {#if localSettings.filter_lists}
      {#each localSettings.filter_lists as filter, index}
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
