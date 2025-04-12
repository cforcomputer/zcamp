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
  let is2DView = false;
  let mapData = [];
  let isLoading = true;
  let error = null;
  let searchTerm = "";
  let selectedRegion = "all";
  let regions = [];
  let selectedSystem = null;

  // Raycasting for interaction
  let raycaster;
  let mouse;

  // Constants
  const SCALE_FACTOR = 1e-14; // Scale down universe coordinates
  const SYSTEM_SIZE = 0.5;
  const HIGH_SEC_COLOR = 0x00ff00; // Green
  const LOW_SEC_COLOR = 0xffff00; // Yellow
  const NULL_SEC_COLOR = 0xff0000; // Red
  const CONNECTION_COLOR = 0x00ffff; // Cyan

  onMount(async () => {
    try {
      console.log("Component mounted, initializing map...");
      await initializeMap();

      window.addEventListener("resize", handleResize);
      container.addEventListener("mousemove", onMouseMove);
      container.addEventListener("click", onClick);
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

    window.removeEventListener("resize", handleResize);
    if (container) {
      container.removeEventListener("mousemove", onMouseMove);
      container.removeEventListener("click", onClick);
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
        .map((region) => ({
          id: region.itemid,
          name: region.itemname,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      console.log(`Client: Extracted ${regions.length} regions`);

      initThreeJS();
      buildMap();
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
      10000
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
    controls.dampingFactor = 0.05;
    controls.maxDistance = 500;

    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    // Initialize raycaster
    raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 2;
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

    // Extract solar systems - using lowercase column names
    const solarSystemsData = mapData.filter((item) => item.typeid === 5);
    console.log(`Found ${solarSystemsData.length} solar systems`);

    // Filter by region if selected
    const filteredSystems =
      selectedRegion === "all"
        ? solarSystemsData
        : solarSystemsData.filter(
            (system) => system.regionid === parseInt(selectedRegion)
          );

    console.log(`After region filter: ${filteredSystems.length} systems`);

    // Filter by search term if provided
    const searchFilteredSystems = searchTerm
      ? filteredSystems.filter((system) =>
          system.itemname.toLowerCase().includes(searchTerm.toLowerCase())
        )
      : filteredSystems;

    console.log(`After search filter: ${searchFilteredSystems.length} systems`);

    // Create points geometry for all systems
    const positions = [];
    const colors = [];

    searchFilteredSystems.forEach((system) => {
      if (system.x === null || system.y === null || system.z === null) {
        console.warn("Skipping system with null coordinates:", system.itemname);
        return;
      }

      // Add position
      positions.push(
        system.x * SCALE_FACTOR,
        system.y * SCALE_FACTOR,
        system.z * SCALE_FACTOR
      );

      // Add color based on security status
      const color = new THREE.Color(getSecurityColor(system.security));
      colors.push(color.r, color.g, color.b);

      // Create label for the system
      const labelDiv = document.createElement("div");
      labelDiv.className = "system-label";
      labelDiv.textContent = system.itemname;

      const label = new CSS2DObject(labelDiv);
      label.position.set(
        system.x * SCALE_FACTOR,
        system.y * SCALE_FACTOR,
        system.z * SCALE_FACTOR
      );
      label.visible = false; // Only show labels when zoomed in

      scene.add(label);

      // Store system reference
      solarSystems.set(system.itemid, {
        position: new THREE.Vector3(
          system.x * SCALE_FACTOR,
          system.y * SCALE_FACTOR,
          system.z * SCALE_FACTOR
        ),
        label,
        data: system,
        index: positions.length / 3 - 1,
      });
    });

    if (positions.length === 0) {
      console.warn("No valid system positions found after filtering");
      return;
    }

    // Create points material
    const pointsMaterial = new THREE.PointsMaterial({
      size: SYSTEM_SIZE,
      vertexColors: true,
      sizeAttenuation: true,
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

    // Extract stargates
    const stargatesData = mapData.filter((item) => item.groupid === 10);
    console.log(`Found ${stargatesData.length} stargates`);

    // Process stargate connections
    const processedConnections = new Set();
    let connectionCount = 0;

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

    const startPoint = new THREE.Vector3(
      sourceSystem.x * SCALE_FACTOR,
      sourceSystem.y * SCALE_FACTOR,
      sourceSystem.z * SCALE_FACTOR
    );

    const endPoint = new THREE.Vector3(
      destinationSystem.x * SCALE_FACTOR,
      destinationSystem.y * SCALE_FACTOR,
      destinationSystem.z * SCALE_FACTOR
    );

    const geometry = new THREE.BufferGeometry().setFromPoints([
      startPoint,
      endPoint,
    ]);
    const material = new THREE.LineBasicMaterial({
      color: CONNECTION_COLOR,
      opacity: 0.5,
      transparent: true,
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

  function toggleView() {
    is2DView = !is2DView;

    if (is2DView) {
      // Flatten to 2D (set all y values to 0)
      scene.traverse((object) => {
        if (object.isPoints) {
          const positions = object.geometry.attributes.position.array;
          for (let i = 1; i < positions.length; i += 3) {
            positions[i] = 0; // Set all Y values to 0
          }
          object.geometry.attributes.position.needsUpdate = true;
        } else if (object.isLine) {
          const positions = object.geometry.attributes.position.array;
          positions[1] = 0; // start y
          positions[4] = 0; // end y
          object.geometry.attributes.position.needsUpdate = true;
        } else if (object.isCSS2DObject) {
          object.position.y = 0;
        }
      });

      // Update stored positions
      solarSystems.forEach((system) => {
        system.position.y = 0;
      });

      // Position camera for top view
      camera.position.set(0, 50, 0);
      camera.lookAt(0, 0, 0);
    } else {
      // Restore 3D positions
      buildMap(); // Rebuild the map with original 3D positions

      // Reset camera position
      camera.position.set(0, 0, 50);
      camera.lookAt(0, 0, 0);
    }

    controls.update();
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

  function clearSelection() {
    selectedSystem = null;
  }

  function searchSystems() {
    buildMap();
  }

  function regionChanged() {
    buildMap();
  }

  function animate() {
    requestAnimationFrame(animate);
    if (controls) controls.update();

    // Update label visibility based on camera distance
    if (camera) {
      const cameraDistance = camera.position.length();
      solarSystems.forEach((system) => {
        // Only show labels for selected system or when zoomed in close
        if (
          (selectedSystem && system.data.itemid === selectedSystem.itemid) ||
          (cameraDistance < 20 &&
            system.position.distanceTo(camera.position) < 10)
        ) {
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
          placeholder="Search systems..."
          on:input={searchSystems}
        />
      </div>

      <div class="region-filter">
        <select bind:value={selectedRegion} on:change={regionChanged}>
          <option value="all">All Regions</option>
          {#each regions as region}
            <option value={region.id}>{region.name}</option>
          {/each}
        </select>
      </div>

      <button class="view-toggle" on:click={toggleView}>
        {is2DView ? "3D View" : "2D View"}
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

  .search-box input,
  .region-filter select {
    background-color: rgba(30, 30, 30, 0.7);
    color: white;
    border: 1px solid rgba(0, 255, 255, 0.5);
    padding: 8px 12px;
    border-radius: 4px;
    width: 100%;
  }

  .view-toggle {
    background-color: rgba(0, 100, 100, 0.7);
    color: white;
    border: 1px solid #00ffff;
    padding: 8px 16px;
    cursor: pointer;
    border-radius: 4px;
    transition: background-color 0.2s;
  }

  .view-toggle:hover {
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
</style>
