<script>
  import {
    startLocationPolling,
    stopLocationPolling,
    currentLocation,
    locationError,
  } from "./locationStore";
  import { onMount, onDestroy } from "svelte";

  let isTracking = false;
  let trackedCharacter = null;

  function getCampSummary(camps) {
    if (!camps) return "No camp data available";

    if (camps.current.length > 0) {
      return `Warning! Active camps in your current system at: ${camps.current.map((c) => c.stargateName).join(", ")}`;
    }

    if (camps.connected.length > 0) {
      return `Warning! Active camps in connected systems: ${camps.connected
        .map(
          (c) =>
            `${c.kills[0]?.pinpoints?.celestialData?.solarsystemname} at ${c.stargateName}`
        )
        .join(", ")}`;
    }

    return "There are no active camps in your current system or direct system connections. Cleared to jump.";
  }

  async function toggleTracking() {
    try {
      if (!isTracking) {
        const started = await startLocationPolling();
        if (started) {
          isTracking = true;
          const userData = JSON.parse(sessionStorage.getItem("user"));
          trackedCharacter = userData?.character_name;

          if ($currentLocation) {
            const msg = new SpeechSynthesisUtterance(
              `Tracking enabled for: ${trackedCharacter}. Your current system is ${$currentLocation.systemName}. ${getCampSummary($currentLocation.camps)}`
            );
            window.speechSynthesis.speak(msg);
          }
        }
      } else {
        stopLocationPolling();
        isTracking = false;
        trackedCharacter = null;
      }
    } catch (err) {
      console.error("Error toggling tracking:", err);
    }
  }

  onDestroy(() => {
    if (isTracking) {
      stopLocationPolling();
    }
  });
</script>

<div class="location-tracker">
  <div class="tracker-header">
    <label class="toggle">
      <input type="checkbox" checked={isTracking} on:change={toggleTracking} />
      <span class="slider" />
      <span class="label-text">Track Location</span>
    </label>
    <span class="tracking-status">
      {#if isTracking}
        Tracking: {trackedCharacter || "Active"}
      {:else}
        Tracking Disabled
      {/if}
    </span>
  </div>

  {#if $currentLocation}
    <div class="system-info">
      <p>Current System: {$currentLocation.systemName}</p>
      <p class="camp-status">{getCampSummary($currentLocation.camps)}</p>
    </div>
  {/if}

  {#if $locationError}
    <p class="error">{$locationError}</p>
  {/if}
</div>

<style>
  .location-tracker {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 4px;
  }

  .tracker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .toggle {
    position: relative;
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    gap: 0.5rem;
  }

  .toggle input {
    display: none;
  }

  .slider {
    position: relative;
    width: 40px;
    height: 20px;
    background: #444;
    border-radius: 20px;
    transition: 0.3s;
  }

  .slider:before {
    content: "";
    position: absolute;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    left: 2px;
    top: 2px;
    background: white;
    transition: 0.3s;
  }

  input:checked + .slider {
    background: #007bff;
  }

  input:checked + .slider:before {
    transform: translateX(20px);
  }

  .tracking-status {
    color: white;
    font-size: 0.9em;
  }

  .system-info {
    color: white;
    margin: 0;
  }

  .camp-status {
    color: #00ff00;
    margin: 0;
  }

  .camp-status:has(span:contains("Warning")) {
    color: #ff4444;
  }

  .error {
    color: #ff4444;
    margin: 0;
  }

  .label-text {
    color: white;
    user-select: none;
  }
</style>
