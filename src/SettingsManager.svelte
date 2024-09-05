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
      Location ID:
      <input
        type="number"
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

    <h3>Attacker Filters</h3>
    <label>
      <input
        type="checkbox"
        bind:checked={localSettings.attacker_alliance_filter_enabled}
        on:change={() =>
          updateSetting(
            "attacker_alliance_filter_enabled",
            localSettings.attacker_alliance_filter_enabled
          )}
      />
      Enable Attacker Alliance Filter
    </label>
    <label>
      Attacker Alliance ID:
      <input
        type="number"
        bind:value={localSettings.attacker_alliance_filter}
        on:input={() =>
          updateSetting(
            "attacker_alliance_filter",
            localSettings.attacker_alliance_filter
          )}
      />
    </label>

    <label>
      <input
        type="checkbox"
        bind:checked={localSettings.attacker_corporation_filter_enabled}
        on:change={() =>
          updateSetting(
            "attacker_corporation_filter_enabled",
            localSettings.attacker_corporation_filter_enabled
          )}
      />
      Enable Attacker Corporation Filter
    </label>
    <label>
      Attacker Corporation ID:
      <input
        type="number"
        bind:value={localSettings.attacker_corporation_filter}
        on:input={() =>
          updateSetting(
            "attacker_corporation_filter",
            localSettings.attacker_corporation_filter
          )}
      />
    </label>

    <label>
      <input
        type="checkbox"
        bind:checked={localSettings.attacker_ship_type_filter_enabled}
        on:change={() =>
          updateSetting(
            "attacker_ship_type_filter_enabled",
            localSettings.attacker_ship_type_filter_enabled
          )}
      />
      Enable Attacker Ship Type Filter
    </label>
    <label>
      Attacker Ship Type ID:
      <input
        type="number"
        bind:value={localSettings.attacker_ship_type_filter}
        on:input={() =>
          updateSetting(
            "attacker_ship_type_filter",
            localSettings.attacker_ship_type_filter
          )}
      />
    </label>

    <h3>Victim Filters</h3>
    <label>
      <input
        type="checkbox"
        bind:checked={localSettings.victim_alliance_filter_enabled}
        on:change={() =>
          updateSetting(
            "victim_alliance_filter_enabled",
            localSettings.victim_alliance_filter_enabled
          )}
      />
      Enable Victim Alliance Filter
    </label>
    <label>
      Victim Alliance ID:
      <input
        type="number"
        bind:value={localSettings.victim_alliance_filter}
        on:input={() =>
          updateSetting(
            "victim_alliance_filter",
            localSettings.victim_alliance_filter
          )}
      />
    </label>

    <label>
      <input
        type="checkbox"
        bind:checked={localSettings.victim_corporation_filter_enabled}
        on:change={() =>
          updateSetting(
            "victim_corporation_filter_enabled",
            localSettings.victim_corporation_filter_enabled
          )}
      />
      Enable Victim Corporation Filter
    </label>
    <label>
      Victim Corporation ID:
      <input
        type="number"
        bind:value={localSettings.victim_corporation_filter}
        on:input={() =>
          updateSetting(
            "victim_corporation_filter",
            localSettings.victim_corporation_filter
          )}
      />
    </label>

    <label>
      <input
        type="checkbox"
        bind:checked={localSettings.solar_system_filter_enabled}
        on:change={() =>
          updateSetting(
            "solar_system_filter_enabled",
            localSettings.solar_system_filter_enabled
          )}
      />
      Enable Solar System Filter
    </label>
    <label>
      Solar System ID:
      <input
        type="number"
        bind:value={localSettings.solar_system_filter}
        on:input={() =>
          updateSetting(
            "solar_system_filter",
            localSettings.solar_system_filter
          )}
      />
    </label>

    <h3>Filter Lists</h3>
    {#if localSettings.filter_lists}
      {#each localSettings.filter_lists as filter, index}
        <div class="filter-list">
          <h4>{filter.file}</h4>
          <label>
            <input
              type="checkbox"
              bind:checked={filter.enabled}
              on:change={() =>
                updateFilterList(index, "enabled", filter.enabled)}
            />
            Enabled
          </label>
          <label>
            Color:
            <input
              type="text"
              bind:value={filter.color}
              on:input={() => updateFilterList(index, "color", filter.color)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              bind:checked={filter.webhook}
              on:change={() =>
                updateFilterList(index, "webhook", filter.webhook)}
            />
            Webhook
          </label>
          <label>
            Sound:
            <input
              type="text"
              bind:value={filter.sound}
              on:input={() => updateFilterList(index, "sound", filter.sound)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              bind:checked={filter.ignore_dropped_value}
              on:change={() =>
                updateFilterList(
                  index,
                  "ignore_dropped_value",
                  filter.ignore_dropped_value
                )}
            />
            Ignore Dropped Value
          </label>
          <label>
            List Check ID:
            <input
              type="text"
              bind:value={filter.list_check_id}
              on:input={() =>
                updateFilterList(index, "list_check_id", filter.list_check_id)}
            />
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
