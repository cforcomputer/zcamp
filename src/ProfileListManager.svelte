<script>
  import { createEventDispatcher, afterUpdate } from "svelte";
  import { profiles as profilesStore } from "./store.js";

  const dispatch = createEventDispatcher();

  export let profiles = [];
  export let selectedProfile = null;

  let newProfileName = "";

  $: {
    console.log("ProfileListManager.svelte - profiles updated:", profiles);
  }

  afterUpdate(() => {
    console.log("ProfileListManager.svelte - afterUpdate. Profiles:", profiles);
  });

  function saveProfile() {
    if (newProfileName) {
      dispatch("saveProfile", { name: newProfileName });
      newProfileName = ""; // Clear the input after saving
    } else {
      console.log("No profile name provided");
    }
  }

  function loadProfile() {
    if (selectedProfile) {
      dispatch("loadProfile", selectedProfile);
    }
  }

  function deleteProfile() {
    if (selectedProfile) {
      console.log("ProfileListManager: Deleting profile:", selectedProfile);
      dispatch("deleteProfile", { id: selectedProfile });
      selectedProfile = null; // Reset selection after delete
    } else {
      console.log("ProfileListManager: No profile selected for deletion");
    }
  }

  function handleDropdownClick() {
    dispatch("fetchProfiles");
  }
</script>

<div class="profile-list-manager">
  <h2>Profiles</h2>
  <div class="profile-controls">
    <select bind:value={selectedProfile} on:click={handleDropdownClick}>
      <option value={null}>Select a profile</option>
      {#each profiles || [] as profile (profile.id)}
        <option value={profile.id}>{profile.name}</option>
      {/each}
    </select>
    <button on:click={loadProfile}>Load</button>
    <button on:click={deleteProfile}>Delete</button>
  </div>
  <div class="new-profile">
    <input bind:value={newProfileName} placeholder="New profile name" />
    <button on:click={saveProfile}>Save New Profile</button>
  </div>
</div>

<style>
  .profile-list-manager {
    margin-top: 20px;
    padding: 15px;
    border: 1px solid #ddd;
    border-radius: 5px;
  }

  .profile-controls {
    display: flex;
    gap: 10px;
    margin-bottom: 10px;
  }

  .profile-controls select {
    flex-grow: 1;
  }

  .new-profile {
    display: flex;
    gap: 10px;
  }

  .new-profile input {
    flex-grow: 1;
  }
</style>
