<script>
  import { onMount } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

  export let killmailId;

  let container;

  // Function to fetch celestial data based on the killmail ID
  async function fetchCelestials(killmailId) {
    const response = await fetch(`/api/celestials/${killmailId}`);
    return await response.json();
  }

  // Function to initialize the Three.js scene and add objects
  function initVisualization(celestials) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer();

    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    // Initialize OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);

    // Add celestials to the scene
    celestials.forEach(celestial => {
      const geometry = new THREE.SphereGeometry(0.1, 32, 32);
      const material = new THREE.MeshBasicMaterial({ color: 0x0000ff });
      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.set(celestial.x, celestial.y, celestial.z);
      scene.add(sphere);
    });

    // Add the killmail position marker
    const killmailGeometry = new THREE.SphereGeometry(0.2, 32, 32);
    const killmailMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const killmailSphere = new THREE.Mesh(killmailGeometry, killmailMaterial);
    killmailSphere.position.set(celestials[0].killmail_x, celestials[0].killmail_y, celestials[0].killmail_z);
    scene.add(killmailSphere);

    // Set initial camera position
    camera.position.z = 5;

    // Animation loop to render the scene and update controls
    function animate() {
      requestAnimationFrame(animate);
      controls.update(); // Update controls on each frame
      renderer.render(scene, camera);
    }
    animate();
  }

  // Fetch data and initialize the visualization on component mount
  onMount(async () => {
    const celestials = await fetchCelestials(killmailId);
    initVisualization(celestials);
  });
</script>

<!-- Container for the Three.js canvas -->
<div bind:this={container} style="width: 100%; height: 400px;"></div>
