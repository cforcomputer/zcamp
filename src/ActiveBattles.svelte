<!-- src/ActiveBattles.svelte -->
<script>
  import { filteredBattles } from "./battleStore.js";
  import { onMount, onDestroy } from "svelte";

  let minInvolved = 2;
  let canvas;
  let ctx;
  let bubbles = new Map();
  let animationFrame;

  // Physics constants
  const FRICTION = 0.99;
  const REPULSION = 0.2;
  const FLASH_DURATION = 1000;

  class Bubble {
    constructor(battle) {
      this.battle = battle;
      this.id = battle.kills[0]?.killmail_id;
      this.x = this.x || Math.random() * window.innerWidth;
      this.y = this.y || Math.random() * window.innerHeight;
      this.vx = this.vx || Math.random() - 0.5;
      this.vy = this.vy || Math.random() - 0.5;
      this.lastValue = this.currentValue || battle.totalValue;
      this.currentValue = battle.totalValue;
      this.targetSize = this.calculateSize();
      this.currentSize = this.currentSize || 0;
      this.flashTime = this.currentValue > this.lastValue ? Date.now() : 0;
    }

    calculateSize() {
      return Math.max(30, Math.log10(this.battle.totalValue + 1) * 10);
    }

    update(bubbles) {
      // Smooth size transition
      this.currentSize += (this.targetSize - this.currentSize) * 0.1;

      // Physics updates
      this.x += this.vx;
      this.y += this.vy;
      this.vx *= FRICTION;
      this.vy *= FRICTION;

      // Boundary checks with size
      const padding = this.currentSize * 1.2; // Extra padding for text
      if (this.x < padding) {
        this.x = padding;
        this.vx *= -0.5;
      }
      if (this.x > canvas.width - padding) {
        this.x = canvas.width - padding;
        this.vx *= -0.5;
      }
      if (this.y < padding) {
        this.y = padding;
        this.vy *= -0.5;
      }
      if (this.y > canvas.height - padding) {
        this.y = canvas.height - padding;
        this.vy *= -0.5;
      }

      // Bubble collision and repulsion
      bubbles.forEach((other) => {
        if (other === this) return;
        const dx = other.x - this.x;
        const dy = other.y - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const minDist = this.currentSize + other.currentSize;

        if (distance < minDist) {
          const angle = Math.atan2(dy, dx);
          const force = (minDist - distance) * REPULSION;
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
      const flashProgress = this.flashTime
        ? (Date.now() - this.flashTime) / FLASH_DURATION
        : 1;
      const flash = Math.max(0, 1 - flashProgress);

      // Draw bubble with flash effect
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.currentSize, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${255 * flash}, ${50}, ${50}, ${0.2 + this.battle.involvedCount / 50})`;
      ctx.strokeStyle = `rgba(255, ${100 * flash}, ${100 * flash}, 0.5)`;
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();

      // Draw text with background
      const systemName =
        this.battle.kills[0]?.pinpoints?.nearestCelestial?.name?.split(
          " "
        )[0] || this.battle.systemId;
      const pilotText = `${this.battle.involvedCount} pilots`;
      const valueText = `${formatValue(this.battle.totalValue)} ISK`;

      ctx.font = `${Math.max(14, this.currentSize / 5)}px Arial`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Text background
      const padding = 4;
      const lineHeight = Math.max(16, this.currentSize / 5) * 1.2;

      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(
        this.x - ctx.measureText(systemName).width / 2 - padding,
        this.y - lineHeight * 1.5 - padding,
        ctx.measureText(systemName).width + padding * 2,
        lineHeight * 3 + padding * 2
      );

      // Text
      ctx.fillStyle = "white";
      ctx.fillText(systemName, this.x, this.y - lineHeight);
      ctx.fillText(pilotText, this.x, this.y);
      ctx.fillText(valueText, this.x, this.y + lineHeight);
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
        const latestKill = bubble.battle.kills[bubble.battle.kills.length - 1];
        window.open(
          `https://zkillboard.com/kill/${latestKill.killmail_id}/`,
          "_blank"
        );
        break;
      }
    }
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    bubbles.forEach((bubble) => {
      bubble.update(bubbles);
      bubble.draw(ctx);
    });
    animationFrame = requestAnimationFrame(animate);
  }

  function handleResize() {
    if (canvas) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight - 100; // Account for controls
    }
  }

  $: {
    // Filter battles by minimum involved
    const battles = $filteredBattles.filter(
      (battle) => battle.involvedCount >= minInvolved
    );

    // Update bubbles map
    const newBubbles = new Map();
    battles.forEach((battle) => {
      const id = battle.kills[0]?.killmail_id;
      const existingBubble = bubbles.get(id);
      if (existingBubble) {
        existingBubble.battle = battle;
        existingBubble.targetSize = existingBubble.calculateSize();
        if (battle.totalValue > existingBubble.lastValue) {
          existingBubble.flashTime = Date.now();
        }
        existingBubble.lastValue = existingBubble.currentValue;
        existingBubble.currentValue = battle.totalValue;
        newBubbles.set(id, existingBubble);
      } else {
        newBubbles.set(id, new Bubble(battle));
      }
    });
    bubbles = newBubbles;
  }

  onMount(() => {
    ctx = canvas.getContext("2d");
    handleResize();
    window.addEventListener("resize", handleResize);
    animate();
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

  label {
    color: white;
    display: flex;
    align-items: center;
    gap: 1em;
  }
</style>
