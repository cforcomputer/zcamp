<script>
  import { onMount, onDestroy, tick } from "svelte";
  import * as THREE from "three";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import {
    CSS2DRenderer,
    CSS2DObject,
  } from "three/examples/jsm/renderers/CSS2DRenderer.js";
  import { activeCamps } from "./campManager.js";
  import { activeRoams } from "./roamManager.js";
  import { currentLocation, locationError } from "./locationStore.js";
  import ContextMenu from "./ContextMenu.svelte";
  import { getValidAccessToken } from "./tokenManager.js";

  // --- State Variables ---
  let container;
  let scene, camera, renderer, labelRenderer, controls;
  let solarSystems = new Map();
  let stargateConnections = [];
  let mapData = [];
  let isLoading = true;
  let isCalculatingRoute = false; // For specific route calculation loading state
  let error = null;
  let errorTimeout = null; // Timeout ID for clearing error message
  let searchTerm = "";
  let selectedSystem = null; // Holds data object
  let colorByRegion = false;
  let regions = [];
  let mounted = false;
  let regionLabelCache = new Map(); // Cache only for region labels now

  // Galaxy bounds tracking
  let galaxyCenter = new THREE.Vector3();
  let galaxySize = 0;

  // Interaction
  let raycaster;
  let mouse;
  let clock = new THREE.Clock();
  let lastClickTime = 0;
  let hoveredSystemData = null;
  let hoverRing; // Mesh for hover effect

  // Context menu state
  let contextMenu = { show: false, x: 0, y: 0, options: [] };

  // Live data visualization references
  let campMarkers = new Map(); // Map: systemId -> { group, campData, mixer, lastKillId, flashEndTime, secondaryGlow, secondaryGlowFlashEndTime }
  let roamPaths = new Map(); // Map: roamId -> { group, roamData, lineMaterial, lastKillId, flashEndTime, secondaryGlow, secondaryGlowFlashEndTime }
  let userLocationMarker = { group: null, mixer: null };
  let routeLines = null;
  let currentRoute = []; // Stores the current full route (array of system IDs)
  let dangerWarnings = [];
  let dangerTooltip;

  // Animation properties
  const PULSE_DURATION = 2.0;
  const FLASH_DURATION = 0.5; // Faster flash
  let lastAnimationTime = 0;

  // Fullscreen state
  let isFullscreen = false;

  // --- Constants ---
  const SCALE_FACTOR = 1e-14;
  const SYSTEM_SIZE = 8.0; // Keep increased base size
  const CONNECTION_COLOR = 0x00ffff;
  const DOUBLE_CLICK_TIME = 300;
  // REGION_PADDING removed
  const CAMP_COLOR = 0xff3333; // Red
  const ROAM_COLOR = 0x3333ff; // Blue
  const USER_COLOR = 0x00ffff; // Cyan
  const ROUTE_COLOR = 0x00ff00; // Green
  const DANGER_ROUTE_COLOR = 0xff6600; // Orange
  const FLASH_COLOR_CAMP = new THREE.Color(0xffdddd); // Light Red for camp flash
  const FLASH_COLOR_ROAM = new THREE.Color(0xddddff); // Light Blue for roam flash
  const SECONDARY_GLOW_COLOR_CAMP = 0xffaaaa; // Lighter Red
  const SECONDARY_GLOW_COLOR_ROAM = 0xaaaaff; // Lighter Blue

  // Region colors
  const regionColors = [
    0x3498db, 0x9b59b6, 0x2ecc71, 0xe74c3c, 0xf1c40f, 0x1abc9c, 0xd35400,
    0x34495e, 0x95a5a6, 0x16a085, 0x27ae60, 0x2980b9, 0x8e44ad, 0xe67e22,
    0xc0392b, 0xf39c12, 0xd35400, 0x7f8c8d, 0xbdc3c7, 0x7d3c98, 0xb3b6b7,
    0x2874a6, 0x138d75, 0xba4a00, 0x566573, 0xd4ac0d, 0xca6f1e, 0x48c9b0,
    0xf5b041, 0xa569bd, 0x5d6d7e, 0x45b39d, 0xf4d03f, 0xaf7ac5, 0x5499c7,
    0x48c9b0, 0xeb984e, 0xcd6155, 0x5d6d7e, 0xf7dc6f, 0x85c1e9, 0x73c6b6,
  ];

  // --- Reusable Textures ---
  let circleTexture;
  let glowTexture;

  // --- Resource Disposal Utility ---
  function disposeObject3D(obj) {
    if (!obj) return;
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      } else {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
    }
    // Special handling for CSS2DObject labels
    if (obj instanceof CSS2DObject && obj.element) {
      obj.element.remove();
    } else if (
      obj.userData?.label instanceof CSS2DObject &&
      obj.userData.label.element
    ) {
      obj.userData.label.element.remove();
      obj.userData.label = null;
    } else if (obj.label instanceof CSS2DObject && obj.label.element) {
      obj.label.element.remove();
      obj.label = null;
    }

    while (obj.children.length > 0) {
      disposeObject3D(obj.children[0]);
      obj.remove(obj.children[0]);
    }
    if (obj.userData?.mixer) {
      obj.userData.mixer.stopAllAction();
      obj.userData.mixer = null;
    }
  }

  // --- Reactive Subscriptions & Updates ---
  $: camps = $activeCamps;
  $: roams = $activeRoams;
  $: userLocation = $currentLocation;

  $: if (mounted && camps !== undefined && scene)
    updateCampVisualizations(camps || []);
  $: if (mounted && roams !== undefined && scene)
    updateRoamVisualizations(roams || []);
  $: if (mounted && userLocation !== undefined && scene)
    updateUserLocationMarker(userLocation);

  // Info panel reactive data
  $: selectedCampMarkerData = selectedSystem
    ? campMarkers.get(selectedSystem.itemid)?.campData
    : null;
  $: firstMatchingRoamData = selectedSystem
    ? Array.from(roamPaths.values()).find((roamPathObj) =>
        roamPathObj.roamData.systems?.some(
          (s) => parseInt(s.id) === selectedSystem.itemid
        )
      )?.roamData
    : null;

  // --- Texture Creation Functions ---
  function createCircleTexture() {
    const canvas = document.createElement("canvas");
    const size = 64;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2, 0, 2 * Math.PI);
    context.fillStyle = "white";
    context.fill();
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }
  function createGlowTexture() {
    const canvas = document.createElement("canvas");
    const size = 128;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    const gradient = context.createRadialGradient(
      size / 2,
      size / 2,
      size / 6,
      size / 2,
      size / 2,
      size / 2
    );
    gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  // --- Lifecycle Hooks ---
  onMount(async () => {
    try {
      console.log("Component mounting...");
      circleTexture = createCircleTexture();
      glowTexture = createGlowTexture();

      await initializeMap();

      window.addEventListener("resize", handleResize);
      container.addEventListener("mousemove", onMouseMove);
      container.addEventListener("click", onClick);
      container.addEventListener("dblclick", onDoubleClick);
      container.addEventListener("contextmenu", onContextMenu);
      document.addEventListener("fullscreenchange", handleFullscreenChange);

      dangerTooltip = document.createElement("div");
      dangerTooltip.className = "danger-tooltip";
      dangerTooltip.style.display = "none";

      mounted = true;
      console.log("Map initialized.");
      animate(performance.now());
    } catch (err) {
      console.error("Error initializing map:", err);
      error = err.message || "Failed to initialize map";
      if (errorTimeout) clearTimeout(errorTimeout);
      errorTimeout = setTimeout(() => {
        error = null;
      }, 5000);
    } finally {
      isLoading = false;
    }
  });

  let frameId;
  onDestroy(() => {
    console.log("Component destroying...");
    mounted = false;
    if (frameId) cancelAnimationFrame(frameId);
    window.removeEventListener("resize", handleResize);
    document.removeEventListener("fullscreenchange", handleFullscreenChange);
    if (container) {
      container.removeEventListener("mousemove", onMouseMove);
      container.removeEventListener("click", onClick);
      container.removeEventListener("dblclick", onDoubleClick);
      container.removeEventListener("contextmenu", onContextMenu);
    }
    if (errorTimeout) clearTimeout(errorTimeout); // Clear error timeout
    console.log("Disposing scene objects...");
    campMarkers.forEach((markerObj) => disposeObject3D(markerObj.group));
    campMarkers.clear();
    roamPaths.forEach((pathObj) => disposeObject3D(pathObj.group));
    roamPaths.clear();
    if (userLocationMarker.group) disposeObject3D(userLocationMarker.group);
    userLocationMarker = { group: null, mixer: null };
    if (routeLines) disposeObject3D(routeLines);
    routeLines = null;
    regionLabelCache.forEach((cacheEntry) => {
      // Clear label cache
      disposeObject3D(cacheEntry.label);
    });
    regionLabelCache.clear();
    stargateConnections.forEach((line) => disposeObject3D(line));
    stargateConnections = [];
    const pointsObject = scene?.children.find(
      (child) => child.userData?.isSystemPoints
    );
    if (pointsObject) disposeObject3D(pointsObject);
    solarSystems.forEach((sys) => {
      if (sys.label) disposeObject3D(sys.label);
    });
    solarSystems.clear();
    if (hoverRing) disposeObject3D(hoverRing);
    console.log("Dynamic objects disposed.");
    if (renderer) renderer.dispose();
    if (labelRenderer?.domElement?.parentElement)
      labelRenderer.domElement.remove();
    if (controls) controls.dispose();
    if (circleTexture) circleTexture.dispose();
    if (glowTexture) glowTexture.dispose();
    console.log("Renderers, controls, textures disposed.");
    if (dangerTooltip?.parentElement) dangerTooltip.remove();
    console.log("Component destroyed.");
  });

  // --- Fullscreen Handling ---
  async function toggleFullscreen() {
    const mainContainer = container.closest(".universe-map-container");
    if (!mainContainer) return;

    if (!document.fullscreenElement) {
      try {
        await mainContainer.requestFullscreen();
      } catch (err) {
        console.error(`Error requesting fullscreen: ${err.message}`);
        error = `Fullscreen not supported/denied.`;
        if (errorTimeout) clearTimeout(errorTimeout);
        errorTimeout = setTimeout(() => {
          error = null;
        }, 5000);
      }
    } else {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      }
    }
  }
  async function handleFullscreenChange() {
    isFullscreen = !!document.fullscreenElement;
    await tick();
    if (mounted) handleResize();
  }

  // --- Context Menu & ESI ---
  function onContextMenu(event) {
    event.preventDefault();
    if (!selectedSystem) return;
    const rect = container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    contextMenu = {
      show: true,
      x,
      y,
      options: [
        {
          label: "Set Destination",
          action: () => calculateRoute(selectedSystem.itemid, true), // Use new function
        },
        {
          label: "Add Waypoint",
          action: () => calculateRoute(selectedSystem.itemid, false), // Use new function
        },
        {
          label: "View Activity",
          action: () => showSystemActivity(selectedSystem),
        },
      ],
    };
  }
  function handleMenuSelect(event) {
    const option = event.detail;
    option.action();
    contextMenu.show = false;
  }
  async function setDestination(systemId, clearOthers = true) {
    // This function is now only called by calculateRoute for ESI UI interaction
    try {
      const accessToken = await getValidAccessToken();
      const result = await fetch(
        `https://esi.evetech.net/latest/ui/autopilot/waypoint/?add_to_beginning=false&clear_other_waypoints=${clearOthers}&datasource=tranquility&destination_id=${systemId}`,
        { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!result.ok) {
        if (result.status === 401)
          window.dispatchEvent(new CustomEvent("session-expired"));
        throw new Error(`Failed to set destination: ${result.status}`);
      }
      console.log(
        `[setDestination] ESI UI waypoint set for ${systemId}, clearOthers: ${clearOthers}`
      );
      return true;
    } catch (error) {
      console.error("Error setting destination via ESI UI:", error);
      return false;
    }
  }
  function showSystemActivity(system) {
    const systemCamps = Array.from(campMarkers.values())
      .filter((marker) => parseInt(marker.campData.systemId) === system.itemid)
      .map((marker) => marker.campData);
    const systemRoams = Array.from(roamPaths.values())
      .filter((path) =>
        path.roamData.systems?.some((s) => parseInt(s.id) === system.itemid)
      )
      .map((path) => path.roamData);
    if (systemCamps.length > 0) {
      const sortedCamps = [...systemCamps].sort(
        (a, b) => b.probability - a.probability
      );
      const latestKill = sortedCamps[0].kills[sortedCamps[0].kills.length - 1];
      if (latestKill)
        window.open(
          `https://zkillboard.com/kill/${latestKill.killID}/`,
          "_blank"
        );
    } else if (systemRoams.length > 0) {
      const sortedRoams = [...systemRoams].sort(
        (a, b) => new Date(b.lastActivity) - new Date(a.lastActivity)
      );
      const latestKill = sortedRoams[0].kills[sortedRoams[0].kills.length - 1];
      if (latestKill)
        window.open(
          `https://zkillboard.com/kill/${latestKill.killID}/`,
          "_blank"
        );
    }
  }

  // --- Map Initialization & Building ---
  async function initializeMap() {
    try {
      console.log("Client: Loading map data...");
      const response = await fetch("/api/map-data");
      if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
      mapData = await response.json();
      console.log(`Client: Received ${mapData.length} map entries`);
      if (mapData.length === 0) throw new Error("No map data received");
      regions = mapData
        .filter((item) => item.typeid === 3)
        .map((region, index) => ({
          id: region.itemid,
          name: region.itemname,
          x: region.x,
          y: region.y,
          z: region.z,
          color: regionColors[index % regionColors.length],
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      console.log(`Client: Extracted ${regions.length} regions`);
      initThreeJS();
      buildMap();
      calculateGalaxyBounds();
      setInitialCameraPosition();
    } catch (err) {
      console.error("Error initializing map:", err);
      error = err.message || "Failed to initialize map";
      if (errorTimeout) clearTimeout(errorTimeout);
      errorTimeout = setTimeout(() => {
        error = null;
      }, 5000);
      throw err;
    }
  }
  function initThreeJS() {
    console.log("Initializing Three.js...");
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000011);
    camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      1000000
    );
    camera.position.set(0, 0, 50);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(container.clientWidth, container.clientHeight);
    labelRenderer.domElement.style.position = "absolute";
    labelRenderer.domElement.style.top = "0";
    labelRenderer.domElement.style.pointerEvents = "none";
    container.appendChild(labelRenderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.rotateSpeed = 0;
    controls.panSpeed = 0.8;
    controls.zoomSpeed = 1.2;
    controls.minDistance = 0.5;
    controls.maxDistance = 2500;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = 0;
    controls.enableRotate = false;
    controls.enablePan = true;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 1.5;
    mouse = new THREE.Vector2();

    // Initialize hover ring
    const ringGeometry = new THREE.RingGeometry(
      SYSTEM_SIZE * 0.8 * 3, // Adjusted size
      SYSTEM_SIZE * 0.9 * 3, // Adjusted size
      32
    );
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff, // Cyan
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7,
    });
    hoverRing = new THREE.Mesh(ringGeometry, ringMaterial);
    hoverRing.rotation.x = -Math.PI / 2;
    hoverRing.visible = false;
    scene.add(hoverRing);

    console.log("Three.js initialized successfully");
  }
  function buildMap() {
    console.log("Building base map...");
    // Clear dynamic objects
    campMarkers.forEach((markerObj) => {
      scene.remove(markerObj.group);
      disposeObject3D(markerObj.group);
    });
    campMarkers.clear();
    roamPaths.forEach((pathObj) => {
      scene.remove(pathObj.group);
      disposeObject3D(pathObj.group);
    });
    roamPaths.clear();
    if (userLocationMarker.group) {
      scene.remove(userLocationMarker.group);
      disposeObject3D(userLocationMarker.group);
      userLocationMarker = { group: null, mixer: null };
    }
    if (routeLines) {
      scene.remove(routeLines);
      disposeObject3D(routeLines);
      routeLines = null;
    }

    // Clear previous base map objects (excluding cached region labels)
    stargateConnections.forEach((line) => {
      scene.remove(line);
      disposeObject3D(line);
    });
    stargateConnections = [];
    const oldPointsObject = scene?.children.find(
      (child) => child.userData?.isSystemPoints
    );
    if (oldPointsObject) {
      scene.remove(oldPointsObject);
      disposeObject3D(oldPointsObject);
    }
    solarSystems.forEach((sys) => {
      if (sys.label) {
        scene.remove(sys.label);
        disposeObject3D(sys.label);
      }
    });
    solarSystems.clear();

    // Filter data
    const solarSystemsData = mapData.filter((item) => item.typeid === 5);
    const stargatesData = mapData.filter((item) => item.groupid === 10);
    if (solarSystemsData.length === 0) {
      console.warn("No solar system data found.");
      return;
    }
    const processedConnections = new Set();
    const connectedSystems = new Set();
    stargatesData.forEach((sourceGate) => {
      if (!sourceGate.solarsystemid || !sourceGate.itemname) return;
      const match = sourceGate.itemname.match(/Stargate \(([^)]+)\)/);
      if (!match) return;
      const destinationName = match[1];
      const destinationSystem = solarSystemsData.find(
        (sys) => sys.itemname === destinationName
      );
      if (!destinationSystem) return;
      const sourceSystem = solarSystemsData.find(
        (sys) => sys.itemid === sourceGate.solarsystemid
      );
      if (!sourceSystem) return;
      const sourceRegion = regions.find((r) => r.id === sourceSystem.regionid);
      const destRegion = regions.find(
        (r) => r.id === destinationSystem.regionid
      );
      if (
        (sourceRegion && sourceRegion.name.startsWith("C-R")) ||
        (destRegion && destRegion.name.startsWith("C-R"))
      )
        return;
      const connectionId = [sourceSystem.itemid, destinationSystem.itemid]
        .sort()
        .join("-");
      if (processedConnections.has(connectionId)) return;
      processedConnections.add(connectionId);
      connectedSystems.add(sourceSystem.itemid);
      connectedSystems.add(destinationSystem.itemid);
    });
    const filteredSystems = solarSystemsData.filter((system) =>
      connectedSystems.has(system.itemid)
    );
    const searchFilteredSystems = searchTerm
      ? filteredSystems.filter((system) =>
          system.itemname.toLowerCase().includes(searchTerm.toLowerCase())
        )
      : filteredSystems;
    console.log(`After filtering: ${searchFilteredSystems.length} systems`);
    if (searchFilteredSystems.length === 0) {
      calculateGalaxyBounds();
      setInitialCameraPosition();
      return;
    }

    // Create System Points
    const positions = [];
    const colors = [];
    searchFilteredSystems.forEach((system, idx) => {
      if (system.x === null || system.y === null || system.z === null) return;
      const posX = system.x * SCALE_FACTOR;
      const posY = 0;
      const posZ = system.z * SCALE_FACTOR;
      positions.push(posX, posY, posZ);
      let color;
      if (colorByRegion) {
        const region = regions.find((r) => r.id === system.regionid);
        color = new THREE.Color(region ? region.color : 0xffffff);
      } else {
        color = new THREE.Color(getSecurityColor(system.security));
      }
      colors.push(color.r, color.g, color.b);
      const labelDiv = document.createElement("div");
      labelDiv.className = "system-label";
      labelDiv.textContent = system.itemname;
      const label = new CSS2DObject(labelDiv);
      label.position.set(posX, posY, posZ);
      label.visible = false; // Initially hidden
      scene.add(label);
      solarSystems.set(system.itemid, {
        position: new THREE.Vector3(posX, posY, posZ),
        label,
        data: system,
        index: idx,
        securityColor: getSecurityColor(system.security),
        regionColor:
          regions.find((r) => r.id === system.regionid)?.color || 0xffffff,
        connections: new Set(),
      });
    });
    if (positions.length === 0) {
      console.warn("No valid system positions");
      return;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const pointsMaterial = new THREE.PointsMaterial({
      size: SYSTEM_SIZE,
      vertexColors: true,
      sizeAttenuation: true,
      map: circleTexture,
      alphaTest: 0.5,
      transparent: true,
    });
    const points = new THREE.Points(geometry, pointsMaterial);
    points.userData.isSystemPoints = true;
    scene.add(points);
    console.log(`Added ${solarSystems.size} system points.`);

    // Create Connections
    let connectionCount = 0;
    processedConnections.clear();
    stargatesData.forEach((sourceGate) => {
      if (!sourceGate.solarsystemid || !sourceGate.itemname) return;
      const match = sourceGate.itemname.match(/Stargate \(([^)]+)\)/);
      if (!match) return;
      const destinationName = match[1];
      const destinationSystem = solarSystemsData.find(
        (sys) => sys.itemname === destinationName
      );
      if (!destinationSystem) return;
      const sourceSystem = solarSystemsData.find(
        (sys) => sys.itemid === sourceGate.solarsystemid
      );
      if (!sourceSystem) return;
      const sourceRegion = regions.find((r) => r.id === sourceSystem.regionid);
      const destRegion = regions.find(
        (r) => r.id === destinationSystem.regionid
      );
      if (
        (sourceRegion && sourceRegion.name.startsWith("C-R")) ||
        (destRegion && destRegion.name.startsWith("C-R"))
      )
        return;
      const connectionId = [sourceSystem.itemid, destinationSystem.itemid]
        .sort()
        .join("-");
      if (processedConnections.has(connectionId)) return;
      processedConnections.add(connectionId);
      if (
        searchFilteredSystems.some(
          (sys) => sys.itemid === sourceSystem.itemid
        ) &&
        searchFilteredSystems.some(
          (sys) => sys.itemid === destinationSystem.itemid
        )
      ) {
        const connection = createConnectionLine(
          sourceSystem,
          destinationSystem
        );
        if (connection) {
          scene.add(connection);
          stargateConnections.push(connection);
          connectionCount++;
        }
      }
    });
    console.log(`Created ${connectionCount} stargate connections`);

    // Create or show Region Labels (Backgrounds removed)
    createRegionLabels(searchFilteredSystems);

    // Final steps
    calculateGalaxyBounds();
    setInitialCameraPosition();
    console.log("Base map build complete.");
  }
  function createConnectionLine(sourceSystem, destinationSystem) {
    if (
      sourceSystem.x === null ||
      sourceSystem.y === null ||
      sourceSystem.z === null ||
      destinationSystem.x === null ||
      destinationSystem.y === null ||
      destinationSystem.z === null
    ) {
      return null;
    }
    const startPoint = new THREE.Vector3(
      sourceSystem.x * SCALE_FACTOR,
      0,
      sourceSystem.z * SCALE_FACTOR
    );
    const endPoint = new THREE.Vector3(
      destinationSystem.x * SCALE_FACTOR,
      0,
      destinationSystem.z * SCALE_FACTOR
    );
    let lineColor;
    if (colorByRegion) {
      if (sourceSystem.regionid === destinationSystem.regionid) {
        const region = regions.find((r) => r.id === sourceSystem.regionid);
        lineColor = region ? region.color : CONNECTION_COLOR;
      } else {
        lineColor = CONNECTION_COLOR;
      }
    } else {
      const sourceSec = sourceSystem.security ?? 0;
      const destSec = destinationSystem.security ?? 0;
      lineColor =
        sourceSec < destSec
          ? getSecurityColor(sourceSystem.security)
          : getSecurityColor(destinationSystem.security);
    }
    const geometry = new THREE.BufferGeometry().setFromPoints([
      startPoint,
      endPoint,
    ]);
    const material = new THREE.LineBasicMaterial({
      color: lineColor,
      opacity: 0.4,
      transparent: true,
      linewidth: 1,
    });
    return new THREE.Line(geometry, material);
  }

  function createRegionLabels(systemsInMap) {
    console.log("Creating/Updating region labels...");

    // Ensure all cached region labels are added to the scene if not already present
    regionLabelCache.forEach((cacheEntry) => {
      if (!cacheEntry.label.parent) scene.add(cacheEntry.label);
      cacheEntry.label.visible = true; // Labels are always visible
    });

    const regionSystems = new Map();
    systemsInMap.forEach((systemData) => {
      const regionId = systemData.regionid;
      if (!regionSystems.has(regionId)) regionSystems.set(regionId, []);
      regionSystems.get(regionId).push({
        x: systemData.x * SCALE_FACTOR,
        y: 0,
        z: systemData.z * SCALE_FACTOR,
      });
    });

    regionSystems.forEach((positions, regionId) => {
      if (positions.length < 1) return; // Need at least one system
      const region = regions.find((r) => r.id === regionId);
      if (!region) return;

      if (!regionLabelCache.has(regionId)) {
        console.log(`Creating label for region ${region.name} (${regionId})`);
        const cacheEntry = {};

        // --- Create Label ---
        const avgPosition = new THREE.Vector3();
        positions.forEach((p) => avgPosition.add(p));
        avgPosition.divideScalar(positions.length);
        const labelDiv = document.createElement("div");
        labelDiv.className = "region-label";
        labelDiv.textContent = region.name;
        labelDiv.style.color = `#${new THREE.Color(region.color).getHexString()}`;
        const label = new CSS2DObject(labelDiv);
        label.position.set(avgPosition.x, 0.1, avgPosition.z); // Position slightly above systems
        label.userData.regionId = regionId;
        label.visible = true; // Always visible
        cacheEntry.label = label;
        cacheEntry.center = new THREE.Vector3(
          avgPosition.x,
          0.1,
          avgPosition.z
        );
        scene.add(label);

        regionLabelCache.set(regionId, cacheEntry);
        console.log(`Created and cached label for region ${region.name}`);
      } else {
        // Ensure cached label is visible
        const cacheEntry = regionLabelCache.get(regionId);
        cacheEntry.label.visible = true;
      }
    });
    console.log(`Region labels update complete.`);
  }

  // --- Live Data Updates ---
  function updateCampVisualizations(newCamps) {
    if (!scene || !mounted) return;
    const now = clock.getElapsedTime();
    const newCampIds = new Set(newCamps.map((camp) => parseInt(camp.systemId)));

    // Remove old or low-probability camps
    campMarkers.forEach((markerObj, systemId) => {
      const campStillExists = newCamps.find(
        (c) => parseInt(c.systemId) === systemId && c.probability >= 30
      );
      if (!campStillExists) {
        scene.remove(markerObj.group);
        disposeObject3D(markerObj.group);
        campMarkers.delete(systemId);
      }
    });

    // Add/Update camps
    newCamps.forEach((camp) => {
      const systemId = parseInt(camp.systemId);
      if (camp.probability < 30) return;

      const system = solarSystems.get(systemId);
      if (!system) return;

      const latestKillId = camp.kills[camp.kills.length - 1]?.killID;

      if (campMarkers.has(systemId)) {
        // Update existing marker
        const markerObj = campMarkers.get(systemId);
        markerObj.campData = camp;

        // Check for new kill to trigger flash
        if (latestKillId && markerObj.lastKillId !== latestKillId) {
          markerObj.flashEndTime = now + FLASH_DURATION;
          markerObj.lastKillId = latestKillId;
          console.log(`Flash triggered for camp in system ${systemId}`);
        }
      } else {
        // Create new marker
        const campGroup = new THREE.Group();
        campGroup.position.copy(system.position);

        // Primary Glow
        const glowSize = (camp.probability / 100) * 20 + 5;
        const glowMaterial = new THREE.SpriteMaterial({
          map: glowTexture,
          color: new THREE.Color(CAMP_COLOR),
          transparent: true,
          opacity: Math.min(0.8, camp.probability / 100),
          depthWrite: false,
          sizeAttenuation: true,
        });
        const glowSprite = new THREE.Sprite(glowMaterial);
        glowSprite.scale.set(glowSize, glowSize, 1);
        campGroup.add(glowSprite);

        // Secondary Glow
        const secondaryGlowSize = glowSize * 10.0; // Keep increased size
        const secondaryGlowMaterial = new THREE.SpriteMaterial({
          map: glowTexture,
          color: new THREE.Color(SECONDARY_GLOW_COLOR_CAMP), // Lighter red
          transparent: true,
          opacity: 0.1, // Lower base opacity for secondary
          depthWrite: false,
          sizeAttenuation: true,
        });
        const secondaryGlowSprite = new THREE.Sprite(secondaryGlowMaterial);
        secondaryGlowSprite.scale.set(secondaryGlowSize, secondaryGlowSize, 1);
        secondaryGlowSprite.renderOrder = -1;
        campGroup.add(secondaryGlowSprite);

        // Animation Mixer
        const mixer = new THREE.AnimationMixer(glowSprite);
        const initialScaleVal = glowSprite.scale.x;
        const track = new THREE.KeyframeTrack(
          ".scale",
          [0, PULSE_DURATION / 2, PULSE_DURATION],
          [
            initialScaleVal,
            initialScaleVal,
            initialScaleVal,
            initialScaleVal * 1.3,
            initialScaleVal * 1.3,
            initialScaleVal,
            initialScaleVal,
            initialScaleVal,
            initialScaleVal,
          ]
        );
        const clip = new THREE.AnimationClip("pulse", PULSE_DURATION, [track]);
        const action = mixer.clipAction(clip);
        action.setLoop(THREE.LoopRepeat);
        action.play();

        campGroup.userData = {
          mixer: mixer,
          type: "camp",
          campData: camp,
          name: system.data.itemname,
          probability: camp.probability,
        };
        scene.add(campGroup);
        campMarkers.set(systemId, {
          group: campGroup,
          campData: camp,
          mixer: mixer,
          lastKillId: latestKillId,
          flashEndTime: 0,
          secondaryGlow: secondaryGlowSprite,
        });
      }
    });
  }
  function updateRoamVisualizations(newRoams) {
    if (!scene || !mounted) return;
    const now = clock.getElapsedTime();
    const newRoamIds = new Set(newRoams.map((roam) => roam.id));
    // Remove old
    roamPaths.forEach((pathObj, roamId) => {
      if (!newRoamIds.has(roamId)) {
        scene.remove(pathObj.group);
        disposeObject3D(pathObj.group);
        roamPaths.delete(roamId);
      }
    });
    // Add/Update new
    newRoams.forEach((roam) => {
      const latestKillId = roam.kills[roam.kills.length - 1]?.killID;

      if (roamPaths.has(roam.id)) {
        // Update existing roam
        const pathObj = roamPaths.get(roam.id);
        pathObj.roamData = roam;

        // Check for new kill to trigger flash
        if (latestKillId && pathObj.lastKillId !== latestKillId) {
          pathObj.flashEndTime = now + FLASH_DURATION;
          pathObj.lastKillId = latestKillId;
          console.log(`Flash triggered for roam ${roam.id}`);
          if (pathObj.secondaryGlow) {
            pathObj.secondaryGlowFlashEndTime = now + FLASH_DURATION;
          }
        }
        return;
      }

      // Create new roam path
      if (!roam.systems || roam.systems.length < 2) return;
      const sortedSystems = [...roam.systems].sort(
        (a, b) => new Date(a.time) - new Date(b.time)
      );
      const points = [];
      const systemOrder = [];
      for (const system of sortedSystems) {
        const systemObj = solarSystems.get(parseInt(system.id));
        if (systemObj) {
          points.push(systemObj.position.clone());
          systemOrder.push(system);
        }
      }
      if (points.length < 2) return;
      const roamGroup = createRoamPath(points, systemOrder, roam);
      if (!roamGroup) return;
      scene.add(roamGroup);
      const lineObject = roamGroup.children.find(
        (c) => c instanceof THREE.Line
      );

      // Add secondary glow sprite for the roam path
      let secondaryGlowSprite = null;
      const lastSystemPos = points[points.length - 1];
      if (lastSystemPos) {
        const secondaryGlowMaterial = new THREE.SpriteMaterial({
          map: glowTexture,
          color: new THREE.Color(SECONDARY_GLOW_COLOR_ROAM), // Lighter blue
          transparent: true,
          opacity: 0.1, // Lower base opacity
          depthWrite: false,
          sizeAttenuation: true,
        });
        secondaryGlowSprite = new THREE.Sprite(secondaryGlowMaterial);
        secondaryGlowSprite.scale.set(60, 60, 1); // Increased secondary size
        secondaryGlowSprite.position.copy(lastSystemPos);
        secondaryGlowSprite.renderOrder = -1;
        roamGroup.add(secondaryGlowSprite);
      }

      roamPaths.set(roam.id, {
        group: roamGroup,
        roamData: roam,
        lineMaterial: lineObject?.material,
        lastKillId: latestKillId,
        flashEndTime: 0,
        secondaryGlow: secondaryGlowSprite,
        secondaryGlowFlashEndTime: 0,
      });

      // Add system glow markers
      sortedSystems.forEach((system) => {
        const systemIdInt = parseInt(system.id);
        const systemObj = solarSystems.get(systemIdInt);
        if (!systemObj || campMarkers.has(systemIdInt)) return;
        const glowMaterial = new THREE.SpriteMaterial({
          map: glowTexture,
          color: new THREE.Color(ROAM_COLOR),
          transparent: true,
          opacity: 0.6,
          depthWrite: false,
        });
        const glowSprite = new THREE.Sprite(glowMaterial);
        glowSprite.position.copy(systemObj.position);
        glowSprite.scale.set(8, 8, 1);
        roamGroup.add(glowSprite);
      });
    });
  }
  function createRoamPath(points, systems, roamData) {
    if (points.length < 2) return null;
    const group = new THREE.Group();
    try {
      const curve = new THREE.CatmullRomCurve3(points);
      const geometry = new THREE.BufferGeometry().setFromPoints(
        curve.getPoints(Math.max(64, points.length * 8))
      );
      const material = new THREE.LineBasicMaterial({
        color: new THREE.Color(ROAM_COLOR).multiplyScalar(1.5),
        linewidth: 2,
        transparent: true,
        opacity: 0.7,
      });
      material.userData = { baseColor: new THREE.Color(ROAM_COLOR) };
      const line = new THREE.Line(geometry, material);
      group.add(line);
      group.userData = { type: "roam", roamData: roamData, systems: systems };
      return group;
    } catch (e) {
      console.error("Error creating roam path:", e);
      disposeObject3D(group);
      return null;
    }
  }
  function updateUserLocationMarker(newUserLocation) {
    if (!scene || !mounted) return;
    if (userLocationMarker.group) {
      scene.remove(userLocationMarker.group);
      disposeObject3D(userLocationMarker.group);
      userLocationMarker = { group: null, mixer: null };
    }
    if (!newUserLocation || !newUserLocation.solar_system_id) return;
    const systemId = parseInt(newUserLocation.solar_system_id);
    const system = solarSystems.get(systemId);
    if (!system) return;
    const markerGroup = new THREE.Group();
    markerGroup.position.copy(system.position);
    const glowMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: new THREE.Color(USER_COLOR),
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    const glowSprite = new THREE.Sprite(glowMaterial);
    glowSprite.scale.set(15, 15, 1);
    const ringGeometry = new THREE.RingGeometry(0.008, 0.01, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: USER_COLOR,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2;
    const mixer = new THREE.AnimationMixer(glowSprite);
    const initialScaleVal = glowSprite.scale.x;
    const track = new THREE.KeyframeTrack(
      ".scale",
      [0, PULSE_DURATION / 2, PULSE_DURATION],
      [
        initialScaleVal,
        initialScaleVal,
        initialScaleVal,
        initialScaleVal * 1.2,
        initialScaleVal * 1.2,
        initialScaleVal,
        initialScaleVal,
        initialScaleVal,
        initialScaleVal,
      ]
    );
    const clip = new THREE.AnimationClip("userPulse", PULSE_DURATION, [track]);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat);
    action.play();
    markerGroup.add(glowSprite);
    markerGroup.add(ring);
    markerGroup.userData = {
      type: "userLocation",
      name: newUserLocation.systemName || system.data.itemname,
      systemId: systemId,
      mixer: mixer,
    };
    scene.add(markerGroup);
    userLocationMarker = { group: markerGroup, mixer: mixer };
  }

  // --- Route Calculation & Visualization ---
  async function fetchEsiRoute(originId, destinationId) {
    // **MODIFIED:** Use the server-side proxy
    console.log(
      `[fetchEsiRoute] Fetching route via SERVER PROXY from ${originId} to ${destinationId}`
    );
    // Construct the relative URL for the server proxy
    const url = `/api/route/${originId}/${destinationId}?flag=shortest`;
    console.log(`[fetchEsiRoute] Request URL (proxy): ${url}`);
    try {
      // Use fetch to call the local server endpoint
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          // No need for Cache-Control here, let the server handle it
        },
      });
      console.log(`[fetchEsiRoute] Proxy response status: ${response.status}`);
      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[fetchEsiRoute] Proxy route error ${response.status}: ${errorText} for URL: ${url}`
        );
        // Try to parse the error from the server
        let serverError = `Failed to fetch route via proxy (${response.status})`;
        try {
          const jsonError = JSON.parse(errorText);
          serverError = jsonError.error || serverError;
        } catch (e) {
          /* ignore json parse error */
        }
        throw new Error(serverError);
      }
      const routeData = await response.json();
      console.log(
        `[fetchEsiRoute] Proxy route received: ${routeData.length} jumps`,
        JSON.stringify(routeData)
      );
      return routeData;
    } catch (error) {
      // Catch errors from the fetch call itself (e.g., server down)
      console.error(`[fetchEsiRoute] Error fetching route via proxy: ${error}`);
      // Re-throw the error so calculateRoute can handle it
      throw new Error(
        `Network error fetching route via proxy: ${error.message}`
      );
    }
  }

  async function calculateRoute(destinationId, isNewRoute) {
    console.log(
      `[calculateRoute] Calculating route to ${destinationId}, isNewRoute: ${isNewRoute}`
    );

    if (routeLines) {
      scene.remove(routeLines);
      disposeObject3D(routeLines);
      routeLines = null;
      console.log("[calculateRoute] Cleared previous route lines.");
    }
    dangerWarnings = [];
    if (dangerTooltip?.parentElement) dangerTooltip.remove();

    let originId;
    if (isNewRoute || currentRoute.length === 0) {
      if (!userLocationMarker.group?.userData?.systemId) {
        console.error(
          "[calculateRoute] User location unknown, cannot calculate new route."
        );
        error = "Your location is unknown. Cannot calculate route.";
        if (errorTimeout) clearTimeout(errorTimeout);
        errorTimeout = setTimeout(() => {
          error = null;
        }, 5000);
        return;
      }
      originId = userLocationMarker.group.userData.systemId;
      currentRoute = []; // Clear waypoints for a new route
      console.log(
        `[calculateRoute] Starting new route from user location: ${originId}`
      );
    } else {
      originId = currentRoute[currentRoute.length - 1];
      console.log(
        `[calculateRoute] Adding waypoint from last system: ${originId}`
      );
    }

    if (originId === destinationId) {
      console.log("[calculateRoute] Origin and destination are the same.");
      return;
    }

    isCalculatingRoute = true; // Show "Setting route..."
    isLoading = false; // Hide general loading
    error = null;
    if (errorTimeout) clearTimeout(errorTimeout);
    await tick();

    try {
      // This now calls the modified fetchEsiRoute which uses the proxy
      const routeSegment = await fetchEsiRoute(originId, destinationId);

      if (routeSegment && routeSegment.length > 0) {
        console.log(
          `[calculateRoute] Route segment found: ${routeSegment.length} systems.`
        );

        if (isNewRoute) {
          currentRoute = routeSegment;
        } else {
          if (
            currentRoute.length > 0 &&
            routeSegment[0] === currentRoute[currentRoute.length - 1]
          ) {
            currentRoute = [...currentRoute, ...routeSegment.slice(1)];
          } else if (
            currentRoute.length === 0 &&
            routeSegment[0] === originId
          ) {
            // If starting a waypoint route from user location
            currentRoute = routeSegment;
          } else {
            console.warn(
              "[calculateRoute] Route segment start doesn't match current end. Appending anyway."
            );
            currentRoute = [...currentRoute, ...routeSegment];
          }
        }

        console.log(
          `[calculateRoute] Updated full route: ${currentRoute.length} systems`
        );
        createRouteVisualization(currentRoute);
        checkRouteForDangers(currentRoute);
        // Also set ESI UI waypoint
        await setDestination(destinationId, isNewRoute); // Use isNewRoute to determine clear_other_waypoints
      } else {
        console.warn("[calculateRoute] No route segment returned from proxy.");
        error = "Could not calculate route."; // Simplified error message
        if (errorTimeout) clearTimeout(errorTimeout);
        errorTimeout = setTimeout(() => {
          error = null;
        }, 5000);
      }
    } catch (err) {
      console.error("[calculateRoute] Error:", err);
      error = `Route calculation failed: ${err.message}`;
      if (errorTimeout) clearTimeout(errorTimeout);
      errorTimeout = setTimeout(() => {
        error = null;
      }, 5000);
    } finally {
      isCalculatingRoute = false;
      await tick();
    }
  }

  function findSystemByPosition(x, y, z, tolerance = 0.0001) {
    for (const system of solarSystems.values()) {
      const dx = Math.abs(system.position.x - x);
      const dy = Math.abs(system.position.y - y);
      const dz = Math.abs(system.position.z - z);
      if (dx < tolerance && dy < tolerance && dz < tolerance) return system;
    }
    return null;
  }
  function createRouteVisualization(route) {
    // Accepts array of system IDs
    if (routeLines) {
      scene.remove(routeLines);
      disposeObject3D(routeLines);
      routeLines = null;
    }

    const group = new THREE.Group();
    const points = [];
    const dangerSegmentsIndices = [];
    for (let i = 0; i < route.length; i++) {
      const system = solarSystems.get(route[i]);
      if (system) {
        points.push(system.position.clone());
        let isDangerous = false;
        if (campMarkers.has(route[i])) isDangerous = true;
        else {
          for (const pathObj of roamPaths.values()) {
            if (
              pathObj.roamData.systems?.some((s) => parseInt(s.id) === route[i])
            ) {
              isDangerous = true;
              break;
            }
          }
        }
        if (isDangerous && i < route.length - 1) dangerSegmentsIndices.push(i);
      } else {
        console.warn(
          `System ID ${route[i]} not found in rendered map for route.`
        );
      }
    }
    if (points.length < 2) {
      console.warn("Not enough points to draw route visualization.");
      return;
    }
    const routeGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const routeMaterial = new THREE.LineBasicMaterial({
      color: ROUTE_COLOR,
      linewidth: 2,
      transparent: true,
      opacity: 0.7,
    });
    const routeLine = new THREE.Line(routeGeometry, routeMaterial);
    group.add(routeLine);
    dangerSegmentsIndices.forEach((i) => {
      if (i + 1 < points.length) {
        const dangerPoints = [points[i], points[i + 1]];
        const dangerGeometry = new THREE.BufferGeometry().setFromPoints(
          dangerPoints
        );
        const dangerMaterial = new THREE.LineBasicMaterial({
          color: DANGER_ROUTE_COLOR,
          linewidth: 3,
          transparent: true,
          opacity: 0.9,
        });
        const dangerLine = new THREE.Line(dangerGeometry, dangerMaterial);
        group.add(dangerLine);
      }
    });
    if (points.length > 0) {
      const startMarker = createRouteMarker(points[0], 0x00ff00);
      const endMarker = createRouteMarker(points[points.length - 1], 0xff0000);
      group.add(startMarker);
      group.add(endMarker);
    }
    scene.add(group);
    routeLines = group; // Assign the new group
  }
  function createRouteMarker(position, color) {
    const markerGeometry = new THREE.SphereGeometry(SYSTEM_SIZE * 0.5);
    const markerMaterial = new THREE.MeshBasicMaterial({ color });
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.position.copy(position);
    return marker;
  }
  function checkRouteForDangers(route) {
    // Accepts array of system IDs
    dangerWarnings = [];
    let tooltipHtml = "";
    for (let i = 0; i < route.length; i++) {
      const systemId = route[i];
      const system = solarSystems.get(systemId);
      if (!system) continue;
      let systemMarkedDangerous = false;
      if (campMarkers.has(systemId)) {
        const markerObj = campMarkers.get(systemId);
        const warning = {
          type: "camp",
          systemName: system.data.itemname || `System ${systemId}`,
          probability: markerObj.campData.probability,
          systemId: systemId,
        };
        dangerWarnings.push(warning);
        systemMarkedDangerous = true;
        tooltipHtml += `<li class="camp-warning" title="ID: ${warning.systemId}"><strong>${warning.systemName}</strong>: Gate camp (${Math.round(warning.probability)}% confidence)</li>`;
      }
      if (!systemMarkedDangerous) {
        for (const pathObj of roamPaths.values()) {
          if (
            pathObj.roamData.systems?.some((s) => parseInt(s.id) === systemId)
          ) {
            const warning = {
              type: "roam",
              systemName: system.data.itemname || `System ${systemId}`,
              gangSize: pathObj.roamData.members?.length || 0,
              systemId: systemId,
            };
            dangerWarnings.push(warning);
            systemMarkedDangerous = true;
            tooltipHtml += `<li class="roam-warning" title="ID: ${warning.systemId}"><strong>${warning.systemName}</strong>: Roaming gang (${warning.gangSize} pilots)</li>`;
            break;
          }
        }
      }
    }
    if (dangerWarnings.length > 0) showDangerWarnings(tooltipHtml);
    else if (dangerTooltip?.parentElement) dangerTooltip.remove();
  }
  function showDangerWarnings(warningsHtmlList) {
    if (!dangerTooltip) return;
    dangerTooltip.innerHTML = `<div class="danger-header">⚠️ Route Dangers</div><ul class="danger-list">${warningsHtmlList}</ul>`;
    if (!dangerTooltip.parentElement) container.appendChild(dangerTooltip);
    dangerTooltip.style.display = "block";
    setTimeout(() => {
      if (dangerTooltip) dangerTooltip.style.display = "none";
    }, 10000);
  }

  // --- UI Interaction & View Helpers ---
  function handleResize() {
    if (camera && renderer && labelRenderer) {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
      labelRenderer.setSize(container.clientWidth, container.clientHeight);
    }
  }
  function calculateGalaxyBounds() {
    if (solarSystems.size === 0) return;
    const positions = [];
    solarSystems.forEach((system) => {
      positions.push(system.position);
    });
    const boundingBox = new THREE.Box3().setFromPoints(positions);
    boundingBox.getCenter(galaxyCenter);
    galaxySize = boundingBox.getSize(new THREE.Vector3()).length();
    console.log("Galaxy bounds:", { center: galaxyCenter, size: galaxySize });
  }
  function setInitialCameraPosition() {
    if (galaxySize === 0) return;
    const distance = galaxySize * 1.5;
    camera.position.set(
      galaxyCenter.x,
      galaxyCenter.y + distance, // Position camera directly above center
      galaxyCenter.z
    );
    camera.lookAt(galaxyCenter);
    controls.target.copy(galaxyCenter);
    controls.update();
    console.log("Camera positioned at:", camera.position);
  }
  // Updated Security Color Function
  function getSecurityColor(security) {
    if (security === null || security === undefined) return 0xffffff; // White for unknown

    const sec = Math.round(security * 10) / 10; // Round to one decimal place

    const red = new THREE.Color(0xff0000);
    const darkOrange = new THREE.Color(0xff8c00);
    const brightOrange = new THREE.Color(0xffa500); // Brighter orange for 0.4
    const yellow = new THREE.Color(0xffff00);
    const limeGreen = new THREE.Color(0x32cd32); // Lime Green (brighter)
    const cyanBlue = new THREE.Color(0x00ffff); // Cyan/Aqua (very bright blue)

    if (sec < 0.0) {
      return red.getHex();
    } else if (sec < 0.4) {
      // 0.0 to 0.3
      const t = sec / 0.4;
      return new THREE.Color().lerpColors(darkOrange, brightOrange, t).getHex();
    } else if (sec < 0.5) {
      // 0.4
      // Lerp between brightOrange and yellow, making 0.4 mostly orange
      const t = (sec - 0.4) / 0.1;
      return new THREE.Color()
        .lerpColors(brightOrange, yellow, t * 0.5)
        .getHex(); // Bias heavily to orange
    } else if (sec === 0.5) {
      return yellow.getHex(); // Exactly 0.5 is yellow
    } else if (sec <= 0.8) {
      // Lerp between Yellow and Bright Green (Lime)
      const t = (sec - 0.5) / (0.8 - 0.5);
      return new THREE.Color().lerpColors(yellow, limeGreen, t).getHex();
    } else {
      // sec > 0.8
      // Lerp between Bright Green (Lime) and Cyan Blue for > 0.8 to 1.0
      const t = Math.min(1.0, (sec - 0.8) / 0.2);
      return new THREE.Color().lerpColors(limeGreen, cyanBlue, t).getHex();
    }
  }
  function getSecurityDescription(security) {
    if (security === null || security === undefined) return "Unknown";
    if (security >= 0.5) return "High Security";
    if (security > 0.0) return "Low Security";
    return "Null Security";
  }
  function toggleColorMode() {
    colorByRegion = !colorByRegion;
    // Update system point colors
    const pointsObject = scene?.children.find(
      (child) => child.userData?.isSystemPoints
    );
    if (pointsObject && pointsObject.geometry.attributes.color) {
      const colors = pointsObject.geometry.attributes.color;
      solarSystems.forEach((system, systemId) => {
        const color = colorByRegion
          ? new THREE.Color(system.regionColor)
          : new THREE.Color(system.securityColor);
        colors.setXYZ(system.index, color.r, color.g, color.b);
      });
      colors.needsUpdate = true;
    }
    // Update connection colors
    stargateConnections.forEach((line) => {
      scene.remove(line);
      disposeObject3D(line);
    });
    stargateConnections = [];
    const solarSystemsData = mapData.filter((item) => item.typeid === 5);
    const stargatesData = mapData.filter((item) => item.groupid === 10);
    const processedConnections = new Set();
    stargatesData.forEach((sourceGate) => {
      if (!sourceGate.solarsystemid || !sourceGate.itemname) return;
      const match = sourceGate.itemname.match(/Stargate \(([^)]+)\)/);
      if (!match) return;
      const destinationName = match[1];
      const destinationSystem = solarSystemsData.find(
        (sys) => sys.itemname === destinationName
      );
      if (!destinationSystem) return;
      const sourceSystem = solarSystemsData.find(
        (sys) => sys.itemid === sourceGate.solarsystemid
      );
      if (!sourceSystem) return;
      const connectionId = [sourceSystem.itemid, destinationSystem.itemid]
        .sort()
        .join("-");
      if (processedConnections.has(connectionId)) return;
      processedConnections.add(connectionId);
      if (
        solarSystems.has(sourceSystem.itemid) &&
        solarSystems.has(destinationSystem.itemid)
      ) {
        const connection = createConnectionLine(
          sourceSystem,
          destinationSystem
        );
        if (connection) {
          scene.add(connection);
          stargateConnections.push(connection);
        }
      }
    });

    // Region labels are always visible, no toggling needed
    // Region backgrounds removed, no toggling needed

    // Re-evaluate route colors if a route is active
    if (routeLines && currentRoute.length > 0) {
      createRouteVisualization(currentRoute); // Redraw with potentially new connection colors
      checkRouteForDangers(currentRoute);
    }
  }
  function onMouseMove(event) {
    if (!renderer || !mounted || !scene) return;
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const pointObjects = scene.children.filter(
      (c) => c.userData?.isSystemPoints
    );
    if (pointObjects.length === 0) {
      hoverRing.visible = false;
      return;
    }
    const intersects = raycaster.intersectObjects(pointObjects);
    let newlyHoveredSystem = null;
    if (intersects.length > 0) {
      const index = intersects[0].index;
      const systemsArray = Array.from(solarSystems.values());
      if (systemsArray[index]) {
        newlyHoveredSystem = systemsArray[index];
        hoverRing.position.copy(newlyHoveredSystem.position);
        hoverRing.visible = true;
      } else {
        hoverRing.visible = false;
      }
    } else {
      hoverRing.visible = false;
    }

    hoveredSystemData = newlyHoveredSystem?.data ?? null;

    // Update system labels based on hover and selection
    solarSystems.forEach((system) => {
      const isSelected =
        selectedSystem && system.data.itemid === selectedSystem.itemid;
      const isHovered = newlyHoveredSystem === system;
      system.label.visible = isSelected || isHovered;
    });

    // Region labels are always visible

    container.style.cursor = hoveredSystemData ? "pointer" : "auto";
  }
  function onClick(event) {
    if (!renderer || !mounted) return;
    const currentTime = clock.getElapsedTime() * 1000;
    if (currentTime - lastClickTime < DOUBLE_CLICK_TIME) return;
    lastClickTime = currentTime;
    if (contextMenu.show) contextMenu.show = false;
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const pointObjects = scene.children.filter(
      (c) => c.userData?.isSystemPoints
    );
    let clickedSystem = null;
    if (pointObjects.length > 0) {
      const intersects = raycaster.intersectObjects(pointObjects);
      if (intersects.length > 0) {
        const index = intersects[0].index;
        const systemsArray = Array.from(solarSystems.values());
        if (systemsArray[index]) clickedSystem = systemsArray[index];
      }
    }
    if (selectedSystem?.itemid !== clickedSystem?.data?.itemid) {
      if (selectedSystem) {
        const prevSystem = solarSystems.get(selectedSystem.itemid);
        if (prevSystem && prevSystem.data.itemid !== hoveredSystemData?.itemid)
          prevSystem.label.visible = false;
      }
      selectedSystem = clickedSystem?.data ?? null;
      if (selectedSystem) {
        const newSys = solarSystems.get(selectedSystem.itemid);
        if (newSys) newSys.label.visible = true;
      }
      console.log(
        "Selected system:",
        selectedSystem ? selectedSystem.itemname : "None"
      );
    } else if (!clickedSystem) {
      if (selectedSystem) {
        const prevSystem = solarSystems.get(selectedSystem.itemid);
        if (prevSystem && prevSystem.data.itemid !== hoveredSystemData?.itemid)
          prevSystem.label.visible = false;
      }
      selectedSystem = null;
      console.log("Selection cleared");
    }
  }
  function onDoubleClick(event) {
    if (!renderer || !mounted) return;
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const pointObjects = scene.children.filter(
      (c) => c.userData?.isSystemPoints
    );
    if (pointObjects.length === 0) return;
    const intersects = raycaster.intersectObjects(pointObjects);
    if (intersects.length > 0) {
      const index = intersects[0].index;
      const systemsArray = Array.from(solarSystems.values());
      const clickedSystem = systemsArray[index];
      if (clickedSystem) {
        if (selectedSystem?.itemid !== clickedSystem.data.itemid) {
          if (selectedSystem) {
            const prev = solarSystems.get(selectedSystem.itemid);
            if (prev) prev.label.visible = false;
          }
          selectedSystem = clickedSystem.data;
          clickedSystem.label.visible = true;
        }
        zoomToSystem(clickedSystem);
      }
    }
  }
  function zoomToSystem(system) {
    const startPosition = camera.position.clone();
    const startTarget = controls.target.clone();
    const targetPosition = system.position.clone();
    const endTarget = targetPosition.clone();
    const distance = Math.max(SYSTEM_SIZE * 10, 1);
    const offset = new THREE.Vector3().subVectors(startPosition, startTarget);
    offset.setLength(distance);
    const endPosition = new THREE.Vector3().addVectors(endTarget, offset);
    endPosition.x = endTarget.x;
    endPosition.z = endTarget.z;
    endPosition.y = endTarget.y + distance; // Position above

    const duration = 800;
    const startTime = performance.now();
    function animateCam() {
      const now = performance.now();
      const elapsed = now - startTime;
      let progress = Math.min(elapsed / duration, 1);
      progress = 1 - Math.pow(1 - progress, 3);
      camera.position.lerpVectors(startPosition, endPosition, progress);
      controls.target.lerpVectors(startTarget, endTarget, progress);
      controls.update();
      if (progress < 1) {
        frameId = requestAnimationFrame(animateCam);
      } else {
        camera.position.copy(endPosition);
        controls.target.copy(endTarget);
        controls.update();
      }
    }
    frameId = requestAnimationFrame(animateCam);
  }
  function handleSearch(event) {
    if (event.key !== "Enter") return;
    if (!searchTerm.trim()) return;
    const solarSystemsData = mapData.filter((item) => item.typeid === 5);
    const matchingSystems = solarSystemsData.filter((system) =>
      system.itemname.toLowerCase().includes(searchTerm.toLowerCase())
    );
    if (matchingSystems.length > 0) {
      const targetSystem = matchingSystems[0];
      const renderedSystem = Array.from(solarSystems.values()).find(
        (sys) => sys.data.itemid === targetSystem.itemid
      );
      if (renderedSystem) {
        zoomToSystem(renderedSystem);
        selectedSystem = renderedSystem.data;
        if (renderedSystem.label) renderedSystem.label.visible = true;
      } else {
        alert(
          `System "${targetSystem.itemname}" found but not visible on the current map.`
        );
      }
    } else {
      alert(`No system found with name containing "${searchTerm}"`);
    }
  }
  function clearSelection() {
    if (selectedSystem) {
      const prev = solarSystems.get(selectedSystem.itemid);
      if (prev?.label && prev.data.itemid !== hoveredSystemData?.itemid)
        prev.label.visible = false;
    }
    selectedSystem = null;
  }

  // --- Animation Loop ---
  function animate(time) {
    if (!mounted) return;
    frameId = requestAnimationFrame(animate);

    const now = clock.getElapsedTime(); // Use THREE.Clock for consistent time
    const deltaTime = now - lastAnimationTime;
    lastAnimationTime = now;

    // Update animation mixers
    campMarkers.forEach((markerObj) => {
      if (markerObj.mixer) markerObj.mixer.update(deltaTime);

      // Handle flash animation for camps
      const glowSprite = markerObj.group?.children.find(
        (c) => c.isSprite && c.material.color.getHex() === CAMP_COLOR
      );
      const secondaryGlow = markerObj.secondaryGlow;

      if (markerObj.flashEndTime > 0) {
        const flashProgress = Math.max(
          0,
          1 - (markerObj.flashEndTime - now) / FLASH_DURATION
        );
        if (glowSprite) {
          const baseScale =
            (markerObj.campData.probability / 100) * 20 + 5 || 10;
          const flashScaleMultiplier =
            1 + Math.sin(flashProgress * Math.PI) * 19.0; // 20x flash size
          glowSprite.scale.setScalar(baseScale * flashScaleMultiplier);
          glowSprite.material.color.lerpColors(
            FLASH_COLOR_CAMP,
            new THREE.Color(CAMP_COLOR),
            flashProgress
          );
          glowSprite.material.opacity =
            0.9 + Math.sin(flashProgress * Math.PI) * 0.1;
        }
        // Also flash secondary glow
        if (secondaryGlow) {
          secondaryGlow.material.opacity =
            0.4 + Math.sin(flashProgress * Math.PI) * 0.3;
        }

        if (now >= markerObj.flashEndTime) {
          markerObj.flashEndTime = 0; // End flash
          if (glowSprite) {
            // Reset primary glow
            const baseScale =
              (markerObj.campData.probability / 100) * 20 + 5 || 10;
            glowSprite.scale.setScalar(baseScale);
            glowSprite.material.color.set(CAMP_COLOR);
            glowSprite.material.opacity = Math.min(
              0.8,
              markerObj.campData.probability / 100
            );
          }
          // Reset secondary glow
          if (secondaryGlow) {
            secondaryGlow.material.opacity = 0.1; // Reset to lower base opacity
          }
        }
      } else {
        // Update normal opacity if not flashing
        if (glowSprite) {
          glowSprite.material.opacity = Math.min(
            0.8,
            markerObj.campData.probability / 100
          );
        }
        // Pulse secondary glow opacity
        if (secondaryGlow) {
          const pulseFactorSec = (Math.sin(now * 3) + 1) / 2; // Slower pulse for secondary
          secondaryGlow.material.opacity = 0.1 + pulseFactorSec * 0.2; // Pulse between 0.1 and 0.3
        }
      }
    });

    if (userLocationMarker.mixer) userLocationMarker.mixer.update(deltaTime);

    // Animate roam path opacity and flash
    const pulseSpeed = 4;
    const minOpacity = 0.7; // Brighter base
    const maxOpacity = 1.0;
    const opacityRange = maxOpacity - minOpacity;
    const pulseFactor = (Math.sin(now * pulseSpeed) + 1) / 2;
    const baseRoamColor = new THREE.Color(ROAM_COLOR);
    const brightRoamColor = new THREE.Color(0xffffff); // Pulse towards white

    roamPaths.forEach((pathObj) => {
      const lineMat = pathObj.lineMaterial;
      const secondaryGlow = pathObj.secondaryGlow;

      if (lineMat) {
        if (pathObj.flashEndTime > 0) {
          // Handle flash
          const flashProgress = Math.max(
            0,
            1 - (pathObj.flashEndTime - now) / FLASH_DURATION
          );
          lineMat.opacity = 1.0; // Max opacity during flash
          lineMat.color.lerpColors(
            FLASH_COLOR_ROAM,
            baseRoamColor,
            flashProgress
          );
          // Flash secondary glow
          if (secondaryGlow) {
            secondaryGlow.material.opacity =
              0.5 + Math.sin(flashProgress * Math.PI) * 0.25;
          }

          if (now >= pathObj.flashEndTime) {
            pathObj.flashEndTime = 0; // End flash
            // Reset secondary glow
            if (secondaryGlow) {
              secondaryGlow.material.opacity = 0.1; // Reset to lower base opacity
            }
          }
        } else {
          // Handle normal pulse
          const currentOpacity = minOpacity + pulseFactor * opacityRange;
          lineMat.opacity = currentOpacity;
          lineMat.color.lerpColors(
            baseRoamColor,
            brightRoamColor, // Pulse towards white
            pulseFactor * 0.9 // Increase brightness intensity further
          );
        }
      }
      // Pulse secondary roam glow opacity
      if (secondaryGlow && pathObj.flashEndTime <= 0) {
        // Only pulse if not flashing
        const pulseFactorSec = (Math.sin(now * 3) + 1) / 2; // Slower pulse for secondary
        secondaryGlow.material.opacity = 0.1 + pulseFactorSec * 0.2; // Pulse between 0.1 and 0.3
      }
      // Update secondary glow position if it exists
      if (secondaryGlow && pathObj.roamData.systems.length > 0) {
        const lastSysId = parseInt(
          pathObj.roamData.systems[pathObj.roamData.systems.length - 1].id
        );
        const lastSystem = solarSystems.get(lastSysId);
        if (lastSystem) {
          secondaryGlow.position.copy(lastSystem.position);
        }
      }
    });

    // Update region label visibility (always visible, no zoom check)
    regionLabelCache.forEach((cacheEntry) => {
      if (cacheEntry.label) {
        cacheEntry.label.visible = true;
      }
    });

    if (controls) controls.update();
    if (renderer && camera) renderer.render(scene, camera);
    if (labelRenderer && camera) labelRenderer.render(scene, camera);
  }
</script>

<div class="universe-map-container">
  <div class="controls">
    <div class="control-panel">
      <div class="search-box">
        <input
          type="text"
          bind:value={searchTerm}
          placeholder="Search systems (Enter)"
          on:keydown={handleSearch}
        />
      </div>
      <button
        class="color-toggle"
        on:click={toggleColorMode}
        title="Toggle map coloring"
      >
        Color by {colorByRegion ? "Security" : "Region"}
      </button>
      <button
        class="fullscreen-toggle"
        on:click={toggleFullscreen}
        title="Toggle Fullscreen"
      >
        {isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          width="1em"
          height="1em"
          style="vertical-align: middle; margin-left: 5px;"
        >
          {#if isFullscreen}
            <path
              d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"
            />
          {:else}
            <path
              d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zm-3-7h3v-3h2V5h-5v5z"
            />
          {/if}
        </svg>
      </button>
    </div>
  </div>

  {#if selectedSystem}
    <div class="system-info-panel">
      <div class="close-btn" on:click={clearSelection}>×</div>
      <h3>{selectedSystem.itemname}</h3>
      <div class="info-row">
        <span>Security:</span>
        <span
          class="security"
          style="color: {new THREE.Color(
            getSecurityColor(selectedSystem.security)
          ).getStyle()}"
        >
          {selectedSystem.security !== null
            ? selectedSystem.security.toFixed(1)
            : "N/A"} ({getSecurityDescription(selectedSystem.security)})
        </span>
      </div>
      <div class="info-row">
        <span>Region:</span>
        <span
          >{regions.find((r) => r.id === selectedSystem.regionid)?.name ||
            "Unknown"}</span
        >
      </div>
      <div class="info-row">
        <span>System ID:</span>
        <span>{selectedSystem.itemid}</span>
      </div>
      {#if selectedCampMarkerData}
        <div class="info-row danger">
          <span>Activity:</span>
          <span class="camp-indicator">
            Active gate camp ({Math.round(selectedCampMarkerData.probability)}%
            confidence)
          </span>
        </div>
      {/if}
      {#if firstMatchingRoamData}
        <div class="info-row warning">
          <span>Activity:</span>
          <span class="roam-indicator">
            Roaming gang ({firstMatchingRoamData.members?.length || 0} pilots)
          </span>
        </div>
      {/if}
      <div class="action-buttons">
        <button
          on:click={() => calculateRoute(selectedSystem.itemid, true)}
          disabled={isCalculatingRoute}>Set Destination</button
        >
        <button
          on:click={() => calculateRoute(selectedSystem.itemid, false)}
          disabled={isCalculatingRoute}>Add Waypoint</button
        >
        <button on:click={() => showSystemActivity(selectedSystem)}
          >View Activity</button
        >
      </div>
    </div>
  {/if}

  <div class="map-view" bind:this={container}>
    {#if isLoading}
      <div class="loading">Loading universe map...</div>
    {:else if isCalculatingRoute}
      <div class="loading">Setting route...</div>
    {/if}
    {#if error && !isCalculatingRoute}
      <div class="error">Error: {error}</div>
    {/if}
  </div>
</div>

<ContextMenu
  show={contextMenu.show}
  x={contextMenu.x}
  y={contextMenu.y}
  options={contextMenu.options}
  on:select={handleMenuSelect}
/>

<style>
  /* --- Styles --- */
  .universe-map-container {
    position: relative; /* Needed for absolute positioning of children */
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  .controls {
    position: absolute;
    top: 20px;
    left: 20px;
    z-index: 10; /* Ensure controls are above map */
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .control-panel {
    background-color: rgba(0, 0, 0, 0.7);
    border: 1px solid rgba(0, 255, 255, 0.3);
    border-radius: 8px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .search-box input {
    background-color: rgba(30, 30, 30, 0.7);
    color: white;
    border: 1px solid rgba(0, 255, 255, 0.5);
    padding: 8px 12px;
    border-radius: 4px;
    width: 100%;
  }
  .color-toggle {
    background-color: rgba(0, 100, 100, 0.7);
    color: white;
    border: 1px solid #00ffff;
    padding: 8px 16px;
    cursor: pointer;
    border-radius: 4px;
    transition: background-color 0.2s;
  }
  .color-toggle:hover {
    background-color: rgba(0, 150, 150, 0.7);
  }
  .fullscreen-toggle {
    background-color: rgba(50, 50, 150, 0.7);
    border: 1px solid #aaaaff;
    color: white;
    padding: 8px 16px;
    cursor: pointer;
    border-radius: 4px;
    transition: background-color 0.2s;
    margin-top: 5px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .fullscreen-toggle:hover {
    background-color: rgba(70, 70, 180, 0.7);
  }

  /* Info Panel Styling */
  .system-info-panel {
    position: absolute;
    bottom: 20px;
    left: 20px;
    z-index: 100; /* High z-index */
    background-color: rgba(0, 0, 0, 0.8);
    border: 1px solid rgba(0, 255, 255, 0.3);
    border-radius: 8px;
    padding: 15px;
    min-width: 250px;
    max-width: 300px;
    color: white;
  }
  .close-btn {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 20px;
    height: 20px;
    background-color: rgba(255, 100, 100, 0.7);
    color: white;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border: none;
    line-height: 1;
    padding: 0;
  }
  .system-info-panel h3 {
    color: #00ffff;
    margin: 0 0 10px 0;
    font-size: 16px;
  }
  .info-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 5px;
    font-size: 14px;
  }
  .info-row span:first-child {
    color: #888;
  }
  .info-row span:last-child {
    color: white;
  }
  .camp-indicator {
    color: #ff3333;
    font-weight: bold;
  }
  .roam-indicator {
    color: #3333ff; /* Roam color */
    font-weight: bold;
  }
  .danger {
    background-color: rgba(255, 0, 0, 0.2);
    border-radius: 4px;
    padding: 2px 4px;
  }
  .warning {
    background-color: rgba(255, 165, 0, 0.2); /* Use roam color for warning */
    border-radius: 4px;
    padding: 2px 4px;
  }
  .action-buttons {
    margin-top: 15px;
    display: flex;
    gap: 10px;
  }
  .action-buttons button {
    flex-grow: 1;
    background-color: rgba(0, 255, 255, 0.2);
    color: #00ffff;
    border: 1px solid rgba(0, 255, 255, 0.5);
    padding: 6px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    transition: background-color 0.2s;
  }
  .action-buttons button:hover {
    background-color: rgba(0, 255, 255, 0.4);
  }
  .action-buttons button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .map-view {
    width: 100%;
    height: 100%;
    background-color: #000;
  }
  .loading,
  .error {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: white;
    background-color: rgba(0, 0, 0, 0.7);
    padding: 20px;
    border-radius: 8px;
    z-index: 20;
  }
  .error {
    color: #ff6b6b;
  }

  :global(.system-label) {
    color: white;
    font-size: 12px;
    padding: 2px 5px;
    background-color: rgba(0, 0, 0, 0.7);
    border-radius: 3px;
    white-space: nowrap;
    pointer-events: none;
    user-select: none;
  }
  :global(.region-label) {
    font-size: 16px;
    font-weight: bold;
    padding: 3px 6px;
    background-color: rgba(0, 0, 0, 0.5);
    border-radius: 4px;
    white-space: nowrap;
    pointer-events: none;
    user-select: none;
    text-shadow:
      0 0 3px black,
      0 0 3px black;
  }

  :global(.danger-tooltip) {
    position: absolute;
    bottom: 20px;
    left: 20px;
    background: rgba(0, 0, 0, 0.8);
    border: 1px solid #ff6600;
    border-radius: 4px;
    padding: 10px;
    color: white;
    font-family: sans-serif;
    max-width: 300px;
    z-index: 1000;
  }
  :global(.danger-header) {
    font-weight: bold;
    font-size: 16px;
    margin-bottom: 8px;
    color: #ff6600;
  }
  :global(.danger-list) {
    margin: 0;
    padding: 0 0 0 20px;
  }
  :global(.camp-warning) {
    color: #ff3333;
    margin-bottom: 4px;
  }
  :global(.roam-warning) {
    color: #3333ff; /* Roam color */
    margin-bottom: 4px;
  }
  :global(.camp-warning strong),
  :global(.roam-warning strong) {
    color: white;
    font-weight: bold;
  }
</style>
