<script>
  import { onMount } from "svelte";
  import { fly, fade } from "svelte/transition";

  export let wrecks = [];
  export let totalValue = 0;
  export let onClose;

  let canvas;
  let ctx;
  let animationFrame;
  let wreckObjects = [];
  let debrisParticles = [];

  // Generate random polygon points for wreck shapes
  function generateWreckShape(size) {
    const points = [];
    const segments = 5 + Math.floor(Math.random() * 4); // 5-8 segments
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const variance = 0.5 + Math.random() * 0.5; // 50-100% of size
      const radius = size * variance;
      points.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      });
    }
    return points;
  }

  class Debris {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.size = 1 + Math.random() * 3;
      this.dx = (Math.random() - 0.5) * 0.3;
      this.dy = (Math.random() - 0.5) * 0.3;
      this.rotation = Math.random() * Math.PI * 2;
      this.rotationSpeed = (Math.random() - 0.5) * 0.05;
    }

    update(width, height) {
      // Add subtle sinusoidal movement
      this.dx += Math.sin(this.sinOffset) * this.sinAmplitude;
      this.dy += Math.cos(this.sinOffset) * this.sinAmplitude;
      this.sinOffset += 0.01;

      // Dampen movement to prevent excessive speed
      this.dx *= 0.99;
      this.dy *= 0.99;

      this.x += this.dx;
      this.y += this.dy;
      this.rotation += this.rotationSpeed;

      // Pulse size effect
      this.pulsePhase += this.pulseSpeed;
      const pulseFactor = 1 + Math.sin(this.pulsePhase) * 0.05;
      this.size = this.baseSize * pulseFactor;

      // Wrap around screen with smoother transition
      const margin = this.size * 2;
      if (this.x < -margin) this.x = width + margin;
      if (this.x > width + margin) this.x = -margin;
      if (this.y < -margin) this.y = height + margin;
      if (this.y > height + margin) this.y = -margin;
    }

    draw(ctx) {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rotation);

      ctx.beginPath();
      ctx.moveTo(-this.size, -this.size);
      ctx.lineTo(this.size, -this.size);
      ctx.lineTo(0, this.size);
      ctx.closePath();

      ctx.strokeStyle = "#3d4758";
      ctx.strokeWidth = 1;
      ctx.stroke();

      // Add a subtle glint
      ctx.beginPath();
      ctx.arc(-this.size / 4, -this.size / 4, 2, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff33";
      ctx.fill();

      ctx.restore();
    }
  }

  class WreckObject {
    constructor(wreck, x, y) {
      this.wreck = wreck;
      this.x = x;
      this.y = y;
      this.rotation = Math.random() * Math.PI * 2;
      this.rotationSpeed = (Math.random() - 0.5) * 0.02;
      this.dx = (Math.random() - 0.5) * 0.5;
      this.dy = (Math.random() - 0.5) * 0.5;
      this.pulsePhase = Math.random() * Math.PI * 2; // Random starting phase for pulse
      this.pulseSpeed = 0.05;
      this.baseSize = 20 + Math.floor(Math.random() * 30);
      this.size = this.baseSize;
      this.points = generateWreckShape(this.size);

      // Add slight randomness to movement
      this.sinOffset = Math.random() * Math.PI * 2;
      this.sinAmplitude = 0.1;
    }

    update(width, height) {
      this.x += this.dx;
      this.y += this.dy;
      this.rotation += this.rotationSpeed;

      // Wrap around screen
      if (this.x < 0) this.x = width;
      if (this.x > width) this.x = 0;
      if (this.y < 0) this.y = height;
      if (this.y > height) this.y = 0;
    }

    draw(ctx) {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rotation);

      // Draw wreck shape with glow effect
      ctx.shadowBlur = 10;
      ctx.shadowColor = "#4a556844";

      ctx.beginPath();
      ctx.moveTo(this.points[0].x, this.points[0].y);
      for (let i = 1; i < this.points.length; i++) {
        ctx.lineTo(this.points[i].x, this.points[i].y);
      }
      ctx.closePath();

      // Inner fill
      ctx.fillStyle = "#1a1a1a";
      ctx.fill();

      // Outer stroke with glow
      ctx.strokeStyle = "#4a5568";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Reset shadow
      ctx.shadowBlur = 0;

      // Draw ship name
      ctx.rotate(-this.rotation);
      ctx.fillStyle = "#a0aec0";
      ctx.font = "12px monospace";
      ctx.textAlign = "center";
      ctx.fillText(this.wreck.shipName, 0, this.size + 15);

      ctx.restore();
    }
  }

  function initObjects() {
    const width = canvas.width;
    const height = canvas.height;

    // Initialize wrecks
    wreckObjects = wrecks.map(
      (wreck) =>
        new WreckObject(wreck, Math.random() * width, Math.random() * height)
    );

    // Initialize debris based on total value
    const debrisCount = Math.min(200, Math.floor(totalValue / 1000000)); // 1 debris per million ISK, max 200
    debrisParticles = Array(debrisCount)
      .fill(null)
      .map(() => new Debris(Math.random() * width, Math.random() * height));
  }

  function animate() {
    if (!canvas || !ctx) return;

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw debris first
    debrisParticles.forEach((debris) => {
      debris.update(canvas.width, canvas.height);
      debris.draw(ctx);
    });

    // Then draw wrecks
    wreckObjects.forEach((wreck) => {
      wreck.update(canvas.width, canvas.height);
      wreck.draw(ctx);
    });

    animationFrame = requestAnimationFrame(animate);
  }

  onMount(() => {
    ctx = canvas.getContext("2d");

    // Set canvas size
    const updateCanvasSize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };

    updateCanvasSize();
    window.addEventListener("resize", updateCanvasSize);

    initObjects();
    animate();

    return () => {
      window.removeEventListener("resize", updateCanvasSize);
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
    };
  });
</script>

<div
  class="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
  on:click={onClose}
  transition:fade
>
  <div
    class="bg-black border border-eve-secondary/30 rounded-lg p-4 w-[800px] h-[600px] shadow-xl shadow-black/50"
    on:click|stopPropagation
    transition:fly={{ y: 20, duration: 200 }}
  >
    <div class="flex justify-between items-center mb-4">
      <h3 class="text-lg font-semibold text-eve-accent">
        Wreck Field Visualization
      </h3>
      <button
        class="text-gray-400 hover:text-white transition-colors"
        on:click={onClose}
      >
        ✕
      </button>
    </div>
    <canvas bind:this={canvas} class="w-full h-[520px] bg-black rounded"
    ></canvas>
  </div>
</div>
