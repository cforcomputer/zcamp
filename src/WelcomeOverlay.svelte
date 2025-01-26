<script>
  import { createEventDispatcher, onMount } from "svelte";
  import socket from "./socket.js";

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
          "X-Socket-ID": socket.id,
        },
        body: JSON.stringify({ token }),
      });
      const data = await response.json();
      if (data.success) {
        verified = true;
      }
    } catch (error) {
      console.error("Turnstile verification failed:", error);
    }
  }

  function handleContinue() {
    if (verified) {
      socket.emit("requestInitialKillmails");
      dispatch("verified");
    }
  }

  function handleLogin() {
    if (verified) {
      socket.emit("requestInitialKillmails");
      dispatch("login");
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
        Welcome to ZCamp. As a guest user, certain features will not work:
      </p>
      <ul class="list-disc list-inside space-y-2 ml-4">
        <li>Profiles/Custom filters</li>
        <li>Minigames</li>
        <li>Right click to set destination</li>
      </ul>
      <div
        class="bg-eve-secondary/50 rounded-lg p-4 border border-eve-accent/10"
      >
        <h3 class="text-eve-accent font-semibold mb-2">
          Features with EVE Login:
        </h3>
        <ul class="list-disc list-inside space-y-1 text-sm">
          <li>Custom kill filters and saved profiles</li>
          <li>Future integration with bookmarks for triangulation</li>
          <li>Minigame/leaderboard tracking</li>
          <li>Right click to set destination</li>
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
        <div class="flex gap-4">
          <button
            class="px-6 py-2 bg-eve-accent hover:bg-eve-accent/80 text-black rounded transition-colors"
            on:click={handleLogin}
            disabled={!verified}
          >
            {verified ? "Log In" : "Complete Verification"}
          </button>
          <button
            class="px-6 py-2 {verified
              ? 'bg-eve-accent/20 hover:bg-eve-accent/30'
              : 'bg-gray-600/20'} 
            text-eve-accent rounded transition-colors"
            on:click={handleContinue}
            disabled={!verified}
          >
            {verified ? "Continue as Guest" : "Complete Verification"}
          </button>
        </div>
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
