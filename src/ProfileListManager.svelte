<!-- ProfileListManager.svelte -->
<!-- Needs to be fixed to not load profiles from every user-->
<!-- switched to sockets to update state-->
<script>
  import { createEventDispatcher } from "svelte";
  import { settings, filterLists, profiles } from "./settingsStore";
  import socket from "./socket.js";
  import { onMount } from "svelte";

  export let selectedProfile = null;

  const dispatch = createEventDispatcher();

  let newProfileName = "";

  $: localProfiles = $profiles;
  $: console.log("Local profiles updated:", localProfiles);

  async function saveProfile() {
    if (!newProfileName) return;

    const profileData = {
      name: newProfileName,
      settings: $settings,
      filterLists: $filterLists.map((list) => ({
        ...list,
        id: list.id.toString(),
      })),
    };

    console.log("Saving profile:", profileData);
    socket.emit("saveProfile", profileData);
    newProfileName = ""; // Clear input
  }

  function loadProfile() {
    if (!selectedProfile) return;
    console.log("Loading profile:", selectedProfile);
    socket.emit("loadProfile", selectedProfile);
  }

  function deleteProfile() {
    if (!selectedProfile) return;
    console.log("Deleting profile:", selectedProfile);
    socket.emit("deleteProfile", { id: selectedProfile });
  }

  function handleDropdownClick() {
    console.log("Fetching profiles...");
    socket.emit("fetchProfiles");
  }

  onMount(() => {
    // Initial profiles fetch
    socket.emit("fetchProfiles");

    // Socket event listeners
    socket.on("profilesFetched", (fetchedProfiles) => {
      console.log("Received profiles:", fetchedProfiles);
      profiles.set(fetchedProfiles);
    });

    socket.on("profileSaved", (profile) => {
      console.log("Profile saved:", profile);
      profiles.update((currentProfiles) => {
        const existingIndex = currentProfiles.findIndex(
          (p) => p.id === profile.id
        );
        if (existingIndex !== -1) {
          // Update existing profile
          const updatedProfiles = [...currentProfiles];
          updatedProfiles[existingIndex] = profile;
          return updatedProfiles;
        }
        // Add new profile
        return [...currentProfiles, profile];
      });
    });

    socket.on("profileLoaded", (profileData) => {
      console.log("Profile loaded:", profileData);
      if (profileData.settings) {
        settings.set(profileData.settings);
      }
      if (profileData.filterLists) {
        filterLists.set(profileData.filterLists);
      }
    });

    socket.on("profileDeleted", (id) => {
      console.log("Profile deleted:", id);
      profiles.update((currentProfiles) =>
        currentProfiles.filter((profile) => profile.id !== id)
      );
      if (selectedProfile === id) {
        selectedProfile = null;
      }
    });

    return () => {
      socket.off("profilesFetched");
      socket.off("profileSaved");
      socket.off("profileLoaded");
      socket.off("profileDeleted");
    };
  });
</script>

<div class="bg-eve-dark/95 rounded-lg p-6 space-y-6">
  <h2 class="text-2xl font-bold text-eve-accent mb-4">Profile Manager</h2>

  <div class="space-y-4">
    <!-- Profile Selection Controls -->
    <div class="flex flex-col space-y-3">
      <select
        bind:value={selectedProfile}
        on:click={handleDropdownClick}
        class="bg-eve-secondary text-gray-200 rounded px-4 py-2 border border-eve-accent/20 focus:border-eve-accent focus:ring-1 focus:ring-eve-accent outline-none"
      >
        <option value={null}>Select a profile</option>
        {#each localProfiles as profile (profile.id)}
          <option value={profile.id}>{profile.name}</option>
        {/each}
      </select>

      <div class="flex space-x-2">
        <button
          on:click={loadProfile}
          class="flex-1 bg-eve-accent/20 hover:bg-eve-accent/30 text-eve-accent px-4 py-2 rounded transition-colors duration-200"
        >
          Load
        </button>
        <button
          on:click={deleteProfile}
          class="flex-1 bg-eve-danger/20 hover:bg-eve-danger/30 text-eve-danger px-4 py-2 rounded transition-colors duration-200"
        >
          Delete
        </button>
      </div>
    </div>

    <!-- New Profile Creation -->
    <div class="border-t border-eve-accent/20 pt-4 space-y-3">
      <h3 class="text-lg font-semibold text-eve-accent">Create New Profile</h3>
      <div class="flex space-x-2">
        <input
          bind:value={newProfileName}
          placeholder="New profile name"
          class="flex-grow bg-eve-secondary text-gray-200 rounded px-4 py-2 border border-eve-accent/20 focus:border-eve-accent focus:ring-1 focus:ring-eve-accent outline-none"
        />
        <button
          on:click={saveProfile}
          class="bg-eve-accent/20 hover:bg-eve-accent/30 text-eve-accent px-6 py-2 rounded transition-colors duration-200 whitespace-nowrap"
        >
          Save New Profile
        </button>
      </div>
    </div>
  </div>
</div>
