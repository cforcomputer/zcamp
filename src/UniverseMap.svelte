<script>
  import { onMount, onDestroy, tick } from "svelte";
  import * as THREE from "three";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import {
    CSS2DRenderer,
    CSS2DObject,
  } from "three/examples/jsm/renderers/CSS2DRenderer.js";
  // --- CHANGE: Import unified activity store ---
  import { activeActivities } from "./activityManager.js"; // Changed from camp/roam managers
  // --- END CHANGE ---
  import { currentLocation, locationError } from "./locationStore.js";
  import ContextMenu from "./ContextMenu.svelte";
  import { getValidAccessToken } from "./tokenManager.js";

  // --- State Variables ---
  let container;
  let scene, camera, renderer, labelRenderer, controls;
  let solarSystems = new Map(); // Map: systemId -> { position, label, data, index, securityColor, regionColor, connections }
  let stargateConnections = [];
  let mapData = [];
  let isLoading = true;
  let isCalculatingRoute = false;
  let error = null;
  let errorTimeout = null;
  let searchTerm = "";
  let selectedSystem = null; // Holds system data object { itemid, itemname, ... }
  let colorByRegion = false;
  let regions = [];
  let mounted = false;
  let regionLabelCache = new Map(); // Map: regionId -> { label, center }

  // Galaxy bounds tracking
  let galaxyCenter = new THREE.Vector3();
  let galaxySize = 0;

  // Interaction
  let raycaster;
  let mouse;
  let clock = new THREE.Clock();
  let lastClickTime = 0;
  let hoveredSystemData = null; // Holds system data object { itemid, itemname, ... }
  let hoverRing; // Mesh for hover effect

  // Context menu state
  let contextMenu = { show: false, x: 0, y: 0, options: [] };

  // --- CHANGE: Unified activity marker storage ---
  let activityMarkers = new Map(); // Map: activity.id -> { group, activityData, mixer, flashEndTime, secondaryGlow, secondaryGlowFlashEndTime, type: 'camp' | 'roam' | 'battle' | 'smartbomb' | 'roaming_camp' }
  // --- END CHANGE ---

  let userLocationMarker = { group: null, mixer: null };
  let routeLines = null;
  let currentRoute = []; // Stores the current full route (array of system IDs)
  let dangerWarnings = [];
  let dangerTooltip;

  // Animation properties
  const PULSE_DURATION = 2.0;
  const FLASH_DURATION = 0.5;
  let lastAnimationTime = 0;

  // Fullscreen state
  let isFullscreen = false;

  // --- Constants ---
  const SCALE_FACTOR = 1e-14;
  const SYSTEM_SIZE = 7.0; // Slightly smaller base size
  const CONNECTION_COLOR = 0x00ffff;
  const DOUBLE_CLICK_TIME = 300;
  const CAMP_COLOR = 0xff3333; // Red
  const SMARTBOMB_COLOR = 0xff9933; // Orange-Red for Smartbomb
  const ROAM_COLOR = 0x3333ff; // Blue
  const ROAMING_CAMP_COLOR = 0xff8c00; // Orange for Roaming Camp
  const BATTLE_COLOR = 0xcc00cc; // Purple/Magenta for Battle
  const USER_COLOR = 0x00ffff; // Cyan
  const ROUTE_COLOR = 0x00ff00; // Green
  const DANGER_ROUTE_COLOR = 0xff6600; // Orange
  const FLASH_COLOR_CAMP = new THREE.Color(0xffdddd);
  const FLASH_COLOR_SMARTBOMB = new THREE.Color(0xffccaa);
  const FLASH_COLOR_ROAM = new THREE.Color(0xddddff);
  const FLASH_COLOR_ROAMING_CAMP = new THREE.Color(0xffddaa);
  const FLASH_COLOR_BATTLE = new THREE.Color(0xffaaff);
  const SECONDARY_GLOW_COLOR_CAMP = 0xffaaaa;
  const SECONDARY_GLOW_COLOR_SMARTBOMB = 0xffbb88;
  const SECONDARY_GLOW_COLOR_ROAM = 0xaaaaff;
  const SECONDARY_GLOW_COLOR_ROAMING_CAMP = 0xffcc88;
  const SECONDARY_GLOW_COLOR_BATTLE = 0xee88ee;

  // --- NEW: Classification Icons/Tooltips (used in info panel) ---
  const classificationIcons = {
    camp: "⛺",
    smartbomb: "⚡",
    roaming_camp: "🏕️",
    battle: "⚔️",
    roam: "➡️",
    activity: "❓",
  };
  const classificationTooltips = {
    camp: "Standard Gate Camp",
    smartbomb: "Smartbomb Camp",
    roaming_camp: "Roaming Camp (Multi-System)",
    battle: "Large Battle (>40 Pilots)",
    roam: "Roaming Gang",
    activity: "Unclassified Activity",
  };
  // --- END NEW ---

  // Region colors (remains the same)
  const regionColors = [
    /* ... colors ... */
  ];

  // --- Reusable Textures ---
  let circleTexture;
  let glowTexture;

  // --- Resource Disposal Utility (remains the same) ---
  function disposeObject3D(obj) {
    /* ... */
  }

  // --- Reactive Subscriptions & Updates ---
  // --- CHANGE: Subscribe to unified activities ---
  $: activities = $activeActivities || [];
  // --- END CHANGE ---
  $: userLocation = $currentLocation;

  // --- CHANGE: Single reactive block for activities ---
  $: if (mounted && activities !== undefined && scene) {
    updateActivityVisualizations(activities);
  }
  // --- END CHANGE ---
  $: if (mounted && userLocation !== undefined && scene) {
    updateUserLocationMarker(userLocation);
  }

  // Info panel reactive data
  $: selectedActivityData = selectedSystem
    ? Array.from(activityMarkers.values()).find(
        (marker) => marker.activityData.systemId === selectedSystem.itemid
      )?.activityData
    : null;
  // Note: Finding roam data associated with a selected system is more complex now, might need adjustment if needed for panel.

  // --- Texture Creation Functions (remain the same) ---
  function createCircleTexture() {
    /* ... */
  }
  function createGlowTexture() {
    /* ... */
  }

  // --- Lifecycle Hooks (remain the same, just update cleanup) ---
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
    if (errorTimeout) clearTimeout(errorTimeout);

    console.log("Disposing scene objects...");
    // --- CHANGE: Dispose unified markers ---
    activityMarkers.forEach((markerObj) => disposeObject3D(markerObj.group));
    activityMarkers.clear();
    // --- END CHANGE ---
    if (userLocationMarker.group) disposeObject3D(userLocationMarker.group);
    userLocationMarker = { group: null, mixer: null };
    if (routeLines) disposeObject3D(routeLines);
    routeLines = null;
    regionLabelCache.forEach((cacheEntry) => {
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

  // --- Fullscreen Handling (remains the same) ---
  async function toggleFullscreen() {
    /* ... */
  }
  async function handleFullscreenChange() {
    /* ... */
  }

  // --- Context Menu & ESI (remain the same, routing uses calculateRoute) ---
  function onContextMenu(event) {
    /* ... */
  }
  function handleMenuSelect(event) {
    /* ... */
  }
  async function setDestination(systemId, clearOthers = true) {
    /* ... */
  }
  function showSystemActivity(system) {
    /* ... */
  }

  // --- Map Initialization & Building (remain the same) ---
  async function initializeMap() {
    /* ... */
  }
  function initThreeJS() {
    console.log("Initializing Three.js...");
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000011);
    camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1, // near plane
      1000000 // far plane (increased range)
    );
    camera.position.set(0, 0, 50); // Initial position
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    // Label Renderer
    labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(container.clientWidth, container.clientHeight);
    labelRenderer.domElement.style.position = "absolute";
    labelRenderer.domElement.style.top = "0";
    labelRenderer.domElement.style.pointerEvents = "none"; // Allow clicks to pass through
    container.appendChild(labelRenderer.domElement);

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.rotateSpeed = 0; // Disable rotation
    controls.panSpeed = 0.8;
    controls.zoomSpeed = 1.2;
    controls.minDistance = 0.5; // Allow closer zoom
    controls.maxDistance = 2500; // Allow further zoom out
    controls.minPolarAngle = 0; // Lock vertical panning
    controls.maxPolarAngle = 0; // Lock vertical panning
    controls.enableRotate = false;
    controls.enablePan = true; // Enable panning

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7); // Slightly brighter ambient
    scene.add(ambientLight);

    // Raycaster
    raycaster = new THREE.Raycaster();
    // --- CHANGE: Increase raycaster threshold for points ---
    raycaster.params.Points.threshold = 2.5; // Increased from 1.5
    // --- END CHANGE ---
    mouse = new THREE.Vector2();

    // Hover Ring
    // --- CHANGE: Slightly smaller hover ring ---
    const ringGeometry = new THREE.RingGeometry(
      SYSTEM_SIZE * 0.7, // Slightly smaller inner radius
      SYSTEM_SIZE * 0.8, // Slightly smaller outer radius
      32
    );
    // --- END CHANGE ---
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff, // Cyan
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7,
    });
    hoverRing = new THREE.Mesh(ringGeometry, ringMaterial);
    // hoverRing.rotation.x = -Math.PI / 2; // Keep it flat on the XZ plane
    hoverRing.visible = false;
    scene.add(hoverRing);

    console.log("Three.js initialized successfully");
  }
  function buildMap() {
    /* ... */
  }
  function createConnectionLine(sourceSystem, destinationSystem) {
    /* ... */
  }
  function createRegionLabels(systemsInMap) {
    /* ... */
  }

  // --- CHANGE: Unified Activity Visualization Update ---
  function updateActivityVisualizations(newActivities) {
    if (!scene || !mounted) return;
    const now = clock.getElapsedTime();
    const currentActivityIds = new Set(newActivities.map((a) => a.id));

    // Remove markers for activities that no longer exist
    activityMarkers.forEach((markerObj, activityId) => {
      if (!currentActivityIds.has(activityId)) {
        scene.remove(markerObj.group);
        disposeObject3D(markerObj.group);
        activityMarkers.delete(activityId);
      }
    });

    // Add/Update markers for current activities
    newActivities.forEach((activity) => {
      const existingMarker = activityMarkers.get(activity.id);
      const latestKillId = activity.kills[activity.kills.length - 1]?.killID;

      if (existingMarker) {
        // Update existing marker
        const markerObj = existingMarker;
        const oldClassification = markerObj.activityData.classification;
        markerObj.activityData = activity; // Update data

        // Check if classification changed, requires recreating visual
        if (activity.classification !== oldClassification) {
          console.log(
            `Activity ${activity.id} classification changed from ${oldClassification} to ${activity.classification}. Recreating visual.`
          );
          scene.remove(markerObj.group);
          disposeObject3D(markerObj.group);
          activityMarkers.delete(activity.id); // Remove old entry
          createOrUpdateActivityMarker(activity, now, latestKillId); // Create new one
        } else {
          // Only update properties if classification is the same
          updateMarkerProperties(markerObj, activity, now, latestKillId);
        }
      } else {
        // Create new marker
        createOrUpdateActivityMarker(activity, now, latestKillId);
      }
    });
  }

  // --- NEW: Helper to create or update a marker based on classification ---
  function createOrUpdateActivityMarker(activity, now, latestKillId) {
    let markerObj;
    switch (activity.classification) {
      case "camp":
      case "smartbomb":
      case "roaming_camp": // Use camp-style marker for roaming camps too
      case "battle": // Use camp-style marker for battles
        markerObj = createOrUpdateCampStyleMarker(activity, now, latestKillId);
        break;
      case "roam":
        markerObj = createOrUpdateRoamStyleMarker(activity, now, latestKillId);
        break;
      case "activity": // Decide how to represent 'activity' - maybe a smaller grey glow?
        // markerObj = createOrUpdateActivityStyleMarker(activity, now, latestKillId);
        console.log(
          `Skipping visualization for unclassified activity: ${activity.id}`
        );
        return; // Don't visualize 'activity' for now
      default:
        console.warn(
          `Unknown activity classification: ${activity.classification}`
        );
        return;
    }

    if (markerObj) {
      activityMarkers.set(activity.id, markerObj);
      scene.add(markerObj.group);
    }
  }

  // --- NEW: Helper to update existing marker properties (if classification hasn't changed) ---
  function updateMarkerProperties(markerObj, activity, now, latestKillId) {
    // Update shared data
    markerObj.activityData = activity;

    // Trigger flash if needed
    if (latestKillId && markerObj.lastKillId !== latestKillId) {
      markerObj.flashEndTime = now + FLASH_DURATION;
      markerObj.lastKillId = latestKillId;
      if (markerObj.secondaryGlow) {
        markerObj.secondaryGlowFlashEndTime = now + FLASH_DURATION;
      }
      // console.log(`Flash triggered for activity ${activity.id}`);
    }

    // Update specific visuals based on type stored in markerObj
    if (
      markerObj.type === "camp" ||
      markerObj.type === "smartbomb" ||
      markerObj.type === "roaming_camp" ||
      markerObj.type === "battle"
    ) {
      // Update glow size/opacity based on probability for camp-like markers
      const glowSprite = markerObj.group?.children.find(
        (c) =>
          c.isSprite &&
          c.material.map === glowTexture &&
          c !== markerObj.secondaryGlow
      );
      if (glowSprite) {
        const baseSize = (activity.probability / 100) * 20 + 5;
        if (markerObj.flashEndTime <= 0) {
          // Only update size if not flashing
          glowSprite.scale.set(baseSize, baseSize, 1);
          glowSprite.material.opacity = Math.min(
            0.8,
            activity.probability / 100
          );
        }
      }
      // Update secondary glow position for roaming camps/battles if needed
      if (
        (activity.classification === "roaming_camp" ||
          activity.classification === "battle") &&
        markerObj.secondaryGlow &&
        activity.lastSystem
      ) {
        const system = solarSystems.get(parseInt(activity.lastSystem.id));
        if (system) markerObj.secondaryGlow.position.copy(system.position);
      }
    } else if (markerObj.type === "roam") {
      // Update roam path if systems changed? (More complex, might require redraw)
      // For now, just update secondary glow position
      if (markerObj.secondaryGlow && activity.lastSystem) {
        const system = solarSystems.get(parseInt(activity.lastSystem.id));
        if (system) markerObj.secondaryGlow.position.copy(system.position);
      }
    }
  }

  // --- NEW: Function to create/update Camp, Smartbomb, Roaming Camp, Battle markers ---
  function createOrUpdateCampStyleMarker(activity, now, latestKillId) {
    const systemId = parseInt(activity.systemId); // Camp-like activities have a primary systemId
    const system = solarSystems.get(systemId);
    if (!system) return null; // Cannot place marker if system isn't rendered

    const group = new THREE.Group();
    group.position.copy(system.position);

    let primaryColor, secondaryColor, flashColor;
    let baseGlowSize = (activity.probability / 100) * 20 + 5; // Base size on probability

    switch (activity.classification) {
      case "camp":
        primaryColor = CAMP_COLOR;
        secondaryColor = SECONDARY_GLOW_COLOR_CAMP;
        flashColor = FLASH_COLOR_CAMP;
        break;
      case "smartbomb":
        primaryColor = SMARTBOMB_COLOR;
        secondaryColor = SECONDARY_GLOW_COLOR_SMARTBOMB;
        flashColor = FLASH_COLOR_SMARTBOMB;
        baseGlowSize *= 1.1; // Slightly larger for smartbombs
        break;
      case "roaming_camp":
        primaryColor = ROAMING_CAMP_COLOR;
        secondaryColor = SECONDARY_GLOW_COLOR_ROAMING_CAMP;
        flashColor = FLASH_COLOR_ROAMING_CAMP;
        baseGlowSize *= 1.2; // Larger for roaming camps
        break;
      case "battle":
        primaryColor = BATTLE_COLOR;
        secondaryColor = SECONDARY_GLOW_COLOR_BATTLE;
        flashColor = FLASH_COLOR_BATTLE;
        baseGlowSize =
          30 +
          (Math.min(activity.metrics?.partyMetrics?.characters || 0, 100) /
            100) *
            30; // Size based on participants for battles
        break;
      default: // Fallback, should not happen if called correctly
        primaryColor = CAMP_COLOR;
        secondaryColor = SECONDARY_GLOW_COLOR_CAMP;
        flashColor = FLASH_COLOR_CAMP;
    }

    // Primary Glow
    const glowMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: new THREE.Color(primaryColor),
      transparent: true,
      opacity: Math.min(0.8, activity.probability / 100),
      depthWrite: false,
      sizeAttenuation: true,
    });
    const glowSprite = new THREE.Sprite(glowMaterial);
    glowSprite.scale.set(baseGlowSize, baseGlowSize, 1);
    group.add(glowSprite);

    // Secondary Glow (Positioned at the primary system for camps/SB, last system for roaming/battle)
    const secondaryGlowPosition =
      (activity.classification === "roaming_camp" ||
        activity.classification === "battle") &&
      activity.lastSystem
        ? solarSystems.get(parseInt(activity.lastSystem.id))?.position ||
          system.position // Fallback to primary system
        : system.position;

    const secondaryGlowSize = baseGlowSize * 10.0;
    const secondaryGlowMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: new THREE.Color(secondaryColor),
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const secondaryGlowSprite = new THREE.Sprite(secondaryGlowMaterial);
    secondaryGlowSprite.scale.set(secondaryGlowSize, secondaryGlowSize, 1);
    secondaryGlowSprite.position.copy(secondaryGlowPosition); // Set position
    secondaryGlowSprite.renderOrder = -1;
    group.add(secondaryGlowSprite); // Add to the main group

    // Animation Mixer
    const mixer = new THREE.AnimationMixer(glowSprite);
    const track = new THREE.KeyframeTrack(
      ".scale",
      [0, PULSE_DURATION / 2, PULSE_DURATION],
      [
        baseGlowSize,
        baseGlowSize,
        baseGlowSize,
        baseGlowSize * 1.3,
        baseGlowSize * 1.3,
        baseGlowSize,
        baseGlowSize,
        baseGlowSize,
        baseGlowSize,
      ]
    );
    const clip = new THREE.AnimationClip("pulse", PULSE_DURATION, [track]);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat);
    action.play();

    group.userData = {
      type: activity.classification, // Store the specific classification
      activityData: activity,
      name: system.data.itemname,
      probability: activity.probability,
      flashColor: flashColor, // Store flash color for animation loop
      baseColor: primaryColor, // Store base color
      baseGlowSize: baseGlowSize,
    };

    return {
      group: group,
      activityData: activity,
      mixer: mixer,
      lastKillId: latestKillId,
      flashEndTime: 0,
      secondaryGlow: secondaryGlowSprite,
      secondaryGlowFlashEndTime: 0,
      type: activity.classification, // Store type for update logic
    };
  }

  // --- NEW: Function to create/update Roam markers ---
  function createOrUpdateRoamStyleMarker(activity, now, latestKillId) {
    if (!activity.systems || activity.systems.length < 1) return null; // Need at least one system for last known location

    const sortedSystems = [...activity.systems].sort(
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

    if (points.length < 1) return null; // Need at least one valid point

    const roamGroup = new THREE.Group();
    let lineObject = null;
    let secondaryGlowSprite = null;

    // Create path line if more than one point
    if (points.length >= 2) {
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
        material.userData = { baseColor: new THREE.Color(ROAM_COLOR) }; // Store base color
        lineObject = new THREE.Line(geometry, material);
        roamGroup.add(lineObject);
      } catch (e) {
        console.error("Error creating roam path line:", e);
        // Continue without the line if curve creation fails
      }
    }

    // Secondary Glow at the last known system
    const lastSystemPos = points[points.length - 1];
    if (lastSystemPos) {
      const secondaryGlowMaterial = new THREE.SpriteMaterial({
        map: glowTexture,
        color: new THREE.Color(SECONDARY_GLOW_COLOR_ROAM),
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        sizeAttenuation: true,
      });
      secondaryGlowSprite = new THREE.Sprite(secondaryGlowMaterial);
      secondaryGlowSprite.scale.set(60, 60, 1);
      secondaryGlowSprite.position.copy(lastSystemPos);
      secondaryGlowSprite.renderOrder = -1;
      roamGroup.add(secondaryGlowSprite);
    }

    // Add system glow markers for visited systems (excluding camp systems)
    systemOrder.forEach((system) => {
      const systemIdInt = parseInt(system.id);
      const systemObj = solarSystems.get(systemIdInt);
      // Check if this system also hosts a camp-like activity marker
      const hasCampMarker = Array.from(activityMarkers.values()).some(
        (m) =>
          m.activityData.systemId === systemIdInt &&
          ["camp", "smartbomb", "roaming_camp", "battle"].includes(
            m.activityData.classification
          )
      );

      if (systemObj && !hasCampMarker) {
        // Only add roam glow if no camp marker exists
        const glowMaterial = new THREE.SpriteMaterial({
          map: glowTexture,
          color: new THREE.Color(ROAM_COLOR),
          transparent: true,
          opacity: 0.6,
          depthWrite: false,
        });
        const glowSprite = new THREE.Sprite(glowMaterial);
        glowSprite.position.copy(systemObj.position);
        glowSprite.scale.set(8, 8, 1); // Roam system marker size
        roamGroup.add(glowSprite);
      }
    });

    roamGroup.userData = {
      type: "roam",
      activityData: activity,
      systems: systemOrder, // Store the ordered systems
      flashColor: FLASH_COLOR_ROAM, // Store flash color
      baseColor: ROAM_COLOR, // Store base color
    };

    return {
      group: roamGroup,
      activityData: activity,
      mixer: null, // Roams don't use mixer currently
      lineMaterial: lineObject?.material, // Store material for animation
      lastKillId: latestKillId,
      flashEndTime: 0,
      secondaryGlow: secondaryGlowSprite,
      secondaryGlowFlashEndTime: 0,
      type: "roam", // Store type for update logic
    };
  }

  // --- Route Calculation & Visualization (remain the same, uses calculateRoute) ---
  async function fetchEsiRoute(originId, destinationId) {
    /* ... */
  }
  async function calculateRoute(destinationId, isNewRoute) {
    /* ... */
  }
  function createRouteVisualization(route) {
    /* ... */
  }
  function createRouteMarker(position, color) {
    /* ... */
  }
  // --- CHANGE: Update Route Danger Check ---
  function checkRouteForDangers(route) {
    dangerWarnings = [];
    let tooltipHtml = "";
    for (let i = 0; i < route.length; i++) {
      const systemId = route[i];
      const system = solarSystems.get(systemId);
      if (!system) continue;

      let systemMarkedDangerous = false;
      // Check unified activity markers
      for (const markerObj of activityMarkers.values()) {
        const activity = markerObj.activityData;
        // Check if activity is in the current route system
        if (
          activity.systemId === systemId ||
          activity.lastSystem?.id === systemId ||
          activity.systems?.some((s) => s.id === systemId)
        ) {
          // Check if it's a dangerous classification
          if (
            ["camp", "smartbomb", "roaming_camp", "battle"].includes(
              activity.classification
            )
          ) {
            let warningText = "";
            if (
              activity.classification === "camp" ||
              activity.classification === "smartbomb" ||
              activity.classification === "roaming_camp"
            ) {
              warningText = `${activity.classification.replace("_", " ")} (${Math.round(activity.probability)}% confidence)`;
            } else if (activity.classification === "battle") {
              warningText = `Battle (${activity.metrics?.partyMetrics?.characters || 0} pilots)`;
            }

            const warning = {
              type: activity.classification,
              systemName: system.data.itemname || `System ${systemId}`,
              details: warningText,
              systemId: systemId,
            };
            dangerWarnings.push(warning);
            systemMarkedDangerous = true;
            tooltipHtml += `<li class="${warning.type}-warning" title="ID: ${warning.systemId}"><strong>${warning.systemName}</strong>: ${warning.details}</li>`;
            break; // Mark system as dangerous and move to next system in route
          }
          // Check if a 'roam' is currently in this system
          else if (
            activity.classification === "roam" &&
            activity.lastSystem?.id === systemId
          ) {
            const warning = {
              type: "roam",
              systemName: system.data.itemname || `System ${systemId}`,
              details: `Roaming gang (${activity.members?.size || 0} pilots)`,
              systemId: systemId,
            };
            dangerWarnings.push(warning);
            systemMarkedDangerous = true;
            tooltipHtml += `<li class="roam-warning" title="ID: ${warning.systemId}"><strong>${warning.systemName}</strong>: ${warning.details}</li>`;
            break; // Mark system as dangerous and move to next system in route
          }
        }
      }
    }
    if (dangerWarnings.length > 0) showDangerWarnings(tooltipHtml);
    else if (dangerTooltip?.parentElement) dangerTooltip.remove();
  }
  // --- END CHANGE ---
  function showDangerWarnings(warningsHtmlList) {
    /* ... */
  }

  // --- UI Interaction & View Helpers (remain mostly the same) ---
  function handleResize() {
    /* ... */
  }
  function calculateGalaxyBounds() {
    /* ... */
  }
  function setInitialCameraPosition() {
    /* ... */
  }
  function getSecurityColor(security) {
    /* ... */
  }
  function getSecurityDescription(security) {
    /* ... */
  }
  function toggleColorMode() {
    /* ... */
  }
  function onMouseMove(event) {
    /* ... */
  }
  function onClick(event) {
    /* ... */
  }
  function onDoubleClick(event) {
    /* ... */
  }
  function zoomToSystem(system) {
    /* ... */
  }
  function handleSearch(event) {
    /* ... */
  }
  function clearSelection() {
    /* ... */
  }

  // --- Animation Loop ---
  function animate(time) {
    if (!mounted) return;
    frameId = requestAnimationFrame(animate);

    const now = clock.getElapsedTime(); // Use THREE.Clock for consistent time
    const deltaTime = now - lastAnimationTime;
    lastAnimationTime = now;

    // --- CHANGE: Update unified activity markers ---
    activityMarkers.forEach((markerObj) => {
      // Update mixer if it exists
      if (markerObj.mixer) markerObj.mixer.update(deltaTime);

      // Handle flash animation
      const glowSprite = markerObj.group?.children.find(
        (c) =>
          c.isSprite &&
          c.material.map === glowTexture &&
          c !== markerObj.secondaryGlow
      );
      const secondaryGlow = markerObj.secondaryGlow;
      const lineMat = markerObj.lineMaterial; // For roams
      const activity = markerObj.activityData;
      const classification = activity.classification;

      // Determine colors based on classification stored in userData
      let flashColor = FLASH_COLOR_CAMP; // Default
      let baseColor = CAMP_COLOR; // Default
      let secondaryBaseOpacity = 0.1;
      let secondaryFlashOpacityBoost = 0.3;

      switch (
        markerObj.type // Use stored type for consistency
      ) {
        case "camp":
          flashColor = FLASH_COLOR_CAMP;
          baseColor = CAMP_COLOR;
          break;
        case "smartbomb":
          flashColor = FLASH_COLOR_SMARTBOMB;
          baseColor = SMARTBOMB_COLOR;
          secondaryBaseOpacity = 0.15;
          secondaryFlashOpacityBoost = 0.35;
          break;
        case "roaming_camp":
          flashColor = FLASH_COLOR_ROAMING_CAMP;
          baseColor = ROAMING_CAMP_COLOR;
          secondaryBaseOpacity = 0.15;
          secondaryFlashOpacityBoost = 0.35;
          break;
        case "battle":
          flashColor = FLASH_COLOR_BATTLE;
          baseColor = BATTLE_COLOR;
          secondaryBaseOpacity = 0.2;
          secondaryFlashOpacityBoost = 0.4;
          break;
        case "roam":
          flashColor = FLASH_COLOR_ROAM;
          baseColor = ROAM_COLOR;
          secondaryBaseOpacity = 0.1;
          secondaryFlashOpacityBoost = 0.3;
          break;
      }

      if (markerObj.flashEndTime > 0 && markerObj.flashEndTime > now) {
        const flashProgress = Math.max(
          0,
          1 - (markerObj.flashEndTime - now) / FLASH_DURATION
        );
        const flashSine = Math.sin(flashProgress * Math.PI);

        // Flash primary visual (glow or line)
        if (glowSprite) {
          const baseScale = markerObj.group.userData.baseGlowSize || 10; // Use stored base size
          const flashScaleMultiplier = 1 + flashSine * 19.0; // Flash size multiplier
          glowSprite.scale.setScalar(baseScale * flashScaleMultiplier);
          glowSprite.material.color.lerpColors(
            new THREE.Color(flashColor),
            new THREE.Color(baseColor),
            flashProgress
          );
          glowSprite.material.opacity = 0.9 + flashSine * 0.1;
        } else if (lineMat) {
          lineMat.opacity = 1.0;
          lineMat.color.lerpColors(
            new THREE.Color(flashColor),
            new THREE.Color(baseColor),
            flashProgress
          );
        }

        // Flash secondary glow
        if (secondaryGlow) {
          secondaryGlow.material.opacity =
            secondaryBaseOpacity + flashSine * secondaryFlashOpacityBoost;
        }
      } else {
        // Reset flash time if it just ended
        if (markerObj.flashEndTime > 0 && markerObj.flashEndTime <= now) {
          markerObj.flashEndTime = 0;
        }

        // Handle normal state / pulse
        if (glowSprite) {
          // Camp-like markers
          const baseScale = markerObj.group.userData.baseGlowSize || 10;
          glowSprite.scale.setScalar(baseScale); // Reset scale
          glowSprite.material.color.set(baseColor); // Reset color
          glowSprite.material.opacity = Math.min(
            0.8,
            (activity.probability || 0) / 100
          ); // Update opacity based on probability
        } else if (lineMat) {
          // Roam markers
          const pulseFactor = (Math.sin(now * 4) + 1) / 2; // Pulse speed
          lineMat.opacity = 0.7 + pulseFactor * 0.3; // Pulse opacity
          lineMat.color.lerpColors(
            new THREE.Color(baseColor),
            new THREE.Color(0xffffff),
            pulseFactor * 0.9
          ); // Pulse color towards white
        }

        // Pulse secondary glow
        if (secondaryGlow) {
          const pulseFactorSec = (Math.sin(now * 3) + 1) / 2; // Slower pulse
          secondaryGlow.material.opacity =
            secondaryBaseOpacity + pulseFactorSec * 0.2; // Pulse opacity
        }
      }
    });
    // --- END CHANGE ---

    if (userLocationMarker.mixer) userLocationMarker.mixer.update(deltaTime);

    // Region label visibility (remains the same - always visible)
    regionLabelCache.forEach((cacheEntry) => {
      if (cacheEntry.label) cacheEntry.label.visible = true;
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
      {#if selectedActivityData}
        <div
          class="info-row danger"
          style="background-color: rgba(100,100,100,0.1); padding: 2px 4px; border-radius: 4px; margin-top: 5px;"
        >
          <span>Activity:</span>
          <span class="{selectedActivityData.classification}-indicator">
            <span
              class="icon"
              title={classificationTooltips[
                selectedActivityData.classification
              ] || "Activity"}
            >
              {classificationIcons[selectedActivityData.classification] || "?"}
            </span>
            {#if selectedActivityData.classification === "camp" || selectedActivityData.classification === "smartbomb" || selectedActivityData.classification === "roaming_camp"}
              {classificationTooltips[selectedActivityData.classification]} ({Math.round(
                selectedActivityData.probability
              )}% conf.)
            {:else if selectedActivityData.classification === "battle"}
              {classificationTooltips[selectedActivityData.classification]} ({selectedActivityData
                .metrics?.partyMetrics?.characters || 0} pilots)
            {:else if selectedActivityData.classification === "roam"}
              {classificationTooltips[selectedActivityData.classification]} ({selectedActivityData
                .members?.size || 0} pilots)
            {:else}
              {classificationTooltips[selectedActivityData.classification]}
            {/if}
          </span>
        </div>
      {/if}
      <div class="action-buttons">
        <button
          on:click={() => calculateRoute(selectedSystem.itemid, true)}
          disabled={isCalculatingRoute || !userLocation}>Set Destination</button
        >
        <button
          on:click={() => calculateRoute(selectedSystem.itemid, false)}
          disabled={isCalculatingRoute || !userLocation}>Add Waypoint</button
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
  /* --- Styles (remain mostly the same, added indicator styles) --- */
  .universe-map-container {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  .controls {
    position: absolute;
    top: 20px;
    left: 20px;
    z-index: 10;
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

  .system-info-panel {
    position: absolute;
    bottom: 20px;
    left: 20px;
    z-index: 100;
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

  /* --- NEW: Indicator Styles --- */
  .camp-indicator,
  .smartbomb-indicator,
  .roaming_camp-indicator,
  .battle-indicator,
  .roam-indicator {
    display: inline-flex;
    align-items: center;
    font-weight: bold;
  }
  .camp-indicator {
    color: #ff3333;
  }
  .smartbomb-indicator {
    color: #ff9933;
  }
  .roaming_camp-indicator {
    color: #ff8c00;
  }
  .battle-indicator {
    color: #cc00cc;
  }
  .roam-indicator {
    color: #3333ff;
  }
  .icon {
    margin-right: 5px;
    font-size: 1.1em;
  }
  /* --- END NEW --- */

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
    bottom: 20px; /* Adjust if needed */
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
    list-style: none;
  }
  :global(.danger-list li) {
    margin-bottom: 4px;
    position: relative;
    padding-left: 15px;
  }
  :global(.danger-list li::before) {
    content: "";
    position: absolute;
    left: 0;
    top: 5px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  :global(.camp-warning::before),
  :global(.smartbomb-warning::before),
  :global(.roaming_camp-warning::before),
  :global(.battle-warning::before) {
    background-color: #ff3333; /* Default danger color */
  }
  :global(.smartbomb-warning::before) {
    background-color: #ff9933;
  }
  :global(.roaming_camp-warning::before) {
    background-color: #ff8c00;
  }
  :global(.battle-warning::before) {
    background-color: #cc00cc;
  }
  :global(.roam-warning::before) {
    background-color: #3333ff;
  } /* Roam color */
  :global(.danger-list strong) {
    color: white;
    font-weight: bold;
  }
</style>
