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
  import { currentLocation, locationError } from "./locationStore.js"; //
  import ContextMenu from "./ContextMenu.svelte"; //
  import { getValidAccessToken } from "./tokenManager.js"; //

  // --- State Variables ---
  let container; //
  let scene, camera, renderer, labelRenderer, controls; //
  let solarSystems = new Map(); // Map: systemId -> { position, label, data, index, securityColor, regionColor, connections }
  let stargateConnections = []; //
  let mapData = []; //
  let isLoading = true; //
  let isCalculatingRoute = false; // For specific route calculation loading state
  let error = null; //
  let errorTimeout = null; // Timeout ID for clearing error message
  let searchTerm = ""; //
  let selectedSystem = null; // Holds system data object { itemid, itemname, ... }
  let colorByRegion = false; //
  let regions = []; //
  let mounted = false; //
  let mapReady = false; // <<< *** ADDED: Flag to indicate base map is built ***
  let regionLabelCache = new Map(); // Cache only for region labels now
  let loadingEllipsis = ".";
  let ellipsisInterval = null;

  // Galaxy bounds tracking
  let galaxyCenter = new THREE.Vector3(); //
  let galaxySize = 0; //

  // Interaction
  let raycaster; //
  let mouse; //
  let clock = new THREE.Clock(); //
  let lastClickTime = 0; //
  let hoveredSystemData = null; // Holds system data object { itemid, itemname, ... }
  let hoverRing; // Mesh for hover effect

  // Context menu state
  let contextMenu = { show: false, x: 0, y: 0, options: [] }; //
  // --- CHANGE: Unified activity marker storage ---
  let activityMarkers = new Map(); // Map: activity.id -> { group, activityData, mixer, flashEndTime, secondaryGlow, secondaryGlowFlashEndTime, type: 'camp' | 'roam' | 'battle' | 'smartbomb' | 'roaming_camp' }
  // --- END CHANGE ---

  let userLocationMarker = { group: null, mixer: null }; //
  let routeLines = null; //
  let currentRoute = []; // Stores the current full route (array of system IDs)
  let dangerWarningsList = [];

  // Animation properties
  const PULSE_DURATION = 2.0; //
  const FLASH_DURATION = 0.5; // Faster flash
  let lastAnimationTime = 0; //

  // Fullscreen state
  let isFullscreen = false; //

  // --- Constants ---
  const SCALE_FACTOR = 1e-14; //
  const SYSTEM_SIZE = 7.0; // Slightly smaller base size
  const CONNECTION_COLOR = 0x00ffff; //
  const DOUBLE_CLICK_TIME = 300; //
  const CAMP_COLOR = 0xff3333; // Red
  const SMARTBOMB_COLOR = 0xff9933; // Orange-Red for Smartbomb
  const ROAM_COLOR = 0x3333ff; // Blue
  const ROAMING_CAMP_COLOR = 0xff8c00; // Orange for Roaming Camp
  const BATTLE_COLOR = 0xcc00cc; // Purple/Magenta for Battle
  const USER_COLOR = 0x00ffff; // Cyan
  const ROUTE_COLOR = 0x00ff00; // Green
  const DANGER_ROUTE_COLOR = 0xff6600; // Orange
  const FLASH_COLOR_CAMP = new THREE.Color(0xffdddd); //
  const FLASH_COLOR_SMARTBOMB = new THREE.Color(0xffccaa); //
  const FLASH_COLOR_ROAM = new THREE.Color(0xddddff); //
  const FLASH_COLOR_ROAMING_CAMP = new THREE.Color(0xffddaa); //
  const FLASH_COLOR_BATTLE = new THREE.Color(0xffaaff); //
  const SECONDARY_GLOW_COLOR_CAMP = 0xffaaaa; //
  const SECONDARY_GLOW_COLOR_SMARTBOMB = 0xffbb88; //
  const SECONDARY_GLOW_COLOR_ROAM = 0xaaaaff; //
  const SECONDARY_GLOW_COLOR_ROAMING_CAMP = 0xffcc88; //
  const SECONDARY_GLOW_COLOR_BATTLE = 0xee88ee; //
  const classificationIcons = {
    //
    camp: "⛺", //
    smartbomb: "⚡", //
    roaming_camp: "🏕️", //
    battle: "⚔️", //
    roam: "➡️", //
    activity: "❓", //
  };
  const classificationTooltips = {
    //
    camp: "Standard Gate Camp", //
    smartbomb: "Smartbomb Camp", //
    roaming_camp: "Roaming Camp (Multi-System)", //
    battle: "Large Battle (>40 Pilots)", //
    roam: "Roaming Gang", //
    activity: "Unclassified Activity", //
  };

  // --- Reusable Textures ---
  let circleTexture; //
  let glowTexture; //
  // --- Resource Disposal Utility (remains the same) ---
  function disposeObject3D(obj) {
    //
    if (!obj) return; //
    if (obj.geometry) obj.geometry.dispose(); //
    if (obj.material) {
      //
      if (Array.isArray(obj.material)) {
        //
        obj.material.forEach((m) => {
          //
          if (m.map) m.map.dispose(); //
          m.dispose(); //
        });
      } else {
        //
        if (obj.material.map) obj.material.map.dispose(); //
        obj.material.dispose(); //
      }
    }
    // Special handling for CSS2DObject labels
    if (obj instanceof CSS2DObject && obj.element) {
      //
      obj.element.remove(); //
    } else if (
      //
      obj.userData?.label instanceof CSS2DObject && //
      obj.userData.label.element //
    ) {
      obj.userData.label.element.remove(); //
      obj.userData.label = null; //
    } else if (obj.label instanceof CSS2DObject && obj.label.element) {
      //
      obj.label.element.remove(); //
      obj.label = null; //
    }

    while (obj.children.length > 0) {
      //
      disposeObject3D(obj.children[0]); //
      obj.remove(obj.children[0]); //
    }
    if (obj.userData?.mixer) {
      //
      obj.userData.mixer.stopAllAction(); //
      obj.userData.mixer = null; //
    }
  } //

  // --- Reactive Subscriptions & Updates ---
  // --- CHANGE: Subscribe to unified activities ---
  $: activities = $activeActivities || []; //
  // --- END CHANGE ---
  $: userLocation = $currentLocation; //
  // --- CHANGE: Single reactive block for activities with mapReady check ---
  // This block will run whenever 'mounted', 'mapReady', 'scene', or 'userLocation' changes
  $: if (mounted && mapReady && scene) {
    // Check if map base is built and scene exists
    if (userLocation) {
      // If we have location data, update the marker
      console.log(
        "[UniverseMap Reactive] User location updated:",
        userLocation
      ); // Optional debug log
      updateUserLocationMarker(userLocation); // Call your existing update function
    } else {
      // If location is null (e.g., tracking stopped), remove the marker
      if (userLocationMarker.group) {
        console.log(
          "[UniverseMap Reactive] User location null, removing marker."
        ); // Optional debug log
        scene.remove(userLocationMarker.group);
        disposeObject3D(userLocationMarker.group); // Assuming you have disposeObject3D
        userLocationMarker = { group: null, mixer: null };
      }
    }
  }
  $: if (mounted && mapReady && scene) {
    if (activities !== undefined) {
      // Check if activities array is defined
      console.log(
        `[UniverseMap Reactive] Activity store updated with ${activities.length} activities. Calling visualization update.`
      ); // Optional debug
      updateActivityVisualizations(activities); // Call the function to draw markers
    }
  }

  // Info panel reactive data
  $: selectedActivityData = selectedSystem //
    ? Array.from(activityMarkers.values()).find(
        //
        (marker) => marker.activityData.systemId === selectedSystem.itemid //
      )?.activityData //
    : null; //
  // Note: Finding roam data associated with a selected system is more complex now, might need adjustment if needed for panel. //
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
    //
    try {
      console.log("[UniverseMap] Component mounting..."); // <<< DEBUG
      if (isLoading) {
        startEllipsisAnimation();
      }
      circleTexture = createCircleTexture(); //
      glowTexture = createGlowTexture(); //

      await initializeMap(); //

      window.addEventListener("resize", handleResize); //
      container.addEventListener("mousemove", onMouseMove); //
      container.addEventListener("click", onClick); //
      container.addEventListener("dblclick", onDoubleClick); //
      container.addEventListener("contextmenu", onContextMenu); //
      document.addEventListener("fullscreenchange", handleFullscreenChange); //

      mounted = true; //
      console.log("[UniverseMap] Map initialized."); // <<< DEBUG
      animate(performance.now()); //
    } catch (err) {
      console.error("[UniverseMap] Error initializing map:", err); // <<< DEBUG
      error = err.message || "Failed to initialize map"; //
      stopEllipsisAnimation();
      if (errorTimeout) clearTimeout(errorTimeout); //
      errorTimeout = setTimeout(() => {
        //
        error = null; //
      }, 5000); //
    } finally {
      isLoading = false; //
    }
  }); //

  let frameId; //
  onDestroy(() => {
    stopEllipsisAnimation();
    console.log("[UniverseMap] Component destroying..."); // <<< DEBUG
    mounted = false; //
    if (frameId) cancelAnimationFrame(frameId); //
    window.removeEventListener("resize", handleResize); //
    document.removeEventListener("fullscreenchange", handleFullscreenChange); //
    if (container) {
      //
      container.removeEventListener("mousemove", onMouseMove); //
      container.removeEventListener("click", onClick); //
      container.removeEventListener("dblclick", onDoubleClick); //
      container.removeEventListener("contextmenu", onContextMenu); //
    }
    if (errorTimeout) clearTimeout(errorTimeout); //

    console.log("[UniverseMap] Disposing scene objects..."); // <<< DEBUG
    // --- CHANGE: Dispose unified markers ---
    activityMarkers.forEach((markerObj) => disposeObject3D(markerObj.group)); //
    activityMarkers.clear(); //
    // --- END CHANGE ---
    if (userLocationMarker.group) disposeObject3D(userLocationMarker.group); //
    userLocationMarker = { group: null, mixer: null }; //
    if (routeLines) disposeObject3D(routeLines); //
    routeLines = null; //
    regionLabelCache.forEach((cacheEntry) => {
      //
      disposeObject3D(cacheEntry.label); //
    });
    regionLabelCache.clear(); //
    stargateConnections.forEach((line) => disposeObject3D(line)); //
    stargateConnections = []; //
    const pointsObject = scene?.children.find(
      //
      (child) => child.userData?.isSystemPoints //
    );
    if (pointsObject) disposeObject3D(pointsObject); //
    solarSystems.forEach((sys) => {
      //
      if (sys.label) disposeObject3D(sys.label); //
    });
    solarSystems.clear(); //
    if (hoverRing) disposeObject3D(hoverRing); //
    console.log("[UniverseMap] Dynamic objects disposed."); // <<< DEBUG
    if (renderer) renderer.dispose(); //
    if (labelRenderer?.domElement?.parentElement)
      //
      labelRenderer.domElement.remove(); //
    if (controls) controls.dispose(); //
    if (circleTexture) circleTexture.dispose(); //
    if (glowTexture) glowTexture.dispose(); //
    console.log("[UniverseMap] Renderers, controls, textures disposed."); // <<< DEBUG

    console.log("[UniverseMap] Component destroyed."); // <<< DEBUG
  }); //

  // Add a reactive statement to stop the animation when loading finishes
  $: if (!isLoading && ellipsisInterval) {
    stopEllipsisAnimation();
  }
  // Add a reactive statement to start the animation if isLoading becomes true after mount (less common but safe)
  $: if (isLoading && !ellipsisInterval && mounted) {
    startEllipsisAnimation();
  }

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

  function onContextMenu(event) {
    //
    // <<< DEBUG Add log
    console.log("[UniverseMap] onContextMenu triggered."); //
    event.preventDefault(); //
    if (!selectedSystem) {
      // <<< DEBUG Add check
      console.log("[UniverseMap] Context menu prevented: No system selected."); //
      return; //
    }
    const rect = container.getBoundingClientRect(); //
    const x = event.clientX - rect.left; //
    const y = event.clientY - rect.top; //
    contextMenu = {
      //
      show: true, //
      x, //
      y, //
      options: [
        //
        {
          //
          label: "Set Destination", //
          action: () => calculateRoute(selectedSystem.itemid, true), // // Use new function
        },
        {
          //
          label: "Add Waypoint", //
          action: () => calculateRoute(selectedSystem.itemid, false), // // Use new function
        },
        {
          //
          label: "View Activity", //
          action: () => showSystemActivity(selectedSystem), //
        },
      ],
    };
    console.log("[UniverseMap] Context menu should show:", contextMenu); // <<< DEBUG
  } //
  function handleMenuSelect(event) {
    //
    const option = event.detail; //
    option.action(); //
    contextMenu.show = false; //
  } //
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
  // --- CORRECTED showSystemActivity function ---
  function showSystemActivity(selectedSystemData) {
    if (
      !selectedSystemData ||
      typeof selectedSystemData.itemid === "undefined"
    ) {
      console.error(
        "showSystemActivity: Invalid selected system data",
        selectedSystemData
      );
      return;
    }

    const systemIdToFind = selectedSystemData.itemid;

    // Find *all* activities associated with the selected system ID
    // Activities might be linked via systemId (camps) or lastSystem.id (roams/battles currently there)
    // or within the systems array (roams/battles that passed through)
    const relevantActivities = Array.from(activityMarkers.values())
      .map((marker) => marker.activityData) // Get the actual activity data
      .filter((activity) => {
        if (!activity) return false;
        // Check primary system ID (for camps, maybe battles)
        if (activity.systemId === systemIdToFind) return true;
        // Check last known system ID (for roams, battles)
        if (activity.lastSystem?.id === systemIdToFind) return true;
        // Check if the system is in the path history (for roams)
        if (activity.systems?.some((sys) => sys.id === systemIdToFind))
          return true;
        return false;
      });

    if (relevantActivities.length === 0) {
      console.log(
        `showSystemActivity: No active activity found for system ${systemIdToFind}`
      );
      // Optionally inform the user, e.g., alert("No recent activity found for this system.");
      return;
    }

    // Sort activities to prioritize (e.g., battles > camps > roams, then by time/probability)
    relevantActivities.sort((a, b) => {
      const priority = {
        battle: 5,
        smartbomb: 4,
        camp: 3,
        roaming_camp: 2,
        roam: 1,
        activity: 0,
      };
      const priorityA = priority[a.classification] ?? 0;
      const priorityB = priority[b.classification] ?? 0;
      if (priorityA !== priorityB) return priorityB - priorityA;

      // Secondary sort by last activity time (most recent first)
      const timeA = new Date(a.lastActivity || a.lastKill || 0).getTime();
      const timeB = new Date(b.lastActivity || b.lastKill || 0).getTime();
      return timeB - timeA;
    });

    // Get the most relevant activity and its latest kill
    const bestActivity = relevantActivities[0];
    if (!bestActivity.kills || bestActivity.kills.length === 0) {
      console.warn(
        `showSystemActivity: Selected activity ${bestActivity.id} has no kill data.`
      );
      return;
    }

    // Sort kills within the best activity to find the absolute latest
    const sortedKills = [...bestActivity.kills].sort(
      (ka, kb) =>
        new Date(kb.killmail.killmail_time) -
        new Date(ka.killmail.killmail_time)
    );
    const latestKill = sortedKills[0];

    if (latestKill && latestKill.killID) {
      // Open ZKillboard link for the latest kill of the most relevant activity
      const killTime = new Date(latestKill.killmail.killmail_time);
      const formattedTime = `${killTime.getUTCFullYear()}${String(killTime.getUTCMonth() + 1).padStart(2, "0")}${String(killTime.getUTCDate()).padStart(2, "0")}${String(killTime.getUTCHours()).padStart(2, "0")}${String(killTime.getUTCMinutes()).padStart(2, "0")}`;
      const systemToLink =
        bestActivity.lastSystem?.id || bestActivity.systemId || systemIdToFind; // Use best available system ID

      window.open(
        // Link to the related page for context, centered on the activity's primary/last system
        `https://zkillboard.com/related/${systemToLink}/${formattedTime}/`,
        "_blank"
      );
    } else {
      console.warn(
        `showSystemActivity: Could not find a valid killID for activity ${bestActivity.id}`
      );
    }
  }

  // --- Map Initialization & Building ---
  async function initializeMap() {
    console.log("[UniverseMap] initializeMap started...");
    initThreeJS(); // Initialize Three.js setup first

    try {
      isLoading = true;
      if (!ellipsisInterval && mounted) {
        startEllipsisAnimation();
      }
      error = null;
      mapReady = false;
      console.log("[UniverseMap] Fetching /api/map-data...");
      const response = await fetch("/api/map-data");
      if (!response.ok) {
        throw new Error(`Failed to fetch map data: ${response.status}`);
      }
      mapData = await response.json();
      console.log(`[UniverseMap] Fetched ${mapData.length} map entries.`);
      if (mapData.length === 0) throw new Error("No map data received");

      // --- DYNAMIC REGION COLOR GENERATION --- START ---

      // 1. Filter mapData to get only region definitions first
      const regionDefinitions = mapData.filter((item) => item.typeid === 3);
      const numberOfRegions = regionDefinitions.length;
      console.log(
        `[UniverseMap] Found ${numberOfRegions} region definitions (typeid 3).`
      );

      if (numberOfRegions === 0) {
        console.warn(
          "[UniverseMap] No region definitions found in mapData. Region coloring/labels might fail."
        );
        regions = []; // Ensure regions array is empty
      } else {
        // 2. Generate distinct colors using HSL hue stepping
        const hueStep = 360 / numberOfRegions;
        const saturation = 0.85; // High saturation for vibrancy (adjust 0.7 - 1.0)
        const lightness = 0.55; // Mid-range lightness (adjust 0.5 - 0.6)

        // 3. Map region definitions to the desired structure, calculating color
        regions = regionDefinitions
          .map((regionData, index) => {
            const hue = (index * hueStep) % 360; // Calculate hue for this region

            const color = new THREE.Color();
            // THREE.Color.setHSL expects H, S, L values between 0 and 1
            color.setHSL(hue / 360, saturation, lightness);

            return {
              id: regionData.itemid, // Use the ID from the region definition
              name: regionData.itemname,
              x: regionData.x,
              y: regionData.y,
              z: regionData.z,
              color: color.getHex(), // Store the calculated HEX color
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name)); // Sort alphabetically after processing

        console.log(
          `[UniverseMap] Generated and assigned distinct colors for ${regions.length} regions.`
        );
        // Optional: Log a sample of generated colors
        // console.log("Sample generated colors:", regions.slice(0, 5).map(r => ({ name: r.name, hex: `#${r.color.toString(16).padStart(6, '0')}` })));
      }
      // --- DYNAMIC REGION COLOR GENERATION --- END ---

      // 4. Now build the map - it will use the 'regions' array with generated colors
      console.log(
        `[UniverseMap] Final regions array (sample):`,
        JSON.stringify(regions.slice(0, 10)),
        "Total count:",
        regions.length
      );
      buildMap(mapData); // Pass the full mapData
    } catch (err) {
      console.error("[UniverseMap] Error during initializeMap:", err);
      error = err.message || "Failed to initialize map";
      stopEllipsisAnimation();
      if (errorTimeout) clearTimeout(errorTimeout);
      errorTimeout = setTimeout(() => {
        error = null;
      }, 5000);
      // Optional: Set mapReady = true even on error? Or leave false?
      // mapReady = true;
    } finally {
      isLoading = false;
      console.log(
        "[UniverseMap] initializeMap finished. isLoading:",
        isLoading,
        "mapReady:",
        mapReady // mapReady will be true only if buildMap completes successfully
      );
    }
  }
  function initThreeJS() {
    //
    console.log("[UniverseMap] Initializing Three.js..."); // <<< DEBUG
    scene = new THREE.Scene(); //
    scene.background = new THREE.Color(0x000011); //
    camera = new THREE.PerspectiveCamera( //
      60, //
      container.clientWidth / container.clientHeight, //
      0.1, // near plane
      1000000 // far plane (increased range)
    );
    camera.position.set(0, 0, 50); // Initial position
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); //
    renderer.setSize(container.clientWidth, container.clientHeight); //
    renderer.setPixelRatio(window.devicePixelRatio); //
    container.appendChild(renderer.domElement); //

    // Label Renderer
    labelRenderer = new CSS2DRenderer(); //
    labelRenderer.setSize(container.clientWidth, container.clientHeight); //
    labelRenderer.domElement.style.position = "absolute"; //
    labelRenderer.domElement.style.top = "0"; //
    labelRenderer.domElement.style.pointerEvents = "none"; // Allow clicks to pass through
    container.appendChild(labelRenderer.domElement); //
    // Controls
    controls = new OrbitControls(camera, renderer.domElement); //
    controls.enableDamping = true; //
    controls.dampingFactor = 0.1; //
    controls.rotateSpeed = 0; // Disable rotation
    controls.panSpeed = 0.8; //
    controls.zoomSpeed = 1.2; //
    controls.minDistance = 0.5; // Allow closer zoom
    controls.maxDistance = 2500; // Allow further zoom out
    controls.minPolarAngle = 0; // Lock vertical panning
    controls.maxPolarAngle = 0; // Lock vertical panning
    controls.enableRotate = false; //
    controls.enablePan = true; // Enable panning

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7); // Slightly brighter ambient
    scene.add(ambientLight); //

    // Raycaster
    raycaster = new THREE.Raycaster(); //
    // --- CHANGE: Increase raycaster threshold for points ---
    raycaster.params.Points.threshold = 2.5; // Increased from 1.5
    // --- END CHANGE ---
    mouse = new THREE.Vector2(); //
    // Hover Ring
    // --- CHANGE: Slightly smaller hover ring ---
    const ringGeometry = new THREE.RingGeometry( //
      SYSTEM_SIZE * 0.7, // Slightly smaller inner radius
      SYSTEM_SIZE * 0.8, // Slightly smaller outer radius
      32 //
    );
    // --- END CHANGE ---
    const ringMaterial = new THREE.MeshBasicMaterial({
      //
      color: 0x00ffff, // Cyan
      side: THREE.DoubleSide, //
      transparent: true, //
      opacity: 0.7, //
    });
    hoverRing = new THREE.Mesh(ringGeometry, ringMaterial); //
    // hoverRing.rotation.x = -Math.PI / 2; // Keep it flat on the XZ plane
    hoverRing.visible = false; //
    scene.add(hoverRing); //

    console.log("[UniverseMap] Three.js initialized successfully"); // <<< DEBUG
  } //
  function buildMap(systemsData) {
    console.log(
      `[UniverseMap] Building map with ${systemsData?.length ?? 0} entries...`
    );
    if (!scene) {
      console.error(
        "[UniverseMap] buildMap called but scene is not initialized."
      );
      return;
    }

    // --- Clear existing region labels from scene ---
    regionLabelCache.forEach((cacheEntry) => {
      if (cacheEntry.label && cacheEntry.label.parent) {
        scene.remove(cacheEntry.label);
        // Optional: Dispose CSS2DObject element if needed and safe
        // if (cacheEntry.label.element && cacheEntry.label.element.parentNode) {
        //     cacheEntry.label.element.parentNode.removeChild(cacheEntry.label.element);
        // }
      }
    });
    // We don't clear regionLabelCache itself, it's reused/updated in createRegionLabels

    // --- Clear previous points/lines ---
    const oldPointsObject = scene?.children.find(
      (child) => child.userData?.isSystemPoints
    );
    if (oldPointsObject) {
      console.log("[UniverseMap] Removing old system points...");
      scene.remove(oldPointsObject);
      disposeObject3D(oldPointsObject);
    }
    stargateConnections.forEach((line) => {
      scene.remove(line);
      disposeObject3D(line);
    });
    stargateConnections = [];
    solarSystems.forEach((sys) => {
      // Clear old system labels
      if (sys.label && sys.label.parent) {
        // Check if parent exists before removing
        scene.remove(sys.label);
        // disposeObject3D(sys.label); // Disposal handled by main dispose loop if needed
      }
    });
    solarSystems.clear(); // Clear the system map

    // --- Filter data ---
    const solarSystemsData = systemsData.filter((item) => item.typeid === 5);
    const stargatesData = systemsData.filter((item) => item.groupid === 10);
    console.log(
      `[UniverseMap] Filtered data: ${solarSystemsData.length} systems, ${stargatesData.length} stargates.`
    );
    if (solarSystemsData.length === 0) {
      console.warn("[UniverseMap] No solar system data found after filtering.");
      mapReady = true;
      // Attempt to create labels even if no systems shown? Or handle empty state?
      createRegionLabels([]); // Call with empty array if needed? Or skip?
      calculateGalaxyBounds(); // Will result in 0/null bounds
      setInitialCameraPosition(); // Will use fallback position
      return;
    }

    // --- Filter systems by connectivity and search term ---
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
      const sourceRegion = regions.find(
        (r) => String(r.id) === String(sourceSystem.regionid)
      ); // Use string comparison
      const destRegion = regions.find(
        (r) => String(r.id) === String(destinationSystem.regionid)
      ); // Use string comparison
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
    console.log(
      `[UniverseMap] After connection/search filtering: ${searchFilteredSystems.length} systems`
    );

    if (searchFilteredSystems.length === 0) {
      // If search yields no results, still mark map as ready but show no systems
      mapReady = true;
      createRegionLabels([]); // Call with empty array
      calculateGalaxyBounds();
      setInitialCameraPosition();
      return;
    }

    // --- Create System Points (Geometry) ---
    const positions = [];
    const colors = [];
    searchFilteredSystems.forEach((system, idx) => {
      if (system.x === null || system.z === null) {
        console.warn(
          `[UniverseMap] Skipping system ${system.itemname} due to null coordinates.`
        );
        return;
      }
      const posX = system.x * SCALE_FACTOR;
      const posY = 0; // Keep Y=0 for 2D map
      const posZ = system.z * SCALE_FACTOR;
      positions.push(posX, posY, posZ);

      let colorValue;
      // --- Assign point color based on mode ---
      if (colorByRegion) {
        // Robust find using string comparison
        const region = regions.find(
          (r) => String(r.id) === String(system.regionid)
        );
        colorValue = region ? region.color : 0xffffff; // Default white if region not found
      } else {
        colorValue = getSecurityColor(system.security);
      }
      const color = new THREE.Color(colorValue);
      colors.push(color.r, color.g, color.b);

      // --- Create System Label (CSS2DObject) ---
      const labelDiv = document.createElement("div");
      labelDiv.className = "system-label";
      labelDiv.textContent = system.itemname;
      const label = new CSS2DObject(labelDiv);
      label.position.set(posX, posY, posZ);
      label.visible = false; // Initially hidden
      scene.add(label);

      // --- Store system data in map ---
      solarSystems.set(system.itemid, {
        position: new THREE.Vector3(posX, posY, posZ),
        label,
        data: system,
        index: idx, // Store index relative to searchFilteredSystems for potential direct updates
        securityColor: getSecurityColor(system.security),
        // Store region color using robust find
        regionColor:
          regions.find((r) => String(r.id) === String(system.regionid))
            ?.color || 0xffffff,
        connections: new Set(),
      });
    });

    if (positions.length === 0) {
      console.warn("[UniverseMap] No valid system positions after processing.");
      mapReady = true;
      createRegionLabels([]);
      calculateGalaxyBounds();
      setInitialCameraPosition();
      return;
    }

    // --- Add Points Object to Scene ---
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
    console.log(
      `[UniverseMap] Added ${solarSystems.size} system points object to scene.`
    );

    // --- Create Connections ---
    let connectionCount = 0;
    processedConnections.clear(); // Clear again for the connection drawing loop
    stargatesData.forEach((sourceGate) => {
      if (!sourceGate.solarsystemid || !sourceGate.itemname) return;
      const match = sourceGate.itemname.match(/Stargate \(([^)]+)\)/);
      if (!match) return;
      const destinationName = match[1];
      // Find systems in the original data, not the filtered one, for connection logic
      const destinationSystem = solarSystemsData.find(
        (sys) => sys.itemname === destinationName
      );
      if (!destinationSystem) return;
      const sourceSystem = solarSystemsData.find(
        (sys) => sys.itemid === sourceGate.solarsystemid
      );
      if (!sourceSystem) return;

      // Skip C-R regions (same check as before)
      const sourceRegion = regions.find(
        (r) => String(r.id) === String(sourceSystem.regionid)
      );
      const destRegion = regions.find(
        (r) => String(r.id) === String(destinationSystem.regionid)
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

      // Ensure BOTH systems exist in the *rendered* solarSystems map (i.e., passed filtering)
      if (
        solarSystems.has(sourceSystem.itemid) &&
        solarSystems.has(destinationSystem.itemid)
      ) {
        // Pass the original system data to createConnectionLine
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
    console.log(
      `[UniverseMap] Created ${connectionCount} stargate connections.`
    );

    // --- Create Region Labels ---
    // Pass the currently filtered list of systems to base label positions
    createRegionLabels(searchFilteredSystems);

    // --- Final Steps ---
    calculateGalaxyBounds();
    setInitialCameraPosition();
    mapReady = true; // Mark map as ready
    console.log("[UniverseMap] Base map build complete and ready.");
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
    console.log(
      `CREATE REGION LABELS START. Received ${systemsInMap?.length ?? 0} systems.`
    );

    // Ensure all cached region labels ARE added to the scene if not already present
    regionLabelCache.forEach((cacheEntry, regionId) => {
      // Added regionId for logging
      if (cacheEntry.label && !cacheEntry.label.parent) {
        console.log(`-- Re-adding cached label ${regionId} to scene.`);
        scene.add(cacheEntry.label);
      }
      // Visibility is primarily handled by animate loop, ensuring true here is safe fallback
      if (cacheEntry.label) cacheEntry.label.visible = true;
    });

    const regionSystems = new Map();
    systemsInMap.forEach((systemData) => {
      if (
        systemData &&
        typeof systemData.regionid !== "undefined" &&
        systemData.x !== null &&
        systemData.z !== null
      ) {
        const regionId = systemData.regionid; // Use the ID from system data
        if (!regionSystems.has(regionId)) regionSystems.set(regionId, []);
        // Store scaled coordinates for averaging
        regionSystems.get(regionId).push({
          x: systemData.x * SCALE_FACTOR,
          y: 0,
          z: systemData.z * SCALE_FACTOR,
        });
      }
    });
    console.log(
      `-- Processed systems into ${regionSystems.size} region groups.`
    );

    regionSystems.forEach((positions, regionId) => {
      // regionId here comes from systemData.regionid
      if (positions.length < 1) return;

      // --- Use Robust String Comparison ---
      const region = regions.find((r) => String(r.id) === String(regionId));
      // ------------------------------------

      if (!region) {
        // This warning means the regionId from a system doesn't exist in the 'regions' array (typeid=3 items)
        console.warn(`-- Region data not found for ID: ${regionId}`);
        return;
      }

      // Check cache BEFORE creating
      if (!regionLabelCache.has(regionId)) {
        console.log(
          `-- CREATING NEW label for region ${region.name} (ID: ${regionId})`
        ); // Use region.name here
        const cacheEntry = {};
        const avgPosition = new THREE.Vector3();
        positions.forEach((p) => avgPosition.add(p));
        avgPosition.divideScalar(positions.length);

        console.log(
          `-- > Calculated Position: x=${avgPosition.x.toFixed(2)}, y=${avgPosition.y.toFixed(2)}, z=${avgPosition.z.toFixed(2)}`
        );
        if (
          isNaN(avgPosition.x) ||
          isNaN(avgPosition.y) ||
          isNaN(avgPosition.z)
        ) {
          console.error(
            `-- > !!! Position calculation resulted in NaN for region ${region.name}`
          );
          return;
        }

        const labelDiv = document.createElement("div");
        labelDiv.className = "region-label";
        labelDiv.textContent = region.name; // Use name from found region object
        const labelColor = new THREE.Color(region.color);
        labelDiv.style.color = `#${labelColor.getHexString()}`;
        console.log(
          `-- > Assigned Color: ${labelDiv.style.color} (from region data 0x${region.color?.toString(16)})`
        ); // Log found color

        const label = new CSS2DObject(labelDiv);
        label.position.copy(avgPosition);
        label.position.y = 0.1; // Position slightly above systems
        label.userData.regionId = regionId; // Store the ID used for lookup
        label.visible = true;

        cacheEntry.label = label;
        cacheEntry.center = avgPosition.clone();

        scene.add(label);
        console.log(`-- > Added label object for ${region.name} to scene.`);

        regionLabelCache.set(regionId, cacheEntry);
      } else {
        // Label exists in cache, make sure it's visible (animate loop does this too)
        const cacheEntry = regionLabelCache.get(regionId);
        if (cacheEntry.label) {
          // Check if label exists in cache entry
          cacheEntry.label.visible = true;
          // Optionally update position if needed, but can be complex/slow
          // const avgPosition = new THREE.Vector3();
          // positions.forEach(p => avgPosition.add(p));
          // avgPosition.divideScalar(positions.length);
          // cacheEntry.label.position.copy(avgPosition);
          // cacheEntry.label.position.y = 0.1;
          // console.log(`-- Updated position for cached label ${region.name}`);
        }
        // console.log(`-- Label for region ${region.name} exists in cache.`);
      }
    });
    console.log("CREATE REGION LABELS END.");
  }

  // --- CHANGE: Unified Activity Visualization Update ---
  function updateActivityVisualizations(newActivities) {
    //
    if (!scene || !mounted || !mapReady) {
      // <<< Add mapReady check
      console.log(
        "[UniverseMap] updateActivityVisualizations skipped: Scene/Mount/Map not ready."
      ); // <<< DEBUG
      return; //
    }
    console.log(
      `[UniverseMap] Updating ${newActivities?.length ?? 0} activity visualizations...`
    ); // <<< DEBUG
    const now = clock.getElapsedTime(); //
    const currentActivityIds = new Set(newActivities.map((a) => a.id)); //
    // Remove markers for activities that no longer exist
    activityMarkers.forEach((markerObj, activityId) => {
      //
      if (!currentActivityIds.has(activityId)) {
        //
        console.log(
          `[UniverseMap] Removing stale activity marker: ${activityId}`
        ); // <<< DEBUG
        scene.remove(markerObj.group); //
        disposeObject3D(markerObj.group); //
        activityMarkers.delete(activityId); //
      }
    });
    // Add/Update markers for current activities
    newActivities.forEach((activity) => {
      //
      if (!activity?.id) {
        // <<< DEBUG Add check
        console.warn(
          "[UniverseMap] Skipping activity with missing ID:",
          activity
        ); //
        return; //
      }
      const existingMarker = activityMarkers.get(activity.id); //
      const latestKillId = activity.kills?.[activity.kills.length - 1]?.killID; // Safely access kills //

      if (existingMarker) {
        //
        // Update existing marker
        const markerObj = existingMarker; //
        const oldClassification = markerObj.activityData?.classification; // Safely access old data //
        markerObj.activityData = activity; // Update data

        // Check if classification changed, requires recreating visual
        if (activity.classification !== oldClassification) {
          //
          console.log(
            // <<< DEBUG
            `[UniverseMap] Activity ${activity.id} classification changed from ${oldClassification} to ${activity.classification}. Recreating visual.` //
          );
          scene.remove(markerObj.group); //
          disposeObject3D(markerObj.group); //
          activityMarkers.delete(activity.id); // Remove old entry
          createOrUpdateActivityMarker(activity, now, latestKillId); // Create new one
        } else {
          //
          // Only update properties if classification is the same
          updateMarkerProperties(markerObj, activity, now, latestKillId); //
        }
      } else {
        //
        // Create new marker
        createOrUpdateActivityMarker(activity, now, latestKillId); //
      }
    });
  } //

  // --- NEW: Helper to create or update a marker based on classification ---
  function createOrUpdateActivityMarker(activity, now, latestKillId) {
    //
    console.log(
      `[UniverseMap] Creating/Updating marker for activity ${activity.id}, classification: ${activity.classification}`
    ); // <<< DEBUG
    let markerObj; //
    switch (
      activity.classification //
    ) {
      case "camp": //
      case "smartbomb": //
      case "roaming_camp": // Use camp-style marker for roaming camps too
      case "battle": // Use camp-style marker for battles
        markerObj = createOrUpdateCampStyleMarker(activity, now, latestKillId); //
        break; //
      case "roam": //
        markerObj = createOrUpdateRoamStyleMarker(activity, now, latestKillId); //
        break; //
      case "activity": // Decide how to represent 'activity' - maybe a smaller grey glow?
        // markerObj = createOrUpdateActivityStyleMarker(activity, now, latestKillId); //
        console.log(
          // <<< DEBUG
          `[UniverseMap] Skipping visualization for unclassified activity: ${activity.id}` //
        );
        return; // Don't visualize 'activity' for now
      default: //
        console.warn(
          // <<< DEBUG
          `[UniverseMap] Unknown activity classification: ${activity.classification}` //
        );
        return; //
    }

    if (markerObj) {
      //
      activityMarkers.set(activity.id, markerObj); //
      scene.add(markerObj.group); //
      console.log(
        `[UniverseMap] Added/Updated marker group to scene for activity ${activity.id}`
      ); // <<< DEBUG
    } else {
      console.warn(
        `[UniverseMap] Failed to create marker object for activity ${activity.id}`
      ); // <<< DEBUG
    }
  } //

  // --- NEW: Helper to update existing marker properties (if classification hasn't changed) ---
  function updateMarkerProperties(markerObj, activity, now, latestKillId) {
    //
    // Update shared data
    markerObj.activityData = activity; //
    // Trigger flash if needed
    if (latestKillId && markerObj.lastKillId !== latestKillId) {
      //
      markerObj.flashEndTime = now + FLASH_DURATION; //
      markerObj.lastKillId = latestKillId; //
      if (markerObj.secondaryGlow) {
        //
        markerObj.secondaryGlowFlashEndTime = now + FLASH_DURATION; //
      }
      console.log(`[UniverseMap] Flash triggered for activity ${activity.id}`); // <<< DEBUG
    }

    // Update specific visuals based on type stored in markerObj
    if (
      //
      markerObj.type === "camp" || //
      markerObj.type === "smartbomb" || //
      markerObj.type === "roaming_camp" || //
      markerObj.type === "battle" //
    ) {
      // Update glow size/opacity based on probability for camp-like markers
      const glowSprite = markerObj.group?.children.find(
        //
        (
          c //
        ) =>
          c.isSprite && //
          c.material.map === glowTexture && //
          c !== markerObj.secondaryGlow //
      );
      if (glowSprite) {
        //
        const baseSize = ((activity.probability || 0) / 100) * 20 + 5; // Use default 0 if undefined //
        if (markerObj.flashEndTime <= 0 || markerObj.flashEndTime < now) {
          // Ensure flash check considers 'now' //
          // Only update size if not flashing
          glowSprite.scale.set(baseSize, baseSize, 1); //
          glowSprite.material.opacity = Math.min(
            //
            0.8, //
            (activity.probability || 0) / 100 //
          );
        } //
      }
      // Update secondary glow position for roaming camps/battles if needed
      if (
        //
        (activity.classification === "roaming_camp" || //
          activity.classification === "battle") && //
        markerObj.secondaryGlow && //
        activity.lastSystem //
      ) {
        const lastSystemIdStr = activity.lastSystem.id;
        const lastSystemIdInt = lastSystemIdStr
          ? parseInt(lastSystemIdStr)
          : NaN; // Ensure parsing

        if (!isNaN(lastSystemIdInt)) {
          // <<< Check if ID is valid number
          const secondaryGlowTargetSystem = solarSystems.get(lastSystemIdInt); // The system where the secondary glow SHOULD be centered

          if (secondaryGlowTargetSystem) {
            // We need the position of the group (which is anchored at the primary system)
            const primarySystemPosition = markerObj.group.position; // Get the group's world position

            // Calculate the position of the secondary glow RELATIVE to the group's origin
            const relativePosition = new THREE.Vector3().subVectors(
              secondaryGlowTargetSystem.position, // Target world position
              primarySystemPosition // Group's world position (origin)
            );

            // Apply the calculated RELATIVE position to the secondary glow sprite
            markerObj.secondaryGlow.position.copy(relativePosition);
          } else {
            console.warn(
              `[UniverseMap] System ${lastSystemIdInt} not found for secondary glow update (Activity ${activity.id}).`
            ); // <<< DEBUG
            // Optional: You might want to hide or reset the secondary glow position if the target system isn't found
            // markerObj.secondaryGlow.position.set(0, 0, 0); // Or hide: markerObj.secondaryGlow.visible = false;
          }
        } else {
          console.warn(
            `[UniverseMap] Invalid lastSystem ID for secondary glow update: ${activity.lastSystem.id}`
          ); // <<< DEBUG
        }
      }
    } else if (markerObj.type === "roam") {
      //
      // Update roam path if systems changed? // (More complex, might require redraw)
      // For now, just update secondary glow position
      if (markerObj.secondaryGlow && activity.lastSystem) {
        //
        const systemIdInt = parseInt(activity.lastSystem.id); //
        if (!isNaN(systemIdInt)) {
          // <<< DEBUG Check if ID is valid number
          const system = solarSystems.get(systemIdInt); //
          if (system)
            markerObj.secondaryGlow.position.copy(system.position); //
          else
            console.warn(
              `[UniverseMap] System ${systemIdInt} not found for roam secondary glow.`
            ); // <<< DEBUG
        } else {
          console.warn(
            `[UniverseMap] Invalid lastSystem ID for roam secondary glow: ${activity.lastSystem.id}`
          ); // <<< DEBUG
        }
      }
    }
  } //

  // --- NEW: Function to create/update Camp, Smartbomb, Roaming Camp, Battle markers ---
  function createOrUpdateCampStyleMarker(activity, now, latestKillId) {
    //
    const systemId = parseInt(activity.systemId); // // Camp-like activities have a primary systemId
    if (isNaN(systemId)) {
      // <<< DEBUG Check ID
      console.warn(
        `[UniverseMap] Invalid systemId for camp-style marker: ${activity.systemId}`
      ); //
      return null; //
    }
    const system = solarSystems.get(systemId); //
    if (!system) {
      //
      console.warn(
        `[UniverseMap] System ${systemId} not found for camp-style marker ${activity.id}`
      ); // <<< DEBUG
      return null; // // Cannot place marker if system isn't rendered
    }

    const group = new THREE.Group(); //
    group.position.copy(system.position); //
    let primaryColor, secondaryColor, flashColor; //
    let baseGlowSize = ((activity.probability || 0) / 100) * 20 + 5; // Use default 0 if undefined // Base size on probability

    switch (
      activity.classification //
    ) {
      case "camp": //
        primaryColor = CAMP_COLOR; //
        secondaryColor = SECONDARY_GLOW_COLOR_CAMP; //
        flashColor = FLASH_COLOR_CAMP; //
        break; //
      case "smartbomb": //
        primaryColor = SMARTBOMB_COLOR; //
        secondaryColor = SECONDARY_GLOW_COLOR_SMARTBOMB; //
        flashColor = FLASH_COLOR_SMARTBOMB; //
        baseGlowSize *= 1.1; // Slightly larger for smartbombs
        break; //
      case "roaming_camp": //
        primaryColor = ROAMING_CAMP_COLOR; //
        secondaryColor = SECONDARY_GLOW_COLOR_ROAMING_CAMP; //
        flashColor = FLASH_COLOR_ROAMING_CAMP; //
        baseGlowSize *= 1.2; // Larger for roaming camps
        break; //
      case "battle": //
        primaryColor = BATTLE_COLOR; //
        secondaryColor = SECONDARY_GLOW_COLOR_BATTLE; //
        flashColor = FLASH_COLOR_BATTLE; //
        baseGlowSize = //
          30 + //
          (Math.min(activity.metrics?.partyMetrics?.characters || 0, 100) / //
            100) * //
            30; // Size based on participants for battles
        break; //
      default: // Fallback, should not happen if called correctly
        primaryColor = CAMP_COLOR; //
        secondaryColor = SECONDARY_GLOW_COLOR_CAMP; //
        flashColor = FLASH_COLOR_CAMP; //
    }

    // Primary Glow
    const glowMaterial = new THREE.SpriteMaterial({
      //
      map: glowTexture, //
      color: new THREE.Color(primaryColor), //
      transparent: true, //
      opacity: Math.min(0.8, (activity.probability || 0) / 100), //
      depthWrite: false, //
      sizeAttenuation: true, //
    });
    const glowSprite = new THREE.Sprite(glowMaterial); //
    glowSprite.scale.set(baseGlowSize, baseGlowSize, 1); //
    group.add(glowSprite); //

    // Secondary Glow (Positioned at the primary system for camps/SB, last system for roaming/battle)
    const lastSystemIdStr = activity.lastSystem?.id;
    const lastSystemIdInt = lastSystemIdStr ? parseInt(lastSystemIdStr) : NaN;

    let secondaryGlowTargetSystem = system; // Default to primary system (where the group is anchored)
    if (
      (activity.classification === "roaming_camp" ||
        activity.classification === "battle") &&
      !isNaN(lastSystemIdInt) &&
      solarSystems.has(lastSystemIdInt)
    ) {
      secondaryGlowTargetSystem = solarSystems.get(lastSystemIdInt);
    } else if (
      (activity.classification === "roaming_camp" ||
        activity.classification === "battle") &&
      !isNaN(lastSystemIdInt)
    ) {
      console.warn(
        `[UniverseMap] Last system ${lastSystemIdInt} for secondary glow (Activity ${activity.id}) not found in rendered map. Using primary system ${systemId}.`
      );
    }
    const secondaryGlowSize = baseGlowSize * 10.0; //
    const secondaryGlowMaterial = new THREE.SpriteMaterial({
      //
      map: glowTexture, //
      color: new THREE.Color(secondaryColor), //
      transparent: true, //
      opacity: 0.1, //
      depthWrite: false, //
      sizeAttenuation: true, //
    });
    const secondaryGlowSprite = new THREE.Sprite(secondaryGlowMaterial); //
    secondaryGlowSprite.scale.set(secondaryGlowSize, secondaryGlowSize, 1); //
    secondaryGlowSprite.renderOrder = -1; //

    // The group is positioned at 'system.position'.
    // We want the sprite to appear at 'secondaryGlowTargetSystem.position' in world space.
    // So, the sprite's local position within the group needs to be the difference.
    const relativePosition = new THREE.Vector3().subVectors(
      secondaryGlowTargetSystem.position, // Target world position
      system.position // Group's world position (origin)
    );
    secondaryGlowSprite.position.copy(relativePosition);

    group.add(secondaryGlowSprite); // Add to the main group

    // Animation Mixer
    const mixer = new THREE.AnimationMixer(glowSprite); //
    const track = new THREE.KeyframeTrack( //
      ".scale", //
      [0, PULSE_DURATION / 2, PULSE_DURATION], //
      [
        //
        baseGlowSize, //
        baseGlowSize, //
        baseGlowSize, //
        baseGlowSize * 1.3, //
        baseGlowSize * 1.3, //
        baseGlowSize, //
        baseGlowSize, //
        baseGlowSize, //
        baseGlowSize, //
      ] //
    );
    const clip = new THREE.AnimationClip("pulse", PULSE_DURATION, [track]); //
    const action = mixer.clipAction(clip); //
    action.setLoop(THREE.LoopRepeat); //
    action.play(); //

    group.userData = {
      //
      type: activity.classification, // Store the specific classification
      activityData: activity, //
      name: system.data.itemname, //
      probability: activity.probability, //
      flashColor: flashColor, // Store flash color for animation loop
      baseColor: primaryColor, // Store base color
      baseGlowSize: baseGlowSize, //
    };
    return {
      //
      group: group, //
      activityData: activity, //
      mixer: mixer, //
      lastKillId: latestKillId, //
      flashEndTime: 0, //
      secondaryGlow: secondaryGlowSprite, //
      secondaryGlowFlashEndTime: 0, //
      type: activity.classification, // Store type for update logic
    }; //
  } //

  // --- NEW: Function to create/update Roam markers ---
  function createOrUpdateRoamStyleMarker(activity, now, latestKillId) {
    //
    if (!activity.systems || activity.systems.length < 1) {
      //
      console.warn(
        `[UniverseMap] Skipping roam marker ${activity.id}: No system data.`
      ); // <<< DEBUG
      return null; //
    }

    const sortedSystems = [...activity.systems].sort(
      //
      (a, b) => new Date(a.time) - new Date(b.time) //
    );
    const points = []; //
    const systemOrder = []; //
    for (const system of sortedSystems) {
      //
      const systemIdInt = parseInt(system.id); //
      if (isNaN(systemIdInt)) {
        // <<< DEBUG Check ID
        console.warn(
          `[UniverseMap] Skipping system in roam ${activity.id}: Invalid system ID ${system.id}`
        ); //
        continue; //
      }
      const systemObj = solarSystems.get(systemIdInt); //
      if (systemObj) {
        //
        points.push(systemObj.position.clone()); //
        systemOrder.push(system); //
      } else {
        console.warn(
          `[UniverseMap] System ${systemIdInt} not found for roam ${activity.id}`
        ); // <<< DEBUG
      }
    }

    if (points.length < 1) {
      //
      console.warn(
        `[UniverseMap] Skipping roam marker ${activity.id}: No valid points found.`
      ); // <<< DEBUG
      return null; // // Need at least one valid point
    }

    const roamGroup = new THREE.Group(); //
    let lineObject = null; //
    let secondaryGlowSprite = null; //

    // Create path line if more than one point
    if (points.length >= 2) {
      //
      try {
        const curve = new THREE.CatmullRomCurve3(points); //
        const geometry = new THREE.BufferGeometry().setFromPoints(
          //
          curve.getPoints(Math.max(64, points.length * 8)) //
        );
        const material = new THREE.LineBasicMaterial({
          color: new THREE.Color(ROAM_COLOR).multiplyScalar(1.5), // Keep color bright
          linewidth: 2.5, // Slightly thicker
          transparent: true,
          opacity: 0.98,
        });
        material.userData = { baseColor: new THREE.Color(ROAM_COLOR) }; // Store base color
        lineObject = new THREE.Line(geometry, material); //
        roamGroup.add(lineObject); //
      } catch (e) {
        console.error("Error creating roam path line:", e); //
        // Continue without the line if curve creation fails
      }
    }

    // Secondary Glow at the last known system
    const lastSystemPos = points[points.length - 1]; //
    if (lastSystemPos) {
      //
      const secondaryGlowMaterial = new THREE.SpriteMaterial({
        //
        map: glowTexture, //
        color: new THREE.Color(SECONDARY_GLOW_COLOR_ROAM), //
        transparent: true, //
        opacity: 0.1, //
        depthWrite: false, //
        sizeAttenuation: true, //
      });
      secondaryGlowSprite = new THREE.Sprite(secondaryGlowMaterial); //
      secondaryGlowSprite.scale.set(60, 60, 1); //
      secondaryGlowSprite.position.copy(lastSystemPos); //
      secondaryGlowSprite.renderOrder = -1; //
      roamGroup.add(secondaryGlowSprite); //
    }

    // Add system glow markers for visited systems (excluding camp systems)
    systemOrder.forEach((system) => {
      //
      const systemIdInt = parseInt(system.id); //
      if (isNaN(systemIdInt)) return; // <<< DEBUG Skip if invalid
      const systemObj = solarSystems.get(systemIdInt); //
      // Check if this system also hosts a camp-like activity marker
      const hasCampMarker = Array.from(activityMarkers.values()).some(
        //
        (
          m //
        ) =>
          m.activityData.systemId === systemIdInt && //
          ["camp", "smartbomb", "roaming_camp", "battle"].includes(
            //
            m.activityData.classification //
          )
      );

      if (systemObj && !hasCampMarker) {
        //
        // Only add roam glow if no camp marker exists
        const glowMaterial = new THREE.SpriteMaterial({
          //
          map: glowTexture, //
          color: new THREE.Color(ROAM_COLOR), //
          transparent: true, //
          opacity: 0.6, //
          depthWrite: false, //
        });
        const glowSprite = new THREE.Sprite(glowMaterial); //
        glowSprite.position.copy(systemObj.position); //
        glowSprite.scale.set(8, 8, 1); // Roam system marker size
        roamGroup.add(glowSprite); //
      }
    });

    roamGroup.userData = {
      //
      type: "roam", //
      activityData: activity, //
      systems: systemOrder, // Store the ordered systems
      flashColor: FLASH_COLOR_ROAM, // Store flash color
      baseColor: ROAM_COLOR, // Store base color
    };
    return {
      //
      group: roamGroup, //
      activityData: activity, //
      mixer: null, // Roams don't use mixer currently
      lineMaterial: lineObject?.material, // Store material for animation
      lastKillId: latestKillId, //
      flashEndTime: 0, //
      secondaryGlow: secondaryGlowSprite, //
      secondaryGlowFlashEndTime: 0, //
      type: "roam", // Store type for update logic
    }; //
  } //

  // --- User Location Marker (remains mostly same) ---
  function updateUserLocationMarker(newUserLocation) {
    //
    if (!scene || !mounted || !mapReady) {
      // <<< Add mapReady check
      console.log(
        "[UniverseMap] updateUserLocationMarker skipped: Scene/Mount/Map not ready."
      ); // <<< DEBUG
      return;
    }
    console.log("[UniverseMap] Updating user location marker..."); // <<< DEBUG
    if (userLocationMarker.group) {
      //
      scene.remove(userLocationMarker.group); //
      disposeObject3D(userLocationMarker.group); //
      userLocationMarker = { group: null, mixer: null }; //
    }
    if (!newUserLocation || !newUserLocation.solar_system_id) {
      //
      console.log("[UniverseMap] No user location data provided."); // <<< DEBUG
      return;
    }
    const systemId = parseInt(newUserLocation.solar_system_id); //
    if (isNaN(systemId)) {
      // <<< DEBUG Check ID
      console.warn(
        `[UniverseMap] Invalid user location systemId: ${newUserLocation.solar_system_id}`
      );
      return;
    }
    const system = solarSystems.get(systemId); //
    if (!system) {
      //
      console.warn(
        `[UniverseMap] User location system ${systemId} not found in rendered map.`
      ); // <<< DEBUG
      return;
    }
    console.log(
      `[UniverseMap] User located in system: <span class="math-inline">\{system\.data\.itemname\} \(</span>{systemId})`
    ); // <<< DEBUG
    const markerGroup = new THREE.Group(); //
    markerGroup.position.copy(system.position); //
    const glowMaterial = new THREE.SpriteMaterial({
      //
      map: glowTexture, //
      color: new THREE.Color(USER_COLOR), //
      transparent: true, //
      opacity: 0.8, //
      depthWrite: false, //
    });
    const glowSprite = new THREE.Sprite(glowMaterial); //
    glowSprite.scale.set(15, 15, 1); //
    const ringGeometry = new THREE.RingGeometry(
      SYSTEM_SIZE * 0.4,
      SYSTEM_SIZE * 0.5,
      32
    ); // Adjusted size //
    const ringMaterial = new THREE.MeshBasicMaterial({
      //
      color: USER_COLOR, //
      side: THREE.DoubleSide, //
      transparent: true, //
      opacity: 0.8, //
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial); //
    ring.rotation.x = Math.PI / 2; // Rotate to be flat //
    const mixer = new THREE.AnimationMixer(glowSprite); //
    const initialScaleVal = glowSprite.scale.x; //
    const track = new THREE.KeyframeTrack( //
      ".scale", //
      [0, PULSE_DURATION / 2, PULSE_DURATION], //
      [
        //
        initialScaleVal, //
        initialScaleVal, //
        initialScaleVal, //
        initialScaleVal * 1.2, //
        initialScaleVal * 1.2, //
        initialScaleVal, //
        initialScaleVal, //
        initialScaleVal, //
        initialScaleVal, //
      ] //
    );
    const clip = new THREE.AnimationClip("userPulse", PULSE_DURATION, [track]); //
    const action = mixer.clipAction(clip); //
    action.setLoop(THREE.LoopRepeat); //
    action.play(); //
    markerGroup.add(glowSprite); //
    markerGroup.add(ring); //
    markerGroup.userData = {
      //
      type: "userLocation", //
      name: newUserLocation.systemName || system.data.itemname, //
      systemId: systemId, //
      mixer: mixer, //
    };
    scene.add(markerGroup); //
    userLocationMarker = { group: markerGroup, mixer: mixer }; //
  } //

  // --- Route Calculation & Visualization ---
  async function fetchEsiRoute(originId, destinationId) {
    //
    // **MODIFIED:** Use the server-side proxy
    console.log(
      //
      `[fetchEsiRoute] Fetching route via SERVER PROXY from ${originId} to ${destinationId}` //
    );
    // Construct the relative URL for the server proxy
    const url = `/api/route/${originId}/${destinationId}?flag=shortest`;
    console.log(`[fetchEsiRoute] Request URL (proxy): ${url}`); //
    try {
      // Use fetch to call the local server endpoint
      const response = await fetch(url, {
        //
        method: "GET", //
        headers: {
          //
          Accept: "application/json", //
          // No need for Cache-Control here, let the server handle it
        },
      });
      console.log(`[fetchEsiRoute] Proxy response status: ${response.status}`); //
      if (!response.ok) {
        //
        const errorText = await response.text(); //
        console.error(
          //
          `[fetchEsiRoute] Proxy route error ${response.status}: ${errorText} for URL: ${url}` //
        );
        // Try to parse the error from the server
        let serverError = `Failed to fetch route via proxy (${response.status})`; //
        try {
          const jsonError = JSON.parse(errorText); //
          serverError = jsonError.error || serverError; //
        } catch (e) {
          //
          /* ignore json parse error */
        }
        throw new Error(serverError); //
      }
      const routeData = await response.json(); //
      console.log(
        //
        `[fetchEsiRoute] Proxy route received: ${routeData.length} jumps`, //
        JSON.stringify(routeData) //
      );
      return routeData; //
    } catch (error) {
      //
      // Catch errors from the fetch call itself (e.g., server down)
      console.error(`[fetchEsiRoute] Error fetching route via proxy: ${error}`); //
      // Re-throw the error so calculateRoute can handle it
      throw new Error( //
        `Network error fetching route via proxy: ${error.message}` //
      );
    }
  } //

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
    dangerWarningsList = [];

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

  function createRouteVisualization(route) {
    // Accepts array of system IDs
    if (routeLines) {
      scene.remove(routeLines);
      disposeObject3D(routeLines);
      routeLines = null;
    }

    const group = new THREE.Group();
    const points = [];
    // const dangerSegmentsIndices = []; // <<< REMOVE THIS LINE

    for (let i = 0; i < route.length; i++) {
      const system = solarSystems.get(route[i]);
      if (system) {
        points.push(system.position.clone());
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
      linewidth: 2, // Note: linewidth > 1 might not work on all systems with WebGLRenderer
      transparent: true,
      opacity: 0.7,
    });
    const routeLine = new THREE.Line(routeGeometry, routeMaterial);
    group.add(routeLine);

    if (points.length > 0) {
      const startMarker = createRouteMarker(points[0], 0x00ff00); // Green
      const endMarker = createRouteMarker(points[points.length - 1], 0xffaa00); // Orange/Yellow for end
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
  // --- CHANGE: Update Route Danger Check to use unified activities ---

  function checkRouteForDangers(route) {
    // Note: Ensure 'dangerWarningsList' is declared as a top-level reactive variable
    // let dangerWarningsList = []; // <<< Should be declared outside this function

    const newWarnings = []; // Build a new list for this check
    const dangerLinesGroup = new THREE.Group(); // Group for danger lines specifically

    for (let i = 0; i < route.length; i++) {
      const systemId = route[i];
      const system = solarSystems.get(systemId);
      if (!system) continue;

      let systemMarkedDangerous = false;
      let dangerType = "unknown"; // To store the type for coloring the segment

      // Check unified activity markers
      for (const markerObj of activityMarkers.values()) {
        const activity = markerObj.activityData;
        let isActivityHere = false;
        let currentActivityClassification = null;

        // Check if activity involves the current route system
        // Use parseInt for robust comparison if IDs might be strings
        const currentSystemIdInt = parseInt(systemId);
        const activitySystemIdInt = activity.systemId
          ? parseInt(activity.systemId)
          : NaN;
        const activityLastSystemIdInt = activity.lastSystem?.id
          ? parseInt(activity.lastSystem.id)
          : NaN;

        if (
          (!isNaN(activitySystemIdInt) &&
            activitySystemIdInt === currentSystemIdInt) ||
          (!isNaN(activityLastSystemIdInt) &&
            activityLastSystemIdInt === currentSystemIdInt) ||
          (activity.systems &&
            activity.systems.some(
              (s) => s.id && parseInt(s.id) === currentSystemIdInt
            ))
        ) {
          isActivityHere = true;
          currentActivityClassification = activity.classification;
        }

        if (isActivityHere) {
          // Check if it's a dangerous classification
          if (
            ["camp", "smartbomb", "roaming_camp", "battle"].includes(
              currentActivityClassification
            )
          ) {
            systemMarkedDangerous = true;
            dangerType = currentActivityClassification; // Store the specific type

            let warningText = ""; // Basic text description
            if (
              dangerType === "camp" ||
              dangerType === "smartbomb" ||
              dangerType === "roaming_camp"
            ) {
              warningText = `${dangerType.replace("_", " ")}`; // Will add details in template
            } else if (dangerType === "battle") {
              warningText = `Battle`; // Will add details in template
            }

            const warning = {
              type: dangerType,
              systemName: system.data.itemname || `System ${systemId}`,
              details: warningText,
              systemId: systemId,
              // Add probability/pilot count for template usage
              probability:
                dangerType !== "battle" && activity.probability
                  ? Math.round(activity.probability || 0)
                  : null,
              pilots:
                dangerType === "battle"
                  ? activity.metrics?.partyMetrics?.characters || 0
                  : null,
            };
            // Avoid duplicate warnings for the same system ID within this check
            if (!newWarnings.some((w) => w.systemId === systemId)) {
              newWarnings.push(warning);
            }
            break; // Mark system as dangerous and move to next activity marker check for this system
          }
          // Check if a 'roam' is currently in this system
          else if (
            currentActivityClassification === "roam" &&
            !isNaN(activityLastSystemIdInt) &&
            activityLastSystemIdInt === currentSystemIdInt
          ) {
            systemMarkedDangerous = true; // Still mark segment
            dangerType = "roam"; // Specific type for segment color

            const warning = {
              type: "roam",
              systemName: system.data.itemname || `System ${systemId}`,
              details: `Roaming gang`, // Simple text
              systemId: systemId,
              pilots: activity.members?.size || 0, // Add pilot count
            };
            // Avoid duplicate warnings for the same system ID within this check
            if (!newWarnings.some((w) => w.systemId === systemId)) {
              newWarnings.push(warning);
            }
            break; // Mark system as dangerous and move to next activity marker check for this system
          }
        }
      } // End loop through activityMarkers

      // If the *current* system (i) is marked dangerous, draw the line segment *from previous (i-1) to current (i)*
      if (systemMarkedDangerous && i > 0) {
        const prevSystem = solarSystems.get(route[i - 1]);
        if (prevSystem) {
          const dangerPoints = [
            prevSystem.position.clone(),
            system.position.clone(),
          ];
          const dangerGeometry = new THREE.BufferGeometry().setFromPoints(
            dangerPoints
          );
          let segmentColor = DANGER_ROUTE_COLOR; // Default orange

          // Assign specific colors based on the primary danger type found
          if (dangerType === "roam") segmentColor = ROAM_COLOR;
          else if (dangerType === "battle") segmentColor = BATTLE_COLOR;
          else if (dangerType === "smartbomb") segmentColor = SMARTBOMB_COLOR;
          else if (dangerType === "roaming_camp")
            segmentColor = ROAMING_CAMP_COLOR;
          // Camp uses default DANGER_ROUTE_COLOR

          const dangerMaterial = new THREE.LineBasicMaterial({
            color: segmentColor,
            linewidth: 3, // Make danger lines slightly thicker
            transparent: true,
            opacity: 0.9,
            depthTest: false, // Draw on top of other lines if possible
          });
          const dangerLine = new THREE.Line(dangerGeometry, dangerMaterial);
          dangerLine.renderOrder = 1; // Attempt to render over the base route line
          dangerLinesGroup.add(dangerLine);
        }
      }
    } // End loop through route systems

    // --- UPDATE the reactive variable ---
    dangerWarningsList = newWarnings; // Assign the newly generated list of warning objects

    // Add the group of danger lines to the main routeLines group if it exists
    if (routeLines) {
      // Ensure old danger lines are removed first if route is recalculated
      const oldDangerGroup = routeLines.getObjectByName("dangerSegments");
      if (oldDangerGroup) {
        routeLines.remove(oldDangerGroup);
        disposeObject3D(oldDangerGroup); // Dispose old geometry/material
      }
      // Add the new group if there are any danger segments
      if (dangerLinesGroup.children.length > 0) {
        dangerLinesGroup.name = "dangerSegments"; // Name it for easy removal later
        routeLines.add(dangerLinesGroup);
        console.log(
          `[checkRouteForDangers] Added ${dangerLinesGroup.children.length} danger segments visualization.`
        );
      }
    } else if (newWarnings.length > 0) {
      // Only warn if there were dangers but no route line to attach to
      console.warn(
        "[checkRouteForDangers] routeLines group does not exist, cannot add danger segments visualization."
      );
    }
  }
  // --- END CHANGE ---
  function showDangerWarnings(warningsHtmlList) {
    if (!dangerTooltip) return;
    dangerTooltip.innerHTML = `<div class="danger-header">⚠️ Route Dangers</div><ul class="danger-list">${warningsHtmlList}</ul>`;
    if (!dangerTooltip.parentElement) container.appendChild(dangerTooltip);
    dangerTooltip.style.display = "block";
    setTimeout(() => {
      if (dangerTooltip) dangerTooltip.style.display = "none";
    }, 10000);
  }

  // --- UI Interaction & View Helpers (remain mostly the same) ---
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
    //
    console.log("[UniverseMap] Setting initial camera position..."); // <<< DEBUG
    if (galaxySize === 0 || !galaxyCenter) {
      //
      console.warn(
        "[UniverseMap] Cannot set initial camera: Galaxy bounds not calculated."
      ); // <<< DEBUG
      camera.position.set(0, 50, 0); // Sensible default fallback
      controls.target.set(0, 0, 0);
      controls.update();
      return;
    }
    const distance = galaxySize * 1.5; //
    camera.position.set(
      //
      galaxyCenter.x, //
      distance, // Position camera directly above center along Y
      galaxyCenter.z //
    );
    camera.lookAt(galaxyCenter); //
    controls.target.copy(galaxyCenter); //
    controls.update(); //
    console.log(
      "[UniverseMap] Camera positioned at:",
      camera.position,
      "Target:",
      controls.target
    ); // <<< DEBUG
  } //
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
  // In your NEWEST code file, replace the toggleColorMode function with this OLD logic:
  async function toggleColorMode() {
    // Added async for potential future use, not strictly needed now
    colorByRegion = !colorByRegion;
    console.log(
      `[UniverseMap] Toggled color mode. Color by region: ${colorByRegion}`
    );

    if (mapData && mapData.length > 0) {
      console.log("[UniverseMap] Rebuilding map for color toggle...");
      buildMap(mapData); // Call buildMap to apply new colors correctly

      // Re-apply route visualization if a route exists
      if (currentRoute.length > 0) {
        console.log(
          "[UniverseMap] Re-applying route visualization after color toggle."
        );
        createRouteVisualization(currentRoute);
        checkRouteForDangers(currentRoute); // Re-check dangers and apply overlays
      }
      // Re-apply user location marker visualization
      if (userLocation) {
        console.log(
          "[UniverseMap] Re-applying user location marker after color toggle."
        );
        updateUserLocationMarker(userLocation); // Ensure marker is present
      }
      // Re-apply activity markers
      if (activities && activities.length > 0) {
        console.log(
          "[UniverseMap] Re-applying activity markers after color toggle."
        );
        updateActivityVisualizations(activities); // Redraw activities
      }
    } else {
      console.warn(
        "[UniverseMap] Cannot rebuild map for color toggle: mapData is missing."
      );
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

  function startEllipsisAnimation() {
    if (ellipsisInterval) clearInterval(ellipsisInterval); // Clear previous interval if any
    loadingEllipsis = "."; // Reset to initial state
    ellipsisInterval = setInterval(() => {
      // Cycle through '.', '..', '...'
      if (loadingEllipsis.length < 3) {
        loadingEllipsis += ".";
      } else {
        loadingEllipsis = ".";
      }
    }, 500); // Adjust speed (milliseconds) as desired
  }

  function stopEllipsisAnimation() {
    if (ellipsisInterval) {
      clearInterval(ellipsisInterval);
      ellipsisInterval = null;
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
  // --- Animation Loop ---
  function animate(time) {
    //
    if (!mounted) return; //
    frameId = requestAnimationFrame(animate); //

    const now = clock.getElapsedTime(); // Use THREE.Clock for consistent time
    const deltaTime = now - lastAnimationTime; //
    lastAnimationTime = now; //

    // --- CHANGE: Update unified activity markers ---
    activityMarkers.forEach((markerObj) => {
      //
      // Update mixer if it exists (for camp-style pulse animation)
      if (markerObj.mixer) markerObj.mixer.update(deltaTime); //

      // Find relevant visual components for this marker
      // Note: Not all markers have all components
      const glowSprite = markerObj.group?.children.find(
        // Primary glow for camp-style
        (c) =>
          c.isSprite &&
          c.material.map === glowTexture &&
          c !== markerObj.secondaryGlow
      );
      const secondaryGlow = markerObj.secondaryGlow; // Secondary glow for all types
      const activity = markerObj.activityData; // The raw activity data

      // Determine colors based on classification stored in markerObj when created/updated
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
          flashColor = FLASH_COLOR_ROAM; // Flash color for roam
          baseColor = ROAM_COLOR; // Base color for roam
          secondaryBaseOpacity = 0.1;
          secondaryFlashOpacityBoost = 0.3;
          break;
      }

      // --- Handle Flashing State (if flashEndTime is active) ---
      if (markerObj.flashEndTime > 0 && markerObj.flashEndTime > now) {
        const flashProgress = Math.max(
          0,
          1 - (markerObj.flashEndTime - now) / FLASH_DURATION
        );
        const flashSine = Math.sin(flashProgress * Math.PI); // Ease in/out effect

        // Flash primary visual (glowSprite for camps, lineMat for roams)
        if (glowSprite) {
          // Camp-style flash logic (scale, color, opacity)
          const baseScale = markerObj.group.userData.baseGlowSize || 10;
          const flashScaleMultiplier = 1 + flashSine * 1.0; // Adjusted flash size multiplier
          glowSprite.scale.setScalar(baseScale * flashScaleMultiplier);
          glowSprite.material.color.lerpColors(
            new THREE.Color(flashColor),
            new THREE.Color(baseColor),
            flashProgress // Interpolate color based on progress
          );
          glowSprite.material.opacity = 0.9 + flashSine * 0.1; // Flash opacity slightly
        } else if (markerObj.type === "roam" && markerObj.lineMaterial) {
          // --- Roam line FLASH logic ---
          const lineMat = markerObj.lineMaterial; // Get material
          lineMat.opacity = 1.0; // Keep full opacity during flash
          lineMat.color.lerpColors(
            new THREE.Color(flashColor), // Use roam's specific flash color
            new THREE.Color(baseColor), // Use roam's specific base color
            flashProgress // Interpolate color based on progress
          );
          // --- End Roam line FLASH logic ---
        }

        // Flash secondary glow (common to most types)
        if (secondaryGlow) {
          secondaryGlow.material.opacity =
            secondaryBaseOpacity + flashSine * secondaryFlashOpacityBoost;
        }
      }
      // --- Handle Normal State / Pulse ---
      else {
        // Reset flash time if it just ended in this frame
        if (markerObj.flashEndTime > 0 && markerObj.flashEndTime <= now) {
          markerObj.flashEndTime = 0;
        }

        // Apply normal state / pulse animation
        if (glowSprite) {
          // Camp-style markers: Reset properties potentially changed by flash/mixer
          // Mixer handles the scale pulse, just ensure color/opacity are correct
          glowSprite.material.color.set(baseColor); // Reset color
          glowSprite.material.opacity = Math.min(
            0.8,
            (activity?.probability || 0) / 100 // Base opacity based on probability
          );
          // Base scale is reset by the mixer animation action if running
          if (!markerObj.mixer?.clipAction?.("pulse")?.isRunning()) {
            const baseScale = markerObj.group?.userData?.baseGlowSize || 10;
            glowSprite.scale.setScalar(baseScale); // Fallback scale reset
          }
        } else if (markerObj.type === "roam" && markerObj.lineMaterial) {
          // --- Roam line PULSE logic ---
          const lineMat = markerObj.lineMaterial; // Get the material
          const pulseSpeed = 4; // Adjust speed of the pulse
          const minOpacity = 0.6; // Minimum opacity during pulse (e.g., 60%)
          const maxOpacity = 1.0; // Maximum opacity (should match base opacity set in create function)

          // Calculate a value oscillating between 0 and 1
          const pulseFactor = (Math.sin(now * pulseSpeed) + 1) / 2;

          // Modulate opacity between minOpacity and maxOpacity
          lineMat.opacity =
            minOpacity + pulseFactor * (maxOpacity - minOpacity);

          // Ensure base color is set (no color pulsing needed based on request)
          lineMat.color.set(ROAM_COLOR);
          // --- End Roam line PULSE logic ---
        }

        // Pulse secondary glow (common to most types)
        if (secondaryGlow) {
          const pulseFactorSec = (Math.sin(now * 3) + 1) / 2; // Slower pulse
          secondaryGlow.material.opacity =
            secondaryBaseOpacity + pulseFactorSec * 0.2; // Pulse base opacity slightly
        }
      }
    });
    // --- END CHANGE for activity marker update ---

    // Update user location marker animation
    if (userLocationMarker.mixer) userLocationMarker.mixer.update(deltaTime);

    // Ensure region labels remain visible
    regionLabelCache.forEach((cacheEntry) => {
      if (cacheEntry.label) cacheEntry.label.visible = true;
    });

    // Update controls and render the scene
    if (controls) controls.update();
    if (renderer && camera) renderer.render(scene, camera);
    if (labelRenderer && camera) labelRenderer.render(scene, camera);
  } // End animate function
</script>

<div class="universe-map-container">
  {#if isLoading}
    <div class="loading">
      Loading map{loadingEllipsis}
    </div>
  {/if}
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
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div class="close-btn" on:click={clearSelection}>×</div>
      <h3>{selectedSystem.itemname}</h3>
      <div class="info-row">
        <span>Security:</span>
        <span
          class="security"
          style="color: {new THREE.Color(
            getSecurityColor(selectedSystem.security) //
          ).getStyle()}"
        >
          {selectedSystem.security !== null //
            ? selectedSystem.security.toFixed(1) //
            : "N/A"} ({getSecurityDescription(selectedSystem.security)})
        </span>
      </div>
      <div class="info-row">
        <span>Region:</span>
        <span
          >{regions.find((r) => r.id === selectedSystem.regionid)?.name || //
            "Unknown"}</span
        >
      </div>
      <div class="info-row">
        <span>System ID:</span> <span>{selectedSystem.itemid}</span>
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
              title={classificationTooltips[ //
                selectedActivityData.classification //
              ] || "Activity"}
            >
              {classificationIcons[selectedActivityData.classification] || "?"}
            </span>
            {#if selectedActivityData.classification === "camp" || selectedActivityData.classification === "smartbomb" || selectedActivityData.classification === "roaming_camp"}
              {classificationTooltips[selectedActivityData.classification]} ({Math.round(
                //
                selectedActivityData.probability //
              )}% conf.)
            {:else if selectedActivityData.classification === "battle"}
              {classificationTooltips[selectedActivityData.classification]} ({selectedActivityData //
                .metrics?.partyMetrics?.characters || 0} pilots)
            {:else if selectedActivityData.classification === "roam"}
              {classificationTooltips[selectedActivityData.classification]} ({selectedActivityData //
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
  <div class="map-view" bind:this={container}></div>

  {#if dangerWarningsList.length > 0}
    <div class="danger-tooltip-reactive">
      <div class="danger-header">
        ⚠️ Route Dangers
        <button
          class="close-danger"
          on:click={() => (dangerWarningsList = [])}
          title="Dismiss Warnings">×</button
        >
      </div>
      <ul class="danger-list">
        {#each dangerWarningsList as warning (warning.systemId)}
          <li
            class="{warning.type}-warning"
            title="System ID: {warning.systemId}"
          >
            <strong>{warning.systemName}:</strong>
            {#if warning.type === "camp" || warning.type === "smartbomb" || warning.type === "roaming_camp"}
              {warning.details} ({warning.probability}% confidence)
            {:else if warning.type === "battle"}
              {warning.details} ({warning.pilots} pilots)
            {:else if warning.type === "roam"}
              {warning.details} ({warning.pilots} pilots)
            {:else}
              {warning.details}
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<ContextMenu
  show={contextMenu.show}
  x={contextMenu.x}
  y={contextMenu.y}
  options={contextMenu.options}
  on:select={handleMenuSelect}
/>

<style>
  /* --- Base Container & Controls --- */
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
    width: 100%; /* Use available width */
    box-sizing: border-box; /* Include padding/border in width */
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

  /* --- Info Panel Styling (Bottom Left) --- */
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
    box-shadow: 0 0 15px rgba(0, 255, 255, 0.2);
    backdrop-filter: blur(2px); /* Optional blur */
  }
  .close-btn {
    position: absolute;
    top: 8px; /* Adjust position */
    right: 8px; /* Adjust position */
    width: 22px;
    height: 22px;
    background-color: rgba(150, 50, 50, 0.7); /* Less intense red */
    color: white;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border: 1px solid rgba(255, 100, 100, 0.5);
    line-height: 1;
    padding: 0;
    font-size: 16px;
    font-weight: bold;
    transition: background-color 0.2s;
  }
  .close-btn:hover {
    background-color: rgba(200, 50, 50, 0.9);
  }
  .system-info-panel h3 {
    color: #00ffff;
    margin: 0 0 12px 0; /* Increased bottom margin */
    padding-right: 25px; /* Space for close button */
    font-size: 17px; /* Slightly larger */
    border-bottom: 1px solid rgba(0, 255, 255, 0.2); /* Separator */
    padding-bottom: 8px; /* Space below title */
  }
  .info-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 6px; /* Slightly more space */
    font-size: 14px;
  }
  .info-row span:first-child {
    color: #aaa; /* Dimmer label */
    margin-right: 10px;
  }
  .info-row span:last-child {
    color: white;
    text-align: right;
  }
  /* Activity Indicator Styles within Info Panel */
  .info-row.danger {
    /* Style the row containing activity */
    background-color: rgba(50, 50, 50, 0.2); /* Subtle background */
    padding: 4px 6px;
    border-radius: 4px;
    margin-top: 8px;
    border-left: 3px solid; /* Add left border color dynamically */
  }
  .camp-indicator,
  .smartbomb-indicator,
  .roaming_camp-indicator,
  .battle-indicator,
  .roam-indicator {
    display: inline-flex;
    align-items: center;
    font-weight: bold;
    /* Colors applied via specific classes below */
  }
  .info-row.danger.camp-indicator {
    border-left-color: #ff3333;
  }
  .info-row.danger.smartbomb-indicator {
    border-left-color: #ff9933;
  }
  .info-row.danger.roaming_camp-indicator {
    border-left-color: #ff8c00;
  }
  .info-row.danger.battle-indicator {
    border-left-color: #cc00cc;
  }
  .info-row.danger.roam-indicator {
    border-left-color: #3333ff;
  }

  .camp-indicator span {
    color: #ff3333;
  }
  .smartbomb-indicator span {
    color: #ff9933;
  }
  .roaming_camp-indicator span {
    color: #ff8c00;
  }
  .battle-indicator span {
    color: #cc00cc;
  }
  .roam-indicator span {
    color: #3333ff;
  }

  .icon {
    margin-right: 6px;
    font-size: 1.1em;
    line-height: 1; /* Prevent extra vertical space */
  }
  /* Action Buttons */
  .action-buttons {
    margin-top: 15px;
    display: flex;
    gap: 10px;
    border-top: 1px solid rgba(0, 255, 255, 0.2); /* Separator */
    padding-top: 15px; /* Space above buttons */
  }
  .action-buttons button {
    flex-grow: 1;
    background-color: rgba(0, 255, 255, 0.2);
    color: #00ffff;
    border: 1px solid rgba(0, 255, 255, 0.5);
    padding: 7px 10px; /* Slightly adjusted padding */
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    transition:
      background-color 0.2s,
      color 0.2s;
  }
  .action-buttons button:hover:not(:disabled) {
    background-color: rgba(0, 255, 255, 0.4);
    color: #ffffff;
  }
  .action-buttons button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background-color: rgba(100, 100, 100, 0.2);
    border-color: rgba(100, 100, 100, 0.5);
    color: #888;
  }

  /* --- Map View & Loading/Error States --- */
  .map-view {
    width: 100%;
    height: 100%;
    background-color: #000; /* Base background */
  }
  .loading {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: white;
    background-color: rgba(0, 0, 0, 0.8); /* Background helps visibility */
    padding: 20px 30px;
    border-radius: 8px; /* Keep rounded corners */
    z-index: 20;
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.5); /* Keep shadow for contrast */
    text-align: center;
    font-size: 1.2em;
    white-space: nowrap;
  }
  .loading,
  .error {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: white;
    background-color: rgba(0, 0, 0, 0.8); /* Darker background */
    padding: 20px 30px; /* More padding */
    border-radius: 8px;
    z-index: 20;
    border: 1px solid rgba(255, 255, 255, 0.2);
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
    text-align: center;
  }
  .error {
    color: #ff6b6b; /* Error color */
    border-color: rgba(255, 107, 107, 0.5);
  }

  /* --- THREE.js CSS2D Labels --- */
  :global(.system-label) {
    color: white;
    font-size: 11px; /* Slightly smaller */
    padding: 1px 4px; /* Tighter padding */
    background-color: rgba(0, 0, 0, 0.75); /* More opaque */
    border-radius: 3px;
    white-space: nowrap;
    pointer-events: none; /* Allow clicks to pass through */
    user-select: none; /* Prevent text selection */
    border: 1px solid rgba(255, 255, 255, 0.2); /* Subtle border */
  }
  :global(.region-label) {
    font-size: 18px; /* Larger region labels */
    font-weight: bold;
    padding: 4px 8px;
    background-color: rgba(0, 0, 0, 0.6); /* Background for contrast */
    border-radius: 4px;
    white-space: nowrap;
    pointer-events: none;
    user-select: none;
    text-shadow:
      0 0 4px black,
      0 0 4px black; /* Stronger shadow */
    /* Color is set dynamically via style attribute */
    border: 1px solid rgba(255, 255, 255, 0.1); /* Very subtle border */
  }

  /* --- Reactive Danger Warnings Box (Bottom Right) --- */
  .danger-tooltip-reactive {
    position: absolute;
    bottom: 20px;
    right: 20px;
    background: rgba(10, 0, 0, 0.85); /* Darker background */
    border: 1px solid #ff6600;
    border-radius: 5px;
    padding: 10px 15px;
    color: #ddd;
    font-family: sans-serif;
    font-size: 13px;
    max-width: 300px;
    max-height: 200px; /* Limit height */
    overflow-y: auto; /* Add scrollbar if needed */
    z-index: 1000;
    box-shadow: 0 0 10px rgba(255, 102, 0, 0.5);
    backdrop-filter: blur(2px);
  }
  .danger-header {
    font-weight: bold;
    font-size: 16px;
    margin-bottom: 8px;
    color: #ffaa00; /* Header color */
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 5px;
    border-bottom: 1px solid rgba(255, 102, 0, 0.3); /* Separator line */
  }
  .close-danger {
    background: none;
    border: none;
    color: #aaa;
    font-size: 20px;
    line-height: 1;
    padding: 0 5px;
    cursor: pointer;
    transition: color 0.2s;
  }
  .close-danger:hover {
    color: white;
  }
  .danger-list {
    margin: 0;
    padding: 0 0 0 5px; /* List padding */
    list-style: none;
  }
  .danger-list li {
    margin-bottom: 5px; /* Space between items */
    position: relative;
    padding-left: 15px; /* Space for the colored dot */
    line-height: 1.4;
  }
  /* Colored dot marker for each list item */
  .danger-list li::before {
    content: "";
    position: absolute;
    left: 0;
    top: 6px; /* Align dot vertically */
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: #ff3333; /* Default: Camp color */
  }
  /* Specific dot colors for different warning types */
  .smartbomb-warning::before {
    background-color: #ff9933;
  } /* SMARTBOMB_COLOR */
  .roaming_camp-warning::before {
    background-color: #ff8c00;
  } /* ROAMING_CAMP_COLOR */
  .battle-warning::before {
    background-color: #cc00cc;
  } /* BATTLE_COLOR */
  .roam-warning::before {
    background-color: #3333ff;
  } /* ROAM_COLOR */

  .danger-list strong {
    color: #eee; /* System name color */
    font-weight: 600;
    margin-right: 4px;
  }
</style>
