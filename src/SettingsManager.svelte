<script>
  import { createEventDispatcher, onMount, afterUpdate } from "svelte";
  import {
    settings,
    filterLists,
    profiles,
    DEFAULT_SETTINGS,
  } from "./settingsStore";
  import ProfileListManager from "./ProfileListManager.svelte";
  import FilterListManager from "./FilterListManager.svelte";

  export let socket;

  let newListName = "";
  let newListIds = "";
  let newListIsExclude = false;
  let newListFilterType = "";
  let selectedProfile = null;
  let error = null;
  let settingsManagerHeight = "calc(100vh - 120px)"; // Default height

  $: localSettings = $settings;
  $: localProfiles = $profiles;

  function addProfile(profile) {
    profiles.update((currentProfiles) => {
      const existingIndex = currentProfiles.findIndex(
        (p) => p.id === profile.id
      );
      if (existingIndex !== -1) {
        currentProfiles[existingIndex] = profile;
        return [...currentProfiles];
      } else {
        return [...currentProfiles, profile];
      }
    });
  }

  onMount(() => {
    socket.on("profilesFetched", (fetchedProfiles) => {
      profiles.set(fetchedProfiles);
    });

    socket.on("profileSaved", (profile) => {
      addProfile(profile);
    });

    socket.on("profileDeleted", (id) => {
      deleteProfile(id);
    });

    socket.on("filterListCreated", (newList) => {
      filterLists.update((lists) => [...lists, newList]);
    });

    socket.on("filterListDeleted", (id) => {
      filterLists.update((lists) => lists.filter((l) => l.id !== id));
    });

    socket.on("error", (err) => {
      error = err.message;
      setTimeout(() => (error = null), 5000);
    });

    socket.emit("fetchProfiles");

    // Calculate height on mount and resize
    const handleResize = () => {
      const headerHeight = document.querySelector(".header")?.offsetHeight || 0; // Replace '.header' with the actual selector for your header
      const footerHeight = document.querySelector(".footer")?.offsetHeight || 0; // Replace '.footer' with the actual selector for your footer
      settingsManagerHeight = `calc(100vh - ${
        headerHeight + footerHeight + 40
      }px)`; // 40px additional margin
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      socket.off("profilesFetched");
      socket.off("profileSaved");
      socket.off("profileDeleted");
      socket.off("filterListCreated");
      socket.off("filterListDeleted");
      socket.off("error");
    };
  });

  function updateSetting(key, value) {
    try {
      settings.update((currentSettings) => {
        const updatedSettings = {
          ...DEFAULT_SETTINGS,
          ...currentSettings,
        };

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
          updatedSettings[key] = value;
        }

        socket.emit("updateSettings", updatedSettings);
        return updatedSettings;
      });
    } catch (e) {
      console.error("Error updating setting:", e);
      error = "Failed to update settings";
      setTimeout(() => (error = null), 5000);
      settings.set({ ...DEFAULT_SETTINGS });
    }
  }

  async function createFilterList() {
    if (!newListName || !newListIds) return;

    const ids = newListIds.split(",").map((id) => id.trim());
    const newList = {
      name: newListName,
      ids,
      enabled: false,
      is_exclude: newListIsExclude,
      filter_type: newListFilterType,
    };

    socket.emit("createFilterList", newList);

    // Clear form
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
          id: list.id.toString(),
        })),
      };
      socket.emit("saveProfile", profileData);
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
    socket.emit("deleteProfile", { id });
  }

  function fetchProfiles() {
    socket.emit("fetchProfiles");
  }
</script>

<div
  class="settings-manager overflow-auto"
  style="height: {settingsManagerHeight};"
