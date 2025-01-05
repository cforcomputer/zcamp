<script>
  import { createEventDispatcher, onMount, afterUpdate } from "svelte";
  import { settings, filterLists, profiles, DEFAULT_SETTINGS } from "./store";
  import ProfileListManager from "./ProfileListManager.svelte";
  import FilterListManager from "./FilterListManager.svelte";

  export let socket;

  let newListName = "";
  let newListIds = "";
  let newListIsExclude = false;
  let newListFilterType = "";
  let selectedProfile = null;

  $: localSettings = $settings;
  $: localProfiles = $profiles;

  function addProfile(profile) {
    profiles.update((currentProfiles) => {
      // Check if the profile already exists
      const existingIndex = currentProfiles.findIndex(
        (p) => p.id === profile.id
      );
      if (existingIndex !== -1) {
        // Update the existing profile
        currentProfiles[existingIndex] = profile;
        return [...currentProfiles];
      } else {
        // Add the new profile
        return [...currentProfiles, profile];
      }
    });
  }

  $: {
    console.log(
      "SettingsManager.svelte - localProfiles updated:",
      localProfiles
    );
  }

  onMount(() => {
    socket.on("profilesFetched", (fetchedProfiles) => {
      console.log("Received profiles:", fetchedProfiles);
      profiles.set(fetchedProfiles);
    });

    socket.on("profileSaved", (profile) => {
      console.log("Profile saved:", profile);
      addProfile(profile); // Use the addProfile function
    });

    socket.on("profileDeleted", (id) => {
      console.log("Profile deleted:", id);
      deleteProfile(id);
    });

    // Initial fetch
    socket.emit("fetchProfiles");

    return () => {
      socket.off("profilesFetched");
      socket.off("profileSaved");
      socket.off("profileDeleted");
    };
  });

  afterUpdate(() => {
    console.log(
      "SettingsManager.svelte - afterUpdate. Profiles:",
      localProfiles
    );
  });

  // SettingsManager.svelte
  function updateSetting(key, value) {
    try {
      settings.update((currentSettings) => {
        // Create a new settings object with defaults
        const updatedSettings = {
          ...DEFAULT_SETTINGS,
          ...currentSettings,
        };

        // Handle nested objects
        if (key === "location_types") {
          updatedSettings.location_types = {
            ...DEFAULT_SETTINGS.location_types,
            ...currentSettings.location_types,
            ...value,
          };
        } else if (key === "combat_labels") {
          updatedSettings.combat_labels = {
            ...DEFAULT_SETTINGS.combat_labels,
            ...currentSettings.combat_labels,
            ...value,
          };
        } else {
          // Handle regular settings
          updatedSettings[key] = value;
        }

        // Emit update to server
        socket.emit("updateSettings", updatedSettings);

        return updatedSettings;
      });
    } catch (e) {
      console.error("Error updating setting:", e);
      settings.set({ ...DEFAULT_SETTINGS }); // Reset to defaults if error occurs
    }
  }

  async function createFilterList() {
    if (!newListName || !newListIds) {
      return; // Add validation
    }

    const ids = newListIds.split(",").map((id) => id.trim());
    const newList = {
      name: newListName,
      ids,
      enabled: false,
      is_exclude: newListIsExclude,
      filter_type: newListFilterType,
    };

    socket.emit("createFilterList", newList); // Use socket instead of fetch

    // Clear form fields after emitting
    newListName = "";
    newListIds = "";
    newListIsExclude = false;
    newListFilterType = "";
  }

  function saveProfile(event) {
    const { name } = event.detail;
    if (name) {
      const profileData = {
        name,
        settings: $settings,
        filterLists: $filterLists.map((list) => ({
          ...list,
          id: list.id.toString(), // Convert BigInt to string
        })),
      };
      console.log("Sending profile data:", profileData);
      socket.emit("saveProfile", profileData);
    }
  }

  function loadProfile(event) {
    const profileId = event.detail;
    if (profileId) {
      console.log("Loading profile:", profileId);
      socket.emit("loadProfile", profileId);
    }
  }

  function deleteProfile(event) {
    const { id } = event.detail;
    console.log("Deleting profile:", id);
    socket.emit("deleteProfile", { id });
  }

  function fetchProfiles() {
    console.log("Fetching profiles");
    socket.emit("fetchProfiles");
  }

  socket.on("initialData", (data) => {
    console.log("Received initial data, fetching profiles");
    fetchProfiles();
  });

  socket.on("profileSaved", (profile) => {
    console.log("Profile saved:", profile);
    profiles.update((currentProfiles) => {
      // Find and update existing profile or add new one
      const existingIndex = currentProfiles.findIndex(
        (p) => p.id === profile.id
      );
      if (existingIndex !== -1) {
        currentProfiles[existingIndex] = profile;
        return [...currentProfiles];
      }
      return [...currentProfiles, profile];
    });

    // Trigger a profile fetch to ensure we have latest data
    fetchProfiles();
  });

  socket.on("profileLoaded", (data) => {
    // Update settings
    settings.set({
      ...DEFAULT_SETTINGS,
      ...data.settings,
    });

    // Update filter lists
    filterLists.set(
      data.filterLists.map((list) => ({
        ...list,
        ids: JSON.parse(list.ids),
        enabled: Boolean(list.enabled),
        is_exclude: Boolean(list.is_exclude),
      }))
    );

    // Update profiles store
    profiles.update((currentProfiles) => {
      const existingIndex = currentProfiles.findIndex((p) => p.id === data.id);
      if (existingIndex !== -1) {
        currentProfiles[existingIndex] = data;
        return [...currentProfiles];
      }
      return [...currentProfiles, data];
    });

    // Force UI update
    selectedProfile = data.id;
  });

  socket.on("profilesFetched", (fetchedProfiles) => {
    console.log("Profiles fetched from database:", fetchedProfiles);
    profiles.set(fetchedProfiles);
  });

  socket.on("profileDeleted", (deletedId) => {
    profiles.update((profs) => profs.filter((p) => p.id !== deletedId));
    if (selectedProfile === deletedId) {
      selectedProfile = null;
    }
  });

  socket.on("filterListCreated", (newList) => {
    console.log("Received new filter list:", newList);
    filterLists.update((lists) => {
      // Check if the list already exists
      const existingIndex = lists.findIndex((list) => list.id === newList.id);
      if (existingIndex !== -1) {
        // Update the existing list
        lists[existingIndex] = newList;
        return [...lists];
      } else {
        // Add the new list
        return [...lists, newList];
      }
    });
  });
