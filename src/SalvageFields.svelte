<script>
  import { onMount, onDestroy } from "svelte";
  import { killmails } from "./store.js";

  let canvas;
  let ctx;
  let systemBubbles = new Map();
  let animationFrame;

  class SystemBubble {
    constructor(systemId, systemName) {
      this.systemId = systemId;
      this.systemName = systemName;
      this.t2Count = 0;
      this.wrecks = new Map(); // Map of killmail IDs to expiry times
      this.x = 0;
      this.y = 0;
      this.size = 0;
      this.needsPositioning = true;
    }

    addWreck(killmailId, killTime) {
      const expiryTime = new Date(killTime).getTime() + 2 * 60 * 60 * 1000; // 2 hours
      this.wrecks.set(killmailId, expiryTime);
      this.updateT2Count();
    }

    updateT2Count() {
      const now = Date.now();
      // Clear expired wrecks
      for (const [killId, expiry] of this.wrecks) {
        if (expiry < now) {
          this.wrecks.delete(killId);
        }
      }
      this.t2Count = this.wrecks.size;
    }

    timeUntilFirstExpiry() {
      if (this.wrecks.size === 0) return 0;
      const now = Date.now();
      return Math.min(...Array.from(this.wrecks.values())) - now;
    }

    draw(ctx) {
      // Similar to battle bubbles but with T2 count and expiry timer
      // Draw implementation...
    }
  }

  $: {
    // Process killmails
    const now = Date.now();
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;

    $killmails.forEach((killmail) => {
      const killTime = new Date(killmail.killmail.killmail_time).getTime();
      if (killTime < twoHoursAgo) return;

      const systemId = killmail.killmail.solar_system_id;
      const systemName =
        killmail.pinpoints?.celestialData?.solarsystemname ||
        systemId.toString();
      const isT2 = killmail.shipCategories?.victim?.tier === "T2";

      if (!isT2) return;

      if (!systemBubbles.has(systemId)) {
        systemBubbles.set(systemId, new SystemBubble(systemId, systemName));
      }

      const bubble = systemBubbles.get(systemId);
      bubble.addWreck(killmail.killID, killmail.killmail.killmail_time);
    });
  }

  // Animation loop similar to ActiveBattles.svelte
  function animate() {
    // Animation implementation...
  }

  onMount(() => {
    // Setup similar to ActiveBattles.svelte
  });

  onDestroy(() => {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
    }
  });
</script>

<div class="salvage-fields">
  <canvas bind:this={canvas} />
</div>

<style>
  .salvage-fields {
    width: 100%;
    height: 100%;
  }

  canvas {
    width: 100%;
    height: 100%;
  }
</style>
