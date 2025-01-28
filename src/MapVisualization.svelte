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

  let pinpointLines = null;
  let container;
  let scene, camera, renderer, controls;
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
    KILL: { radius: 0.00001 },
    SUN: { radius: 0.03 }, // Adjusted scale
    PLANET: { radius: 0.003 },
    MOON: { radius: 0.00009 },
    ASTEROID: {
      radius: 0.00005,
      particleCount: 5,
      spread: 0.0001,
    },
    STARGATE: {
      radius: 0.006,
      length: 0.003,
      sphereRadius: 0.005,
    },
    STATION: { size: 0.02 },
  };

  $: if (kill) {
    console.log("Kill data in MapVisualization:", kill);
  }

  function createPinpointLines(pinpointData) {
    if (!pinpointData || !pinpointData.hasTetrahedron) return null;

    console.log("Creating pinpoint lines with data:", pinpointData);

    const points = pinpointData.points.map((point) => {
      const x = parseFloat(point.position.x) * SCALE_FACTOR;
      const y = parseFloat(point.position.y) * SCALE_FACTOR;
      const z = parseFloat(point.position.z) * SCALE_FACTOR;
      return new THREE.Vector3(x, y, z);
    });

    // Create a line geometry for each edge separately
    const lines = new THREE.Group();

    // Function to create a single line between two points
    function createLine(point1, point2) {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array([
        point1.x,
        point1.y,
        point1.z,
        point2.x,
        point2.y,
        point2.z,
      ]);
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3)
      );

      const material = new THREE.LineBasicMaterial({
        color: 0x00ff00,
        transparent: true,
        opacity: 0.5,
        linewidth: 2,
        depthWrite: false, // This helps prevent z-fighting
      });

      return new THREE.Line(geometry, material);
    }

    // Create lines between all points
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        lines.add(createLine(points[i], points[j]));
      }
    }
    pinpointLines = lines;
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
        // console.log(
        //   `Fetching celestials for killmail: ${killmailId} (attempt ${i + 1})`
        // );
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

      // Get distance to kill point
      const killObject = Array.from(objectsWithLabels.entries()).find(
        ([_, data]) => data.type === "killmail"
      );

      if (killObject && pinpointLines) {
        const distanceToKill = camera.position.distanceTo(
          killObject[0].position
        );
        const DISTANCE_THRESHOLD = 0.01;

        // Toggle line visibility based on distance
        pinpointLines.traverse((child) => {
          if (child instanceof THREE.Line) {
            child.visible = distanceToKill > DISTANCE_THRESHOLD;
          }
        });
      }

      scene.traverse((object) => {
        if (object.isSprite) {
          updateSpriteScale(object);
        }
      });
    }

    sunBrightnessAnimation();
    controls.update();
    renderer.render(scene, camera);
  }

  function focusOnObject(object) {
    if (!camera || !controls || !object) return;

    const targetPosition = object.position.clone();
    const objectData = objectsWithLabels.get(object);

    // Get the size based on object type with special handling for killmail
    let viewDistance;

    if (objectData.type === "killmail") {
      viewDistance = 0.00002; // Adjusted for better stability
    } else {
      // Default view distances for other objects
      const baseSize =
        objectData.type === "sun"
          ? SIZES.SUN.radius
          : objectData.type === "planet"
            ? SIZES.PLANET.radius
            : objectData.type === "moon"
              ? SIZES.MOON.radius
              : objectData.type === "station"
                ? SIZES.STATION.size
                : objectData.type === "stargate"
                  ? SIZES.STARGATE.radius
                  : SIZES.PLANET.radius;
      viewDistance = baseSize * 5;
    }

    // Create offset vector for camera position
    const offset = new THREE.Vector3(viewDistance, viewDistance, viewDistance);
    const targetCameraPosition = targetPosition.clone().add(offset);

    const startPosition = camera.position.clone();
    const duration = 1000;
    const startTime = Date.now();

    function animate() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

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
    ${pinpointHtml}
    ${objectData ? `<p>Selected: ${objectData.name} (${objectData.type})</p>` : ""}
  `;
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

  let zoomLevel = 50; // Initial zoom level (0-100)
  let directionIndicator;

  function initDirectionalGUI() {
    const container = document.createElement("div");
    Object.assign(container.style, {
      position: "absolute",
      bottom: "120px",
      right: "5px",
      background: "rgba(0, 0, 0, 0.7)",
      padding: "10px",
      borderRadius: "5px",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
      zIndex: "1000",
    });

    const zoomIn = document.createElement("button");
    const zoomOut = document.createElement("button");

    zoomIn.textContent = "+";
    zoomOut.textContent = "-";

    zoomIn.onclick = () => smoothZoom(Math.max(0, zoomLevel - 10));
    zoomOut.onclick = () => smoothZoom(Math.min(100, zoomLevel + 10));

    [zoomIn, zoomOut].forEach((btn) => {
      Object.assign(btn.style, {
        width: "30px",
        height: "30px",
        background: "rgba(255, 255, 255, 0.2)",
        border: "none",
        color: "white",
        fontSize: "20px",
        cursor: "pointer",
        borderRadius: "4px",
      });
    });

    container.append(zoomIn, zoomOut);
    document.querySelector(".map-container").appendChild(container);
    directionIndicator = container;
  }

  function smoothZoom(targetLevel) {
    if (!camera || !controls) return;

    const startLevel = zoomLevel;
    const duration = 300; // ms
    const startTime = performance.now();

    function animateZoom(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Smooth easing
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      zoomLevel = startLevel + (targetLevel - startLevel) * easedProgress;

      const minZoom = 0.000001;
      const maxZoom = 1000000;
      const logZoom = Math.pow(
        10,
        Math.log10(minZoom) +
          (zoomLevel / 100) * (Math.log10(maxZoom) - Math.log10(minZoom))
      );

      const currentTarget = controls.target.clone();
      const cameraDirection = camera.position
        .clone()
        .sub(currentTarget)
        .normalize();
      const newCameraPosition = currentTarget
        .clone()
        .add(cameraDirection.multiplyScalar(logZoom));

      camera.position.copy(newCameraPosition);
      controls.update();

      if (progress < 1) {
        requestAnimationFrame(animateZoom);
      }
    }

    requestAnimationFrame(animateZoom);
  }

  // function findClosestCelestial(celestials, killPosition) {
  //   if (!killPosition?.x || !killPosition?.y || !killPosition?.z) {
  //     console.error("Invalid kill position:", killPosition);
  //     return "Unknown";
  //   }

  //   const killPos = new THREE.Vector3(
  //     killPosition.x,
  //     killPosition.y,
  //     killPosition.z
  //   );

  //   let closest = null;
  //   let minDistance = Infinity;

  //   celestials.forEach((celestial) => {
  //     if (celestial.id === "killmail" || !celestial.itemname) return;

  //     const celestialPos = new THREE.Vector3(
  //       celestial.x || 0,
  //       celestial.y || 0,
  //       celestial.z || 0
  //     );
  //     const distance = celestialPos.distanceTo(killPos);

  //     if (distance < minDistance) {
  //       minDistance = distance;
  //       closest = celestial;
  //     }
  //   });

  //   return closest
  //     ? `${closest.itemname} (${formatDistance(minDistance)})`
  //     : "Unknown";
  // }

  function findClosestCelestial(celestials, killPosition) {
    return kill.pinpoints.nearestCelestial
      ? `${kill.pinpoints.nearestCelestial.name} (${formatDistance(kill.pinpoints.nearestCelestial.distance)})`
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
      const coronaGeometry = new THREE.Object3D();
      const coronaSize = SIZES.SUN.radius * 8;

      const points = [];
      const numPoints = 32;
      const phi = Math.PI * (3 - Math.sqrt(5));

      for (let i = 0; i < numPoints; i++) {
        const y = 1 - (i / (numPoints - 1)) * 2;
        const radius = Math.sqrt(1 - y * y);
        const theta = phi * i;
        points.push({
          x: Math.cos(theta) * radius,
          y: y,
          z: Math.sin(theta) * radius,
        });
      }

      points.forEach((point, i) => {
        const plane = new THREE.PlaneGeometry(coronaSize, coronaSize);
        const coronaMaterial = new THREE.ShaderMaterial({
          uniforms: {
            time: { value: 0 },
            seed: { value: i },
          },
          vertexShader: `
       varying vec2 vUv;
       void main() {
         vUv = uv;
         gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
       }
     `,
          fragmentShader: `
       uniform float time;
       uniform float seed;
       varying vec2 vUv;
       
       float noise(vec2 p) {
         return fract(sin(dot(p, vec2(12.9898 + seed, 78.233))) * 43758.5453);
       }
       
       void main() {
         vec2 uvc = vUv - 0.5;
         float dist = length(uvc);
         float n = noise(uvc + time * 0.1);
         float alpha = smoothstep(0.5, 0.0, dist);
         alpha *= 0.5 * (1.0 + 0.2 * sin(time * 0.2 + dist * 3.0 + n * 2.0));
         vec3 color = mix(vec3(1.0, 1.0, 0.8), vec3(1.0, 0.6, 0.1), dist * 1.5 + n * 0.2);
         gl_FragColor = vec4(color, alpha);
       }
     `,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        });

        const coronaMesh = new THREE.Mesh(plane, coronaMaterial);
        coronaMesh.lookAt(new THREE.Vector3(point.x, point.y, point.z));
        coronaGeometry.add(coronaMesh);
      });

      coronaGeometry.position.copy(position);

      const light = new THREE.PointLight(0xffff66, 3, SIZES.SUN.radius * 20);
      light.position.copy(position);

      const animateSun = () => {
        light.intensity = 2.8 + Math.sin(Date.now() * 0.0002) * 0.3;
        coronaGeometry.children.forEach((plane) => {
          plane.material.uniforms.time.value += 0.016;
        });
        coronaGeometry.rotation.y += 0.0005;
        coronaGeometry.rotation.x += 0.0003;
      };

      const originalAnimate = animate;
      animate = () => {
        originalAnimate();
        animateSun();
      };

      group.add(coronaGeometry);
      group.add(light);

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
      0.000001, // Much smaller near plane
      1000000000
    );

    renderer = new THREE.WebGLRenderer({
      antialias: true,
      logarithmicDepthBuffer: true, // Add this line
    });
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

  const sunBrightnessAnimation = () => {
    scene.traverse((object) => {
      if (object.material?.emissive) {
        object.material.emissiveIntensity =
          0.5 + Math.sin(Date.now() * 0.001) * 0.2;
      }
    });
  };

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
    <button
      class="focus-kill"
      on:click={() => {
        const killObject = Array.from(objectsWithLabels.entries()).find(
          ([_, data]) => data.type === "killmail"
        );
        if (killObject) {
          focusOnObject(killObject[0]);
        }
      }}>Kill Location</button
    >
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
    {#if kill.pinpoints?.atCelestial}
      <p>At celestial: {kill.pinpoints.nearestCelestial.name}</p>
    {:else if kill.pinpoints?.triangulationType === "near_celestial"}
      <p>
        Near celestial: {kill.pinpoints.nearestCelestial.name} ({(
          kill.pinpoints.nearestCelestial.distance / 1000
        ).toFixed(2)} km)
      </p>
    {:else if kill.pinpoints?.triangulationType === "via_bookspam"}
      <p>Triangulation possible (requires bookspamming):</p>
      {#each kill.pinpoints.points as point, i}
        <p>
          Pinpoint {i + 1}: {point.name} ({(point.distance / 1000).toFixed(2)} km)
        </p>
      {/each}
    {:else if kill.pinpoints?.triangulationType === "direct"}
      <p>Direct triangulation possible:</p>
      {#each kill.pinpoints.points as point, i}
        <p>
          Pinpoint {i + 1}: {point.name} ({(point.distance / 1000).toFixed(2)} km)
        </p>
      {/each}
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
    overflow: hidden;
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
    display: flex;
    gap: 10px;
  }

  .focus-sun,
  .focus-kill {
    background: rgba(255, 165, 0, 0.8);
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
  }

  .focus-kill {
    background: rgba(255, 0, 0, 0.8);
  }

  .focus-sun:hover,
  .focus-kill:hover {
    opacity: 0.9;
  }
</style>
