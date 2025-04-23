// src/campCrusherTargetStore.js
import { writable, get } from "svelte/store";

// --- Existing Stores ---
export const selectedCampCrusherTargetId = writable(null);
export const currentTargetEndTime = writable(null);
export const isTargetSelectionActive = writable(false);

// --- NEW: Store for main panel visibility ---
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
      // isCampCrusherPanelVisible.set(false); // Optionally hide panel on cancel? Or leave it open? Let's leave it open for now.
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