</script>

<div class="settings-manager">
  <ProfileListManager
    profiles={localProfiles}
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

    {#if $settings.triangulation_filter_enabled}
      <label>
        <input
          type="checkbox"
          bind:checked={$settings.triangulation_filter_exclude}
          on:change={() =>
            updateSetting(
              "triangulation_filter_exclude",
              $settings.triangulation_filter_exclude
            )}
        />
        Exclude Triangulatable Kills
      </label>

      <label>
        <input
          type="checkbox"
          bind:checked={$settings.triangulation_filter_near_stargate}
          on:change={() =>
            updateSetting(
              "triangulation_filter_near_stargate",
              $settings.triangulation_filter_near_stargate
            )}
        />
        Exclude Near-Stargate Kills
      </label>

      <label>
        <input
          type="checkbox"
          bind:checked={$settings.triangulation_filter_near_celestial}
          on:change={() =>
            updateSetting(
              "triangulation_filter_near_celestial",
              $settings.triangulation_filter_near_celestial
            )}
        />
        Exclude Near-Celestial Kills
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
        bind:checked={localSettings.attacker_capital_filter_enabled}
        on:change={() =>
          updateSetting(
            "attacker_capital_filter_enabled",
            localSettings.attacker_capital_filter_enabled
          )}
      />
      Show Only Kills with Capital Ship Attackers
    </label>
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

  <!-- Location Type Filter -->
  <label>
    <input
      type="checkbox"
      bind:checked={localSettings.location_type_filter_enabled}
      on:change={() =>
        updateSetting(
          "location_type_filter_enabled",
          localSettings.location_type_filter_enabled
        )}
    />
    Enable Location Type Filter
  </label>

  {#if $settings.location_type_filter_enabled}
    <div class="location-types">
      <!-- Location type checkboxes -->
      <label>
        <input
          type="checkbox"
          bind:checked={$settings.location_types.highsec}
          on:change={() =>
            updateSetting("location_types", $settings.location_types)}
        />
        High Security
      </label>
      <label>
        <input
          type="checkbox"
          bind:checked={localSettings.location_types.lowsec}
          on:change={() =>
            updateSetting("location_types", localSettings.location_types)}
        />
        Low Security
      </label>
      <label>
        <input
          type="checkbox"
          bind:checked={localSettings.location_types.nullsec}
          on:change={() =>
            updateSetting("location_types", localSettings.location_types)}
        />
        Null Security
      </label>
      <label>
        <input
          type="checkbox"
          bind:checked={localSettings.location_types.wspace}
          on:change={() =>
            updateSetting("location_types", localSettings.location_types)}
        />
        Wormhole Space
      </label>
      <label>
        <input
          type="checkbox"
          bind:checked={localSettings.location_types.abyssal}
          on:change={() =>
            updateSetting("location_types", localSettings.location_types)}
        />
        Abyssal Space
      </label>
    </div>
  {/if}

  <!-- Ship Category Filter -->
  <label>
    <input
      type="checkbox"
      bind:checked={localSettings.capitals_only}
      on:change={() =>
        updateSetting("capitals_only", localSettings.capitals_only)}
    />
    Capitals Only
  </label>

  <!-- Combat Type Filter -->
  <label>
    <input
      type="checkbox"
      bind:checked={localSettings.combat_label_filter_enabled}
      on:change={() =>
        updateSetting(
          "combat_label_filter_enabled",
          localSettings.combat_label_filter_enabled
        )}
    />
    Enable Combat Label Filter
  </label>

  {#if localSettings.combat_label_filter_enabled}
    <div class="combat-labels">
      <label>
        <input
          type="checkbox"
          bind:checked={localSettings.combat_labels.ganked}
          on:change={() =>
            updateSetting("combat_labels", localSettings.combat_labels)}
        />
        Ganked
      </label>
      <label>
        <input
          type="checkbox"
          bind:checked={localSettings.combat_labels.pvp}
          on:change={() =>
            updateSetting("combat_labels", localSettings.combat_labels)}
        />
        PvP
      </label>
      <label>
        <input
          type="checkbox"
          bind:checked={localSettings.combat_labels.padding}
          on:change={() =>
            updateSetting("combat_labels", localSettings.combat_labels)}
        />
        Padding
      </label>
    </div>
  {/if}

  <h3>Discord Webhook</h3>
  <label>
    <input
      type="checkbox"
      bind:checked={localSettings.webhook_enabled}
      on:change={() =>
        updateSetting("webhook_enabled", localSettings.webhook_enabled)}
    />
    Enable Discord Webhook Alerts
  </label>

  {#if localSettings.webhook_enabled}
    <label>
      Webhook URL:
      <input
        type="text"
        bind:value={localSettings.webhook_url}
        on:input={() => updateSetting("webhook_url", localSettings.webhook_url)}
        placeholder="https://discord.com/api/webhooks/..."
        style="width: 100%; max-width: 500px;"
      />
    </label>
  {/if}
  <FilterListManager />
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
</style>
