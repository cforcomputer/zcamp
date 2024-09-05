<script>
  import { createEventDispatcher } from "svelte";
  import socket from "./socket";
  import { settings } from "./store";

  const dispatch = createEventDispatcher();

  let localSettings;

  settings.subscribe((value) => {
    localSettings = { ...value };
  });

  function updateSetting(key, value) {
    localSettings[key] = value;
    settings.set(localSettings);
    socket.emit("updateSettings", localSettings);
  }

  function updateFilterList(index, key, value) {
    if (localSettings.filter_lists) {
      localSettings.filter_lists = [...localSettings.filter_lists];
      localSettings.filter_lists[index] = {
        ...localSettings.filter_lists[index],
        [key]: value,
      };
      settings.set(localSettings);
      socket.emit("updateSettings", localSettings);
    }
  }
</script>

<div class="settings-manager">
  <h2>Settings</h2>
  {#if localSettings}
    <!-- Existing filters -->
    <label>
      <input
        type="checkbox"
        bind:checked={localSettings.dropped_value_enabled}
        on:change={() =>
          updateSetting(
            "dropped_value_enabled",
            localSettings.dropped_value_enabled
          )}
      />
      Enable Dropped Value Filter
    </label>
    <label>
      Minimum Dropped Value:
      <input
        type="number"
        bind:value={localSettings.dropped_value}
        on:input={() =>
          updateSetting("dropped_value", localSettings.dropped_value)}
      />
    </label>

    <!-- New filters -->
    <label>
      <input
        type="checkbox"
        bind:checked={localSettings.total_value_enabled}
        on:change={() =>
          updateSetting(
            "total_value_enabled",
            localSettings.total_value_enabled
          )}
      />
      Enable Total Value Filter
    </label>
    <label>
      Minimum Total Value:
      <input
        type="number"
        bind:value={localSettings.total_value}
        on:input={() => updateSetting("total_value", localSettings.total_value)}
      />
    </label>

    <label>
      <input
        type="checkbox"
        bind:checked={localSettings.points_enabled}
        on:change={() =>
          updateSetting("points_enabled", localSettings.points_enabled)}
      />
      Enable Points Filter
    </label>
    <label>
      Minimum Points:
      <input
        type="number"
        bind:value={localSettings.points}
        on:input={() => updateSetting("points", localSettings.points)}
      />
    </label>

    <label>
      <input
        type="checkbox"
        bind:checked={localSettings.npc_only}
        on:change={() => updateSetting("npc_only", localSettings.npc_only)}
      />
      NPC Only
    </label>

    <label>
      <input
        type="checkbox"
        bind:checked={localSettings.solo}
        on:change={() => updateSetting("solo", localSettings.solo)}
      />
      Solo Only
    </label>

    <label>
      <input
        type="checkbox"
        bind:checked={localSettings.awox_only}
        on:change={() => updateSetting("awox_only", localSettings.awox_only)}
      />
      AWOX Only
    </label>

    <label>
      <input
        type="checkbox"
        bind:checked={localSettings.location_filter_enabled}
        on:change={() =>
          updateSetting(
            "location_filter_enabled",
            localSettings.location_filter_enabled
          )}
      />
      Enable Location Filter
    </label>
    <label>
      Location:
      <input
        type="text"
        bind:value={localSettings.location_filter}
        on:input={() =>
          updateSetting("location_filter", localSettings.location_filter)}
      />
    </label>

    <label>
      <input
        type="checkbox"
        bind:checked={localSettings.ship_type_filter_enabled}
        on:change={() =>
          updateSetting(
            "ship_type_filter_enabled",
            localSettings.ship_type_filter_enabled
          )}
      />
      Enable Ship Type Filter
    </label>
    <label>
      Ship Type ID:
      <input
        type="number"
        bind:value={localSettings.ship_type_filter}
        on:input={() =>
          updateSetting("ship_type_filter", localSettings.ship_type_filter)}
      />
    </label>

    <!-- Existing time threshold and audio alerts -->
    <label>
      <input
        type="checkbox"
        bind:checked={localSettings.time_threshold_enabled}
        on:change={() =>
          updateSetting(
            "time_threshold_enabled",
            localSettings.time_threshold_enabled
          )}
      />
      Enable Time Threshold
    </label>
    <label>
      Time Threshold (seconds):
      <input
        type="number"
        bind:value={localSettings.time_threshold}
        on:input={() =>
          updateSetting("time_threshold", localSettings.time_threshold)}
      />
    </label>

    <label>
      <input
        type="checkbox"
        bind:checked={localSettings.audio_alerts_enabled}
        on:change={() =>
          updateSetting(
            "audio_alerts_enabled",
            localSettings.audio_alerts_enabled
          )}
      />
      Enable Audio Alerts
    </label>

    <!-- Filter Lists (unchanged) -->
    <h3>Filter Lists</h3>
    {#if localSettings.filter_lists}
      {#each localSettings.filter_lists as filter, index}
        <div class="filter-list">
          <!-- ... (unchanged filter list code) ... -->
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

  input[type="number"],
  input[type="text"] {
    width: 100px;
  }

  .filter-list {
    margin-bottom: 20px;
    padding: 10px;
    border: 1px solid #ccc;
    border-radius: 5px;
  }
</style>
