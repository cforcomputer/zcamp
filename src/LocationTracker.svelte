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
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(msg);
  }

  function getCampSummary(camps) {
    if (!camps) return "No camp data";

    if (camps.current.length > 0) {
      return `⚠️ Active camps at: ${camps.current.map((c) => c.stargateName).join(", ")}`;
    }

    if (camps.connected.length > 0) {
      const connectedCampInfo = camps.connected
        .map((camp) => {
          const systemName =
            camp.kills[0]?.pinpoints?.celestialData?.solarsystemname;
          const gateName =
            camp.stargateName.match(/\(([^)]+)\)/)?.[1] || camp.stargateName;
          return systemName
            ? `${systemName} (${gateName} gate, ${Math.round(camp.probability)}%)`
            : null;
        })
        .filter(Boolean);
      return `⚠️ Camps in connected systems: ${connectedCampInfo.join(", ")}`;
    }

    return "✓ No active camps";
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

          if ($currentLocation) {
            const campSummary = getCampSummary($currentLocation.camps);
            speak(
              `Tracking enabled for: ${trackedCharacter}. Your current system is ${$currentLocation.systemName}. ${campSummary}`
            );
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
  <div class="tracker-content">
    <label class="toggle">
      <input type="checkbox" checked={isTracking} on:change={toggleTracking} />
      <span class="slider" />
      <span class="label-text">Track</span>
    </label>

    {#if $currentLocation}
      <div class="system-info">
        <span class="system-name">{$currentLocation.systemName}</span>
        <span class="camp-status">{getCampSummary($currentLocation.camps)}</span
        >
      </div>
    {/if}

    {#if $locationError}
      <span class="error">{$locationError}</span>
    {/if}
  </div>
</div>

<style>
  .location-tracker {
    display: flex;
    align-items: center;
    padding: 0 1rem;
    height: 100%;
    background: transparent;
  }

  .tracker-content {
    display: flex;
    align-items: center;
    gap: 1rem;
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
    width: 32px;
    height: 16px;
    background: #444;
    border-radius: 20px;
    transition: 0.3s;
  }

  .slider:before {
    content: "";
    position: absolute;
    width: 12px;
    height: 12px;
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
    transform: translateX(16px);
  }

  .system-info {
    display: flex;
    align-items: center;
    gap: 1rem;
    color: white;
    font-size: 0.9em;
  }

  .system-name {
    color: #ffd700;
    font-weight: 500;
  }

  .camp-status {
    color: #fff;
  }

  .error {
    color: #ff4444;
    font-size: 0.8em;
  }

  .label-text {
    color: white;
    user-select: none;
    font-size: 0.9em;
  }
</style>
