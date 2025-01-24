<!-- LocationTracker.svelte -->
<script>
  import {
    startLocationPolling,
    stopLocationPolling,
    currentLocation,
    locationError,
  } from "./locationStore";
  import { onMount, onDestroy } from "svelte";
  import campManager from "./campManager";

  let selectedVoice = null;
  let isTracking = false;
  let trackedCharacter = null;
  let lastSystemId = null;
  let lastCampWarning = {};
  let speechQueue = [];
  let isSpeaking = false;

  function initializeVoice() {
    window.speechSynthesis.onvoiceschanged = () => {
      const voices = window.speechSynthesis.getVoices();
      selectedVoice =
        voices.find((voice) => voice.name.includes("Microsoft Hazel")) ||
        voices.find((voice) => voice.lang.includes("en-GB"));
    };
  }

  function processNextSpeechItem() {
    if (speechQueue.length > 0 && !isSpeaking) {
      isSpeaking = true;
      const text = speechQueue.shift();
      speak(text, () => {
        isSpeaking = false;
        processNextSpeechItem();
      });
    }
  }

  function queueSpeech(text) {
    speechQueue.push(text);
    processNextSpeechItem();
  }

  function speak(text, callback) {
    if (!window.speechSynthesis) {
      console.error("Speech synthesis not supported");
      if (callback) callback();
      return;
    }

    const msg = new SpeechSynthesisUtterance(text);
    if (selectedVoice) {
      msg.voice = selectedVoice;
      msg.rate = 0.9;
      msg.pitch = 1.1;
    }

    msg.onend = () => {
      if (callback) callback();
    };

    msg.onerror = () => {
      console.error("Speech synthesis error");
      if (callback) callback();
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(msg);
  }

  function getCampSummary(camps) {
    if (!camps) return "No camp data available";

    const { current, connected } = camps;
    const warnings = [];

    // Check current system camps
    if (current && current.length > 0) {
      const highProbCamps = current.filter((camp) => camp.probability >= 50);
      if (highProbCamps.length > 0) {
        const campLocations = highProbCamps.map(
          (camp) =>
            `${camp.stargateName} gate (${Math.round(camp.probability)}% confidence)`
        );
        warnings.push(`⚠️ Active camps at: ${campLocations.join(", ")}`);
      }
    }

    // Check connected system camps
    if (connected && connected.length > 0) {
      const highProbConnected = connected.filter(
        (camp) => camp.probability >= 50
      );
      if (highProbConnected.length > 0) {
        const connectedWarnings = highProbConnected.map((camp) => {
          const system = $currentLocation.connected_systems.find(
            (sys) => sys.id === camp.systemId
          );
          return `${system?.name || "Unknown"} system at ${camp.stargateName} gate (${Math.round(camp.probability)}% confidence)`;
        });
        warnings.push(
          `⚠️ Camps in connected systems: ${connectedWarnings.join(", ")}`
        );
      }
    }

    return warnings.length > 0
      ? warnings.join(". ")
      : "✓ No active camps detected";
  }

  // Subscribe to location changes
  $: if ($currentLocation && isTracking) {
    if (lastSystemId !== $currentLocation.solar_system_id) {
      const campSummary = getCampSummary($currentLocation.camps);
      const announcement = `System change. Your current system is ${$currentLocation.systemName} in ${$currentLocation.regionName}. ${campSummary}`;

      queueSpeech(announcement);
      lastSystemId = $currentLocation.solar_system_id;
      lastCampWarning = {
        systemId: $currentLocation.solar_system_id,
        timestamp: Date.now(),
        campIds: new Set($currentLocation.camps.current.map((c) => c.id)),
      };
    } else {
      // Check for new camps in current system
      const currentCampIds = new Set(
        $currentLocation.camps.current.map((c) => c.id)
      );
      const newCamps = Array.from(currentCampIds).filter(
        (id) => !lastCampWarning.campIds.has(id)
      );

      if (newCamps.length > 0) {
        const newCampSummary = getCampSummary({
          current: $currentLocation.camps.current.filter((c) =>
            newCamps.includes(c.id)
          ),
          connected: [],
        });
        queueSpeech(`New camp alert! ${newCampSummary}`);
        lastCampWarning.campIds = currentCampIds;
      }
    }
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
            const campSummary = getCampSummary($currentLocation.camps);
            queueSpeech(
              `Tracking enabled for ${trackedCharacter}. Your current system is ${$currentLocation.systemName}. ${campSummary}`
            );
            lastSystemId = null;
          }
        }
      } else {
        stopLocationPolling();
        isTracking = false;
        trackedCharacter = null;
        lastSystemId = null;
        lastCampWarning = {};
        speechQueue = [];
        window.speechSynthesis.cancel();
      }
    } catch (err) {
      console.error("Error toggling tracking:", err);
    }
  }

  onMount(() => {
    initializeVoice();
  });

  onDestroy(() => {
    if (isTracking) {
      stopLocationPolling();
    }
    window.speechSynthesis.cancel();
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
        <span class="region-name">({$currentLocation.regionName})</span>
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

  .region-name {
    color: #aaa;
    font-size: 0.9em;
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
