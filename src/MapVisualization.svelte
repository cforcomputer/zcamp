<script>
  import { onMount, onDestroy } from "svelte";
  import * as THREE from "three";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

  export let killmailId;
  // Add kill as a prop
  export let kill;

  // Type checking
  $: if (kill && typeof kill !== "object") {
    throw new Error("kill prop must be an object");
  }

  import gsap from "gsap";

  let container;
  let scene, camera, renderer, controls;
  let compass;
  let error = null;

  let loading = true;
  let systemName = "";
  let closestCelestial = "Calculating...";
  let pinpoints = [
    "Calculating...",
    "Calculating...",
    "Calculating...",
    "Calculating...",
  ];
  let raycaster;
  let mouse;
  let hoveredObject = null;
  let selectedObject = null;
  let tooltipDiv;
  let spriteMap;
  let cameraTarget;
  let lastCameraPosition = new THREE.Vector3();
  let allCelestialData = null;
  const SCALE_FACTOR = 1e-9;
  const objectsWithLabels = new Map();
  const KM_PER_AU = 149597870.7;

  const SIZES = {
    KILL: { radius: 10 },
    SUN: { radius: 30 },
    PLANET: { radius: 0.003 },
    MOON: { radius: 0.00009 },
    ASTEROID: {
      radius: 0.05,
      particleCount: 5,
      spread: 0.1,
    },
    STARGATE: {
      radius: 6,
      length: 3,
      sphereRadius: 5,
    },
    STATION: { size: 20 },
  };

  $: if (kill) {
    console.log("Kill data in MapVisualization:", kill);
  }

  function createPinpointLines(pinpointData) {
    if (!pinpointData || !pinpointData.hasTetrahedron) return null;

    console.log("Creating pinpoint lines with data:", pinpointData);

    const points = pinpointData.points.map((point) => {
      // Convert string positions to numbers
      const x = parseFloat(point.position.x) * SCALE_FACTOR;
      const y = parseFloat(point.position.y) * SCALE_FACTOR;
      const z = parseFloat(point.position.z) * SCALE_FACTOR;

      console.log(`Celestial point ${point.name}:`, { x, y, z });
      return new THREE.Vector3(x, y, z);
    });

    const lineGeometry = new THREE.BufferGeometry();
    const linePositions = [];

    // Connect all points to each other
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        linePositions.push(points[i].x, points[i].y, points[i].z);
        linePositions.push(points[j].x, points[j].y, points[j].z);
      }
    }

    lineGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(linePositions, 3)
    );

    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.5,
      linewidth: 2,
    });

    const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
    console.log("Created lines at positions:", linePositions);

    return lines;
  }

  function createKillpointSprite(position) {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d");

    // Draw red circle with white border
    context.beginPath();
    context.arc(16, 16, 12, 0, 2 * Math.PI);
    context.fillStyle = "#ff0000";
    context.fill();
    context.strokeStyle = "#ffffff";
    context.lineWidth = 2;
    context.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      sizeAttenuation: true,
    });

    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.position.copy(position);
    sprite.scale.set(20, 20, 1); // Adjust size as needed

    return sprite;
  }

  function createLocationSprite(position, type, name) {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d");

    context.beginPath();
    context.arc(16, 16, 12, 0, 2 * Math.PI);

    let color;
    switch (type) {
      case "sun":
        color = "#ffff00";
        break;
      case "planet":
        color = "#00ff00";
        break;
      case "moon":
        color = "#808080";
        break;
      case "stargate":
        color = "#00ffff";
        break;
      case "station":
        color = "#ff00ff";
        break;
      case "asteroid":
        color = "#a0a0a0";
        break;
      default:
        color = "#ffffff";
    }

    context.fillStyle = color;
    context.fill();
    context.strokeStyle = "#ffffff";
    context.lineWidth = 1;
    context.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      sizeAttenuation: true,
    });

    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.position.copy(position);

    // Set the object type in objectsWithLabels BEFORE scaling
    objectsWithLabels.set(sprite, {
      name: name,
      type: type,
      position: sprite.position.clone(),
    });

    // Now scale after setting the type
    updateSpriteScale(sprite);

    const label = document.createElement("div");
    label.className = "celestial-label";
    label.style.display = "none";
    label.textContent = name;
    container.appendChild(label);

    const updateLabel = () => {
      if (sprite.visible) {
        const vector = sprite.position.clone();
        vector.project(camera);

        const x = (vector.x * 0.5 + 0.5) * container.clientWidth;
        const y = (-vector.y * 0.5 + 0.5) * container.clientHeight;

        label.style.transform = `translate(${x}px, ${y}px)`;

        const isFacing = vector.z < 1;
        label.style.display = isFacing ? "block" : "none";
      }
    };

    sprite.userData.updateLabel = updateLabel;
    sprite.userData.label = label;

    return sprite;
  }

  function findParentPlanet(moonData, celestialData) {
    // Get roman numeral from moon name (e.g., "Moon I" -> "I")
    const moonRoman = moonData.itemname.match(/ ([IVX]+)( -|$)/)?.[1];
    if (!moonRoman) return null;

    // Find planet with matching roman numeral
    return celestialData.find(
      (cel) =>
        cel.typename?.includes("Planet") &&
        cel.itemname.match(/ ([IVX]+)( -|$)/)?.[1] === moonRoman
    );
  }

  function createMoonOrbit(moonPosition, planetPosition, group) {
    // Calculate orbit parameters
    const relativePos = moonPosition.clone().sub(planetPosition);
    const orbitRadius = relativePos.length();
    const segments = 128;
    const orbitPoints = [];

    // Create orbit points around planet
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      orbitPoints.push(
        new THREE.Vector3(
          Math.cos(theta) * orbitRadius,
          0,
          Math.sin(theta) * orbitRadius
        )
      );
    }

    const orbitGeometry = new THREE.BufferGeometry().setFromPoints(orbitPoints);
    const orbitMaterial = new THREE.LineBasicMaterial({
      color: 0x444444,
      transparent: true,
      opacity: 0.5,
      linewidth: 1,
    });

    const orbit = new THREE.Line(orbitGeometry, orbitMaterial);

    // Align orbit with planet-moon axis
    const normal = relativePos.clone().normalize();
    const rotationMatrix = new THREE.Matrix4();
    rotationMatrix.lookAt(
      new THREE.Vector3(),
      normal,
      new THREE.Vector3(0, 1, 0)
    );
    orbit.setRotationFromMatrix(rotationMatrix);

    // Move orbit to be centered on planet
    orbit.position.copy(planetPosition);

    group.add(orbit);
  }

  function updateSpriteScale(sprite) {
    const distanceToCamera = sprite.position.distanceTo(camera.position);
    const baseScale = 0.1; // Increased from 0.01

    const objectData = objectsWithLabels.get(sprite);
    let scaleMultiplier = 1;

    switch (objectData?.type) {
      case "sun":
        scaleMultiplier = 10; // Increased from 2
        break;
      case "planet":
        scaleMultiplier = 10; // Increased from 1
        break;
      case "moon":
        scaleMultiplier = 5; // Increased from 0.75
        break;
      case "stargate":
        scaleMultiplier = 10; // Increased from 1
        break;
      case "station":
        scaleMultiplier = 10; // Increased from 1
        break;
      case "asteroid":
        scaleMultiplier = 10; // Increased from 0.5
        break;
      default:
        scaleMultiplier = 5;
    }

    const scale = baseScale * scaleMultiplier * distanceToCamera * 0.01;
    sprite.scale.set(scale, scale, 1);
  }

  async function fetchCelestials(killmailId, retryCount = 3) {
    for (let i = 0; i < retryCount; i++) {
      try {
        console.log(
          `Fetching celestials for killmail: ${killmailId} (attempt ${i + 1})`
        );
        const response = await fetch(`/api/celestials/${killmailId}`);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (!data || !data.length) {
          console.warn(
            `Empty celestial data received for killmail ${killmailId}`
          );
          if (i < retryCount - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
            continue;
          }
        }

        console.log("Received celestial data:", data);
        return data;
      } catch (error) {
        console.error(`Error fetching celestials (attempt ${i + 1}):`, error);
        if (i === retryCount - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
    return null;
  }

  function initRaycaster() {
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Remove any existing tooltip
    const existingTooltip = document.querySelector(".tooltip");
    if (existingTooltip) {
      existingTooltip.remove();
    }

    tooltipDiv = document.createElement("div");
    tooltipDiv.className = "tooltip";
    tooltipDiv.style.display = "none";
    container.appendChild(tooltipDiv);
  }

  function onMouseMove(event) {
    const rect = container.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / container.clientWidth) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / container.clientHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children);

    if (intersects.length > 0) {
      const object = intersects[0].object;
      if (objectsWithLabels.has(object)) {
        hoveredObject = object;
        tooltipDiv.textContent = objectsWithLabels.get(object).name;
        tooltipDiv.style.display = "block";
        tooltipDiv.style.left = `${event.clientX}px`;
        tooltipDiv.style.top = `${event.clientY - 20}px`;
      }
    } else {
      hoveredObject = null;
      tooltipDiv.style.display = "none";
    }
  }

  function animate() {
    requestAnimationFrame(animate);

    if (!lastCameraPosition.equals(camera.position)) {
      cameraTarget.position.copy(camera.position);
      lastCameraPosition.copy(camera.position);

      scene.traverse((object) => {
        if (object.isSprite) {
          updateSpriteScale(object);
        }
      });
    }

    controls.update();
    renderer.render(scene, camera);
  }

  function focusOnObject(object) {
    if (!camera || !controls || !object) return;

    const targetPosition = object.position.clone();
    const objectData = objectsWithLabels.get(object);

    // Get the size based on object type
    let baseSize;
    if (objectData.type === "sun") baseSize = SIZES.SUN.radius;
    else if (objectData.type === "planet") baseSize = SIZES.PLANET.radius;
    else if (objectData.type === "moon") baseSize = SIZES.MOON.radius;
    else if (objectData.type === "station") baseSize = SIZES.STATION.size;
    else if (objectData.type === "stargate") baseSize = SIZES.STARGATE.radius;
    else if (objectData.type === "killmail") baseSize = SIZES.KILL.radius;
    else baseSize = SIZES.PLANET.radius; // Default case

    // Calculate view distance based on object size
    const viewFactor = 5;
    const viewDistance = Math.max(baseSize * viewFactor, 0.1);

    const offset = new THREE.Vector3(viewDistance, viewDistance, viewDistance);
    const targetCameraPosition = targetPosition.clone().add(offset);

    const startPosition = camera.position.clone();
    const duration = 1000; // 1 second
    const startTime = Date.now();

    function animate() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Smooth easing
      const easeProgress =
        progress < 0.5
          ? 2 * progress * progress
          : -1 + (4 - 2 * progress) * progress;

      camera.position.lerpVectors(
        startPosition,
        targetCameraPosition,
        easeProgress
      );
      controls.target.lerp(targetPosition, easeProgress);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    }

    animate();
  }

  function updateInfoPanel(objectData = null) {
    const infoPanel = document.querySelector(".info-panel");
    if (!infoPanel) return;

    const killPos = kill.killmail.victim.position;
    let pinpointHtml = "";

    if (kill.pinpoints?.atCelestial) {
      pinpointHtml = "<p>Triangulation possible - At celestial</p>";
    } else if (
      kill.pinpoints?.nearestCelestial &&
      kill.pinpoints?.triangulationPossible
    ) {
      pinpointHtml = `<p>Triangulation possible - Near celestial: ${kill.pinpoints.nearestCelestial.name} (${formatDistance(kill.pinpoints.nearestCelestial.distance)})</p>`;
    } else if (
      kill.pinpoints?.hasTetrahedron &&
      kill.pinpoints.points.length >= 4
    ) {
      pinpointHtml = kill.pinpoints.points
        .map(
          (point, i) =>
            `<p>Pinpoint ${i + 1}: ${point.name} (${formatDistance(point.distance)})</p>`
        )
        .join("");
    } else {
      pinpointHtml = "<p>Wreck triangulation not possible</p>";
    }

    infoPanel.innerHTML = `
    <p>System name: ${systemName || "Unknown"}</p>
    <p>Closest Celestial: ${closestCelestial || "Unknown"}</p>
    <p><a href="#" class="kill-location" style="color: white; text-decoration: none;">Kill Location</a> 
      <span style="color: #666;">(${killPos.x}, ${killPos.y}, ${killPos.z})</span></p>
    ${pinpointHtml}
    ${objectData ? `<p>Selected: ${objectData.name} (${objectData.type})</p>` : ""}
  `;

    // Re-add click handler for kill location
    const killLocationLink = infoPanel.querySelector(".kill-location");
    if (killLocationLink) {
      killLocationLink.onclick = (e) => {
        e.preventDefault();
        const killObject = Array.from(objectsWithLabels.entries()).find(
          ([_, data]) => data.type === "killmail"
        );
        if (killObject) {
          focusOnObject(killObject[0]);
        }
      };
    }
  }

  function getRomanNumeralGroup(name) {
    const match = name?.match(/ ([IVX]+)( -|$)/);
    return match ? match[1] : null;
  }

  function focusOnSun() {
    const sunObject = Array.from(objectsWithLabels.entries()).find(
      ([_, data]) => data.type === "sun"
    );
    if (sunObject) {
      selectedObject = null;
      focusOnObject(sunObject[0]);
    }
  }

  let directionIndicator;

  function initDirectionalGUI() {
    directionIndicator = createDirectionalGUI();
    document.body.appendChild(directionIndicator);
    updateDirectionalGUI();
  }

  function createDirectionalGUI() {
    const guiContainer = document.createElement("div");

    // Apply container styles
    Object.assign(guiContainer.style, {
      position: "absolute",
      top: "20px",
      right: "20px",
      background: "rgba(0, 0, 0, 0.7)",
      padding: "10px",
      borderRadius: "5px",
      display: "grid",
      gridTemplateColumns: "repeat(2, 1fr)",
      gap: "5px",
      zIndex: "1000",
    });

    const directions = ["N", "S", "E", "W", "Up", "Down"];

    directions.forEach((direction) => {
      const arrow = document.createElement("div");

      // Apply arrow styles
      Object.assign(arrow.style, {
        color: "white",
        padding: "5px 10px",
        textAlign: "center",
        cursor: "pointer",
        fontFamily: "monospace",
      });

      arrow.className = `direction-${direction.toLowerCase()}`;
      arrow.textContent = direction;
      guiContainer.appendChild(arrow);
    });

    return guiContainer;
  }

  function updateDirectionalGUI() {
    if (!directionIndicator) return;

    // Find sun position from objects
    const sunObject = Array.from(objectsWithLabels.entries()).find(
      ([_, data]) => data.type === "sun"
    );
    if (!sunObject) return;

    const starPosition = sunObject[0].position;
    if (!starPosition) return;

    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    const cameraUp = camera.up;
    const cameraRight = new THREE.Vector3().crossVectors(
      cameraDirection,
      cameraUp
    );

    // Calculate direction vectors
    const directionVectors = {
      north: cameraRight,
      south: cameraRight.clone().negate(),
      east: cameraDirection.clone().cross(cameraUp),
      west: cameraDirection.clone().cross(cameraUp).negate(),
      up: cameraUp,
      down: cameraUp.clone().negate(),
    };

    // Update arrow opacities
    Object.entries(directionVectors).forEach(([dir, vector]) => {
      const arrow = directionIndicator.querySelector(`.direction-arrow.${dir}`);
      if (!arrow) return;

      const dirToStar = starPosition.clone().sub(camera.position).normalize();
      const angle = vector.angleTo(dirToStar);
      const opacity = Math.max(0.2, 1 - angle / Math.PI);

      arrow.style.opacity = opacity;
    });
  }

  function findClosestCelestial(celestials, killPosition) {
    if (!killPosition?.x || !killPosition?.y || !killPosition?.z) {
      console.error("Invalid kill position:", killPosition);
      return "Unknown";
    }

    const killPos = new THREE.Vector3(
      killPosition.x,
      killPosition.y,
      killPosition.z
    );

    let closest = null;
    let minDistance = Infinity;

    celestials.forEach((celestial) => {
      if (celestial.id === "killmail" || !celestial.itemname) return;

      const celestialPos = new THREE.Vector3(
        celestial.x || 0,
        celestial.y || 0,
        celestial.z || 0
      );
      const distance = celestialPos.distanceTo(killPos);

      if (distance < minDistance) {
        minDistance = distance;
        closest = celestial;
      }
    });

    return closest
      ? `${closest.itemname} (${formatDistance(minDistance)})`
      : "Unknown";
  }

  // Add new formatter function
  function formatDistance(meters) {
    const km = meters / 1000;
    if (km >= KM_PER_AU * 0.5) {
      return `${(km / KM_PER_AU).toFixed(2)} AU`;
    }
    return `${km.toFixed(2)} km`;
  }

  function createCelestialObject(celestialData, allData) {
    if (!celestialData) {
      console.error("celestialData is undefined or null.");
      return null;
    }

    const group = new THREE.Group();
    const typeName = celestialData.typename || "";
    const position = new THREE.Vector3(
      celestialData.x * SCALE_FACTOR,
      celestialData.y * SCALE_FACTOR,
      celestialData.z * SCALE_FACTOR
    );

    if (celestialData.id === "killmail") {
      const geometry = new THREE.SphereGeometry(SIZES.KILL.radius);
      const material = new THREE.MeshPhongMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.6,
        depthWrite: true,
      });
      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.copy(position);
      group.add(sphere);
      objectsWithLabels.set(sphere, {
        name: "Kill Location",
        type: "killmail",
        position: sphere.position.clone(),
      });
    } else if (typeName.includes("Sun")) {
      const geometry = new THREE.SphereGeometry(SIZES.SUN.radius);
      const material = new THREE.MeshPhongMaterial({
        color: 0xffff00,
        emissive: 0xffff00,
        emissiveIntensity: 0.5,
        shininess: 100,
      });
      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.copy(position);
      group.add(sphere);

      const sprite = createLocationSprite(
        position,
        "sun",
        celestialData.itemname
      );
      group.add(sprite);

      objectsWithLabels.set(sprite, {
        name: celestialData.itemname,
        type: "sun",
        position: sprite.position.clone(),
      });
    } else if (typeName.includes("Planet")) {
      const geometry = new THREE.SphereGeometry(SIZES.PLANET.radius);
      const material = new THREE.MeshPhongMaterial({
        color: 0x00ff00,
        shininess: 30,
      });
      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.copy(position);
      group.add(sphere);

      const sprite = createLocationSprite(
        position,
        "planet",
        celestialData.itemname
      );
      group.add(sprite);

      const distance = position.length();
      const segments = 256;
      const orbitPoints = [];
      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        orbitPoints.push(
          new THREE.Vector3(
            Math.cos(theta) * distance,
            0,
            Math.sin(theta) * distance
          )
        );
      }

      const orbitGeometry = new THREE.BufferGeometry().setFromPoints(
        orbitPoints
      );
      const orbitMaterial = new THREE.LineBasicMaterial({
        color: 0x666666,
        transparent: true,
        opacity: 0.7,
        linewidth: 2,
      });

      const orbit = new THREE.Line(orbitGeometry, orbitMaterial);
      const normal = position.clone().normalize();
      const rotationMatrix = new THREE.Matrix4();
      rotationMatrix.lookAt(
        new THREE.Vector3(),
        normal,
        new THREE.Vector3(0, 1, 0)
      );
      orbit.setRotationFromMatrix(rotationMatrix);
      group.add(orbit);

      objectsWithLabels.set(sprite, {
        name: celestialData.itemname,
        type: "planet",
        position: sprite.position.clone(),
      });
    } else if (typeName.includes("Moon")) {
      const geometry = new THREE.SphereGeometry(SIZES.MOON.radius);
      const material = new THREE.MeshPhongMaterial({ color: 0x808080 });
      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.copy(position);
      group.add(sphere);

      const sprite = createLocationSprite(
        position,
        "moon",
        celestialData.itemname
      );
      group.add(sprite);

      // Use the passed allData instead of window.allCelestialData
      const parentPlanet = findParentPlanet(celestialData, allData);
      if (parentPlanet) {
        const planetPosition = new THREE.Vector3(
          parentPlanet.x * SCALE_FACTOR,
          parentPlanet.y * SCALE_FACTOR,
          parentPlanet.z * SCALE_FACTOR
        );
        createMoonOrbit(position, planetPosition, group);
      }

      objectsWithLabels.set(sprite, {
        name: celestialData.itemname,
        type: "moon",
        position: sprite.position.clone(),
      });
    } else if (typeName.includes("Asteroid Belt")) {
      const geometry = new THREE.SphereGeometry(SIZES.ASTEROID.radius);
      const material = new THREE.MeshPhongMaterial({
        color: 0x808080,
        visible: false, // Hide the collision mesh but keep it for raycasting
      });
      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.copy(position);
      group.add(sphere);

      const sprite = createLocationSprite(
        position,
        "asteroid",
        celestialData.itemname
      );
      group.add(sprite);

      objectsWithLabels.set(sphere, {
        name: celestialData.itemname,
        type: "asteroid",
        position: sphere.position.clone(),
      });
    } else if (typeName.includes("Stargate")) {
      const geometry = new THREE.SphereGeometry(SIZES.STARGATE.radius);
      const material = new THREE.MeshPhongMaterial({
        color: 0x00ffff,
        visible: false, // Hide the collision mesh but keep it for raycasting
      });
      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.copy(position);
      group.add(sphere);

      const sprite = createLocationSprite(
        position,
        "stargate",
        celestialData.itemname
      );
      group.add(sprite);

      objectsWithLabels.set(sphere, {
        name: celestialData.itemname,
        type: "stargate",
        position: sphere.position.clone(),
      });
    } else if (typeName.includes("Station")) {
      const geometry = new THREE.SphereGeometry(SIZES.STATION.radius);
      const material = new THREE.MeshPhongMaterial({
        color: 0xff00ff,
        visible: false, // Hide the collision mesh but keep it for raycasting
      });
      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.copy(position);
      group.add(sphere);

      const sprite = createLocationSprite(
        position,
        "station",
        celestialData.itemname
      );
      group.add(sprite);

      objectsWithLabels.set(sphere, {
        name: celestialData.itemname,
        type: "station",
        position: sphere.position.clone(),
      });
    }

    return group;
  }

  async function initVisualization(celestialData) {
    if (!kill?.killmail?.victim?.position) {
      console.error("Missing kill position data:", kill);
      error = "Invalid kill data";
      loading = false;
      return;
    }

    // Store celestial data at component level
    allCelestialData = celestialData;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.001, // Much smaller near plane
      1000000000
    );

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    // Create camera target
    cameraTarget = new THREE.Object3D();
    scene.add(cameraTarget);

    const killPosition = new THREE.Vector3(
      kill.killmail.victim.position.x * SCALE_FACTOR,
      kill.killmail.victim.position.y * SCALE_FACTOR,
      kill.killmail.victim.position.z * SCALE_FACTOR
    );

    // Create kill location sprite
    const killSprite = createKillpointSprite(killPosition);
    scene.add(killSprite);
    objectsWithLabels.set(killSprite, {
      name: "Kill Location",
      type: "killmail",
      position: killSprite.position.clone(),
    });

    // Add celestials
    celestialData.forEach((celestial) => {
      if (celestial.id !== "killmail") {
        const mesh = createCelestialObject(celestial, allCelestialData);
        if (mesh) scene.add(mesh);
      }
    });

    // Add pinpoint box if it exists
    // Add pinpoint box if it exists
    if (kill.pinpoints?.hasTetrahedron) {
      console.log("Adding pinpoint box for:", kill.pinpoints);
      const pinpointBox = createPinpointLines(kill.pinpoints);
      if (pinpointBox) {
        scene.add(pinpointBox);
        console.log("Added pinpoint box to scene");
      }
    }

    camera.position.set(
      killPosition.x + 50,
      killPosition.y + 50,
      killPosition.z + 50
    );
    camera.lookAt(killPosition);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    initRaycaster();
    initDirectionalGUI();

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    // Update system information
    systemName = celestialData[1]?.solarsystemname || "Unknown System";
    closestCelestial = findClosestCelestial(
      celestialData,
      kill.killmail.victim.position
    );

    // Update pinpoint information from server data
    if (kill.pinpoints?.hasTetrahedron) {
      pinpoints = kill.pinpoints.points.map(
        (point) =>
          `${point.name} (${(point.distance * SCALE_FACTOR).toFixed(2)} km)`
      );
    } else {
      pinpoints = ["No valid pinpoint box found", "", "", ""];
    }

    updateInfoPanel();

    animate();
    loading = false;
  }

  function handleResize() {
    if (camera && renderer && container) {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight, true);

      // Update all sprites on resize
      scene.traverse((object) => {
        if (object.isSprite) {
          updateSpriteScale(object);
        }
      });
    }
  }

  onMount(async () => {
    try {
      const celestialData = await fetchCelestials(killmailId);
      if (celestialData) {
        await initVisualization(celestialData);
        container.addEventListener("mousemove", onMouseMove);
        container.addEventListener("click", onClick);
        window.addEventListener("resize", handleResize);
      } else {
        error = "Failed to fetch celestial data";
        loading = false;
      }
    } catch (err) {
      error = "Error initializing map visualization";
      console.error(err);
      loading = false;
    }
  });

  onDestroy(() => {
    window.removeEventListener("resize", handleResize);
    container?.removeEventListener("mousemove", onMouseMove);
    container?.removeEventListener("click", onClick);

    if (renderer) {
      renderer.dispose();
    }
    if (scene) {
      scene.traverse((object) => {
        if (object.geometry) {
          object.geometry.dispose();
        }
        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach((material) => material.dispose());
          } else {
            object.material.dispose();
          }
        }
        if (object.userData?.label) {
          object.userData.label.remove();
        }
      });
    }

    // Remove all celestial labels
    const labels = document.querySelectorAll(".celestial-label");
    labels.forEach((label) => label.remove());

    directionIndicator?.remove();
    objectsWithLabels.clear();
    tooltipDiv?.remove();
  });

  function onClick(event) {
    if (!scene || !camera) return;

    const rect = container.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / container.clientWidth) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / container.clientHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(
      Array.from(objectsWithLabels.keys()).filter((obj) => obj.isSprite)
    );

    if (intersects.length > 0) {
      const sprite = intersects[0].object;
      if (objectsWithLabels.has(sprite)) {
        const objectData = objectsWithLabels.get(sprite);
        console.log("Selected object:", objectData);
        selectedObject = sprite;
        focusOnObject(sprite);
        updateInfoPanel(objectData);
      }
    }
  }
