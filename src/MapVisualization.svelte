<script>
    import { onMount } from 'svelte';
    import * as THREE from 'three';
    import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
  
    export let killmailId;
  
    let container;
  
    onMount(async () => {
      const celestials = await fetchCelestials(killmailId);
      initVisualization(celestials);
    });
  
    async function fetchCelestials(killmailId) {
      const response = await fetch(`/api/celestials/${killmailId}`);
      return await response.json();
    }
  
    function initVisualization(celestials) {
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
      const renderer = new THREE.WebGLRenderer();
  
      renderer.setSize(container.clientWidth, container.clientHeight);
      container.appendChild(renderer.domElement);
  
      const controls = new OrbitControls(camera, renderer.domElement);
  
      // Add celestials to the scene
      celestials.forEach(celestial => {
        const geometry = new THREE.SphereGeometry(0.1, 32, 32);
        const material = new THREE.MeshBasicMaterial({ color: 0x0000ff });
        const sphere = new THREE.Mesh(geometry, material);
        sphere.position.set(celestial.x, celestial.y, celestial.z);
        scene.add(sphere);
      });
  
      // Add killmail position
      const killmailGeometry = new THREE.SphereGeometry(0.2, 32, 32);
      const killmailMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      const killmailSphere = new THREE.Mesh(killmailGeometry, killmailMaterial);
      killmailSphere.position.set(celestials[0].killmail_x, celestials[0].killmail_y, celestials[0].killmail_z);
      scene.add(killmailSphere);
  
      camera.position.z = 5;
  
      function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      }
      animate();
    }
  </script>
  
  <div bind:this={container} style="width: 100%; height: 400px;"></div>