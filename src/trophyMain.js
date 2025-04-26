// src/trophyMain.js
import TrophyPage from "./TrophyPage.svelte";

// Hide the page initially to prevent FOUC
document.documentElement.style.visibility = "hidden";

// Wait for the DOM to be ready
window.addEventListener("DOMContentLoaded", () => {
  // Mount the Svelte component
  const app = new TrophyPage({
    target: document.body,
  });

  // Now make the page visible
  // Using requestAnimationFrame ensures the browser has a chance to render the component first
  requestAnimationFrame(() => {
    document.documentElement.style.visibility = "visible";
  });

  // Note: We are simplifying here compared to main.js - assuming styles in trophy.html load synchronously enough.
  // If you still see FOUC, you might need the more complex stylesheet loading check from main.js.
});

// Export is usually not needed for entry points unless required by a specific setup
// export default app;
