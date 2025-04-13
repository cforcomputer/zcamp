<script>
  import { onMount, onDestroy } from "svelte";
  import * as THREE from "three";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import {
    CSS2DRenderer,
    CSS2DObject,
  } from "three/examples/jsm/renderers/CSS2DRenderer.js";

  let container;
  let scene, camera, renderer, labelRenderer, controls;
  let solarSystems = new Map();
  let stargateConnections = [];
  let mapData = [];
  let isLoading = true;
  let error = null;
  let searchTerm = "";
  let selectedSystem = null;
  let regionMeshes = [];
  let colorByRegion = false; // Option for coloring
  let regions = []; // Added declaration

  // Galaxy bounds tracking
  let galaxyCenter = new THREE.Vector3();
  let galaxySize = 0;

  // Raycasting for interaction
  let raycaster;
  let mouse;
  let clock = new THREE.Clock();
  let lastClickTime = 0;

  // Constants
  const SCALE_FACTOR = 1e-14; // Scale down universe coordinates
  const SYSTEM_SIZE = 2.5; // Increased for better visibility
  const HIGH_SEC_COLOR = 0x00ff00; // Green
  const LOW_SEC_COLOR = 0xffff00; // Yellow
  const NULL_SEC_COLOR = 0xff0000; // Red
  const CONNECTION_COLOR = 0x00ffff; // Cyan
  const DOUBLE_CLICK_TIME = 300; // ms
  const REGION_PADDING = 15; // Padding around regions to make them more blob-like

  // Region colors - generate more unique colors
  const regionColors = [
    0x3498db, 0x9b59b6, 0x2ecc71, 0xe74c3c, 0xf1c40f, 0x1abc9c, 0xd35400,
    0x34495e, 0x95a5a6, 0x16a085, 0x27ae60, 0x2980b9, 0x8e44ad, 0xe67e22,
    0xc0392b, 0xf39c12, 0xd35400, 0x7f8c8d, 0xbdc3c7, 0x7d3c98, 0xb3b6b7,
    0x2874a6, 0x138d75, 0xba4a00, 0x566573, 0xd4ac0d, 0xca6f1e, 0x48c9b0,
    0xf5b041, 0xa569bd, 0x5d6d7e, 0x45b39d, 0xf4d03f, 0xaf7ac5, 0x5499c7,
    0x48c9b0, 0xeb984e, 0xcd6155, 0x5d6d7e, 0xf7dc6f, 0x85c1e9, 0x73c6b6,
  ];

  // Create a circular texture for the points
  let circleTexture;

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

  onMount(async () => {
    try {
      console.log("Component mounted, initializing map...");
      // Create the circle texture
      circleTexture = createCircleTexture();

      await initializeMap();

      window.addEventListener("resize", handleResize);
      container.addEventListener("mousemove", onMouseMove);
      container.addEventListener("click", onClick);
      container.addEventListener("dblclick", onDoubleClick);
    } catch (err) {
      console.error("Error initializing map:", err);
      error = err.message || "Failed to initialize map";
    } finally {
      isLoading = false;
    }
  });

  onDestroy(() => {
    if (renderer) renderer.dispose();
    if (labelRenderer) labelRenderer.domElement.remove();
    if (controls) controls.dispose();
    if (circleTexture) circleTexture.dispose();

    window.removeEventListener("resize", handleResize);
    if (container) {
      container.removeEventListener("mousemove", onMouseMove);
      container.removeEventListener("click", onClick);
      container.removeEventListener("dblclick", onDoubleClick);
    }
  });

  async function initializeMap() {
    try {
      console.log("Client: Loading map data...");
      const response = await fetch("/api/map-data");
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      mapData = await response.json();
      console.log(`Client: Received ${mapData.length} map entries`);

      if (mapData.length === 0) {
        throw new Error("No map data received from server");
      }

      if (mapData.length > 0) {
        console.log("Client: Sample entry:", mapData[0]);
      }

      // Extract regions for filtering - using lowercase column names
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
      animate();
    } catch (err) {
      console.error("Error initializing map:", err);
      error = err.message || "Failed to initialize map";
      throw err;
    }
  }

  function initThreeJS() {
    console.log("Initializing Three.js...");

    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000011);

    // Create camera
    camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      1000000 // Increased far plane for better viewing
    );
    camera.position.set(0, 0, 50);

    // Create renderer
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    // Create label renderer
    labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(container.clientWidth, container.clientHeight);
    labelRenderer.domElement.style.position = "absolute";
    labelRenderer.domElement.style.top = "0";
    labelRenderer.domElement.style.pointerEvents = "none";
    container.appendChild(labelRenderer.domElement);

    // Add controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.rotateSpeed = 0.5;
    controls.panSpeed = 0.8;
    controls.zoomSpeed = 1.2;
    controls.maxDistance = 1000;

    // Restrict rotation to top-down view only (2D)
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = 0;
    controls.enableRotate = false;

    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    // Initialize raycaster
    raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 3; // Increased for easier selection
    mouse = new THREE.Vector2();

    console.log("Three.js initialized successfully");
  }

  function handleResize() {
    if (camera && renderer && labelRenderer) {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
      labelRenderer.setSize(container.clientWidth, container.clientHeight);
    }
  }

  function calculateGalaxyBounds() {
    // Calculate the center and size of the galaxy for proper camera positioning
    if (solarSystems.size === 0) return;

    const positions = [];
    solarSystems.forEach((system) => {
      positions.push(system.position);
    });

    // Calculate bounding box
    const boundingBox = new THREE.Box3().setFromPoints(positions);
    boundingBox.getCenter(galaxyCenter);
    galaxySize = boundingBox.getSize(new THREE.Vector3()).length();

    console.log("Galaxy bounds calculated:", {
      center: galaxyCenter,
      size: galaxySize,
    });
  }

  function setInitialCameraPosition() {
    if (galaxySize === 0) return;

    // Position camera to see the entire galaxy - top-down view
    const distance = galaxySize * 0.9; // Adjusted zoom as requested
    camera.position.set(galaxyCenter.x, distance, galaxyCenter.z);
    camera.lookAt(galaxyCenter);
    controls.target.copy(galaxyCenter);

    console.log("Camera positioned at:", camera.position);
  }

  // Create a smooth region shape with padding
  function createRegionBackgrounds(systems) {
    // Only create backgrounds when coloring by region
    if (!colorByRegion) return;

    // Group systems by region
    const regionSystems = new Map();

    systems.forEach((system) => {
      const regionId = system.regionid;
      if (!regionSystems.has(regionId)) {
        regionSystems.set(regionId, []);
      }
      regionSystems.get(regionId).push({
        x: system.x * SCALE_FACTOR,
        y: 0, // Always 0 for 2D
        z: system.z * SCALE_FACTOR,
      });
    });

    // Create smooth backgrounds for each region
    regionSystems.forEach((positions, regionId) => {
      if (positions.length < 3) return; // Need at least 3 points

      const region = regions.find((r) => r.id === regionId);
      if (!region) return;

      // Create a 2D projection of points
      const points2D = positions.map((p) => new THREE.Vector2(p.x, p.z));

      // Create a smooth shape using concave hull algorithm
      const hullPoints = calculateConcaveHull(points2D, REGION_PADDING);

      if (hullPoints.length < 3) return; // Need at least 3 points to form a shape

      // Create a smooth shape
      const shape = new THREE.Shape();

      // Start at the first point
      shape.moveTo(hullPoints[0].x, hullPoints[0].y);

      // Add curves between points for smoother shape
      for (let i = 1; i < hullPoints.length; i += 1) {
        const prev = hullPoints[i - 1];
        const current = hullPoints[i];

        // Use quadratic curves for smoother shape
        if (i % 2 === 0) {
          shape.lineTo(current.x, current.y);
        } else {
          // Find control point for quadratic curve (midpoint with slight offset)
          const midX = (prev.x + current.x) / 2;
          const midY = (prev.y + current.y) / 2;
          const dx = current.x - prev.x;
          const dy = current.y - prev.y;
          const offsetX = -dy * 0.2; // Perpendicular offset for smoother curve
          const offsetY = dx * 0.2;

          shape.quadraticCurveTo(
            midX + offsetX,
            midY + offsetY,
            current.x,
            current.y
          );
        }
      }

      // Close the shape to first point
      shape.closePath();

      // Create geometry and mesh
      const geometry = new THREE.ShapeGeometry(shape);
      const material = new THREE.MeshBasicMaterial({
        color: region.color,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = -0.1; // Slightly below systems
      mesh.rotation.x = Math.PI / 2; // Rotate to lie on the x-z plane
      mesh.userData.regionId = regionId;

      scene.add(mesh);
      regionMeshes.push(mesh);
    });
  }

  // Calculate a concave hull that encloses the points with a padding
  function calculateConcaveHull(points, padding = 0) {
    if (points.length < 3) return points;

    // First calculate a convex hull to get a simpler shape
    const convexHull = calculateConvexHull(points);

    // If we have a very simple region, just add padding to the convex hull
    if (points.length < 10 || convexHull.length < 5) {
      return addPaddingToHull(convexHull, padding);
    }

    // Expand the hull by padding amount
    const paddedHull = addPaddingToHull(convexHull, padding);

    return paddedHull;
  }

  // Calculate a convex hull of points using Graham scan
  function calculateConvexHull(points) {
    // Need at least 3 points to make a hull
    if (points.length < 3) return points;

    // Find the point with the lowest y-coordinate (and leftmost if tied)
    let lowestPoint = points[0];
    for (let i = 1; i < points.length; i++) {
      if (
        points[i].y < lowestPoint.y ||
        (points[i].y === lowestPoint.y && points[i].x < lowestPoint.x)
      ) {
        lowestPoint = points[i];
      }
    }

    // Sort the points by polar angle relative to the lowest point
    const sortedPoints = points.slice();
    sortedPoints.sort((a, b) => {
      // Calculate polar angles
      const angleA = Math.atan2(a.y - lowestPoint.y, a.x - lowestPoint.x);
      const angleB = Math.atan2(b.y - lowestPoint.y, b.x - lowestPoint.x);

      if (angleA === angleB) {
        // If same angle, sort by distance
        const distA = (a.x - lowestPoint.x) ** 2 + (a.y - lowestPoint.y) ** 2;
        const distB = (b.x - lowestPoint.x) ** 2 + (b.y - lowestPoint.y) ** 2;
        return distA - distB;
      }

      return angleA - angleB;
    });

    // Build the hull
    const hull = [sortedPoints[0], sortedPoints[1]];

    for (let i = 2; i < sortedPoints.length; i++) {
      while (
        hull.length > 1 &&
        !isLeftTurn(
          hull[hull.length - 2],
          hull[hull.length - 1],
          sortedPoints[i]
        )
      ) {
        hull.pop();
      }
      hull.push(sortedPoints[i]);
    }

    return hull;
  }

  // Check if three points make a left turn (cross product > 0)
  function isLeftTurn(p1, p2, p3) {
    return (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x) > 0;
  }

  // Add padding to a hull of points
  function addPaddingToHull(hull, padding) {
    if (hull.length < 3) return hull;

    // Find the center of the hull
    const center = new THREE.Vector2();
    hull.forEach((p) => center.add(p));
    center.divideScalar(hull.length);

    // Create padded hull by expanding outward from center
    return hull.map((p) => {
      const dir = new THREE.Vector2().subVectors(p, center).normalize();
      return new THREE.Vector2(p.x + dir.x * padding, p.y + dir.y * padding);
    });
  }

  function buildMap() {
    console.log("Building map...");

    // Clear existing objects
    scene.children.forEach((child) => {
      if (child.type !== "AmbientLight" && child.type !== "DirectionalLight") {
        scene.remove(child);
      }
    });

    solarSystems.clear();
    stargateConnections = [];
    regionMeshes = [];

    // Extract solar systems - using lowercase column names
    const solarSystemsData = mapData.filter((item) => item.typeid === 5);
    console.log(`Found ${solarSystemsData.length} solar systems`);

    // Extract stargates first to determine connected systems
    const stargatesData = mapData.filter((item) => item.groupid === 10);
    console.log(`Found ${stargatesData.length} stargates`);

    // Process stargate connections and track connected systems
    const processedConnections = new Set();
    const connectedSystems = new Set(); // Track systems with connections

    stargatesData.forEach((sourceGate) => {
      if (!sourceGate.solarsystemid || !sourceGate.itemname) return;

      // Extract destination system name from stargate name
      const match = sourceGate.itemname.match(/Stargate \(([^)]+)\)/);
      if (!match) return;

      const destinationName = match[1];

      // Find destination system
      const destinationSystem = solarSystemsData.find(
        (sys) => sys.itemname === destinationName
      );

      if (!destinationSystem) return;

      // Find source system
      const sourceSystem = solarSystemsData.find(
        (sys) => sys.itemid === sourceGate.solarsystemid
      );

      if (!sourceSystem) return;

      // Skip wormhole regions (those with region IDs starting with C-R)
      const sourceRegion = regions.find((r) => r.id === sourceSystem.regionid);
      const destRegion = regions.find(
        (r) => r.id === destinationSystem.regionid
      );

      if (
        (sourceRegion && sourceRegion.name.startsWith("C-R")) ||
        (destRegion && destRegion.name.startsWith("C-R"))
      ) {
        return;
      }

      // Create a unique connection ID
      const connectionId = [sourceSystem.itemid, destinationSystem.itemid]
        .sort()
        .join("-");

      if (processedConnections.has(connectionId)) return;
      processedConnections.add(connectionId);

      // Add both systems to the connected systems set
      connectedSystems.add(sourceSystem.itemid);
      connectedSystems.add(destinationSystem.itemid);
    });

    // Filter systems to only include connected ones
    const filteredSystems = solarSystemsData.filter((system) =>
      connectedSystems.has(system.itemid)
    );

    // Apply search filter if needed
    const searchFilteredSystems = searchTerm
      ? filteredSystems.filter((system) =>
          system.itemname.toLowerCase().includes(searchTerm.toLowerCase())
        )
      : filteredSystems;

    console.log(`After filtering: ${searchFilteredSystems.length} systems`);

    // First create the region backgrounds before the systems
    if (colorByRegion) {
      createRegionBackgrounds(searchFilteredSystems);
    }

    // Create points geometry for all systems
    const positions = [];
    const colors = [];
    const regionLabels = new Map(); // Track one system per region for labels

    searchFilteredSystems.forEach((system) => {
      if (system.x === null || system.y === null || system.z === null) {
        console.warn("Skipping system with null coordinates:", system.itemname);
        return;
      }

      // Always flatten to 2D (set y to 0)
      const posX = system.x * SCALE_FACTOR;
      const posY = 0; // Always 0 for 2D
      const posZ = system.z * SCALE_FACTOR;

      // Add position
      positions.push(posX, posY, posZ);

      // Add color based on selected coloring mode
      let color;
      if (colorByRegion) {
        const region = regions.find((r) => r.id === system.regionid);
        color = new THREE.Color(region ? region.color : 0xffffff);

        // Track a system for region label (one per region)
        if (region && !regionLabels.has(region.id)) {
          regionLabels.set(region.id, {
            name: region.name,
            position: new THREE.Vector3(posX, posY, posZ),
            color: region.color,
          });
        }
      } else {
        color = new THREE.Color(getSecurityColor(system.security));
      }

      colors.push(color.r, color.g, color.b);

      // Create label for the system
      const labelDiv = document.createElement("div");
      labelDiv.className = "system-label";
      labelDiv.textContent = system.itemname;

      const label = new CSS2DObject(labelDiv);
      label.position.set(posX, posY, posZ);
      label.visible = false; // Only show on hover/select

      scene.add(label);

      // Store system reference
      solarSystems.set(system.itemid, {
        position: new THREE.Vector3(posX, posY, posZ),
        label,
        data: system,
        index: positions.length / 3 - 1,
        securityColor: getSecurityColor(system.security),
        regionColor:
          regions.find((r) => r.id === system.regionid)?.color || 0xffffff,
      });
    });

    if (positions.length === 0) {
      console.warn("No valid system positions found after filtering");
      return;
    }

    // Create points material with improved visibility
    const pointsMaterial = new THREE.PointsMaterial({
      size: SYSTEM_SIZE,
      vertexColors: true,
      sizeAttenuation: true,
      map: circleTexture, // Use circular texture
      alphaTest: 0.5,
      transparent: true,
    });

    // Create buffer geometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

    // Create points system
    const points = new THREE.Points(geometry, pointsMaterial);
    scene.add(points);

    // Add region labels
    if (colorByRegion) {
      regionLabels.forEach((labelData) => {
        const labelDiv = document.createElement("div");
        labelDiv.className = "region-label";
        labelDiv.textContent = labelData.name;
        labelDiv.style.color = `#${new THREE.Color(labelData.color).getHexString()}`;

        const label = new CSS2DObject(labelDiv);
        label.position.set(
          labelData.position.x,
          labelData.position.y + 5, // Position above a system
          labelData.position.z
        );

        scene.add(label);
      });
    }

    // Create the stargate connections
    let connectionCount = 0;
    processedConnections.clear();

    stargatesData.forEach((sourceGate) => {
      if (!sourceGate.solarsystemid || !sourceGate.itemname) return;

      // Extract destination system name from stargate name
      const match = sourceGate.itemname.match(/Stargate \(([^)]+)\)/);
      if (!match) return;

      const destinationName = match[1];

      // Find destination system
      const destinationSystem = solarSystemsData.find(
        (sys) => sys.itemname === destinationName
      );

      if (!destinationSystem) return;

      // Find source system
      const sourceSystem = solarSystemsData.find(
        (sys) => sys.itemid === sourceGate.solarsystemid
      );

      if (!sourceSystem) return;

      // Skip wormhole regions
      const sourceRegion = regions.find((r) => r.id === sourceSystem.regionid);
      const destRegion = regions.find(
        (r) => r.id === destinationSystem.regionid
      );

      if (
        (sourceRegion && sourceRegion.name.startsWith("C-R")) ||
        (destRegion && destRegion.name.startsWith("C-R"))
      ) {
        return;
      }

      // Create a unique connection ID
      const connectionId = [sourceSystem.itemid, destinationSystem.itemid]
        .sort()
        .join("-");

      if (processedConnections.has(connectionId)) return;
      processedConnections.add(connectionId);

      // Check if both systems are in our filtered set
      if (
        searchFilteredSystems.some(
          (sys) => sys.itemid === sourceSystem.itemid
        ) &&
        searchFilteredSystems.some(
          (sys) => sys.itemid === destinationSystem.itemid
        )
      ) {
        // Create connection line
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
  }

  function createConnectionLine(sourceSystem, destinationSystem) {
    // Check for null coordinates
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

    // Always use 2D coordinates (y = 0)
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

    // Line color logic
    let lineColor;

    if (colorByRegion) {
      // In region mode, use region color if systems are in the same region
      if (sourceSystem.regionid === destinationSystem.regionid) {
        const region = regions.find((r) => r.id === sourceSystem.regionid);
        lineColor = region ? region.color : CONNECTION_COLOR;
      } else {
        // Cross-region connections use default color
        lineColor = CONNECTION_COLOR;
      }
    } else {
      // In security mode, use the color of the lowest security system
      const sourceSec = sourceSystem.security || 0;
      const destSec = destinationSystem.security || 0;
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

  function getSecurityColor(security) {
    if (security === null || security === undefined) return 0xffffff;
    if (security >= 0.5) return HIGH_SEC_COLOR;
    if (security > 0.0) return LOW_SEC_COLOR;
    return NULL_SEC_COLOR;
  }

  function getSecurityDescription(security) {
    if (security === null || security === undefined) return "Unknown";
    if (security >= 0.5) return "High Security";
    if (security > 0.0) return "Low Security";
    return "Null Security";
  }

  function toggleColorMode() {
    colorByRegion = !colorByRegion;
    buildMap();
  }

  function onMouseMove(event) {
    if (!renderer) return;

    // Calculate mouse position
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Update raycaster
    raycaster.setFromCamera(mouse, camera);

    // Find intersections with systems
    const pointObjects = scene.children.filter((child) => child.isPoints);
    if (pointObjects.length === 0) return;

    const intersects = raycaster.intersectObjects(pointObjects);

    // Hide all labels first unless they're the selected system
    solarSystems.forEach((system) => {
      if (selectedSystem && system.data.itemid === selectedSystem.itemid) {
        system.label.visible = true;
      } else {
        system.label.visible = false;
      }
    });

    if (intersects.length > 0) {
      // Get the index of the intersected point
      const index = intersects[0].index;

      // Find the system with this index
      let hoveredSystem = null;
      solarSystems.forEach((system) => {
        if (system.index === index) {
          hoveredSystem = system;
        }
      });

      if (hoveredSystem) {
        // Show label and set cursor
        hoveredSystem.label.visible = true;
        container.style.cursor = "pointer";
      }
    } else {
      container.style.cursor = "auto";
    }
  }

  function onClick(event) {
    if (!renderer) return;

    const currentTime = clock.getElapsedTime() * 1000; // ms

    // Check if this is a double click
    if (currentTime - lastClickTime < DOUBLE_CLICK_TIME) {
      // This is handled by onDoubleClick
      return;
    }

    lastClickTime = currentTime;

    // Calculate mouse position
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Update raycaster
    raycaster.setFromCamera(mouse, camera);

    // Find intersections with systems
    const pointObjects = scene.children.filter((child) => child.isPoints);
    if (pointObjects.length === 0) return;

    const intersects = raycaster.intersectObjects(pointObjects);

    if (intersects.length > 0) {
      // Get the index of the intersected point
      const index = intersects[0].index;

      // Find the system with this index
      let clickedSystem = null;
      solarSystems.forEach((system) => {
        if (system.index === index) {
          clickedSystem = system;
        }
      });

      if (clickedSystem) {
        selectedSystem = clickedSystem.data;
      }
    }
  }

  function onDoubleClick(event) {
    if (!renderer) return;

    // Calculate mouse position
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Update raycaster
    raycaster.setFromCamera(mouse, camera);

    // Find intersections with systems
    const pointObjects = scene.children.filter((child) => child.isPoints);
    if (pointObjects.length === 0) return;

    const intersects = raycaster.intersectObjects(pointObjects);

    if (intersects.length > 0) {
      // Get the index of the intersected point
      const index = intersects[0].index;

      // Find the system with this index
      let clickedSystem = null;
      solarSystems.forEach((system) => {
        if (system.index === index) {
          clickedSystem = system;
        }
      });

      if (clickedSystem) {
        zoomToSystem(clickedSystem);
        selectedSystem = clickedSystem.data;
      }
    }
  }

  function zoomToSystem(system) {
    // Get current camera position and target
    const startPosition = camera.position.clone();
    const startTarget = controls.target.clone();

    // Calculate target position - always in 2D
    const targetPosition = system.position.clone();

    // Set target for controls
    const endTarget = targetPosition.clone();

    // Calculate a good viewing distance
    const distance = SYSTEM_SIZE * 10;

    // In 2D, we're looking from above
    const endPosition = new THREE.Vector3(
      targetPosition.x,
      distance, // Height above the plane
      targetPosition.z
    );

    // Animation parameters
    const duration = 1000; // ms
    const startTime = Date.now();

    function animateCamera() {
      const now = Date.now();
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Use smooth easing
      const ease = function (t) {
        return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      };

      const t = ease(progress);

      // Interpolate position and target
      camera.position.lerpVectors(startPosition, endPosition, t);
      controls.target.lerpVectors(startTarget, endTarget, t);
      controls.update();

      if (progress < 1) {
        requestAnimationFrame(animateCamera);
      }
    }

    animateCamera();
  }

  function handleSearch(event) {
    if (event.key !== "Enter") return;

    if (!searchTerm.trim()) {
      // If search field is empty, do nothing
      return;
    }

    // Find the system with matching name
    const solarSystemsData = mapData.filter((item) => item.typeid === 5);
    const matchingSystems = solarSystemsData.filter((system) =>
      system.itemname.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (matchingSystems.length > 0) {
      // Use the first matching system
      const targetSystem = matchingSystems[0];

      // Check if this system is in our rendered systems
      const renderedSystem = Array.from(solarSystems.values()).find(
        (sys) => sys.data.itemid === targetSystem.itemid
      );

      if (renderedSystem) {
        // Jump to the system
        zoomToSystem(renderedSystem);
        selectedSystem = renderedSystem.data;
      } else {
        // System found but not rendered (maybe filtered out)
        alert(
          `System "${targetSystem.itemname}" found but not visible on the current map.`
        );
      }
    } else {
      // No matching system found
      alert(`No system found with name containing "${searchTerm}"`);
    }

    // Reset search term after search
    // searchTerm = ""; // Uncomment if you want to clear the search field after search
  }

  function clearSelection() {
    selectedSystem = null;
  }

  function animate() {
    requestAnimationFrame(animate);
    if (controls) controls.update();

    // Update label visibility based on camera distance
    if (camera) {
      const cameraDistance = camera.position.length();
      solarSystems.forEach((system) => {
        // Only show labels for selected system or when hovering
        if (selectedSystem && system.data.itemid === selectedSystem.itemid) {
          system.label.visible = true;
        }
      });
    }

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
          placeholder="Search systems and press Enter"
          on:keydown={handleSearch}
        />
      </div>

      <button class="color-toggle" on:click={toggleColorMode}>
        Color by {colorByRegion ? "Security" : "Region"}
      </button>
    </div>

    {#if selectedSystem}
      <div class="system-info">
        <div class="close-btn" on:click={clearSelection}>×</div>
        <h3>{selectedSystem.itemname}</h3>
        <div class="info-row">
          <span>Security:</span>
          <span
            class="security"
            style="color: rgb({new THREE.Color(
              getSecurityColor(selectedSystem.security)
            ).r * 255}, {new THREE.Color(
              getSecurityColor(selectedSystem.security)
            ).g * 255}, {new THREE.Color(
              getSecurityColor(selectedSystem.security)
            ).b * 255})"
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
      </div>
    {/if}
  </div>

  <div class="map-view" bind:this={container}>
    {#if isLoading}
      <div class="loading">Loading universe map...</div>
    {/if}

    {#if error}
      <div class="error">Error: {error}</div>
    {/if}
  </div>

  <!-- <div class="instructions">
    <p>Double-click a star to zoom to it.</p>
  </div> -->
</div>

<style>
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

  .system-info {
    background-color: rgba(0, 0, 0, 0.8);
    border: 1px solid rgba(0, 255, 255, 0.3);
    border-radius: 8px;
    padding: 15px;
    min-width: 250px;
    position: relative;
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
  }

  .system-info h3 {
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
  }

  .error {
    color: #ff6b6b;
  }

  .instructions {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background-color: rgba(0, 0, 0, 0.7);
    border: 1px solid rgba(0, 255, 255, 0.3);
    border-radius: 8px;
    padding: 8px 12px;
    color: white;
    font-size: 14px;
    pointer-events: none;
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
</style>
