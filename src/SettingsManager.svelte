<script>
  import { createEventDispatcher, onMount, afterUpdate } from "svelte";
  import { settings, filterLists, profiles } from "./store";
  import FilterListManager from "./FilterListManager.svelte";
  import ProfileListManager from "./ProfileListManager.svelte";

  export let socket;

  let newListName = "";
  let newListIds = "";
  let newListIsExclude = false;
  let newListFilterType = "";
  let selectedProfile = null;

  $: localSettings = $settings;
  $: localFilterLists = $filterLists;
  $: localProfiles = $profiles;

  $: {
    console.log(
      "SettingsManager.svelte - localProfiles updated:",
      localProfiles
    );
  }

  onMount(() => {
    console.log("SettingsManager.svelte - onMount. Fetching initial profiles.");
    fetchProfiles();
  });

  afterUpdate(() => {
    console.log(
      "SettingsManager.svelte - afterUpdate. Profiles:",
      localProfiles
    );
  });

  function updateSetting(key, value) {
    settings.update((s) => ({ ...s, [key]: value }));
    socket.emit("updateSettings", $settings);
  }

  function createFilterList() {
    const ids = newListIds.split(",").map((id) => id.trim());
    const newList = {
      name: newListName,
      ids,
      enabled: false,
      is_exclude: newListIsExclude,
      filter_type: newListFilterType,
    };
    console.log("Creating new filter list:", newList);
    socket.emit("createFilterList", newList);
    newListName = newListIds = "";
    newListIsExclude = false;
    newListFilterType = "";
  }

  function handleFilterListsUpdate(event) {
    filterLists.set(event.detail.filterLists);
    socket.emit("updateFilterLists", $filterLists);
  }

  function saveProfile(event) {
    const { name } = event.detail;
    if (name) {
      const profileData = {
        name,
        settings: $settings,
        filterLists: $filterLists,
      };
      console.log("Sending profile data:", profileData);
      socket.emit("saveProfile", profileData);
    } else {
      console.log("No profile name provided");
    }
  }

  function loadProfile(event) {
    const profileId = event.detail;
    if (profileId) {
      socket.emit("loadProfile", profileId);
    }
  }

  function deleteProfile(event) {
    const { id } = event.detail;
    console.log("SettingsManager: Deleting profile:", id);
    socket.emit("deleteProfile", { id });
  }

  function fetchProfiles() {
    console.log("Fetching profiles from database");
    socket.emit("fetchProfiles");
  }

  socket.on("initialData", (data) => {
    console.log("Received initial data, fetching profiles");
    fetchProfiles();
  });

  socket.on("profileSaved", (profile) => {
    console.log("Profile saved event received:", profile);
    profiles.update((profs) => {
      const existingIndex = profs.findIndex((p) => p.id === profile.id);
      if (existingIndex !== -1) {
        profs[existingIndex] = profile;
      } else {
        profs = [...profs, profile];
      }
      return profs;
    });
    selectedProfile = profile.id;
    fetchProfiles(); // Fetch updated list of profiles
  });

  socket.on("profileLoaded", (data) => {
    console.log("Profile loaded:", data);

    // Update settings
    settings.update((currentSettings) => ({
      ...currentSettings,
      ...data.settings,
    }));

    // Update filter lists
    filterLists.update((currentLists) => {
      // Remove any lists that no longer exist
      const validLists = currentLists.filter((list) =>
        data.filterLists.some((newList) => newList.id === list.id)
      );

      // Add or update lists from the loaded profile
      data.filterLists.forEach((newList) => {
        const index = validLists.findIndex((list) => list.id === newList.id);
        if (index !== -1) {
          validLists[index] = { ...validLists[index], ...newList };
        } else {
          validLists.push(newList);
        }
      });

      return validLists;
    });

    console.log("Profile loaded successfully");
    // You might want to add a UI notification here
  });

  socket.on("profilesFetched", (fetchedProfiles) => {
    console.log("Profiles fetched from database:", fetchedProfiles);
    profiles.set(fetchedProfiles);
  });

  socket.on("profileDeleted", (deletedId) => {
    console.log("SettingsManager: Profile deleted:", deletedId);
    profiles.update((profs) => {
      const updatedProfs = profs.filter((p) => p.id !== deletedId);
      console.log("SettingsManager: Updated profiles:", updatedProfs);
      return updatedProfs;
    });
    if (selectedProfile === deletedId) {
      selectedProfile = null;
    }
    fetchProfiles(); // Fetch updated list of profiles
  });

  socket.on("filterListCreated", (newList) => {
    console.log("Received new filter list:", newList);
    filterLists.update((lists) => {
      const existingIndex = lists.findIndex((list) => list.id === newList.id);
      if (existingIndex !== -1) {
        lists[existingIndex] = newList;
        return [...lists];
      } else {
        return [...lists, newList];
      }
    });
  });
</script>

<div class="settings-manager">
  <ProfileListManager
    profiles={localProfiles || []}
    bind:selectedProfile
    on:saveProfile={saveProfile}
    on:loadProfile={loadProfile}
    on:fetchProfiles={fetchProfiles}
    on:deleteProfile={deleteProfile}
  />

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
      <input
        type="checkbox"
        bind:checked={localSettings.triangulation_filter_enabled}
        on:change={() =>
          updateSetting(
            "triangulation_filter_enabled",
            localSettings.triangulation_filter_enabled
          )}
      />
      Enable Triangulation Filter
    </label>

    {#if localSettings.triangulation_filter_enabled}
      <label>
        <input
          type="checkbox"
          bind:checked={localSettings.triangulation_filter_exclude}
          on:change={() =>
            updateSetting(
              "triangulation_filter_exclude",
              localSettings.triangulation_filter_exclude
            )}
        />
        Exclude Triangulatable Kills
      </label>
    {/if}

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

  input[type="number"] {
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
</style>
