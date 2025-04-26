<script>
  // --- Imports ---
  // Import necessary stores and Svelte lifecycle functions
  import { currentLocation, locationError } from "./locationStore"; // Manages current location data and errors
  import { activeActivities } from "./activityManager.js"; // Provides list of detected activities (camps, battles, etc.)
  // import { settings } from "./settingsStore.js"; // No longer needed - TTS is always on when tracking
  import { onMount, onDestroy } from "svelte"; // Svelte lifecycle hooks
  import {
    startLocationPolling,
    stopLocationPolling,
  } from "./locationStore.js"; // Functions to control location updates

  // --- Component Props ---
  // `isTracking` is controlled by the parent component (e.g., App.svelte)
  // Determines if location polling and TTS announcements should be active.
  export let isTracking = false;

  // --- Component State ---
  let trackedCharacter = null; // Stores the name of the character being tracked
  let lastSystemId = null; // Stores the ID of the previously processed system to detect changes
  let lastCampWarning = {}; // Stores info about previously announced dangers in the current system (to avoid repeats)
  let speechQueue = []; // Queue for pending TTS announcements
  let isSpeaking = false; // Flag to prevent multiple TTS utterances from overlapping

  // --- Store Subscriptions ---
  let currentActivities = []; // Local copy of active threats/activities
  // Subscribe to the activeActivities store and update local state
  const unsubActivities = activeActivities.subscribe((value) => {
    console.log(
      "[LocationTracker ActivitySub] Received activities update:",
      value ? value.length : 0,
      "activities"
    );
    currentActivities = value || []; // Ensure it's always an array
  });

  // --- Reactive Logic ---

  /**
   * Converts a timestamp into a human-readable relative time string (e.g., "just now", "5 minutes ago").
   * @param {string | number | Date | null | undefined} timestamp - The timestamp to format. Can be ISO string, epoch ms, or Date object.
   * @returns {string} Relative time string (e.g., "5 minutes ago", "unknown", "invalid date").
   */
  function getTimeAgo(timestamp) {
    if (timestamp === null || timestamp === undefined) return "unknown";

    const then = new Date(timestamp).getTime();
    if (isNaN(then)) return "invalid date";

    const now = Date.now();
    const minutes = Math.floor((now - then) / (1000 * 60));

    if (minutes < 1) return "just now";
    if (minutes === 1) return "1 min ago";
    return `${minutes} mins ago`;
  }

  // Diagnostic Logs for UI state changes
  $: console.log(
    "[LocationTracker UI] isTracking prop reactive check:",
    isTracking
  );
  $: console.log(
    "[LocationTracker UI] $currentLocation value reactive check:",
    $currentLocation
      ? `System ID: ${$currentLocation.solar_system_id}`
      : "null/undefined"
  );
  // Log when the main display condition in the template is met
  $: $currentLocation &&
    isTracking &&
    console.log(
      "[LocationTracker UI] Template #if condition check PASSED (Attempting render)."
    );

  // Automatically start or stop location polling when the `isTracking` prop changes
  $: if (isTracking) {
    console.log(
      `[LocationTracker isTracking Effect] Detected isTracking=${isTracking}, starting polling...`
    );
    startLocationPolling(); // Start polling when tracking is enabled
  } else {
    console.log(
      `[LocationTracker isTracking Effect] Detected isTracking=${isTracking}, stopping polling...`
    );
    stopLocationPolling(); // Stop polling when tracking is disabled
    console.log(
      "[LocationTracker isTracking Effect] Clearing speech queue and cancelling synthesis."
    );
    speechQueue = []; // Clear any pending announcements
    // Cancel any currently speaking TTS utterance
    if (typeof window !== "undefined" && window.speechSynthesis) {
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        console.log(
          "[LocationTracker isTracking Effect] Cancelling active/pending speech synthesis."
        );
        window.speechSynthesis.cancel();
      }
    }
    isSpeaking = false; // Reset speaking flag
  }

  // --- TTS Functions ---

  /**
   * Processes the next item in the speechQueue if available and not currently speaking.
   */
  function processNextSpeechItem() {
    console.log(
      `[LocationTracker processNextSpeechItem] Called. Queue length: ${speechQueue.length}, isSpeaking: ${isSpeaking}`
    );
    // Only proceed if queue has items and TTS is not already active
    if (speechQueue.length > 0 && !isSpeaking) {
      isSpeaking = true; // Set flag to indicate TTS is now active
      console.log(
        "[LocationTracker processNextSpeechItem] Set isSpeaking = true."
      );
      const text = speechQueue.shift(); // Get the next message from the queue
      // Safety check in case queue contains null/undefined
      if (!text) {
        console.warn(
          "[LocationTracker processNextSpeechItem] Dequeued undefined text. Skipping."
        );
        isSpeaking = false; // Reset flag
        setTimeout(processNextSpeechItem, 50); // Check queue again shortly
        return;
      }
      console.log(
        `[LocationTracker processNextSpeechItem] Dequeued text: "${text.substring(0, 70) + "..."}". Calling speak.`
      );
      // Call the speak function with the text and a callback to process the next item
      speak(text, () => {
        console.log(
          "[LocationTracker processNextSpeechItem] Speak callback executed. Setting isSpeaking = false."
        );
        isSpeaking = false; // Reset flag once speech is finished (or errored)
        // Wait a short moment before checking the queue again to prevent potential tight loops
        setTimeout(processNextSpeechItem, 250);
      });
    } else if (speechQueue.length === 0) {
      console.log(
        "[LocationTracker processNextSpeechItem] Queue is empty. Doing nothing."
      );
    } else {
      // isSpeaking is true
      console.log(
        "[LocationTracker processNextSpeechItem] Still speaking. Waiting for current speech to end."
      );
    }
  }

  /**
   * Adds text to the speech queue if tracking is active.
   * @param {string | null | undefined} text - The text to be spoken.
   */
  function queueSpeech(text) {
    // Log the attempt and the conditions
    console.log(
      `[LocationTracker queueSpeech] Attempting to queue. isTracking: ${isTracking}, text: "${text ? text.substring(0, 30) + "..." : "null/empty"}"`
    );
    // Guard: Only queue if tracking is active and text is provided.
    // NOTE: Dependency on audio settings has been removed.
    if (!isTracking || !text) {
      console.log(
        "[LocationTracker queueSpeech] Guard condition failed (isTracking=false or no text). Not queuing."
      );
      return; // Don't queue if conditions aren't met
    }
    // Add the text to the queue
    console.log(
      "[LocationTracker queueSpeech] Queuing speech:",
      text.substring(0, 70) + "..."
    );
    speechQueue.push(text);
    // If not currently speaking, start processing the queue immediately
    if (!isSpeaking) {
      console.log(
        "[LocationTracker queueSpeech] Not currently speaking, calling processNextSpeechItem."
      );
      processNextSpeechItem();
    } else {
      // Otherwise, just log that it was added
      console.log(
        "[LocationTracker queueSpeech] Already speaking, item added to queue."
      );
    }
  }

  /**
   * Uses the browser's SpeechSynthesis API to speak the provided text.
   * Handles cancelling previous speech and basic error logging.
   * @param {string} text - The text to speak.
   * @param {function} callback - Function to call when speech ends or errors.
   */
  function speak(text, callback) {
    console.log(
      `[LocationTracker speak] Function entered. text: "${text ? text.substring(0, 70) + "..." : "null/empty"}"`
    );

    // --- Pre-condition checks ---
    // Ensure running in a browser environment
    if (typeof window === "undefined") {
      console.error("[LocationTracker speak] 'window' is not defined.");
      if (callback) callback(); // Ensure callback runs to potentially unblock queue
      return;
    }
    // Check if Speech Synthesis API is available
    if (!window.speechSynthesis) {
      console.error(
        "[LocationTracker speak] window.speechSynthesis is NOT available."
      );
      if (callback) callback();
      return;
    }
    // Check if tracking is still active (might have changed between queueing and speaking)
    // NOTE: Dependency on audio settings removed here too.
    if (!isTracking) {
      console.warn(
        "[LocationTracker speak] Aborted during speak: isTracking is false."
      );
      if (callback) callback();
      return;
    }
    // Ensure text is valid
    if (!text || text.trim().length === 0) {
      console.warn(
        "[LocationTracker Speak] Aborted during speak: Attempted to speak empty or whitespace text."
      );
      if (callback) callback();
      return;
    }

    // --- Handle existing speech ---
    // If the API is already speaking or has items pending, cancel them first.
    // This prevents overlapping speech and clears the browser's internal queue.
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      console.warn(
        "[LocationTracker Speak] SpeechSynthesis busy, cancelling previous and rescheduling."
      );
      window.speechSynthesis.cancel(); // Cancel everything
      // Reschedule this speak call after a short delay to allow cancellation to complete
      setTimeout(() => {
        console.log(
          "[LocationTracker Speak] Retrying speak after cancel timeout."
        );
        speak(text, callback); // Re-attempt the speak call
      }, 150);
      return; // Stop execution for this attempt, the rescheduled call will handle it
    }

    // --- Create and configure utterance ---
    console.log("[LocationTracker Speak] Creating SpeechSynthesisUtterance.");
    const msg = new SpeechSynthesisUtterance(text);
    // Note: Voice selection logic was removed; uses browser default.
    // You could add configuration here (e.g., msg.rate, msg.pitch, msg.voice) if needed.

    // --- Event Handlers for the utterance ---
    msg.onstart = () => {
      console.log("[LocationTracker Speak] msg.onstart triggered.");
    }; // Log when speech actually starts
    msg.onend = () => {
      // Log when speech finishes successfully
      console.log("[LocationTracker Speak] msg.onend triggered.");
      if (callback) callback(); // Call the provided callback (triggers processNextSpeechItem)
    };
    msg.onerror = (event) => {
      // Log any errors during speech synthesis
      console.error(
        "[LocationTracker Speak] msg.onerror triggered:",
        `Error Code: ${event.error}`,
        "Text:",
        text.substring(0, 100) + "..."
      );
      if (callback) callback(); // Also call callback on error to unblock queue
    };

    // --- Initiate Speech ---
    console.log(
      `[LocationTracker Speak] Calling window.speechSynthesis.speak() for: "${text.substring(0, 70)}..."`
    );
    try {
      window.speechSynthesis.speak(msg); // Send the utterance to the browser API
      console.log(
        "[LocationTracker Speak] window.speechSynthesis.speak() called."
      );
    } catch (e) {
      // Catch potential synchronous errors during the speak() call itself
      console.error(
        "[LocationTracker Speak] CRITICAL: Error calling window.speechSynthesis.speak():",
        e
      );
      if (callback) callback(); // Ensure queue is unblocked if this fails
    }
  }

  // --- Threat Summary Logic ---

  /**
   * Formats details for a single threat activity for TTS or display.
   * @param {object} activity - The activity object containing threat details.
   * @returns {string} A formatted string describing the threat.
   */
  function formatThreatDetails(activity) {
    if (!activity) return "Unknown threat";

    const classification = activity.classification || "threat";
    // Make classification more readable (e.g., "roaming_camp" -> "roaming camp")
    const prettyClassification = classification.replace("_", " ");
    let details = []; // Array to build the detail string parts

    // Add Confidence % (for non-battle) or Pilot Count (for battles)
    if (classification === "battle") {
      // Safely access nested properties for pilot count
      const pilots =
        (activity.metrics &&
          activity.metrics.partyMetrics &&
          activity.metrics.partyMetrics.characters) ||
        0;
      details.push(`${pilots} pilot${pilots !== 1 ? "s" : ""}`);
    } else if (typeof activity.probability === "number") {
      // Add probability percentage if available
      details.push(`${Math.round(activity.probability)}% conf.`);
    }

    // Add Location Detail (Gate Name or Celestial Name if available)
    if (activity.stargateName) {
      // Attempt to shorten common gate names like "Stargate (Other System)" to "Other System Gate"
      const shortGateName = activity.stargateName
        .replace(/Stargate\s*\((.*?)\)/i, "$1 Gate")
        .trim();
      details.push(`at ${shortGateName}`);
    } else if (activity.celestialName) {
      // Fallback to celestial name if gate name isn't present
      details.push(`at ${activity.celestialName}`);
    }

    // Add Ship Composition (Example - ADJUST BASED ON YOUR ACTUAL DATA)
    // This part is hypothetical and needs to match your 'activity' object structure.
    if (
      Array.isArray(activity.composition) &&
      activity.composition.length > 0
    ) {
      // Example: Show top 3 ship type names, separated by comma
      const compSummary = activity.composition
        .slice(0, 3)
        .map((ship) => ship.typeName || "ship")
        .join(", ");
      details.push(
        `w/ ${compSummary}${activity.composition.length > 3 ? "..." : ""}`
      ); // Add ellipsis if more than 3
    } else if (activity.shipType) {
      // Simpler fallback if only a single ship type is known
      details.push(`w/ ${activity.shipType}`);
    }

    // Combine the parts into a final string
    return `${prettyClassification} (${details.join(", ")})`;
  }

  /**
   * Generates a summary string of nearby threats (current system, adjacent systems, further out).
   * MODIFIED: Threshold 10%, all types, last seen time added, DEBUG logging added.
   * @param {Array} activities - The list of currently active threat activities.
   * @returns {string} A formatted summary string, potentially multi-line.
   */
  function getCampSummary(activities) {
    // --- START DEBUG LOGGING ---
    console.log(
      "[DEBUG getCampSummary] Function Start. Received activities:",
      activities
    );
    console.log(
      "[DEBUG getCampSummary] Current Location Store ($currentLocation):",
      $currentLocation
    );
    // --- END DEBUG LOGGING ---
    try {
      const warnings = []; // Array to hold all warning strings
      if (!$currentLocation) {
        console.warn(
          "[DEBUG getCampSummary] $currentLocation is null/undefined. Returning placeholder."
        );
        return "Calculating summary...";
      }
      const currentSystemId = $currentLocation.solar_system_id;
      console.log(
        `[DEBUG getCampSummary] Current System ID: ${currentSystemId}`
      );

      const safeActivities = Array.isArray(activities) ? activities : [];
      console.log(
        "[DEBUG getCampSummary] Input 'safeActivities' count:",
        safeActivities.length,
        safeActivities
      );

      // --- Filter for relevant activities ---
      const relevantActivities = safeActivities.filter(
        (activity) =>
          activity &&
          (activity.probability >= 10 || activity.classification === "battle")
      );
      console.log(
        "[DEBUG getCampSummary] 'relevantActivities' count after filter (prob>=10 or battle):",
        relevantActivities.length,
        relevantActivities
      );
      // --- End Filter ---

      // --- Step 1: Check CURRENT System ---
      const currentSystemDangers = relevantActivities.filter(
        (activity) => activity.systemId === currentSystemId
      );
      console.log(
        `[DEBUG getCampSummary] Dangers found in CURRENT system (${currentSystemId}):`,
        currentSystemDangers.length,
        currentSystemDangers
      );
      if (currentSystemDangers.length > 0) {
        warnings.push(
          `⚠️ Active threats HERE: ${currentSystemDangers.map(formatThreatDetails).join("; ")}`
        );
      }

      // --- Step 2: Check ADJACENT Systems ---
      const connectedSystemWarnings = [];
      if (Array.isArray($currentLocation.connected_systems)) {
        console.log(
          `[DEBUG getCampSummary] Checking ${$currentLocation.connected_systems.length} connected systems...`
        );
        $currentLocation.connected_systems.forEach((connectedSystem) => {
          if (!connectedSystem || typeof connectedSystem.id === "undefined") {
            console.warn(
              "[DEBUG getCampSummary] Skipping invalid connectedSystem entry:",
              connectedSystem
            );
            return;
          }
          const connectedSystemId = connectedSystem.id;
          const connectedSystemName = connectedSystem.name || "Unknown System";
          console.log(
            `[DEBUG getCampSummary] --- Checking Connected System: ${connectedSystemName} (ID: ${connectedSystemId}) ---`
          );

          const celestialData = Array.isArray($currentLocation.celestialData)
            ? $currentLocation.celestialData
            : [];
          const gateToSystem = celestialData.find(
            (cel) => cel && cel.destinationid === connectedSystemId
          );
          let gateName = `Gate to ${connectedSystemName}`;
          if (gateToSystem && gateToSystem.itemname) {
            gateName =
              gateToSystem.itemname
                .replace(`Stargate (${connectedSystemName})`, "")
                .trim() || gateToSystem.itemname;
          }
          console.log(
            `[DEBUG getCampSummary] Gate Name in Current System: ${gateName}`
          );

          let gateSpecificWarnings = [];

          // --- 2a. Direct Dangers IN Adjacent System ---
          const directDangers = relevantActivities.filter((activity) => {
            const activitySystemId = activity?.systemId;
            // Log comparison
            console.log(
              `[DEBUG getCampSummary] Comparing direct: activitySystemId=${activitySystemId} (type: ${typeof activitySystemId}) vs connectedSystemId=${connectedSystemId} (type: ${typeof connectedSystemId})`
            );
            // Ensure types match for comparison if necessary, though === should handle this if both are numbers or both strings
            return String(activitySystemId) === String(connectedSystemId);
          });
          console.log(
            `[DEBUG getCampSummary] Found ${directDangers.length} direct dangers in ${connectedSystemName}:`,
            directDangers
          );
          if (directDangers.length > 0) {
            const dangerSummary = directDangers
              .map((activity) => {
                const lastSeen = getTimeAgo(
                  activity.lastActivity || activity.lastKill
                );
                return `${formatThreatDetails(activity)}, last seen ${lastSeen}`;
              })
              .join("; ");
            gateSpecificWarnings.push(
              `Threat${directDangers.length > 1 ? "s" : ""} IN ${connectedSystemName}: ${dangerSummary}`
            );
          }

          // --- 2b. Neighboring Dangers (Proxy Check) ---
          const neighboringDangers = relevantActivities.filter(
            (activity) =>
              activity &&
              activity.systemId !== currentSystemId &&
              activity.systemId !== connectedSystemId &&
              activity.stargateName &&
              activity.stargateName
                .toLowerCase()
                .includes(connectedSystemName.toLowerCase())
          );
          console.log(
            `[DEBUG getCampSummary] Found ${neighboringDangers.length} neighboring dangers related to ${connectedSystemName}:`,
            neighboringDangers
          );
          if (neighboringDangers.length > 0) {
            const dangerSummary = neighboringDangers
              .map((activity) => {
                const dangerSystemName =
                  (activity.kills &&
                    activity.kills[0] &&
                    activity.kills[0].pinpoints &&
                    activity.kills[0].pinpoints.celestialData &&
                    activity.kills[0].pinpoints.celestialData
                      .solarsystemname) ||
                  `System ${activity.systemId}`;
                const lastSeen = getTimeAgo(
                  activity.lastActivity || activity.lastKill
                );
                return `${formatThreatDetails(activity)} in ${dangerSystemName}, last seen ${lastSeen}`;
              })
              .join("; ");
            gateSpecificWarnings.push(
              `Further threat${neighboringDangers.length > 1 ? "s" : ""} detected on gate towards ${connectedSystemName}: ${dangerSummary}`
            );
          }

          // --- Combine warnings for this gate ---
          if (gateSpecificWarnings.length > 0) {
            console.log(
              `[DEBUG getCampSummary] Adding warnings for gate '${gateName}':`,
              gateSpecificWarnings
            );
            connectedSystemWarnings.push(
              `⚠️ ${gateName}: ${gateSpecificWarnings.join(" | ")}`
            );
          } else {
            console.log(
              `[DEBUG getCampSummary] No specific warnings found for gate '${gateName}'.`
            );
          }
        });
      } else if ($currentLocation) {
        console.warn(
          "[DEBUG getCampSummary] $currentLocation.connected_systems is missing or not an array."
        );
      }

      // --- Final Assembly ---
      if (connectedSystemWarnings.length > 0) {
        warnings.push(...connectedSystemWarnings);
      }

      const summary =
        warnings.length > 0
          ? warnings.join("\n")
          : "✓ No active threats detected nearby";

      // --- START DEBUG LOGGING ---
      console.log("[DEBUG getCampSummary] Final Summary Generated:", summary);
      // --- END DEBUG LOGGING ---

      return summary;
    } catch (error) {
      console.error(
        "[DEBUG getCampSummary] CRITICAL Error during summary generation:",
        error
      );
      return `Error generating threat summary. Please check console logs.`;
    }
  }

  /**
   * Removes warning symbols (⚠️✓) from text, typically before sending to TTS.
   * @param {string} text - The input text.
   * @returns {string} The text without warning symbols.
   */
  function stripSymbols(text) {
    // Ensure input is treated as a string, replace symbols using regex
    return String(text || "").replace(/[⚠️✓]/g, "");
  }

  // --- Reactive Block for Triggering Speech ---
  // This block automatically runs whenever its dependencies (`$currentLocation`, `isTracking`, `currentActivities`) change.
  $: {
    console.log(
      `[LocationTracker Reactive Speech Block] Evaluating... isTracking: ${isTracking}, Has $currentLocation: ${!!$currentLocation}`
    );

    // Primary condition: Must be tracking and have valid location data
    if (
      $currentLocation &&
      typeof $currentLocation.solar_system_id !== "undefined" &&
      isTracking
    ) {
      console.log(
        `[LocationTracker Reactive Speech Block] Condition PASSED (isTracking: ${isTracking}, has valid $currentLocation)`
      );
      const currentSystemId = $currentLocation.solar_system_id;
      console.log(
        `[LocationTracker Reactive Speech Block] Current System ID: ${currentSystemId}, Last Recorded System ID: ${lastSystemId}`
      );

      // --- Logic for System Change ---
      // Check if the system ID has changed since the last evaluation
      if (lastSystemId !== currentSystemId) {
        console.log(
          "[LocationTracker Reactive Speech Block] System change detected (or first update). Processing..."
        );
        // Generate the full threat summary for the new situation
        const summaryResult = getCampSummary(currentActivities);
        console.log(
          `[LocationTracker Reactive Speech Block] getCampSummary result for system change: "${summaryResult.substring(0, 100)}..."`
        );
        // Get system/region names for the announcement
        const systemName = $currentLocation.systemName || "Unknown";
        const regionName = $currentLocation.regionName || "Unknown Region";
        let announcement;
        // Create the announcement text, handling potential errors from getCampSummary
        if (!summaryResult.startsWith("Error generating summary")) {
          // Normal announcement: System info + stripped summary
          announcement = `System change. Current system ${systemName} in ${regionName}. ${stripSymbols(summaryResult)}`;
        } else {
          // Error announcement
          announcement = `System change. Current system ${systemName} in ${regionName}. Error getting threat summary.`;
          console.error(
            "[LocationTracker Reactive Speech Block] Summary generation failed on system change:",
            summaryResult
          );
        }
        // Queue the announcement for TTS
        console.log(
          `[LocationTracker Reactive Speech Block] Queuing announcement for system change: "${announcement.substring(0, 100)}..."`
        );
        queueSpeech(announcement);

        // Update the last known system ID *after* processing the change
        console.log(
          `[LocationTracker Reactive Speech Block] Updating lastSystemId from ${lastSystemId} to: ${currentSystemId}`
        );
        lastSystemId = currentSystemId;

        // Reset the record of announced dangers since we are in a new system
        console.log(
          "[LocationTracker Reactive Speech Block] Resetting lastCampWarning for new system."
        );
        try {
          // Find dangers present *right now* in the new system
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
          // Store the IDs of these initial dangers
          const dangerIds = Array.isArray(currentSystemDangers)
            ? currentSystemDangers
                .map((a) => a && a.id)
                .filter((id) => id != null)
            : [];
          lastCampWarning = {
            systemId: currentSystemId,
            timestamp: Date.now(),
            activityIds: new Set(dangerIds), // Initialize with current dangers
          };
          console.log(
            "[LocationTracker Reactive Speech Block] lastCampWarning updated for new system:",
            lastCampWarning
          );
        } catch (error) {
          // Handle errors during the reset process
          console.error(
            "[LocationTracker Reactive Speech Block] Error updating lastCampWarning on system change:",
            error
          );
          lastCampWarning = {
            systemId: currentSystemId,
            timestamp: Date.now(),
            activityIds: new Set(),
          }; // Reset safely
        }

        // --- Logic for New Dangers in Same System ---
      } else {
        console.log(
          "[LocationTracker Reactive Speech Block] System ID unchanged. Checking for new dangers."
        );
        try {
          // Get all current high-confidence dangers in the current system
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
          // Get the IDs of all current dangers
          const currentDangerIdsArray = Array.isArray(currentSystemDangers)
            ? currentSystemDangers
                .map((a) => a && a.id)
                .filter((id) => id != null)
            : [];
          const currentDangerIds = new Set(currentDangerIdsArray);

          // Get the IDs of dangers that were *previously* announced in this system
          const previousDangerIds =
            lastCampWarning &&
            lastCampWarning.systemId === currentSystemId &&
            lastCampWarning.activityIds instanceof Set
              ? lastCampWarning.activityIds
              : new Set();

          // Find dangers that are present now but were NOT announced previously
          const newDangers = Array.isArray(currentSystemDangers)
            ? currentSystemDangers.filter(
                (a) => a && a.id != null && !previousDangerIds.has(a.id)
              )
            : [];

          // If there are new, unannounced dangers...
          if (newDangers.length > 0) {
            console.log(
              `[LocationTracker Reactive Speech Block] ${newDangers.length} New threat(s) detected in current system.`
            );
            // Generate a summary focusing *only* on these new dangers for the alert
            const newDangerSummaryResult = getCampSummary(newDangers);
            console.log(
              `[LocationTracker Reactive Speech Block] getCampSummary result for new threats: "${newDangerSummaryResult.substring(0, 100)}..."`
            );
            let newThreatAnnouncement;
            // Create the alert text
            if (
              !newDangerSummaryResult.startsWith("Error generating summary")
            ) {
              newThreatAnnouncement = `New threat alert! ${stripSymbols(newDangerSummaryResult)}`;
            } else {
              newThreatAnnouncement = `New threat alert! Error getting summary.`;
              console.error(
                "[LocationTracker Reactive Speech Block] Summary generation failed for new threat alert:",
                newDangerSummaryResult
              );
            }
            // Queue the alert for TTS
            console.log(
              `[LocationTracker Reactive Speech Block] Queuing announcement for new threats: "${newThreatAnnouncement.substring(0, 100)}..."`
            );
            queueSpeech(newThreatAnnouncement);

            // IMPORTANT: Update lastCampWarning to include the IDs of *all* current dangers,
            // so these newly announced ones aren't announced again immediately.
            console.log(
              "[LocationTracker Reactive Speech Block] Updating lastCampWarning with current threat IDs."
            );
            lastCampWarning = {
              systemId: currentSystemId,
              timestamp: Date.now(),
              activityIds: currentDangerIds, // Store the full set of current danger IDs
            };
            console.log(
              "[LocationTracker Reactive Speech Block] lastCampWarning updated:",
              lastCampWarning
            );
          } else {
            // No new dangers found since the last check
            console.log(
              "[LocationTracker Reactive Speech Block] No new dangers detected since last check."
            );
          }
        } catch (error) {
          // Handle errors during the new danger check
          console.error(
            "[LocationTracker Reactive Speech Block] Error checking for new dangers:",
            error
          );
        }
      }
    } else {
      // Log why the main speech logic was skipped
      if (!isTracking) {
        console.log(
          "[LocationTracker Reactive Speech Block] Evaluation skipped: isTracking is false."
        );
      } else if (
        !$currentLocation ||
        typeof $currentLocation.solar_system_id === "undefined"
      ) {
        // Location data might not be ready yet
        console.log(
          "[LocationTracker Reactive Speech Block] Evaluation skipped: $currentLocation is not yet valid."
        );
      }
    }
  } // End of reactive speech block scope

  // --- Lifecycle Hooks ---

  /**
   * Runs when the component is first added to the DOM.
   * Fetches initial session data.
   */
  onMount(() => {
    console.log("[LocationTracker] Component Mounted.");
    // Ensure running in browser context
    if (typeof window !== "undefined") {
      console.log("[LocationTracker onMount] Fetching session data...");
      // Fetch session to get the character name being tracked
      fetch("/api/session", { credentials: "include" }) // Include cookies for session auth
        .then((res) => {
          // Check if the fetch was successful
          if (res.ok) {
            return res.json(); // Parse JSON response
          }
          // If not ok, reject the promise with an error
          return Promise.reject(
            new Error(`Session fetch failed: ${res.status} ${res.statusText}`)
          );
        })
        .then((data) => {
          // Safely extract character name from response data
          trackedCharacter =
            data && data.user && typeof data.user.character_name === "string"
              ? data.user.character_name
              : null;
          console.log(
            "[LocationTracker onMount] Session fetched, character:",
            trackedCharacter || "Not found"
          );
        })
        .catch((err) =>
          // Log any errors during the fetch process
          console.error(
            "[LocationTracker onMount] Error getting session data:",
            err
          )
        );
      // Note: Polling is started reactively by the $: block when isTracking becomes true.
      console.log(
        "[LocationTracker onMount] Mount complete. Waiting for isTracking=true to start polling."
      );
    } else {
      // Log if running in a non-browser context (e.g., SSR)
      console.log(
        "[LocationTracker onMount] 'window' not defined during mount (SSR?)."
      );
    }
  });

  /**
   * Runs just before the component is removed from the DOM.
   * Cleans up subscriptions, stops polling, and cancels speech.
   */
  onDestroy(() => {
    console.log("[LocationTracker] Component Destroying...");
    // Stop any ongoing TTS and clear the browser queue
    if (typeof window !== "undefined" && window.speechSynthesis) {
      console.log(
        "[LocationTracker onDestroy] Cancelling any speech synthesis and stopping polling."
      );
      window.speechSynthesis.cancel();
    }
    // Ensure location polling is stopped
    stopLocationPolling();
    // Unsubscribe from the activity store to prevent memory leaks
    if (unsubActivities) {
      // Check if the unsubscribe function exists
      unsubActivities();
    }
    // Reset component state
    lastSystemId = null;
    lastCampWarning = {};
    speechQueue = [];
    isSpeaking = false;
    console.log("[LocationTracker] Component Destroyed.");
  });
