<script>
  import { createEventDispatcher } from "svelte";
  import { settings, filterLists } from "./store";
  import FilterListManager from "./FilterListManager.svelte";

  const dispatch = createEventDispatcher();

  export let socket;
  export let profiles = [];

  let newListName = '';
  let newListIds = '';
  let newListIsExclude = false;
  let newListFilterType = '';
  let selectedProfile = null;
  let newProfileName = '';

  $: localSettings = $settings;
  $: localFilterLists = $filterLists;

  function updateSetting(key, value) {
    settings.update(s => ({ ...s, [key]: value }));
    socket.emit("updateSettings", $settings);
  }

  function createFilterList() {
    const ids = newListIds.split(',').map(id => id.trim());
    const newList = { 
      name: newListName, 
      ids, 
      enabled: false, 
      is_exclude: newListIsExclude, 
      filter_type: newListFilterType 
    };
    socket.emit("createFilterList", newList);
    filterLists.update(lists => [...lists, newList]);
    newListName = '';
    newListIds = '';
    newListIsExclude = false;
    newListFilterType = '';
  }

  function handleFilterListsUpdate(event) {
    filterLists.set(event.detail.filterLists);
    socket.emit("updateFilterLists", $filterLists);
  }

  function saveProfile() {
    console.log('Save profile function called');
    console.log('New profile name:', newProfileName);
    console.log('Current settings:', $settings);
    console.log('Current filter lists:', $filterLists);

    if (newProfileName) {
      const profileData = {
        name: newProfileName,
        settings: $settings,
        filterLists: $filterLists
      };
      console.log('Sending profile data:', profileData);
      socket.emit("saveProfile", profileData);
      newProfileName = ''; // Clear the input after saving
    } else {
      console.log('No profile name provided');
    }
  }

  function loadProfile() {
    if (selectedProfile) {
      socket.emit("loadProfile", selectedProfile);
    }
  }

  socket.on('profileSaved', (profile) => {
    console.log('Profile saved event received:', profile);
    const existingIndex = profiles.findIndex(p => p.id === profile.id);
    if (existingIndex !== -1) {
      profiles[existingIndex] = profile;
    } else {
      profiles = [...profiles, profile];
    }
    selectedProfile = profile.id;
    profiles = [...profiles]; // Trigger reactivity
    console.log('Updated profiles:', profiles);
  });

  socket.on('profileLoaded', (data) => {
    settings.set(data.settings);
    filterLists.set(data.filterLists);
  });

  socket.on('filterListCreated', (newList) => {
    filterLists.update(lists => [...lists, newList]);
  });

  export function setProfiles(newProfiles) {
    profiles = newProfiles;
    console.log('Profiles updated in SettingsManager:', profiles);
  }
</script>

<div class="settings-manager">
  <h2>Settings</h2>
  
  <div class="profile-section">
    <h3>Profiles</h3>
    <select bind:value={selectedProfile}>
      <option value={null}>Select a profile</option>
      {#each profiles as profile (profile.id)}
        <option value={profile.id}>{profile.name}</option>
      {/each}
    </select>
    <button on:click={loadProfile}>Load Profile</button>
    
    <input bind:value={newProfileName} placeholder="New profile name" />
    <button on:click={saveProfile}>Save Current Settings as New Profile</button>
  </div>
  
  {#if localSettings}
    <!-- Existing settings inputs remain the same -->
    <label>
      <input
        type="checkbox"
        bind:checked={localSettings.dropped_value_enabled}
        on:change={() => updateSetting("dropped_value_enabled", localSettings.dropped_value_enabled)}
      />
      Enable Dropped Value Filter
    </label>
    <label>
      Minimum Dropped Value:
      <input
        type="number"
        bind:value={localSettings.dropped_value}
        on:input={() => updateSetting("dropped_value", localSettings.dropped_value)}
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

    <!-- New Item Type ID Filter -->
    <h3>Item Filter</h3>
    <label>
      <input
        type="checkbox"
        bind:checked={localSettings.item_type_filter_enabled}
        on:change={() =>
          updateSetting(
            "item_type_filter_enabled",
            localSettings.item_type_filter_enabled
          )}
      />
      Enable Item Type Filter
    </label>
    <label>
      Item Type ID:
      <input
        type="number"
        bind:value={localSettings.item_type_filter}
        on:input={() =>
          updateSetting("item_type_filter", localSettings.item_type_filter)}
      />
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
    {/if}
    
    <h3>Create New Filter List</h3>
  <div>
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
    </select>
    <button on:click={createFilterList}>Create New List</button>
  </div>
  
  <FilterListManager on:updateFilterLists={handleFilterListsUpdate} />
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

  input[type="number"]{
    width: 100px;
  }

  h3 {
    margin-top: 20px;
    margin-bottom: 10px;
  }

  button {
    margin-top: 10px;
    margin-right: 10px;
  }

  select {
    margin-top: 5px;
  }

  .profile-section {
    margin-bottom: 20px;
    padding: 10px;
    border: 1px solid #ddd;
    border-radius: 5px;
  }
</style>