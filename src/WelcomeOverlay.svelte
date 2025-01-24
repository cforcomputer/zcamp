<script>
  import { createEventDispatcher, onMount } from "svelte";
  const dispatch = createEventDispatcher();
  let turnstileWidget;
  let turnstileLoaded = false;
  let verified = false;
  let siteKey = "";

  async function handleTurnstileCallback(token) {
    try {
      const response = await fetch("/api/verify-turnstile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token }),
      });
      const data = await response.json();
      if (data.success) {
        verified = true;
        // No longer auto-dispatching verified event
      }
    } catch (error) {
      console.error("Turnstile verification failed:", error);
    }
  }

  function handleContinue() {
    if (verified) {
      dispatch("verified");
    }
  }

  onMount(async () => {
    try {
      const configResponse = await fetch("/api/turnstile-config");
      const config = await configResponse.json();
      siteKey = config.siteKey;

      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";

      script.onload = () => {
        turnstileWidget = window.turnstile.render("#turnstile-container", {
          sitekey: siteKey,
          theme: "dark",
          callback: handleTurnstileCallback,
        });
        turnstileLoaded = true;
      };
      document.head.appendChild(script);
    } catch (error) {
      console.error("Error initializing Turnstile:", error);
    }
    return () => {
      if (turnstileWidget) {
        window.turnstile.remove(turnstileWidget);
      }
    };
  });
</script>

<div
  class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center"
>
  <div
    class="max-w-2xl w-full mx-4 bg-eve-dark/95 rounded-lg shadow-2xl border border-eve-accent/20 p-8"
  >
    <h1 class="text-3xl font-bold text-eve-accent mb-6">Welcome to ZCamp</h1>
    <div class="space-y-6 text-gray-300">
      <p class="leading-relaxed">
        Welcome to ZCamp, your real-time EVE Online combat tracking system. As a
        guest user, you can access:
      </p>
      <ul class="list-disc list-inside space-y-2 ml-4">
        <li>Gate camp monitoring</li>
        <li>Kill tracking and filtering</li>
        <li>Battle analytics</li>
      </ul>
      <div
        class="bg-eve-secondary/50 rounded-lg p-4 border border-eve-accent/10"
      >
        <h3 class="text-eve-accent font-semibold mb-2">Features with Login:</h3>
        <ul class="list-disc list-inside space-y-1 text-sm">
          <li>Personal location tracking with gate camp alerts</li>
          <li>Custom kill filters and saved profiles</li>
          <li>Roaming gang detection</li>
          <li>Salvage opportunities tracking</li>
          <li>Future integration with bookmarks for triangulation</li>
          <li>Play the campcrushers minigame</li>
        </ul>
      </div>
      <div class="flex justify-center" id="turnstile-container">
        {#if !turnstileLoaded}
          <div class="text-eve-accent">Loading verification...</div>
        {/if}
      </div>
      <div class="flex justify-between items-center mt-8">
        <button
          class="text-eve-accent hover:text-eve-accent/80 transition-colors"
          on:click={() => alert("Tutorial coming soon!")}
        >
          View Tutorial
        </button>
        <button
          class="px-6 py-2 {verified
            ? 'bg-eve-accent/20 hover:bg-eve-accent/30'
            : 'bg-gray-600/20'} 
                   text-eve-accent rounded transition-colors"
          on:click={handleContinue}
          disabled={!verified}
        >
          {verified ? "Continue as Guest" : "Complete Verification to Continue"}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  :global(#turnstile-container iframe) {
    margin: 0 auto;
  }

  :global(#turnstile-container) {
    display: flex;
    justify-content: center;
    margin: 1rem 0;
  }
</style>
