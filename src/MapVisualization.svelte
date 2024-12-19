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

  const SCALE_FACTOR = 1e-9;
  const objectsWithLabels = new Map();

  $: if (kill) {
    console.log("Kill data in MapVisualization:", kill);
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

  function updateObjectScales() {
    if (!camera || !scene) return;

    scene.traverse((object) => {
      if (!objectsWithLabels.has(object)) return;

      const data = objectsWithLabels.get(object);
      const distance = camera.position.distanceTo(object.position);
      const scale = getScaleFactor(distance, data.type, data);

      object.scale.setScalar(scale);
    });
  }

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    updateDirectionalGUI();
    renderer.render(scene, camera);
  }

  function getScaleFactor(distance, objectType, objectData) {
    // Base scale factors for different object types
    const scales = {
      sun: { base: 5.0, min: 0.5, max: 8.0 },
      planet: { base: 2.0, min: 0.3, max: 4.0 },
      moon: { base: 0.8, min: 0.2, max: 2.0 },
      station: { base: 1.0, min: 0.2, max: 3.0 },
      stargate: { base: 1.0, min: 0.2, max: 3.0 },
      asteroid: { base: 0.5, min: 0.1, max: 1.5 },
      killmail: { base: 0.8, min: 0.2, max: 20.0 },
    };

    // Distance thresholds for scaling
    const NEAR = 50 * SCALE_FACTOR;
    const FAR = 500000 * SCALE_FACTOR;

    // Get scale configuration for object type
    const scaleConfig = scales[objectType] || scales.planet;

    // Calculate base scale based on distance with smooth interpolation
    const distanceFactor = THREE.MathUtils.smoothstep(distance, NEAR, FAR);
    let scale = THREE.MathUtils.lerp(
      scaleConfig.max,
      scaleConfig.min,
      distanceFactor
    );

    // Apply contextual scaling based on selected object
    if (selectedObject) {
      const selectedData = objectsWithLabels.get(selectedObject);
      const selectedGroup = getRomanNumeralGroup(selectedData.name);
      const thisGroup = getRomanNumeralGroup(objectData?.name);

      if (selectedGroup && thisGroup) {
        if (selectedGroup === thisGroup) {
          // Objects in same planetary system - enhance visibility when close
          const systemScaleFactor = THREE.MathUtils.smoothstep(
            distance,
            NEAR * 0.1,
            NEAR
          );
          scale *= THREE.MathUtils.lerp(1.5, 0.8, systemScaleFactor);
        } else {
          // Objects in different systems - reduce visibility
          const outsideScaleFactor = THREE.MathUtils.smoothstep(
            distance,
            NEAR * 0.5,
            FAR
          );
          scale *= THREE.MathUtils.lerp(0.3, 0.5, outsideScaleFactor);
        }
      }
    }

    // Adjust scale based on object type context
    if (objectType === "sun") {
      // Reduce sun scale when viewing planetary systems
      const planetaryViewFactor =
        selectedObject &&
        objectsWithLabels.get(selectedObject).type === "planet"
          ? 0.3
          : 1.0;
      scale *= planetaryViewFactor;
    }

    return scale;
  }

  function focusOnObject(object) {
    if (!camera || !controls || !object) return;

    const targetPosition = object.position.clone();
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
        targetPosition.clone().add(new THREE.Vector3(50, 50, 50)),
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

    // Early check for kill data
    if (!kill?.killmail?.victim?.position) {
      console.error("Missing kill position data");
      return;
    }

    const killPos = kill.killmail.victim.position;
    const formattedCoords = `(${(killPos.x * SCALE_FACTOR).toFixed(0)}, ${(killPos.y * SCALE_FACTOR).toFixed(0)}, ${(killPos.z * SCALE_FACTOR).toFixed(0)}) km`;

    // Always show these elements
    infoPanel.innerHTML = `
        <p>System name: ${systemName || "Unknown"}</p>
        <p>Closest Celestial: ${closestCelestial || "Unknown"}</p>
        <p><a href="#" class="kill-location">Kill Location: ${formattedCoords}</a></p>
        <p>Pinpoint 1: ${pinpoints[0] || "TBD"}</p>
        <p>Pinpoint 2: ${pinpoints[1] || "TBD"}</p>
        <p>Pinpoint 3: ${pinpoints[2] || "TBD"}</p>
        <p>Pinpoint 4: ${pinpoints[3] || "TBD"}</p>
        ${objectData ? `<p>Selected: ${objectData.name} (${objectData.type})</p>` : ""}
    `;

    // Add click handler for kill location
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

  async function createCompass(size) {
    const compassGroup = new THREE.Group();
    const lineLength = size;
    const lineWidth = 1;

    // Create the main axis line
    const axisGeometry = new THREE.BoxGeometry(
      lineLength,
      lineWidth,
      lineWidth
    );
    const axisMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const axisLine = new THREE.Mesh(axisGeometry, axisMaterial);
    compassGroup.add(axisLine);

    // Create directional markers along the line
    const markerPositions = [
      { position: lineLength / 2, text: "N" },
      { position: -lineLength / 2, text: "S" },
      { position: 0, text: "E", offset: lineLength / 4 },
      { position: 0, text: "W", offset: -lineLength / 4 },
    ];

    markerPositions.forEach((marker) => {
      const sprite = createTextSprite(marker.text);
      if (marker.text === "N" || marker.text === "S") {
        sprite.position.set(marker.position, lineWidth * 5, 0);
      } else {
        sprite.position.set(0, lineWidth * 5, marker.offset);
      }
      sprite.scale.set(50, 50, 1);
      compassGroup.add(sprite);
    });

    return compassGroup;
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
      if (celestial.id === "killmail") return;

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
      ? `${closest.itemname} (${(minDistance * SCALE_FACTOR).toFixed(2)} km)`
      : "Unknown";
  }

  function calculatePinpoints(celestials, killPosition) {
    return ["TBD", "TBD", "TBD", "TBD"];
  }

  function createCelestialObject(celestialData) {
    if (!celestialData) {
      console.error("celestialData is undefined or null.");
      return null;
    }

    // Base sizes with dynamic scale ranges
    const SIZES = {
      KILL: {
        radius: 0.8,
        near: { min: 0.5, max: 2 },
        far: { min: 2, max: 5 },
      },
      SUN: {
        radius: 5,
        near: { min: 0.5, max: 3 },
        far: { min: 3, max: 10 },
      },
      PLANET: {
        radius: 2,
        near: { min: 0.3, max: 2 },
        far: { min: 2, max: 8 },
      },
      MOON: {
        radius: 0.3,
        near: { min: 0.2, max: 1 },
        far: { min: 1, max: 4 },
      },
      ASTEROID: {
        radius: 0.2,
        particleCount: 3,
        spread: 1,
        near: { min: 0.1, max: 0.5 },
        far: { min: 0.5, max: 3 },
      },
      STARGATE: {
        length: 3,
        radius: 0.5,
        sphereRadius: 0.4,
        near: { min: 0.2, max: 1 },
        far: { min: 1, max: 4 },
      },
      STATION: {
        size: 2,
        near: { min: 0.3, max: 1.5 },
        far: { min: 1.5, max: 5 },
      },
    };

    const group = new THREE.Group();
    const typeName = celestialData.typename || "";

    // Calculate initial scale based on camera distance
    const position = new THREE.Vector3(
      celestialData.x * SCALE_FACTOR,
      celestialData.y * SCALE_FACTOR,
      celestialData.z * SCALE_FACTOR
    );

    const distance = camera.position.distanceTo(position);
    const initialScale = getScaleFactor(distance, typeName.toLowerCase());

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
      sphere.scale.setScalar(initialScale);
      group.add(sphere);
      objectsWithLabels.set(sphere, {
        name: "Kill Location",
        type: "killmail",
        position: sphere.position.clone(),
        sizeConfig: SIZES.KILL,
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
      sphere.position.set(
        celestialData.x * SCALE_FACTOR,
        celestialData.y * SCALE_FACTOR,
        celestialData.z * SCALE_FACTOR
      );
      group.add(sphere);

      // Add sun glow
      const glowMaterial = new THREE.ShaderMaterial({
        uniforms: {
          c: { type: "f", value: 0.1 },
          p: { type: "f", value: 1.4 },
          glowColor: { type: "c", value: new THREE.Color(0xffff00) },
        },
        vertexShader: `
                varying vec3 vNormal;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
        fragmentShader: `
                uniform vec3 glowColor;
                uniform float c;
                uniform float p;
                varying vec3 vNormal;
                void main() {
                    float intensity = pow(c - dot(vNormal, vec3(0.0, 0.0, 1.0)), p);
                    gl_FragColor = vec4(glowColor, intensity);
                }
            `,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
      });

      const glowMesh = new THREE.Mesh(
        new THREE.SphereGeometry(SIZES.SUN.radius * 1.2, 32, 32),
        glowMaterial
      );
      glowMesh.position.copy(sphere.position);
      group.add(glowMesh);

      objectsWithLabels.set(sphere, {
        name: celestialData.itemname,
        type: "sun",
        position: sphere.position.clone(),
      });
    } else if (typeName.includes("Asteroid Belt")) {
      const asteroidGroup = new THREE.Group();
      for (let i = 0; i < SIZES.ASTEROID.particleCount; i++) {
        const geometry = new THREE.IcosahedronGeometry(
          SIZES.ASTEROID.radius,
          0
        );
        const material = new THREE.MeshPhongMaterial({ color: 0x808080 });
        const asteroid = new THREE.Mesh(geometry, material);

        const spread = SIZES.ASTEROID.spread;
        asteroid.position.set(
          (Math.random() - 0.5) * spread,
          (Math.random() - 0.5) * spread,
          (Math.random() - 0.5) * spread
        );
        asteroid.rotation.set(
          Math.random() * Math.PI,
          Math.random() * Math.PI,
          Math.random() * Math.PI
        );
        asteroidGroup.add(asteroid);
      }
      asteroidGroup.position.set(
        celestialData.x * SCALE_FACTOR,
        celestialData.y * SCALE_FACTOR,
        celestialData.z * SCALE_FACTOR
      );
      group.add(asteroidGroup);
      objectsWithLabels.set(asteroidGroup, {
        name: celestialData.itemname,
        type: "asteroid",
        position: asteroidGroup.position.clone(),
      });
    } else if (typeName.includes("Planet")) {
      const geometry = new THREE.SphereGeometry(SIZES.PLANET.radius);
      const material = new THREE.MeshPhongMaterial({
        color: 0x00ff00,
        shininess: 30,
      });
      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.set(
        celestialData.x * SCALE_FACTOR,
        celestialData.y * SCALE_FACTOR,
        celestialData.z * SCALE_FACTOR
      );
      group.add(sphere);

      // Calculate planet's distance from sun
      const planetPosition = new THREE.Vector3(
        celestialData.x * SCALE_FACTOR,
        celestialData.y * SCALE_FACTOR,
        celestialData.z * SCALE_FACTOR
      );

      const distance = planetPosition.length();

      // Create orbit ring
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

      // Calculate rotation to align with sun as reference plane
      const normal = planetPosition.clone().normalize();
      const rotationMatrix = new THREE.Matrix4();
      rotationMatrix.lookAt(
        new THREE.Vector3(),
        normal,
        new THREE.Vector3(0, 1, 0)
      );
      orbit.setRotationFromMatrix(rotationMatrix);

      group.add(orbit);

      objectsWithLabels.set(sphere, {
        name: celestialData.itemname,
        type: "planet",
        position: sphere.position.clone(),
      });
    } else if (typeName.includes("Moon")) {
      const geometry = new THREE.SphereGeometry(SIZES.MOON.radius);
      const material = new THREE.MeshPhongMaterial({ color: 0x808080 });
      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.set(
        celestialData.x * SCALE_FACTOR,
        celestialData.y * SCALE_FACTOR,
        celestialData.z * SCALE_FACTOR
      );
      group.add(sphere);
      objectsWithLabels.set(sphere, {
        name: celestialData.itemname,
        type: "moon",
        position: sphere.position.clone(),
      });
    } else if (typeName.includes("Stargate")) {
      const stargateGroup = new THREE.Group();

      // Outer cylinder
      const cylinderGeometry = new THREE.CylinderGeometry(
        SIZES.STARGATE.radius,
        SIZES.STARGATE.radius,
        SIZES.STARGATE.length,
        32
      );
      const material = new THREE.MeshPhongMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.7,
      });
      const cylinder = new THREE.Mesh(cylinderGeometry, material);

      // Inner sphere
      const sphereGeometry = new THREE.SphereGeometry(
        SIZES.STARGATE.sphereRadius
      );
      const sphereMaterial = new THREE.MeshPhongMaterial({
        color: 0x00ffff,
        emissive: 0x00ffff,
        emissiveIntensity: 0.3,
      });
      const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);

      stargateGroup.add(cylinder);
      stargateGroup.add(sphere);
      stargateGroup.position.set(
        celestialData.x * SCALE_FACTOR,
        celestialData.y * SCALE_FACTOR,
        celestialData.z * SCALE_FACTOR
      );
      group.add(stargateGroup);
      objectsWithLabels.set(stargateGroup, {
        name: celestialData.itemname,
        type: "stargate",
        position: stargateGroup.position.clone(),
      });
    } else if (typeName.includes("Station")) {
      const geometry = new THREE.BoxGeometry(
        SIZES.STATION.size,
        SIZES.STATION.size,
        SIZES.STATION.size
      );
      const material = new THREE.MeshPhongMaterial({ color: 0x00ffff });
      const cube = new THREE.Mesh(geometry, material);
      cube.position.set(
        celestialData.x * SCALE_FACTOR,
        celestialData.y * SCALE_FACTOR,
        celestialData.z * SCALE_FACTOR
      );
      group.add(cube);
      objectsWithLabels.set(cube, {
        name: celestialData.itemname,
        type: "station",
        position: cube.position.clone(),
      });
    }

    return group;
  }

  function createTextSprite(text) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    context.font = "Bold 20px Arial";
    context.fillStyle = "white";
    context.fillText(text, 0, 20);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
    return new THREE.Sprite(spriteMaterial);
  }

  async function initVisualization(celestialData) {
    if (!kill?.killmail?.victim?.position) {
      console.error("Missing kill position data:", kill);
      error = "Invalid kill data";
      loading = false;
      return;
    }

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      1000000000
    );

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const killPosition = kill.killmail.victim.position;

    // First create kill location
    const killObject = createCelestialObject({
      id: "killmail",
      x: killPosition.x,
      y: killPosition.y,
      z: killPosition.z,
      typename: "Kill Location",
    });

    if (killObject) {
      scene.add(killObject);
      console.log("Kill object added to scene", killObject);
    }

    // Then add other celestials
    celestialData.forEach((celestial) => {
      if (celestial.id !== "killmail") {
        const mesh = createCelestialObject(celestial);
        if (mesh) scene.add(mesh);
      }
    });

    // Set camera position after objects are created
    camera.position.set(
      killPosition.x * SCALE_FACTOR + 50,
      killPosition.y * SCALE_FACTOR + 50,
      killPosition.z * SCALE_FACTOR + 50
    );
    camera.lookAt(
      killPosition.x * SCALE_FACTOR,
      killPosition.y * SCALE_FACTOR,
      killPosition.z * SCALE_FACTOR
    );

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // Initialize other components
    initRaycaster();
    initDirectionalGUI();

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    // Update info panel after everything is set up
    systemName = celestialData[1]?.solarsystemname || "Unknown System";
    closestCelestial = findClosestCelestial(celestialData, killPosition);
    pinpoints = calculatePinpoints(celestialData, killPosition);
    updateInfoPanel();

    // Start animation
    animate();
    loading = false;
  }

  function handleResize() {
    if (camera && renderer && container) {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight, true);
    }
  }

  onMount(async () => {
    try {
      const celestialData = await fetchCelestials(killmailId);
      if (celestialData) {
        await initVisualization(celestialData);
        // Add event listeners
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
      });
    }
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
    const intersects = raycaster.intersectObjects(scene.children, true);

    if (intersects.length > 0) {
      let object = intersects[0].object;

      // Find the labeled parent
      while (object && !objectsWithLabels.has(object)) {
        object = object.parent;
      }

      if (object && objectsWithLabels.has(object)) {
        const objectData = objectsWithLabels.get(object);
        console.log("Selected object:", objectData);
        selectedObject = object;

        // Special handling for kill location
        if (objectData.type === "killmail") {
          camera.position.set(
            object.position.x + 50,
            object.position.y + 50,
            object.position.z + 50
          );
          controls.target.copy(object.position);
        } else {
          focusOnObject(object);
        }

        updateInfoPanel(objectData);
      }
    }
  }
</script>

<div class="visualization-container">
  <div bind:this={container} class="map-container">
    {#if loading}
      <div class="status-message">Loading map...</div>
    {:else if error}
      <div class="status-message error">{error}</div>
    {/if}
  </div>

  <div class="info-panel">
    <p>System name: {systemName}</p>
    <p>Closest Celestial: {closestCelestial}</p>
    <p>Pinpoint 1: {pinpoints[0]}</p>
    <p>Pinpoint 2: {pinpoints[1]}</p>
    <p>Pinpoint 3: {pinpoints[2]}</p>
    <p>Pinpoint 4: {pinpoints[3]}</p>
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
</style>
