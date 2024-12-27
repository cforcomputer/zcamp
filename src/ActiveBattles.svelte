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
  const FRICTION = 0.99;
  const REPULSION = 0.5;
  const FLASH_DURATION = 1000;

  class Bubble {
    constructor(battle) {
      this.battle = battle;
      this.id =
        battle.battleId || `${battle.systemId}-${battle.kills[0]?.killmail_id}`;

      // Use default center position if canvas isn't ready
      this.x = canvas?.width ? canvas.width / 2 : 0;
      this.y = canvas?.height ? canvas.height / 2 : 0;

      this.vx = (Math.random() - 0.5) * 0.1;
      this.vy = (Math.random() - 0.5) * 0.1;

      this.lastValue = this.currentValue || battle.totalValue;
      this.currentValue = battle.totalValue;
      this.targetSize = this.calculateSize();
      this.currentSize = 0;
      this.flashTime = Date.now();

      // Flag to indicate bubble needs positioning
      this.needsPositioning = true;
    }

    calculateSize() {
      const participantFactor = Math.log10(this.battle.involvedCount + 1) * 20;
      const valueFactor = Math.log10(this.battle.totalValue + 1) * 3;
      return Math.max(40, participantFactor + valueFactor);
    }

    update(bubbles) {
      this.currentSize += (this.targetSize - this.currentSize) * 0.1;

      // Strong center gravity
      const dx = canvas.width / 2 - this.x;
      const dy = canvas.height / 2 - this.y;
      const centerForce = 0.02;
      this.vx += dx * centerForce;
      this.vy += dy * centerForce;

      // Update position
      this.x += this.vx;
      this.y += this.vy;
      this.vx *= 0.95;
      this.vy *= 0.95;

      // Strong repulsion between bubbles
      bubbles.forEach((other) => {
        if (other === this) return;
        const dx = other.x - this.x;
        const dy = other.y - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const minDist = (this.currentSize + other.currentSize) * 1.1;

        if (distance < minDist) {
          const angle = Math.atan2(dy, dx);
          const force = (minDist - distance) * 0.1;
          const fx = Math.cos(angle) * force;
          const fy = Math.sin(angle) * force;

          this.vx -= fx;
          this.vy -= fy;
          other.vx += fx;
          other.vy += fy;
        }
      });
    }

    draw(ctx) {
      const gradient = ctx.createRadialGradient(
        this.x - this.currentSize * 0.3,
        this.y - this.currentSize * 0.3,
        0,
        this.x,
        this.y,
        this.currentSize
      );

      const flashProgress = this.flashTime
        ? (Date.now() - this.flashTime) / FLASH_DURATION
        : 1;
      const flash = Math.max(0, 1 - flashProgress);

      gradient.addColorStop(
        0,
        `rgba(255, ${50 + 150 * flash}, ${50 + 150 * flash}, 0.9)`
      );
      gradient.addColorStop(
        1,
        `rgba(200, ${20 + 100 * flash}, ${20 + 100 * flash}, 0.7)`
      );

      ctx.beginPath();
      ctx.arc(this.x, this.y, this.currentSize, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Simple white text directly on sphere
      ctx.font = `${Math.max(14, this.currentSize / 5)}px Arial`;
      ctx.fillStyle = "white";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const lineHeight = this.currentSize / 3;
      const systemName =
        this.battle.kills[0]?.pinpoints?.nearestCelestial?.name?.split(
          " "
        )[0] || this.battle.systemId;

      ctx.fillText(systemName, this.x, this.y - lineHeight);
      ctx.fillText(`${this.battle.involvedCount} pilots`, this.x, this.y);
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