>
  <div class="space-y-8">
    {#if error}
      <div
        class="bg-eve-danger/20 border border-eve-danger text-eve-danger px-4 py-3 rounded-lg"
      >
        {error}
      </div>
    {/if}

    <div class="bg-eve-card rounded-lg p-6">
      <ProfileListManager
        profiles={localProfiles}
        bind:selectedProfile
        on:saveProfile={saveProfile}
        on:loadProfile={loadProfile}
        on:fetchProfiles={fetchProfiles}
        on:deleteProfile={deleteProfile}
      />
    </div>

    {#if localSettings}
      <div class="bg-eve-card rounded-lg p-6 space-y-4">
        <h3 class="text-xl font-semibold text-eve-accent mb-4">
          Basic Filters
        </h3>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label class="flex items-center space-x-2">
            <input
              type="checkbox"
              class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
              bind:checked={localSettings.npc_only}
              on:change={() =>
                updateSetting("npc_only", localSettings.npc_only)}
            />
            <span>NPC Only</span>
          </label>

          <label class="flex items-center space-x-2">
            <input
              type="checkbox"
              class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
              bind:checked={localSettings.solo}
              on:change={() => updateSetting("solo", localSettings.solo)}
            />
            <span>Solo Only</span>
          </label>

          <label class="flex items-center space-x-2">
            <input
              type="checkbox"
              class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
              bind:checked={localSettings.awox_only}
              on:change={() =>
                updateSetting("awox_only", localSettings.awox_only)}
            />
            <span>AWOX Only</span>
          </label>

          <label class="flex items-center space-x-2">
            <input
              type="checkbox"
              class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
              bind:checked={localSettings.points_enabled}
              on:change={() =>
                updateSetting("points_enabled", localSettings.points_enabled)}
            />
            <span>Enable Points Filter</span>
          </label>
        </div>

        {#if localSettings.points_enabled}
          <div class="flex items-center space-x-4">
            <input
              type="number"
              class="bg-black/20 text-gray-200 rounded px-3 py-2 w-32 border border-eve-accent/20 focus:border-eve-accent/50 focus:outline-none"
              bind:value={localSettings.points}
              on:input={() => updateSetting("points", localSettings.points)}
              placeholder="Min Points"
            />
          </div>
        {/if}
      </div>

      <div class="bg-eve-card rounded-lg p-6 space-y-4">
        <h3 class="text-xl font-semibold text-eve-accent mb-4">
          Value Filters
        </h3>

        <div class="space-y-3">
          <div class="flex items-center space-x-4">
            <label class="flex items-center space-x-2">
              <input
                type="checkbox"
                class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
                bind:checked={localSettings.dropped_value_enabled}
                on:change={() =>
                  updateSetting(
                    "dropped_value_enabled",
                    localSettings.dropped_value_enabled
                  )}
              />
              <span>Enable Dropped Value Filter</span>
            </label>

            <input
              type="number"
              class="bg-black/20 text-gray-200 rounded px-3 py-2 w-32 border border-eve-accent/20 focus:border-eve-accent/50 focus:outline-none"
              bind:value={localSettings.dropped_value}
              on:input={() =>
                updateSetting("dropped_value", localSettings.dropped_value)}
              placeholder="Min Value"
            />
          </div>

          <div class="flex items-center space-x-4">
            <label class="flex items-center space-x-2">
              <input
                type="checkbox"
                class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
                bind:checked={localSettings.total_value_enabled}
                on:change={() =>
                  updateSetting(
                    "total_value_enabled",
                    localSettings.total_value_enabled
                  )}
              />
              <span>Enable Total Value Filter</span>
            </label>

            <input
              type="number"
              class="bg-black/20 text-gray-200 rounded px-3 py-2 w-32 border border-eve-accent/20 focus:border-eve-accent/50 focus:outline-none"
              bind:value={localSettings.total_value}
              on:input={() =>
                updateSetting("total_value", localSettings.total_value)}
              placeholder="Min Value"
            />
          </div>
        </div>
      </div>

      <div class="bg-eve-card rounded-lg p-6 space-y-4">
        <h3 class="text-xl font-semibold text-eve-accent mb-4">Time Filter</h3>

        <div class="flex items-center space-x-4">
          <label class="flex items-center space-x-2">
            <input
              type="checkbox"
              class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
              bind:checked={localSettings.time_threshold_enabled}
              on:change={() =>
                updateSetting(
                  "time_threshold_enabled",
                  localSettings.time_threshold_enabled
                )}
            />
            <span>Enable Time Filter</span>
          </label>

          {#if localSettings.time_threshold_enabled}
            <input
              type="number"
              class="bg-black/20 text-gray-200 rounded px-3 py-2 w-32 border border-eve-accent/20 focus:border-eve-accent/50 focus:outline-none"
              bind:value={localSettings.time_threshold}
              on:input={() =>
                updateSetting("time_threshold", localSettings.time_threshold)}
              placeholder="Seconds"
            />
          {/if}
        </div>
      </div>

      <div class="bg-eve-card rounded-lg p-6 space-y-4">
        <h3 class="text-xl font-semibold text-eve-accent mb-4">
          Triangulation Settings
        </h3>

        <div class="space-y-3">
          <label class="flex items-center space-x-2">
            <input
              type="checkbox"
              class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
              bind:checked={localSettings.triangulation_filter_enabled}
              on:change={() =>
                updateSetting(
                  "triangulation_filter_enabled",
                  localSettings.triangulation_filter_enabled
                )}
            />
            <span>Enable Triangulation Filter</span>
          </label>

          {#if localSettings.triangulation_filter_enabled}
            <div class="ml-6 space-y-2">
              <label class="flex items-center space-x-2">
                <input
                  type="checkbox"
                  class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
                  bind:checked={localSettings.triangulation_filter_exclude}
                  on:change={() =>
                    updateSetting(
                      "triangulation_filter_exclude",
                      localSettings.triangulation_filter_exclude
                    )}
                />
                <span>Exclude Triangulatable Kills</span>
              </label>

              <label class="flex items-center space-x-2">
                <input
                  type="checkbox"
                  class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
                  bind:checked={localSettings.triangulation_filter_near_stargate}
                  on:change={() =>
                    updateSetting(
                      "triangulation_filter_near_stargate",
                      localSettings.triangulation_filter_near_stargate
                    )}
                />
                <span>Exclude Near-Stargate Kills</span>
              </label>

              <label class="flex items-center space-x-2">
                <input
                  type="checkbox"
                  class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
                  bind:checked={localSettings.triangulation_filter_near_celestial}
                  on:change={() =>
                    updateSetting(
                      "triangulation_filter_near_celestial",
                      localSettings.triangulation_filter_near_celestial
                    )}
                />
                <span>Exclude Near-Celestial Kills</span>
              </label>
            </div>
          {/if}
        </div>
      </div>

      <div class="bg-eve-card rounded-lg p-6 space-y-6">
        <div class="space-y-4">
          <h3 class="text-xl font-semibold text-eve-accent">
            Attacker Filters
          </h3>

          <div class="space-y-3">
            <label class="flex items-center space-x-2">
              <input
                type="checkbox"
                class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
                bind:checked={localSettings.attacker_alliance_filter_enabled}
                on:change={() =>
                  updateSetting(
                    "attacker_alliance_filter_enabled",
                    localSettings.attacker_alliance_filter_enabled
                  )}
              />
              <span>Alliance Filter</span>
            </label>

            {#if localSettings.attacker_alliance_filter_enabled}
              <input
                type="text"
                class="bg-black/20 text-gray-200 rounded px-3 py-2 w-full border border-eve-accent/20 focus:border-eve-accent/50 focus:outline-none"
                bind:value={localSettings.attacker_alliance_filter}
                on:input={() =>
                  updateSetting(
                    "attacker_alliance_filter",
                    localSettings.attacker_alliance_filter
                  )}
                placeholder="Alliance ID"
              />
            {/if}

            <label class="flex items-center space-x-2">
              <input
                type="checkbox"
                class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
                bind:checked={localSettings.attacker_corporation_filter_enabled}
                on:change={() =>
                  updateSetting(
                    "attacker_corporation_filter_enabled",
                    localSettings.attacker_corporation_filter_enabled
                  )}
              />
              <span>Corporation Filter</span>
            </label>

            {#if localSettings.attacker_corporation_filter_enabled}
              <input
                type="text"
                class="bg-black/20 text-gray-200 rounded px-3 py-2 w-full border border-eve-accent/20 focus:border-eve-accent/50 focus:outline-none"
                bind:value={localSettings.attacker_corporation_filter}
                on:input={() =>
                  updateSetting(
                    "attacker_corporation_filter",
                    localSettings.attacker_corporation_filter
                  )}
                placeholder="Corporation ID"
              />
            {/if}

            <label class="flex items-center space-x-2">
              <input
                type="checkbox"
                class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
                bind:checked={localSettings.attacker_ship_type_filter_enabled}
                on:change={() =>
                  updateSetting(
                    "attacker_ship_type_filter_enabled",
                    localSettings.attacker_ship_type_filter_enabled
                  )}
              />
              <span>Ship Type Filter</span>
            </label>

            {#if localSettings.attacker_ship_type_filter_enabled}
              <input
                type="text"
                class="bg-black/20 text-gray-200 rounded px-3 py-2 w-full border border-eve-accent/20 focus:border-eve-accent/50 focus:outline-none"
                bind:value={localSettings.attacker_ship_type_filter}
                on:input={() =>
                  updateSetting(
                    "attacker_ship_type_filter",
                    localSettings.attacker_ship_type_filter
                  )}
                placeholder="Ship Type ID"
              />
            {/if}

            <label class="flex items-center space-x-2">
              <input
                type="checkbox"
                class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
                bind:checked={localSettings.attacker_capital_filter_enabled}
                on:change={() =>
                  updateSetting(
                    "attacker_capital_filter_enabled",
                    localSettings.attacker_capital_filter_enabled
                  )}
              />
              <span>Show Only Kills with Capital Ship Attackers</span>
            </label>
          </div>
        </div>

        <div class="space-y-4">
          <h3 class="text-xl font-semibold text-eve-accent">Victim Filters</h3>

          <div class="space-y-3">
            <label class="flex items-center space-x-2">
              <input
                type="checkbox"
                class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
                bind:checked={localSettings.victim_alliance_filter_enabled}
                on:change={() =>
                  updateSetting(
                    "victim_alliance_filter_enabled",
                    localSettings.victim_alliance_filter_enabled
                  )}
              />
              <span>Alliance Filter</span>
            </label>

            {#if localSettings.victim_alliance_filter_enabled}
              <input
                type="text"
                class="bg-black/20 text-gray-200 rounded px-3 py-2 w-full border border-eve-accent/20 focus:border-eve-accent/50 focus:outline-none"
                bind:value={localSettings.victim_alliance_filter}
                on:input={() =>
                  updateSetting(
                    "victim_alliance_filter",
                    localSettings.victim_alliance_filter
                  )}
                placeholder="Alliance ID"
              />
            {/if}

            <label class="flex items-center space-x-2">
              <input
                type="checkbox"
                class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
                bind:checked={localSettings.victim_corporation_filter_enabled}
                on:change={() =>
                  updateSetting(
                    "victim_corporation_filter_enabled",
                    localSettings.victim_corporation_filter_enabled
                  )}
              />
              <span>Corporation Filter</span>
            </label>

            {#if localSettings.victim_corporation_filter_enabled}
              <input
                type="text"
                class="bg-black/20 text-gray-200 rounded px-3 py-2 w-full border border-eve-accent/20 focus:border-eve-accent/50 focus:outline-none"
                bind:value={localSettings.victim_corporation_filter}
                on:input={() =>
                  updateSetting(
                    "victim_corporation_filter",
                    localSettings.victim_corporation_filter
                  )}
                placeholder="Corporation ID"
              />
            {/if}
          </div>
        </div>
      </div>

      <div class="bg-eve-card rounded-lg p-6 space-y-6">
        <div class="space-y-4">
          <h3 class="text-xl font-semibold text-eve-accent">
            Location Filters
          </h3>

          <div class="space-y-3">
            <label class="flex items-center space-x-2">
              <input
                type="checkbox"
                class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
                bind:checked={localSettings.location_type_filter_enabled}
                on:change={() =>
                  updateSetting(
                    "location_type_filter_enabled",
                    localSettings.location_type_filter_enabled
                  )}
              />
              <span>Enable Location Type Filter</span>
            </label>

            {#if localSettings.location_type_filter_enabled}
              <div class="ml-6 grid grid-cols-2 gap-3">
                {#each Object.entries(localSettings.location_types) as [type, enabled]}
                  <label class="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
                      bind:checked={localSettings.location_types[type]}
                      on:change={() =>
                        updateSetting(
                          "location_types",
                          localSettings.location_types
                        )}
                    />
                    <span class="capitalize">{type}</span>
                  </label>
                {/each}
              </div>
            {/if}
          </div>

          <div class="space-y-3">
            <label class="flex items-center space-x-2">
              <input
                type="checkbox"
                class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
                bind:checked={localSettings.solar_system_filter_enabled}
                on:change={() =>
                  updateSetting(
                    "solar_system_filter_enabled",
                    localSettings.solar_system_filter_enabled
                  )}
              />
              <span>Solar System Filter</span>
            </label>

            {#if localSettings.solar_system_filter_enabled}
              <input
                type="text"
                class="bg-black/20 text-gray-200 rounded px-3 py-2 w-full border border-eve-accent/20 focus:border-eve-accent/50 focus:outline-none"
                bind:value={localSettings.solar_system_filter}
                on:input={() =>
                  updateSetting(
                    "solar_system_filter",
                    localSettings.solar_system_filter
                  )}
                placeholder="Solar System ID"
              />
            {/if}
          </div>

          <div class="space-y-3">
            <label class="flex items-center space-x-2">
              <input
                type="checkbox"
                class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
                bind:checked={localSettings.location_filter_enabled}
                on:change={() =>
                  updateSetting(
                    "location_filter_enabled",
                    localSettings.location_filter_enabled
                  )}
              />
              <span>Location ID Filter</span>
            </label>

            {#if localSettings.location_filter_enabled}
              <input
                type="text"
                class="bg-black/20 text-gray-200 rounded px-3 py-2 w-full border border-eve-accent/20 focus:border-eve-accent/50 focus:outline-none"
                bind:value={localSettings.location_filter}
                on:input={() =>
                  updateSetting(
                    "location_filter",
                    localSettings.location_filter
                  )}
                placeholder="Location ID"
              />
            {/if}
          </div>
        </div>

        <div class="space-y-4">
          <h3 class="text-xl font-semibold text-eve-accent">Ship Filters</h3>

          <div class="space-y-3">
            <label class="flex items-center space-x-2">
              <input
                type="checkbox"
                class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
                bind:checked={localSettings.capitals_only}
                on:change={() =>
                  updateSetting("capitals_only", localSettings.capitals_only)}
              />
              <span>Capitals Only</span>
            </label>

            <label class="flex items-center space-x-2">
              <input
                type="checkbox"
                class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
                bind:checked={localSettings.ship_type_filter_enabled}
                on:change={() =>
                  updateSetting(
                    "ship_type_filter_enabled",
                    localSettings.ship_type_filter_enabled
                  )}
              />
              <span>Ship Type Filter</span>
            </label>

            {#if localSettings.ship_type_filter_enabled}
              <input
                type="text"
                class="bg-black/20 text-gray-200 rounded px-3 py-2 w-full border border-eve-accent/20 focus:border-eve-accent/50 focus:outline-none"
                bind:value={localSettings.ship_type_filter}
                on:input={() =>
                  updateSetting(
                    "ship_type_filter",
                    localSettings.ship_type_filter
                  )}
                placeholder="Ship Type ID"
              />
            {/if}
          </div>
        </div>
        <div class="space-y-4">
          <h3 class="text-xl font-semibold text-eve-accent">Item Filters</h3>

          <div class="space-y-3">
            <label class="flex items-center space-x-2">
              <input
                type="checkbox"
                class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
                bind:checked={localSettings.item_type_filter_enabled}
                on:change={() =>
                  updateSetting(
                    "item_type_filter_enabled",
                    localSettings.item_type_filter_enabled
                  )}
              />
              <span>Enable Item Type Filter</span>
            </label>

            {#if localSettings.item_type_filter_enabled}
              <input
                type="text"
                class="bg-black/20 text-gray-200 rounded px-3 py-2 w-full border border-eve-accent/20 focus:border-eve-accent/50 focus:outline-none"
                bind:value={localSettings.item_type_filter}
                on:input={() =>
                  updateSetting(
                    "item_type_filter",
                    localSettings.item_type_filter
                  )}
                placeholder="Item Type ID"
              />
            {/if}
          </div>
        </div>
      </div>

      <div class="bg-eve-card rounded-lg p-6 space-y-4">
        <h3 class="text-xl font-semibold text-eve-accent mb-4">
          Combat Labels
        </h3>

        <label class="flex items-center space-x-2">
          <input
            type="checkbox"
            class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
            bind:checked={localSettings.combat_label_filter_enabled}
            on:change={() =>
              updateSetting(
                "combat_label_filter_enabled",
                localSettings.combat_label_filter_enabled
              )}
          />
          <span>Enable Combat Label Filter</span>
        </label>

        {#if localSettings.combat_label_filter_enabled}
          <div class="ml-6 grid grid-cols-3 gap-3">
            {#each Object.entries(localSettings.combat_labels) as [label, enabled]}
              <label class="flex items-center space-x-2">
                <input
                  type="checkbox"
                  class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
                  bind:checked={localSettings.combat_labels[label]}
                  on:change={() =>
                    updateSetting("combat_labels", localSettings.combat_labels)}
                />
                <span class="capitalize">{label}</span>
              </label>
            {/each}
          </div>
        {/if}
      </div>

      <div class="bg-eve-card rounded-lg p-6 space-y-4">
        <h3 class="text-xl font-semibold text-eve-accent mb-4">
          Discord Webhook
        </h3>

        <label class="flex items-center space-x-2">
          <input
            type="checkbox"
            class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
            bind:checked={localSettings.webhook_enabled}
            on:change={() =>
              updateSetting("webhook_enabled", localSettings.webhook_enabled)}
          />
          <span>Enable Discord Webhook Alerts</span>
        </label>

        {#if localSettings.webhook_enabled}
          <input
            type="text"
            class="bg-black/20 text-gray-200 rounded px-3 py-2 w-full border border-eve-accent/20 focus:border-eve-accent/50 focus:outline-none"
            bind:value={localSettings.webhook_url}
            on:input={() =>
              updateSetting("webhook_url", localSettings.webhook_url)}
            placeholder="https://discord.com/api/webhooks/..."
          />
        {/if}
      </div>
      <div class="bg-eve-card rounded-lg p-6 space-y-4">
        <h3 class="text-xl font-semibold text-eve-accent mb-4">Audio Alerts</h3>

        <label class="flex items-center space-x-2">
          <input
            type="checkbox"
            class="form-checkbox text-eve-accent rounded bg-eve-secondary border-eve-accent/50"
            bind:checked={localSettings.audio_alerts_enabled}
            on:change={() =>
              updateSetting(
                "audio_alerts_enabled",
                localSettings.audio_alerts_enabled
              )}
          />
          <span>Enable Audio Alerts</span>
        </label>
      </div>

      <div class="bg-eve-card rounded-lg p-6">
        <FilterListManager />
      </div>
    {/if}
  </div>
</div>

<style>
  .settings-manager {
    margin-top: 20px;
    text-align: left;
  }
</style>
