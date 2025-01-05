<script>
  import { createEventDispatcher } from "svelte";

  export let profiles = [];
  export let selectedProfile = null;

  const dispatch = createEventDispatcher();

  let newProfileName = "";

  function saveProfile() {
    if (newProfileName) {
      dispatch("saveProfile", { name: newProfileName });
      newProfileName = ""; // Clear the input after saving
    }
  }

  function loadProfile() {
    if (selectedProfile) {
      dispatch("loadProfile", selectedProfile);
    }
  }

  function deleteProfile() {
    if (selectedProfile) {
      dispatch("deleteProfile", { id: selectedProfile });
      selectedProfile = null;
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
      {#each profiles as profile (profile.id)}
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
