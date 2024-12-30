<!-- src/ActiveBattles.svelte -->
<script>
  import { filteredBattles } from "./battleStore.js";
  import { onMount, onDestroy } from "svelte";

  let minInvolved = 2;
  let canvas;
  let ctx;
  let bubbles = new Map();
  let animationFrame;
  let defaultSize = 40; // Default size when canvas isn't ready

  // Physics constants
  // Physics constants
  const FRICTION = 0.99;
  const REPULSION = 0.5;
  const FLASH_DURATION = 1000;
  const BATTLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes in milliseconds

  class Bubble {
    constructor(battle) {
      if (!battle) {
        throw new Error("Battle data is required for Bubble construction");
      }

      this.battle = battle;
      this.id =
        battle.battleId || `${battle.systemId}-${battle.kills[0]?.killmail_id}`;

      // Position properties
      this.x = canvas?.width ? canvas.width / 2 : 0;
      this.y = canvas?.height ? canvas.height / 2 : 0;

      // Velocity properties
      this.vx = (Math.random() - 0.5) * 0.1;
      this.vy = (Math.random() - 0.5) * 0.1;

      // Size properties
      this.lastValue = battle.totalValue;
      this.currentValue = battle.totalValue;
      this.targetSize = this.calculateSize();
      this.currentSize = 0;

      // Animation properties
      this.flashTime = Date.now();
      this.needsPositioning = true;
    }

    update(bubbles) {
      this.currentSize += (this.targetSize - this.currentSize) * 0.1;

      // Strong repulsion between bubbles to prevent overlap
      bubbles.forEach((other) => {
        if (other === this) return;

        const dx = other.x - this.x;
        const dy = other.y - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const minDist = (this.currentSize + other.currentSize) * 1.2; // 20% buffer between bubbles

        if (distance < minDist) {
          const angle = Math.atan2(dy, dx);
          const force = (minDist - distance) * 0.2; // Increased force for stronger separation
          const fx = Math.cos(angle) * force;
          const fy = Math.sin(angle) * force;

          // Apply stronger repulsion when bubbles are very close
          const repulsionMultiplier = Math.min(2, minDist / (distance + 1));

          this.vx -= fx * repulsionMultiplier;
          this.vy -= fy * repulsionMultiplier;
          other.vx += fx * repulsionMultiplier;
          other.vy += fy * repulsionMultiplier;
        }
      });

      // Add boundary checking to keep bubbles in view
      const margin = this.currentSize;
      const boundsForce = 0.1;

      if (this.x < margin) this.vx += boundsForce;
      if (this.x > canvas.width - margin) this.vx -= boundsForce;
      if (this.y < margin) this.vy += boundsForce;
      if (this.y > canvas.height - margin) this.vy -= boundsForce;

      // Update position with improved damping
      this.x += this.vx;
      this.y += this.vy;
      this.vx *= 0.95;
      this.vy *= 0.95;

      // Add slight gravitational pull to center to prevent bubbles from drifting too far
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const pullStrength = 0.001;

      this.vx += (centerX - this.x) * pullStrength;
      this.vy += (centerY - this.y) * pullStrength;
    }

    calculateSize() {
      const participantFactor = Math.log10(this.battle.involvedCount + 1) * 20;
      const valueFactor = Math.log10(this.battle.totalValue + 1) * 3;
      return Math.max(40, participantFactor + valueFactor);
    }

    calculateSize() {
      // Base size for minimum visibility
      const baseSize = 30;

      // Scale based on number of involved participants (logarithmic)
      const participantFactor = Math.log10(this.battle.involvedCount + 1) * 15;

      // Scale based on total value (logarithmic)
      // Add 1 to avoid log(0), scale down large values
      const valueFactor =
        Math.log10(Math.max(1, this.battle.totalValue / 1000000)) * 10;

      // Combine factors with base size
      const finalSize = baseSize + participantFactor + valueFactor;

      // Cap minimum and maximum sizes
      return Math.min(Math.max(30, finalSize), 120);
    }

    calculateTimeBasedColor() {
      const now = new Date().getTime();
      const battleAge = now - new Date(this.battle.lastKill).getTime();
      const timeRatio = battleAge / BATTLE_TIMEOUT;

      // Start with yellow (most time left), transition to orange, then red (about to pop)
      const r = Math.min(255, Math.floor(255 * (0.5 + timeRatio * 0.5)));
      const g = Math.max(0, Math.floor(255 * (1 - timeRatio)));
      const b = 0;

      return {
        r: r,
        g: g,
        b: b,
      };
    }

    draw(ctx) {
      // Calculate time-based color
      const color = this.calculateTimeBasedColor();

      // Create gradient for main bubble
      const gradient = ctx.createRadialGradient(
        this.x - this.currentSize * 0.3,
        this.y - this.currentSize * 0.3,
        0,
        this.x,
        this.y,
        this.currentSize
      );

      // Add gradient stops with time-based color
      gradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, 0.9)`);
      gradient.addColorStop(
        1,
        `rgba(${Math.floor(color.r * 0.8)}, ${Math.floor(color.g * 0.8)}, ${color.b}, 0.7)`
      );

      // Draw main bubble
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.currentSize, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Add a subtle glow effect
      const glowGradient = ctx.createRadialGradient(
        this.x,
        this.y,
        this.currentSize * 0.8,
        this.x,
        this.y,
        this.currentSize * 1.2
      );
      glowGradient.addColorStop(
        0,
        `rgba(${color.r}, ${color.g}, ${color.b}, 0.2)`
      );
      glowGradient.addColorStop(1, "rgba(0, 0, 0, 0)");

      ctx.beginPath();
      ctx.arc(this.x, this.y, this.currentSize * 1.2, 0, Math.PI * 2);
      ctx.fillStyle = glowGradient;
      ctx.fill();

      // Draw text information
      ctx.font = `${Math.max(14, this.currentSize / 5)}px Arial`;
      ctx.fillStyle = "white";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const lineHeight = this.currentSize / 3;

      // System name
      const systemName =
        this.battle.kills[0]?.pinpoints?.celestialData?.solarsystemname ||
        this.battle.systemId;
      ctx.fillText(systemName, this.x, this.y - lineHeight);

      // Number of pilots
      ctx.fillText(`${this.battle.involvedCount} pilots`, this.x, this.y);

      // Total value
      ctx.fillText(
        `${formatValue(this.battle.totalValue)} ISK`,
        this.x,
        this.y + lineHeight
      );
    }

    containsPoint(x, y) {
      const dx = this.x - x;
      const dy = this.y - y;
      return Math.sqrt(dx * dx + dy * dy) <= this.currentSize;
    }
  }

  function formatValue(value) {
    if (value >= 1000000000) {
      return (value / 1000000000).toFixed(2) + "B";
    }
    if (value >= 1000000) {
      return (value / 1000000).toFixed(2) + "M";
    }
    return (value / 1000).toFixed(2) + "K";
  }

  function handleClick(event) {
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Convert position to canvas coordinates
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = x * scaleX;
    const canvasY = y * scaleY;

    // Find clicked bubble
    for (let bubble of bubbles.values()) {
      if (bubble.containsPoint(canvasX, canvasY)) {
        // Get the most recent kill from the battle
        const latestKill = bubble.battle.kills.sort(
          (a, b) =>
            new Date(b.killmail.killmail_time) -
            new Date(a.killmail.killmail_time)
        )[0];

        if (latestKill?.killID) {
          window.open(
            `https://zkillboard.com/kill/${latestKill.killID}/`,
            "_blank"
          );
        }
        break;
      }
    }
  }

  // In animate function
  function animate() {
    if (!canvas || !ctx) {
      console.log("Canvas or context not available");
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    console.log("Drawing bubbles:", bubbles.size);

    bubbles.forEach((bubble) => {
      if (bubble.needsPositioning && canvas) {
        bubble.x = canvas.width / 2;
        bubble.y = canvas.height / 2;
        bubble.needsPositioning = false;
      }
      bubble.update(bubbles);
      bubble.draw(ctx);
    });

    animationFrame = requestAnimationFrame(animate);
  }

  function handleResize() {
    if (!canvas) return;

    // Use actual pixel dimensions
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    // Reset all bubbles to center when resizing
    bubbles.forEach((bubble) => {
      bubble.x = canvas.width / 2;
      bubble.y = canvas.height / 2;
    });
  }

  function initializeCanvas() {
    if (!canvas) return;

    ctx = canvas.getContext("2d");

    // Set canvas dimensions to match display size
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    // Position all bubbles initially
    bubbles.forEach((bubble) => {
      bubble.x = canvas.width / 2;
      bubble.y = canvas.height / 2;
      bubble.needsPositioning = false;
    });

    // Start animation loop
    animate();
  }

  $: {
    // Filter battles by minimum involved
    const battles = $filteredBattles.filter(
      (battle) => battle.involvedCount >= minInvolved
    );

    if (canvas) {
      // Position any bubbles that need it
      bubbles.forEach((bubble) => {
        if (bubble.needsPositioning) {
          bubble.x = canvas.width / 2;
          bubble.y = canvas.height / 2;
          bubble.needsPositioning = false;
        }
      });
    }

    console.log("Processing filtered battles:", battles.length);

    // Generate unique IDs based on system and first kill if battleId not present
    battles.forEach((battle) => {
      if (!battle.id) {
        battle.id = `${battle.systemId}-${battle.kills[0].killmail_id}`;
      }
    });

    // Clear any bubbles for battles that no longer exist
    bubbles.forEach((bubble, id) => {
      if (!battles.find((b) => b.id === id)) {
        bubbles.delete(id);
      }
    });

    // Create new bubbles for battles that don't have them
    battles.forEach((battle) => {
      if (!bubbles.has(battle.id)) {
        console.log("Creating new bubble for battle:", battle.id);
        bubbles.set(battle.id, new Bubble(battle));
      } else {
        // Update existing bubble with new battle data
        const bubble = bubbles.get(battle.id);
        bubble.battle = battle;
        bubble.targetSize = bubble.calculateSize();
        if (battle.totalValue > bubble.lastValue) {
          bubble.flashTime = Date.now();
        }
        bubble.lastValue = bubble.currentValue;
        bubble.currentValue = battle.totalValue;
      }
    });
  }

  onMount(() => {
    initializeCanvas();
    window.addEventListener("resize", handleResize);
    animationFrame = requestAnimationFrame(animate); // Store the animation frame
  });

  onDestroy(() => {
    window.removeEventListener("resize", handleResize);
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
    }
  });
</script>

<div class="active-battles">
  <div class="controls">
    <label>
      Minimum Pilots Involved: {minInvolved}
      <input type="range" bind:value={minInvolved} min="2" max="20" step="1" />
    </label>
  </div>

  <canvas bind:this={canvas} on:click={handleClick} />
</div>

<style>
  .active-battles {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .controls {
    padding: 1em;
    background: rgba(0, 0, 0, 0.5);
  }

  canvas {
    flex: 1;
    cursor: pointer;
  }

  input[type="range"] {
    width: 200px;
  }

  .active-battles {
    display: flex;
    flex-direction: column;
    height: 100vh; /* Set explicit height */
  }

  canvas {
    flex: 1;
    cursor: pointer;
    width: 100%; /* Set explicit width */
    height: 100%; /* Set explicit height */
  }

  label {
    color: white;
    display: flex;
    align-items: center;
    gap: 1em;
  }
</style>
