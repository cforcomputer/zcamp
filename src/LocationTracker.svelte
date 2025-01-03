<script>
  import {
    startLocationPolling,
    stopLocationPolling,
    currentLocation,
    locationError,
  } from "./locationStore";
  import { onMount, onDestroy } from "svelte";

  let selectedVoice = null;
  let isTracking = false;
  let trackedCharacter = null;
  let lastSystemId = null;

  function initializeVoice() {
    window.speechSynthesis.onvoiceschanged = () => {
      const voices = window.speechSynthesis.getVoices();
      selectedVoice =
        voices.find((voice) => voice.name.includes("Microsoft Hazel")) ||
        voices.find((voice) => voice.lang.includes("en-GB"));
    };
  }

  function speak(text) {
    if (!window.speechSynthesis) {
      console.error("Speech synthesis not supported");
      return;
    }

    const msg = new SpeechSynthesisUtterance(text);
    if (selectedVoice) {
      msg.voice = selectedVoice;
      msg.rate = 0.9;
      msg.pitch = 1.1;
    }
    window.speechSynthesis.cancel(); // Cancel any ongoing speech
    window.speechSynthesis.speak(msg);
  }
  function getCampSummary(camps) {
    if (!camps) return "No camp data available";

    if (camps.current.length > 0) {
      return `Warning! Active camps in your current system at: ${camps.current.map((c) => c.stargateName).join(", ")}`;
    }

    if (camps.connected.length > 0) {
      const connectedCampInfo = camps.connected
        .map((camp) => {
          const systemName =
            camp.kills[0]?.pinpoints?.celestialData?.solarsystemname;
          const gateName =
            camp.stargateName.match(/\(([^)]+)\)/)?.[1] || camp.stargateName;
          return systemName
            ? `${systemName} (${gateName} gate, ${Math.round(camp.probability)}% confidence)`
            : null;
        })
        .filter(Boolean);
      return `Warning! Active camps in connected systems: ${connectedCampInfo.join(", ")}`;
    }

    return "There are no active camps in your current system or direct system connections. Cleared to jump.";
  }

  // Subscribe to location changes
  $: if ($currentLocation && isTracking) {
    if (lastSystemId !== $currentLocation.solar_system_id) {
      speak(
        `System change. Your current system is ${$currentLocation.systemName}. ${getCampSummary($currentLocation.camps)}`
      );
      lastSystemId = $currentLocation.solar_system_id;
    }
  }

  onMount(() => {
    initializeVoice();
  });

  async function toggleTracking() {
    try {
      if (!isTracking) {
        const started = await startLocationPolling();
        if (started) {
          isTracking = true;
          const userData = JSON.parse(sessionStorage.getItem("user"));
          trackedCharacter = userData?.character_name;

          // Force a camp check regardless of current location
          if ($currentLocation) {
            const campSummary = getCampSummary($currentLocation.camps);
            speak(
              `Tracking enabled for: ${trackedCharacter}. Your current system is ${$currentLocation.systemName}. ${campSummary}`
            );
            // Reset lastSystemId to ensure we check camps on next system change
            lastSystemId = null;
          }
        }
      } else {
        stopLocationPolling();
        isTracking = false;
        trackedCharacter = null;
        lastSystemId = null;
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
      <p class="system-name">Current System: {$currentLocation.systemName}</p>
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

  .system-name {
    font-size: 1.1em;
    font-weight: 500;
    color: #ffd700;
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

  .error {
    color: #ff4444;
    margin: 0;
  }

  .label-text {
    color: white;
    user-select: none;
  }
</style>
