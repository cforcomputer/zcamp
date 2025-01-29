<script>
  import {
    startLocationPolling,
    stopLocationPolling,
    currentLocation,
    locationError,
  } from "./locationStore";
  import { activeCamps } from "./campManager.js";
  import { onMount, onDestroy } from "svelte";
  import { get } from "svelte/store";

  let selectedVoice = null;
  let isTracking = false;
  let trackedCharacter = null;
  let lastSystemId = null;
  let lastCampWarning = {};
  let speechQueue = [];
  let isSpeaking = false;

  // Subscribe to activeCamps store
  $: camps = $activeCamps;

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
    if (!$currentLocation) return "No location data available";

    const currentSystemCamps = camps.filter(
      (camp) => camp.systemId === $currentLocation.solar_system_id
    );

    const connectedSystemCamps = camps.filter((camp) =>
      $currentLocation.connected_systems.some((sys) => sys.id === camp.systemId)
    );

    const warnings = [];

    // Check current system camps
    if (currentSystemCamps.length > 0) {
      const highProbCamps = currentSystemCamps.filter(
        (camp) => camp.probability >= 50
      );
      if (highProbCamps.length > 0) {
        warnings.push(
          `⚠️ Active camps at: ${highProbCamps
            .map(
              (camp) =>
                `${camp.stargateName} (${Math.round(camp.probability)}% confidence)`
            )
            .join(", ")}`
        );
      }
    }

    // Check connected system camps
    if (connectedSystemCamps.length > 0) {
      const highProbConnected = connectedSystemCamps.filter(
        (camp) => camp.probability >= 50
      );
      if (highProbConnected.length > 0) {
        warnings.push(
          `⚠️ Camps in connected systems: ${highProbConnected
            .map(
              (camp) =>
                `${$currentLocation.connected_systems.find((sys) => sys.id === camp.systemId)?.name || "Unknown"} system at ${camp.stargateName} (${Math.round(camp.probability)}% confidence)`
            )
            .join(", ")}`
        );
      }
    }

    return warnings.length > 0
      ? warnings.join(". ")
      : "✓ No active camps detected";
  }

  function stripSymbols(text) {
    // Remove emoji and other symbols commonly used in warnings
    return text.replace(/[⚠️✓]/g, "");
  }

  // Subscribe to location changes
  $: if ($currentLocation && isTracking) {
    if (lastSystemId !== $currentLocation.solar_system_id) {
      const campSummary = getCampSummary(camps);
      const announcement = `System change. Your current system is ${$currentLocation.systemName} in ${$currentLocation.regionName}. ${stripSymbols(campSummary)}`;

      queueSpeech(announcement);
      lastSystemId = $currentLocation.solar_system_id;
      lastCampWarning = {
        systemId: $currentLocation.solar_system_id,
        timestamp: Date.now(),
        campIds: new Set(
          camps
            .filter((c) => c.systemId === $currentLocation.solar_system_id)
            .map((c) => c.id)
        ),
      };
    } else {
      // Check for new camps in current system
      const currentCamps = camps.filter(
        (c) => c.systemId === $currentLocation.solar_system_id
      );
      const currentCampIds = new Set(currentCamps.map((c) => c.id));
      const newCamps = Array.from(currentCampIds).filter(
        (id) => !lastCampWarning.campIds.has(id)
      );

      if (newCamps.length > 0) {
        const newCampSummary = getCampSummary(
          currentCamps.filter((c) => newCamps.includes(c.id))
        );
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
          const sessionResponse = await fetch("/api/session", {
            credentials: "include",
          });
          const sessionData = await sessionResponse.json();
          trackedCharacter = sessionData.user?.character_name;

          // Only announce once when tracking starts
          if ($currentLocation) {
            const campSummary = getCampSummary(camps);
            queueSpeech(
              `Tracking enabled for ${trackedCharacter}. Your current system is ${$currentLocation.systemName}. ${stripSymbols(campSummary)}`
            );
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

  onMount(async () => {
    try {
      const response = await fetch("/api/session", {
        credentials: "include",
      });
      const data = await response.json();
      trackedCharacter = data.user?.character_name;
    } catch (error) {
      console.error("Error getting session data:", error);
    }

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
        <span class="camp-status">{getCampSummary(camps)}</span>
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
