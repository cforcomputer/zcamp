<script>
  import { currentLocation, locationError } from "./locationStore";
  import { activeActivities } from "./activityManager.js";
  import { settings } from "./settingsStore.js";
  import { onMount, onDestroy } from "svelte";
  import {
    startLocationPolling,
    stopLocationPolling,
  } from "./locationStore.js";
  // import audioManager from "./audioUtils.js"; // Not currently used

  // One-way prop from App.svelte
  export let isTracking = false; // Default to false

  let selectedVoice = null;
  let trackedCharacter = null;
  let lastSystemId = null;
  let lastCampWarning = {};
  let speechQueue = [];
  let isSpeaking = false;

  let currentActivities = [];
  const unsubActivities = activeActivities.subscribe((value) => {
    currentActivities = value || [];
  });

  $: audioEnabled = $settings.audio_alerts_enabled;
  // let mounted = false; // No longer needed for polling logic

  // Diagnostic Logs
  $: console.log("[LocationTracker UI] isTracking prop:", isTracking);
  $: console.log(
    "[LocationTracker UI] $currentLocation value:",
    $currentLocation
  );
  $: $currentLocation &&
    isTracking &&
    console.log(
      "[LocationTracker UI] Template #if condition PASSED (Attempting render)."
    );

  // Start/Stop polling based on the isTracking prop change
  // Svelte automatically handles running this when isTracking changes after mount
  $: if (isTracking) {
    console.log(
      "[LocationTracker] Detected isTracking=true, starting polling..."
    );
    startLocationPolling();
  } else {
    // This will run initially (isTracking=false) and when tracking is toggled off
    console.log(
      "[LocationTracker] Detected isTracking=false, stopping polling..."
    );
    stopLocationPolling();
    // Optionally clear speech queue when tracking stops
    speechQueue = [];
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    isSpeaking = false;
  }

  // --- Voice, Summary, Speech functions remain the same as previous version ---
  function initializeVoice() {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      const loadVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
          selectedVoice =
            voices.find((voice) => voice.name.includes("Microsoft Hazel")) ||
            voices.find((voice) => voice.lang.startsWith("en-GB")) ||
            voices.find((voice) => voice.lang.startsWith("en"));
          console.log(
            "[LocationTracker] Selected voice:",
            selectedVoice?.name || "Default"
          );
        } else {
          console.warn("[LocationTracker] No voices loaded yet.");
          setTimeout(() => {
            if (window.speechSynthesis.getVoices().length === 0)
              console.error("Speech synthesis voices failed to load.");
          }, 2000);
        }
      };
      if (window.speechSynthesis.getVoices().length > 0) {
        loadVoices();
      } else {
        window.speechSynthesis.onvoiceschanged = loadVoices;
      }
    } else {
      console.warn("[LocationTracker] Speech synthesis not supported.");
    }
  }

  function processNextSpeechItem() {
    if (speechQueue.length > 0 && !isSpeaking) {
      isSpeaking = true;
      const text = speechQueue.shift();
      speak(text, () => {
        isSpeaking = false;
        setTimeout(processNextSpeechItem, 250);
      });
    }
  }

  function queueSpeech(text) {
    if (!isTracking || !audioEnabled || !text) return;
    console.log("[LocationTracker] Queuing speech:", text);
    speechQueue.push(text);
    processNextSpeechItem();
  }

  function speak(text, callback) {
    if (!window.speechSynthesis || !isTracking || !audioEnabled) {
      if (callback) callback();
      return;
    }
    if (window.speechSynthesis.speaking) {
      console.warn(
        "[LocationTracker Speak] SpeechSynthesis is speaking, cancelling previous."
      );
      window.speechSynthesis.cancel();
      setTimeout(() => speak(text, callback), 100);
      return;
    }
    const msg = new SpeechSynthesisUtterance(text);
    if (selectedVoice) {
      msg.voice = selectedVoice;
      msg.rate = 0.9;
      msg.pitch = 1.1;
      msg.volume = 0.8;
    } else {
      console.warn("[LocationTracker Speak] No voice selected, using default.");
    }
    msg.onend = () => {
      if (callback) callback();
    };
    msg.onerror = (event) => {
      console.error(
        "[LocationTracker Speak] Speech synthesis error:",
        event.error
      );
      if (callback) callback();
    };
    console.log(
      "[LocationTracker Speak] Attempting to speak:",
      text.substring(0, 50) + "..."
    );
    window.speechSynthesis.speak(msg);
  }

  function getCampSummary(activities) {
    // Assume $currentLocation and isTracking are true if called from template
    try {
      const warnings = [];
      if (!$currentLocation)
        return "Internal error: No location data for summary.";
      const currentSystemId = $currentLocation.solar_system_id;
      const safeActivities = Array.isArray(activities) ? activities : [];
      const relevantActivities = safeActivities.filter(
        (activity) =>
          activity &&
          ["camp", "smartbomb", "roaming_camp", "battle"].includes(
            activity.classification
          ) &&
          (activity.probability >= 50 || activity.classification === "battle")
      );
      const currentSystemDangers = relevantActivities.filter(
        (activity) => activity.systemId === currentSystemId
      );
      if (currentSystemDangers.length > 0) {
        warnings.push(
          `⚠️ Active threats HERE: ${currentSystemDangers.map((activity) => `${activity.stargateName || activity.classification?.replace("_", " ") || "Unknown threat"} (${activity.classification === "battle" ? (activity.metrics?.partyMetrics?.characters || 0) + " pilots" : Math.round(activity.probability || 0) + "% conf."})`).join(", ")}`
        );
      }
      const connectedSystemWarnings = [];
      if (
        $currentLocation &&
        $currentLocation.connected_systems &&
        Array.isArray($currentLocation.connected_systems)
      ) {
        $currentLocation.connected_systems.forEach((connectedSystem) => {
          if (!connectedSystem || typeof connectedSystem.id === "undefined")
            return;
          const systemWarnings = [];
          const connectedSystemId = connectedSystem.id;
          const connectedSystemName = connectedSystem.name || "Unknown System";
          const gateToSystem = ($currentLocation.celestialData || []).find(
            (cel) => cel && cel.destinationid === connectedSystemId
          );
          let gateName = `Gate to ${connectedSystemName}`;
          if (gateToSystem?.itemname) {
            gateName =
              gateToSystem.itemname
                .replace(`Stargate (${connectedSystemName})`, "")
                .trim() || gateToSystem.itemname;
          }
          const directDangers = relevantActivities.filter(
            (activity) => activity.systemId === connectedSystemId
          );
          if (directDangers.length > 0) {
            systemWarnings.push(
              `${directDangers.length} threat${directDangers.length > 1 ? "s" : ""} at ${directDangers.map((activity) => `${activity.stargateName || activity.classification?.replace("_", " ") || "Threat"} (${activity.classification === "battle" ? (activity.metrics?.partyMetrics?.characters || 0) + " pilots" : Math.round(activity.probability || 0) + "% conf."})`).join(", ")}`
            );
          }
          const neighboringDangers = relevantActivities.filter(
            (activity) =>
              activity.systemId !== currentSystemId &&
              activity.systemId !== connectedSystemId &&
              activity.stargateName
                ?.toLowerCase()
                .includes(connectedSystemName.toLowerCase())
          );
          if (neighboringDangers.length > 0) {
            const neighborSystemNames = neighboringDangers
              .map((activity) => {
                const systemDataName =
                  activity.kills?.[0]?.pinpoints?.celestialData
                    ?.solarsystemname || `System ${activity.systemId}`;
                const threatName =
                  activity.stargateName ||
                  activity.classification?.replace("_", " ") ||
                  "Threat";
                const confidence =
                  activity.classification === "battle"
                    ? (activity.metrics?.partyMetrics?.characters || 0) +
                      " pilots"
                    : Math.round(activity.probability || 0) + "% conf.";
                return `${threatName} in ${systemDataName} (${confidence})`;
              })
              .join(", ");
            systemWarnings.push(
              `${neighboringDangers.length} threat${neighboringDangers.length > 1 ? "s" : ""} in neighbors: ${neighborSystemNames}`
            );
          }
          if (systemWarnings.length > 0) {
            connectedSystemWarnings.push(
              `⚠️ ${gateName}: ${systemWarnings.join("; ")}`
            );
          }
        });
      } else if ($currentLocation) {
        console.warn(
          "[LocationTracker getCampSummary] $currentLocation.connected_systems is missing or not an array."
        );
      }
      if (connectedSystemWarnings.length > 0) {
        warnings.push(...connectedSystemWarnings);
      }
      return warnings.length > 0
        ? warnings.join("\n")
        : "✓ No active threats detected nearby";
    } catch (error) {
      console.error("[LocationTracker] Error during getCampSummary:", error);
      return `Error generating summary: ${error.message}`;
    }
  }

  function stripSymbols(text) {
    return String(text || "").replace(/[⚠️✓]/g, "");
  }

  // Reactive block for triggering speech (still useful)
  $: if ($currentLocation && isTracking) {
    // Removed mounted check here too
    const currentSystemId = $currentLocation.solar_system_id;
    if (lastSystemId !== currentSystemId) {
      // System changed
      console.log("[LocationTracker Reactive] System changed detected.");
      const summaryResult = getCampSummary(currentActivities);
      if (!summaryResult.startsWith("Error generating summary")) {
        const announcement = `System change. Current system ${$currentLocation.systemName || "Unknown"} in ${$currentLocation.regionName || "Unknown"}. ${stripSymbols(summaryResult)}`;
        queueSpeech(announcement);
      } else {
        queueSpeech(
          `System change. Current system ${$currentLocation.systemName || "Unknown"} in ${$currentLocation.regionName || "Unknown"}. Error getting threat summary.`
        );
        console.error(
          "[LocationTracker Reactive] Summary generation failed on system change:",
          summaryResult
        );
      }
      lastSystemId = currentSystemId;
      try {
        const currentSystemDangers = (
          Array.isArray(currentActivities) ? currentActivities : []
        ).filter(
          (a) =>
            a &&
            a.systemId === currentSystemId &&
            ["camp", "smartbomb", "roaming_camp", "battle"].includes(
              a.classification
            ) &&
            (a.probability >= 50 || a.classification === "battle")
        );
        lastCampWarning = {
          systemId: currentSystemId,
          timestamp: Date.now(),
          activityIds: new Set(currentSystemDangers.map((a) => a.id)),
        };
      } catch (error) {
        console.error(
          "[LocationTracker Reactive] Error updating lastCampWarning:",
          error
        );
        lastCampWarning = {
          systemId: currentSystemId,
          timestamp: Date.now(),
          activityIds: new Set(),
        };
      }
    } else {
      // Still in the same system, check for *new* high-confidence threats
      try {
        const currentSystemDangers = (
          Array.isArray(currentActivities) ? currentActivities : []
        ).filter(
          (a) =>
            a &&
            a.systemId === currentSystemId &&
            ["camp", "smartbomb", "roaming_camp", "battle"].includes(
              a.classification
            ) &&
            (a.probability >= 50 || a.classification === "battle")
        );
        const currentDangerIds = new Set(currentSystemDangers.map((a) => a.id));
        const newDangers = currentSystemDangers.filter(
          (a) => !lastCampWarning?.activityIds?.has(a.id)
        );
        if (newDangers.length > 0) {
          console.log(
            "[LocationTracker Reactive] New threats detected in current system."
          );
          const newDangerSummaryResult = getCampSummary(newDangers);
          if (!newDangerSummaryResult.startsWith("Error generating summary")) {
            queueSpeech(
              `New threat alert! ${stripSymbols(newDangerSummaryResult)}`
            );
          } else {
            queueSpeech(`New threat alert! Error getting summary.`);
            console.error(
              "[LocationTracker Reactive] Summary generation failed for new threat alert:",
              newDangerSummaryResult
            );
          }
          lastCampWarning.activityIds = currentDangerIds;
        }
      } catch (error) {
        console.error(
          "[LocationTracker Reactive] Error checking for new dangers:",
          error
        );
      }
    }
  }

  // Lifecycle hooks
  onMount(() => {
    // mounted = true; // No longer strictly needed for polling start/stop
    console.log("[LocationTracker] Component Mounted.");
    if (typeof window !== "undefined") {
      fetch("/api/session", { credentials: "include" })
        .then((res) =>
          res.ok
            ? res.json()
            : Promise.reject(`Session fetch failed: ${res.status}`)
        )
        .then((data) => {
          trackedCharacter = data.user?.character_name;
          console.log(
            "[LocationTracker] Session fetched, character:",
            trackedCharacter
          );
        })
        .catch((err) =>
          console.error("[LocationTracker] Error getting session data:", err)
        );
      initializeVoice();
      // Polling now started reactively by $: block when isTracking becomes true
      // if (isTracking) { startLocationPolling(); }
    }
  });

  onDestroy(() => {
    // mounted = false;
    console.log("[LocationTracker] Component Destroyed.");
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    stopLocationPolling(); // Ensure polling stops
    unsubActivities();
  });