</script>

<div class="tracking-info" class:error={$locationError}>
  {#if !$currentLocation && isTracking && !$locationError}
    <span>Polling for location...</span>
  {:else if $currentLocation && isTracking}
    {@const displaySummary = getCampSummary(currentActivities)}
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
        {#if displaySummary.startsWith("Error generating summary")}
          <span class="error-message">{displaySummary}</span>
        {:else}
          <span>{displaySummary}</span>
        {/if}
      </div>
    </div>
  {:else if $locationError && isTracking}
    <span class="error-message flex items-center gap-2">
      <span>{$locationError}</span>
      <button
        class="px-2 py-0.5 bg-eve-danger/30 hover:bg-eve-danger/50 rounded-sm text-white text-xs"
        on:click={() => {
          console.log("[LocationTracker UI] Retry button clicked.");
          locationError.set(null); // Clear the error state in the store
          stopLocationPolling(); // Stop any potentially stuck polling loop
          console.log("[LocationTracker UI] Polling stopped via Retry.");
          // Use a short timeout to allow state changes to propagate before restarting
          setTimeout(() => {
            if (isTracking) {
              // Only restart if tracking is still desired
              console.log(
                "[LocationTracker UI] Attempting to restart polling via Retry."
              );
              startLocationPolling();
            } else {
              console.log(
                "[LocationTracker UI] Tracking was disabled, not restarting polling via Retry."
              );
            }
          }, 100);
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
    font-size: 0.875rem; /* 14px */
    padding: 0 0.5rem; /* 8px horizontal padding */
  }
  .system-info {
    display: flex;
    gap: 0.5rem; /* 8px gap */
    align-items: baseline; /* Align text nicely */
    white-space: nowrap; /* Prevent system/region from wrapping */
  }
  .system-name {
    color: #ffd700; /* Gold color */
    font-weight: 500; /* Medium weight */
  }
  .region-name {
    color: #aaa; /* Light gray */
    font-size: 0.8rem; /* Slightly smaller */
  }
  .camp-status {
    color: #ccc; /* Lighter gray for status */
    margin-left: 1rem; /* 16px left margin */
    line-height: 1.4; /* Improve readability of multi-line summaries */
    white-space: pre-line; /* Respect newlines in the summary string */
    overflow-wrap: break-word; /* Allow long words to break */
    word-break: break-word; /* Ensure words break correctly */
    /* Flex properties to allow shrinking/growing and prevent overflow */
    flex: 1 1 0%;
    min-width: 0;
    overflow: hidden; /* Hide overflow */
  }
  .camp-status span {
    /* Ensure span behaves correctly within flex container */
    display: inline-block;
    max-width: 100%;
  }
  .error-message {
    color: #ff4444; /* Red for errors */
    margin-left: 1rem; /* Consistent margin */
    display: inline-flex; /* Align icon/button with text */
    align-items: center;
    flex-grow: 1; /* Allow error message to take space */
    white-space: normal; /* Allow error message text to wrap */
  }
  /* Style error message specifically within the camp-status area */
  .camp-status .error-message {
    margin-left: 0;
    font-weight: bold;
  }
  /* Style the whole container when there's a location error */
  .tracking-info.error {
    border-left: 3px solid #ff4444; /* Red left border */
    padding-left: calc(0.5rem + 3px); /* Adjust padding for border */
    padding-right: 0.5rem;
  }
  /* Hide the normal camp status when showing the main location error */
  .tracking-info.error .camp-status {
    display: none;
  }
  /* Dim the system info when showing the main location error */
  .tracking-info.error .system-info {
    opacity: 0.6;
  }
  /* Style the retry button within the error message */
  .error-message button {
    margin-left: 0.5rem; /* Space between error text and button */
    flex-shrink: 0; /* Prevent button from shrinking */
  }
</style>
