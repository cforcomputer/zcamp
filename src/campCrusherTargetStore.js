// src/campCrusherTargetStore.js
import { writable, get } from "svelte/store";

// --- Existing Stores ---
export const selectedCampCrusherTargetId = writable(null);
export const currentTargetEndTime = writable(null);
export const isTargetSelectionActive = writable(false);

// --- NEW: Store for main panel visibility ---
// This controls whether the full CampCrusher component is rendered
export const isCampCrusherPanelVisible = writable(false);
// --- End NEW ---

// Existing cancelTarget function (ensure it's here)
export async function cancelTarget() {
  const targetIdToCancel = get(selectedCampCrusherTargetId);
  if (!targetIdToCancel) {
    console.log("[Store] No active target to cancel.");
    return;
  }

  console.log("[Store] Attempting to cancel target:", targetIdToCancel);
  // Consider adding a global loading state if needed

  try {
    const response = await fetch("/api/campcrushers/cancel-target", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: targetIdToCancel }),
    });

    const data = await response.json();

    if (response.ok && data.success) {
      console.log(
        "[Store] Target cancelled successfully via API for:",
        targetIdToCancel
      );
      selectedCampCrusherTargetId.set(null);
      currentTargetEndTime.set(null);
      isTargetSelectionActive.set(false); // Ensure selection mode is off
      // Keep the panel visible after cancelling a target, user might want to select another
      // isCampCrusherPanelVisible.set(false); // Do NOT hide panel on cancel
    } else {
      console.error(
        "[Store] Failed to cancel target on backend:",
        data.error || response.status
      );
      alert(
        `Failed to cancel target: ${
          data.error || "Target not found or already inactive?"
        }`
      );
    }
  } catch (error) {
    console.error(
      "[Store] Network error sending cancel target request:",
      error
    );
    alert("A network error occurred while cancelling the target.");
  } finally {
    // Clear global loading state if used
  }
}

// --- NEW Helper to explicitly hide the panel ---
// Can be called from components if needed, e.g., a close button
export function hideCampCrusherPanel() {
  console.log("[Store] Hiding Camp Crusher Panel");
  isCampCrusherPanelVisible.set(false);
  isTargetSelectionActive.set(false); // Also ensure selection mode is off when hiding
}
// --- End NEW ---
