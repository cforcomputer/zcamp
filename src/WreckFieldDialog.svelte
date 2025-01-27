<script>
  import { onMount, onDestroy } from "svelte";

  export let wrecks = [];
  export let totalValue = 0;
  // export let onClose;
  export let nearestCelestial = { type: "none", name: "" };

  let canvas;
  let ctx;
  let animationFrame;
  let wreckObjects = [];
  let stars = [];
  let debris = [];
  const CONTAINER_VALUE = 10000000; // 10M ISK per container

  // Background patterns based on celestial type
  const backgroundPatterns = {
    stargate: () => {
      const size = 100;
      const pattern = document.createElement("canvas");
      pattern.width = size;
      pattern.height = size;
      const pctx = pattern.getContext("2d");

      // Draw stargate-like pattern
      pctx.strokeStyle = "#1a4a6e";
      pctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const offset = i * (size / 4);
        pctx.beginPath();
        pctx.arc(size / 2, size / 2, 10 + offset, 0, Math.PI * 2);
        pctx.stroke();
      }

      return pattern;
    },
    station: () => {
      const size = 100;
      const pattern = document.createElement("canvas");
      pattern.width = size;
      pattern.height = size;
      const pctx = pattern.getContext("2d");

      // Draw station-like grid pattern
      pctx.strokeStyle = "#4a1a6e";
      pctx.lineWidth = 1;
      const gridSize = 20;
      for (let i = 0; i < size; i += gridSize) {
        pctx.beginPath();
        pctx.moveTo(i, 0);
        pctx.lineTo(i, size);
        pctx.moveTo(0, i);
        pctx.lineTo(size, i);
        pctx.stroke();
      }

      return pattern;
    },
    moon: () => {
      const size = 100;
      const pattern = document.createElement("canvas");
      pattern.width = size;
      pattern.height = size;
      const pctx = pattern.getContext("2d");

      // Draw crater-like pattern
      pctx.fillStyle = "#2a2a2a";
      for (let i = 0; i < 5; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const radius = 5 + Math.random() * 10;
        pctx.beginPath();
        pctx.arc(x, y, radius, 0, Math.PI * 2);
        pctx.fill();
      }

      return pattern;
    },
    "asteroid belt": () => {
      const size = 100;
      const pattern = document.createElement("canvas");
      pattern.width = size;
      pattern.height = size;
      const pctx = pattern.getContext("2d");

      // Draw asteroid-like dots
      pctx.fillStyle = "#3a3a3a";
      for (let i = 0; i < 20; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const size = 1 + Math.random() * 2;
        pctx.beginPath();
        pctx.arc(x, y, size, 0, Math.PI * 2);
        pctx.fill();
      }

      return pattern;
    },
  };

  class Wreck {
    constructor(wreckData) {
      this.data = wreckData;
      this.baseSize = 12 + Math.log10(wreckData.estimatedValue) * 4;
      this.x = canvas.width / 2 + (Math.random() - 0.5) * 200;
      this.y = canvas.height / 2 + (Math.random() - 0.5) * 200;
      this.rotation = Math.random() * Math.PI * 2;
      this.rotationSpeed = (Math.random() - 0.5) * 0.01;
      this.color = this.generatePixelColor();
      this.shapePoints = this.generateFractalShape();
      this.debrisCloud = this.generateDebrisCloud();
      this.details = this.generateStructuralDetails();

      // Calculate label dimensions
      const TEXT_SIZE = 12;
      const PADDING = 6;
      const tempCanvas = document.createElement("canvas");
      const tempCtx = tempCanvas.getContext("2d");
      tempCtx.font = `${TEXT_SIZE}px 'Press Start 2P', monospace`;
      this.labelWidth =
        tempCtx.measureText(wreckData.shipName).width + PADDING * 2;
      this.labelHeight = TEXT_SIZE + PADDING * 2;

      this.label = {
        text: wreckData.shipName,
        offset: { x: 0, y: this.baseSize + 15 }, // Initial offset
        width: this.labelWidth,
        height: this.labelHeight,
      };
    }

    generatePixelColor() {
      const colors = [
        "#7CAFC2", // Light Blue
        "#A1B56C", // Light Green
        "#DC9656", // Light Orange
        "#BA8BAF", // Light Purple
        "#86C1B9", // Light Cyan
      ];
      return colors[Math.floor(Math.random() * colors.length)];
    }

    generateDebrisCloud() {
      return Array(16) // Fewer, larger pieces
        .fill()
        .map(() => ({
          x: (Math.random() - 0.5) * this.baseSize * 4,
          y: (Math.random() - 0.5) * this.baseSize * 4,
          size: 3 + Math.floor(Math.random() * 4), // Larger debris
          angle: Math.random() * Math.PI * 2,
          speed: 0.0005 + Math.random() * 0.001, // Much slower rotation
          distance: this.baseSize * (1.5 + Math.random()),
          shape: Math.floor(Math.random() * 3), // Random shape type
        }));
    }

    generateFractalShape() {
      const points = [];
      const basePoints = this.generateBaseShape();
      const iterations = 3;

      function subdivide(p1, p2, depth) {
        if (depth === 0) return [];

        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        const displacement = (Math.random() - 0.5) * (p1.x - p2.x) * 0.3;

        const midPoint = {
          x: midX + displacement,
          y: midY + displacement,
        };

        return [
          ...subdivide(p1, midPoint, depth - 1),
          midPoint,
          ...subdivide(midPoint, p2, depth - 1),
        ];
      }

      for (let i = 0; i < basePoints.length; i++) {
        const p1 = basePoints[i];
        const p2 = basePoints[(i + 1) % basePoints.length];
        points.push(p1, ...subdivide(p1, p2, iterations));
      }

      return points;
    }

    generateBaseShape() {
      const variants = [
        // Corvette shape
        () => {
          const length = this.baseSize * 2;
          const width = this.baseSize * 0.8;
          return [
            { x: -length / 2, y: 0 },
            { x: -length / 3, y: -width / 2 },
            { x: length / 3, y: -width / 3 },
            { x: length / 2, y: 0 },
            { x: length / 3, y: width / 3 },
            { x: -length / 3, y: width / 2 },
          ];
        },
        // Frigate shape
        () => {
          const points = [];
          const segments = 8;
          for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const variance = 0.6 + Math.floor(Math.random() * 5) * 0.2;
            const radius =
              this.baseSize * variance * (1 + Math.sin(angle * 3) * 0.2);
            points.push({
              x: Math.cos(angle) * radius,
              y: Math.sin(angle) * radius,
            });
          }
          return points;
        },
        // Cruiser shape
        () => {
          const width = this.baseSize * 1.5;
          const gap = this.baseSize * 0.3;
          return [
            { x: -width / 2, y: -gap },
            { x: -width / 4, y: -gap * 2 },
            { x: width / 2, y: -gap },
            { x: width / 2, y: gap },
            { x: -width / 4, y: gap * 2 },
            { x: -width / 2, y: gap },
          ];
        },
      ];

      return variants[Math.floor(Math.random() * variants.length)]();
    }

    generateStructuralDetails() {
      const details = [];
      const detailCount = 3 + Math.floor(Math.random() * 4);

      for (let i = 0; i < detailCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = this.baseSize * (0.3 + Math.random() * 0.4);
        const size = 2 + Math.floor(Math.random() * 3);

        details.push({
          x: Math.cos(angle) * distance,
          y: Math.sin(angle) * distance,
          size,
          type: Math.random() > 0.5 ? "panel" : "structure",
        });
      }

      return details;
    }

    update() {
      this.rotation += this.rotationSpeed;

      this.debrisCloud.forEach((debris) => {
        debris.angle += debris.speed;
        const radius = debris.distance + Math.sin(debris.angle * 2) * 5;
        debris.x = Math.cos(debris.angle) * radius;
        debris.y = Math.sin(debris.angle) * radius;
      });
    }

    drawDebris(ctx, debris) {
      const { x, y, size, shape } = debris;
      ctx.fillStyle = this.color; // Use wreck's color
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;

      switch (shape) {
        case 0: // Triangle
          ctx.beginPath();
          ctx.moveTo(x, y - size);
          ctx.lineTo(x - size, y + size);
          ctx.lineTo(x + size, y + size);
          ctx.closePath();
          break;
        case 1: // Diamond
          ctx.beginPath();
          ctx.moveTo(x, y - size);
          ctx.lineTo(x + size, y);
          ctx.lineTo(x, y + size);
          ctx.lineTo(x - size, y);
          ctx.closePath();
          break;
        default: // Rectangle
          ctx.beginPath();
          ctx.rect(x - size / 2, y - size / 2, size, size);
          break;
      }

      ctx.fill();
      ctx.stroke();
    }

    draw(ctx) {
      ctx.save();
      ctx.translate(Math.round(this.x), Math.round(this.y));

      // Draw debris cloud
      this.debrisCloud.forEach((debris) => {
        ctx.save();
        ctx.translate(Math.round(debris.x), Math.round(debris.y));
        this.drawDebris(ctx, debris);
        ctx.restore();
      });

      // Draw wreck
      ctx.rotate(this.rotation);

      // Main shape
      ctx.beginPath();
      ctx.moveTo(
        Math.round(this.shapePoints[0].x),
        Math.round(this.shapePoints[0].y)
      );
      this.shapePoints.forEach((point) => {
        ctx.lineTo(Math.round(point.x), Math.round(point.y));
      });
      ctx.closePath();

      ctx.fillStyle = this.color;
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Draw structural details
      this.details.forEach((detail) => {
        if (detail.type === "panel") {
          ctx.strokeRect(
            Math.round(detail.x - detail.size / 2),
            Math.round(detail.y - detail.size / 2),
            detail.size,
            detail.size
          );
        } else {
          ctx.beginPath();
          ctx.moveTo(detail.x - detail.size, detail.y);
          ctx.lineTo(detail.x + detail.size, detail.y);
          ctx.moveTo(detail.x, detail.y - detail.size);
          ctx.lineTo(detail.x, detail.y + detail.size);
          ctx.stroke();
        }
      });

      ctx.restore();
    }

    drawLabel(ctx) {
      const TEXT_SIZE = 12;
      const PADDING = 6;
      const HEIGHT = TEXT_SIZE + PADDING * 2;

      const labelCanvas = document.createElement("canvas");
      const labelCtx = labelCanvas.getContext("2d");

      labelCtx.font = `${TEXT_SIZE}px 'Press Start 2P', monospace`;
      const width = this.labelWidth;

      labelCanvas.width = width;
      labelCanvas.height = HEIGHT;

      labelCtx.font = `${TEXT_SIZE}px 'Press Start 2P', monospace`;

      labelCtx.fillStyle = "rgba(0, 0, 0, 0.8)";
      labelCtx.fillRect(0, 0, width, HEIGHT);

      labelCtx.strokeStyle = "#ffffff";
      labelCtx.lineWidth = 1;
      labelCtx.strokeRect(0.5, 0.5, width - 1, HEIGHT - 1);

      labelCtx.fillStyle = "#ffffff";
      labelCtx.textAlign = "center";
      labelCtx.textBaseline = "middle";
      labelCtx.fillText(this.label.text, width / 2, HEIGHT / 2);

      // Use the offset when drawing
      const screenX = Math.round(this.x + this.label.offset.x - width / 2);
      const screenY = Math.round(this.y + this.label.offset.y);

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(labelCanvas, screenX, screenY, width, HEIGHT);
      ctx.imageSmoothingEnabled = true;
    }

    // Check if this label overlaps with another label
    labelsOverlap(other) {
      const b1 = this.getLabelBounds();
      const b2 = other.getLabelBounds();

      return !(
        b1.right < b2.left ||
        b1.left > b2.right ||
        b1.bottom < b2.top ||
        b1.top > b2.bottom
      );
    }

    // Get label bounds based on current position and offset
    getLabelBounds() {
      return {
        left: this.x + this.label.offset.x - this.labelWidth / 2,
        right: this.x + this.label.offset.x + this.labelWidth / 2,
        top: this.y + this.label.offset.y,
        bottom: this.y + this.label.offset.y + this.labelHeight,
      };
    }
  }

  function createStars() {
    const starCount = 200;
    stars = Array(starCount)
      .fill()
      .map(() => ({
        x: Math.floor(Math.random() * canvas.width),
        y: Math.floor(Math.random() * canvas.height),
        size: Math.random() > 0.9 ? 2 : 1,
        brightness: 0.5 + Math.random() * 0.5,
      }));
  }

  function drawContainer(ctx, x, y, size, rotation, type) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);

    // Draw container background
    ctx.fillStyle = type === "cargo" ? "#4a4a4a" : "#6a4a2d";
    ctx.fillRect(-size / 2, -size / 2, size, size);

    // Draw container details
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.strokeRect(-size / 2, -size / 2, size, size);

    // Add container details
    const innerPadding = 2;
    ctx.strokeRect(
      -size / 2 + innerPadding,
      -size / 2 + innerPadding,
      size - innerPadding * 2,
      size - innerPadding * 2
    );

    ctx.restore();
  }

  function createDebrisField() {
    const debrisCount = Math.floor(totalValue / CONTAINER_VALUE);
    debris = Array(debrisCount)
      .fill()
      .map(() => ({
        x: canvas.width / 2 + (Math.random() - 0.5) * 400,
        y: canvas.height / 2 + (Math.random() - 0.5) * 400,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.005, // Even slower rotation
        size: 6 + Math.floor(Math.random() * 4), // Bigger containers
        type: Math.random() > 0.5 ? "cargo" : "secure", // Random container type
      }));
  }

  function animate() {
    ctx.fillStyle = "rgba(0, 0, 0, 0.95)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw background pattern if applicable
    if (
      nearestCelestial?.type &&
      backgroundPatterns[nearestCelestial.type.toLowerCase()]
    ) {
      const pattern = backgroundPatterns[nearestCelestial.type.toLowerCase()]();
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = ctx.createPattern(pattern, "repeat");
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }

    // Draw stars
    stars.forEach((star) => {
      ctx.fillStyle = `rgba(255, 255, 255, ${star.brightness})`;
      ctx.fillRect(star.x, star.y, star.size, star.size);
    });

    // Draw containers (debris field)
    debris.forEach((d) => {
      drawContainer(ctx, d.x, d.y, d.size, d.rotation, d.type);
      d.rotation += d.rotationSpeed;
    });

    // Update and draw wrecks
    wreckObjects.forEach((wreck) => {
      wreck.update();
      wreck.draw(ctx);
    });

    // Draw all labels last to ensure they're on top
    wreckObjects.forEach((wreck) => {
      wreck.drawLabel(ctx);
    });

    animationFrame = requestAnimationFrame(animate);
  }

  function adjustLabelPositions(wrecks, maxIterations = 50) {
    const minDistance = 5; // Minimum space between labels
    const dampening = 0.3; // Reduce force strength
    const springStrength = 0.1; // Force pulling labels back to original positions
    const bounds = {
      left: 50,
      right: canvas.width - 50,
      top: 50,
      bottom: canvas.height - 50,
    };

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      let moved = false;

      for (let i = 0; i < wrecks.length; i++) {
        const wreck = wrecks[i];
        let dx = 0;
        let dy = 0;

        // Repulsion from other labels
        for (let j = 0; j < wrecks.length; j++) {
          if (i === j) continue;

          const other = wrecks[j];
          if (wreck.labelsOverlap(other)) {
            const myBounds = wreck.getLabelBounds();
            const otherBounds = other.getLabelBounds();

            // Calculate center points of labels
            const myCenter = {
              x: (myBounds.left + myBounds.right) / 2,
              y: (myBounds.top + myBounds.bottom) / 2,
            };
            const otherCenter = {
              x: (otherBounds.left + otherBounds.right) / 2,
              y: (otherBounds.top + otherBounds.bottom) / 2,
            };

            // Calculate repulsion
            const deltaX = myCenter.x - otherCenter.x;
            const deltaY = myCenter.y - otherCenter.y;
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY) || 1;

            // Stronger vertical force to encourage vertical stacking
            dx += (deltaX / distance) * 2;
            dy += (deltaY / distance) * 4;
            moved = true;
          }
        }

        // Spring force to pull label back to original position
        dx += -wreck.label.offset.x * springStrength;
        dy += -(wreck.label.offset.y - (wreck.baseSize + 15)) * springStrength;

        // Apply forces with dampening
        wreck.label.offset.x += dx * dampening;
        wreck.label.offset.y += dy * dampening;

        // Keep labels within bounds
        const labelBounds = wreck.getLabelBounds();
        if (labelBounds.left < bounds.left)
          wreck.label.offset.x += bounds.left - labelBounds.left;
        if (labelBounds.right > bounds.right)
          wreck.label.offset.x += bounds.right - labelBounds.right;
        if (labelBounds.top < bounds.top)
          wreck.label.offset.y += bounds.top - labelBounds.top;
        if (labelBounds.bottom > bounds.bottom)
          wreck.label.offset.y += bounds.bottom - labelBounds.bottom;
      }

      if (!moved) break;
    }
  }

  onMount(() => {
    ctx = canvas.getContext("2d");
    canvas.width = canvas.height = 600;

    createStars();
    createDebrisField();
    wreckObjects = wrecks.map((wreck) => new Wreck(wreck));

    // Add label position adjustment to the animation loop
    function animate() {
      ctx.fillStyle = "rgba(0, 0, 0, 0.95)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (
        nearestCelestial?.type &&
        backgroundPatterns[nearestCelestial.type.toLowerCase()]
      ) {
        const pattern =
          backgroundPatterns[nearestCelestial.type.toLowerCase()]();
        ctx.globalAlpha = 0.1;
        ctx.fillStyle = ctx.createPattern(pattern, "repeat");
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1;
      }

      stars.forEach((star) => {
        ctx.fillStyle = `rgba(255, 255, 255, ${star.brightness})`;
        ctx.fillRect(star.x, star.y, star.size, star.size);
      });

      debris.forEach((d) => {
        drawContainer(ctx, d.x, d.y, d.size, d.rotation, d.type);
        d.rotation += d.rotationSpeed;
      });

      // Update and draw wrecks
      wreckObjects.forEach((wreck) => {
        wreck.update();
        wreck.draw(ctx);
      });

      // Adjust label positions and draw them
      adjustLabelPositions(wreckObjects);
      wreckObjects.forEach((wreck) => {
        wreck.drawLabel(ctx);
      });

      animationFrame = requestAnimationFrame(animate);
    }

    animate();

    return () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
    };
  });
</script>

<div class="w-[600px] h-[600px] bg-black border border-white/20">
  <canvas bind:this={canvas} class="w-full h-full pixelated" />
</div>

<style>
  .pixelated {
    image-rendering: pixelated;
    image-rendering: crisp-edges;
    -webkit-font-smoothing: none;
    -moz-osx-font-smoothing: none;
  }
</style>