</script>

<div class="visualization-container">
  <div class="controls">
    <button class="focus-sun" on:click={focusOnSun}>Focus Sun</button>
  </div>

  <div bind:this={container} class="map-container">
    {#if loading}
      <div class="status-message">Loading map...</div>
    {:else if error}
      <div class="status-message error">{error}</div>
    {/if}
  </div>

  <div class="info-panel">
    {#if kill.pinpoints}
      <pre style="display: none">{JSON.stringify(kill.pinpoints, null, 2)}</pre>
    {/if}
    <p>System name: {systemName}</p>
    <p>Closest Celestial: {closestCelestial}</p>
    <p>
      <!-- svelte-ignore a11y-invalid-attribute -->
      <a
        href="#"
        class="kill-location"
        style="color: white; text-decoration: none;">Kill Location</a
      >
      <span style="color: #666;"
        >({kill.killmail.victim.position.x}, {kill.killmail.victim.position.y}, {kill
          .killmail.victim.position.z})</span
      >
    </p>
    {#if kill.pinpoints?.atCelestial}
      <p>Triangulation possible - At celestial</p>
    {:else if kill.pinpoints?.nearestCelestial && kill.pinpoints?.triangulationPossible}
      <p>
        Triangulation possible - Near celestial ({(
          kill.pinpoints.nearestCelestial.distance / 1000
        ).toFixed(2)} km)
      </p>
    {:else if kill.pinpoints?.hasTetrahedron && kill.pinpoints.points.length >= 4}
      <p>
        Pinpoint 1: {kill.pinpoints.points[0].name} ({(
          kill.pinpoints.points[0].distance / 1000
        ).toFixed(2)} km)
      </p>
      <p>
        Pinpoint 2: {kill.pinpoints.points[1].name} ({(
          kill.pinpoints.points[1].distance / 1000
        ).toFixed(2)} km)
      </p>
      <p>
        Pinpoint 3: {kill.pinpoints.points[2].name} ({(
          kill.pinpoints.points[2].distance / 1000
        ).toFixed(2)} km)
      </p>
      <p>
        Pinpoint 4: {kill.pinpoints.points[3].name} ({(
          kill.pinpoints.points[3].distance / 1000
        ).toFixed(2)} km)
      </p>
    {:else if kill.pinpoints?.triangulationPossible && kill.pinpoints?.nearestCelestial}
      <p>
        Nearest celestial: {kill.pinpoints.nearestCelestial.name} ({(
          kill.pinpoints.nearestCelestial.distance / 1000
        ).toFixed(2)} km)
      </p>
    {:else}
      <p>Wreck triangulation not possible</p>
    {/if}
  </div>
</div>

<style>
  .visualization-container {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .map-container {
    width: 100%;
    height: 100%;
    background: #000;
  }

  :global(.celestial-sprite) {
    pointer-events: auto;
    cursor: pointer;
  }

  :global(.celestial-sprite:hover) {
    filter: brightness(1.5);
  }

  .info-panel {
    position: absolute;
    bottom: 20px;
    left: 20px;
    color: white;
    font-family: monospace;
    background: rgba(0, 0, 0, 0.7);
    padding: 15px;
    border-radius: 5px;
  }

  .info-panel p {
    margin: 5px 0;
    white-space: nowrap;
  }

  :global(.celestial-label) {
    position: absolute;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    pointer-events: none;
    transform-origin: left top;
    z-index: 1000;
  }

  .status-message {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: white;
    font-size: 1.2em;
    text-align: center;
    z-index: 1000;
  }

  .error {
    color: #ff6b6b;
    background: rgba(0, 0, 0, 0.7);
    padding: 1rem;
    border-radius: 4px;
  }

  :global(.tooltip) {
    position: absolute;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 5px 10px;
    border-radius: 3px;
    font-size: 12px;
    pointer-events: none;
    z-index: 1000;
    font-family: monospace;
  }

  .controls {
    position: absolute;
    top: 20px;
    left: 20px;
    z-index: 1000;
  }

  .focus-sun {
    background: rgba(255, 165, 0, 0.8);
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
  }

  .focus-sun:hover {
    background: rgba(255, 165, 0, 1);
  }
</style>
