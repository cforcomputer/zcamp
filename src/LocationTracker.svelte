<script>
  import { currentLocation, locationError } from "./locationStore";
  import { activeCamps } from "./campManager.js";
  import { onMount, onDestroy } from "svelte";

  export let isTracking;

  let selectedVoice = null;
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

    const warnings = [];

    // Check current system camps
    const currentSystemCamps = camps.filter(
      (camp) => camp.systemId === $currentLocation.solar_system_id
    );

    if (currentSystemCamps.length > 0) {
      const highProbCamps = currentSystemCamps.filter(
        (camp) => camp.probability >= 50
      );
      if (highProbCamps.length > 0) {
        warnings.push(
          `⚠️ Active camps in current system at: ${highProbCamps
            .map(
              (camp) =>
                `${camp.stargateName} (${Math.round(camp.probability)}% confidence)`
            )
            .join(", ")}`
        );
      }
    }

    // Check camps in connected systems and their neighbors
    const connectedSystemWarnings = [];

    $currentLocation.connected_systems.forEach((connectedSystem) => {
      const warnings = [];

      // Find the gate in current system that leads to this connected system
      const gateToSystem = $currentLocation.celestialData.find(
        (cel) =>
          cel.typename?.toLowerCase().includes("stargate") &&
          cel.itemname
            .toLowerCase()
            .includes(connectedSystem.name.toLowerCase())
      );
      const gateName =
        gateToSystem?.itemname || `Gate to ${connectedSystem.name}`;

      // Check camps in the directly connected system
      const directCamps = camps
        .filter((camp) => camp.systemId === connectedSystem.id)
        .filter((camp) => camp.probability >= 50);

      if (directCamps.length > 0) {
        warnings.push(
          `${directCamps.length} camp${directCamps.length > 1 ? "s" : ""} at ${directCamps
            .map(
              (camp) =>
                `${camp.stargateName} (${Math.round(camp.probability)}% confidence)`
            )
            .join(", ")}`
        );
      }

      // Check for camps in systems that are one jump further
      const neighboringCamps = camps.filter(
        (camp) =>
          // Get camps that aren't in our current system or the connected system
          camp.systemId !== $currentLocation.solar_system_id &&
          camp.systemId !== connectedSystem.id &&
          camp.probability >= 50 &&
          // Only include camps where the gate name mentions either our connected system
          // or the current system (indicating it's one jump away)
          (camp.stargateName
            .toLowerCase()
            .includes(connectedSystem.name.toLowerCase()) ||
            camp.stargateName
              .toLowerCase()
              .includes($currentLocation.systemName.toLowerCase()))
      );

      if (neighboringCamps.length > 0) {
        warnings.push(
          `${neighboringCamps.length} camp${neighboringCamps.length > 1 ? "s" : ""} in neighboring systems: ${neighboringCamps
            .map(
              (camp) =>
                `${camp.stargateName} in ${camp.kills[0]?.pinpoints?.celestialData?.solarsystemname || "Unknown"} (${Math.round(camp.probability)}% confidence)`
            )
            .join(", ")}`
        );
      }

      if (warnings.length > 0) {
        connectedSystemWarnings.push(`⚠️ ${gateName}: ${warnings.join("; ")}`);
      }
    });

    if (connectedSystemWarnings.length > 0) {
      warnings.push(...connectedSystemWarnings);
    }

    return warnings.length > 0
      ? warnings.join("\n")
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
    window.speechSynthesis.cancel();
  });
</script>

<div class="tracking-info" class:error={$locationError}>
  {#if $currentLocation}
    <div class="flex items-center gap-4">
      <div class="system-info">
        <span class="system-name">{$currentLocation.systemName}</span>
        <span class="region-name">({$currentLocation.regionName})</span>
      </div>
      <div class="camp-status">
        {getCampSummary(camps)}
      </div>
    </div>
  {/if}

  {#if $locationError}
    <span class="error-message">{$locationError}</span>
  {/if}
</div>

<style>
  .tracking-info {
    width: 100%;
    color: white;
  }

  .system-info {
    display: flex;
    gap: 1rem;
    align-items: center;
  }

  .system-name {
    color: #ffd700;
    font-weight: 500;
  }

  .region-name {
    color: #aaa;
  }

  .camp-status {
    flex: 1;
  }

  .error-message {
    color: #ff4444;
  }

  .tracking-info.error {
    color: #ff4444;
  }
</style>