</script>

<div class="tracking-info" class:error={$locationError}>
  {#if !$currentLocation && isTracking && !$locationError}
    <span>Polling for location...</span>
  {:else if $currentLocation && isTracking}
    {@const summary = getCampSummary(currentActivities)}
    <div class="flex items-center gap-4 w-full">
      <div class="system-info">
        <span class="system-name"
          >{$currentLocation.systemName || "Unknown System"}</span
        >
        <span class="region-name"
          >({$currentLocation.regionName || "Unknown Region"})</span
        >
      </div>
      <div class="camp-status whitespace-pre-line flex-1">
        {#if summary.startsWith("Error generating summary")}
          <span class="error-message">{summary}</span>
        {:else}
          <span>{summary}</span>
        {/if}
      </div>
    </div>
  {:else if $locationError && isTracking}
    <span class="error-message flex items-center gap-2">
      <span>{$locationError}</span>
      <button
        class="px-2 py-0.5 bg-eve-danger/30 hover:bg-eve-danger/50 rounded-sm text-white text-xs"
        on:click={() => {
          locationError.set(null);
          stopLocationPolling();
          setTimeout(() => {
            if (isTracking) startLocationPolling();
          }, 500);
        }}
      >
        Retry
      </button>
    </span>
  {:else if !isTracking}
    <span>Tracking inactive.</span>
  {/if}
</div>

<style>
  .tracking-info {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    color: white;
    font-size: 0.875rem;
    padding: 0 0.5rem;
  }
  .system-info {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    white-space: nowrap;
  }
  .system-name {
    color: #ffd700;
    font-weight: 500;
  }
  .region-name {
    color: #aaa;
    font-size: 0.8rem;
  }
  .camp-status {
    color: #ccc;
    margin-left: 1rem;
    line-height: 1.4;
    white-space: pre-line;
    overflow-wrap: break-word;
    word-break: break-word;
  }
  .camp-status span {
    display: inline-block;
  }
  .error-message {
    color: #ff4444;
    margin-left: 1rem;
    display: inline-flex;
    align-items: center;
  }
  .camp-status .error-message {
    margin-left: 0;
    font-weight: bold;
  }
  .tracking-info.error {
    border-left: 3px solid #ff4444;
    padding-left: 0.8rem;
  }
  .tracking-info.error .camp-status {
    display: none;
  }
  .tracking-info.error .system-info {
    opacity: 0.6;
  }
</style>
