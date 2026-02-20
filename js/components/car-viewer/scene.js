/**
 * scene.js — Scene factory: renderer, camera, lights, ground, shadows.
 */
import * as THREE from 'three';

export function createScene(canvas, bgColor = '#f45436') {
  // Renderer
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true
  });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(new THREE.Color(bgColor), 1);

  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(bgColor);

  // Camera
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(2.5, 1.5, 2.5);

  // Lights
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
  keyLight.position.set(-2, 4, 3);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -3;
  keyLight.shadow.camera.right = 3;
  keyLight.shadow.camera.top = 3;
  keyLight.shadow.camera.bottom = -3;
  keyLight.shadow.camera.near = 0.1;
  keyLight.shadow.camera.far = 20;
  keyLight.shadow.bias = -0.001;
  scene.add(keyLight);

  const fill = new THREE.DirectionalLight(0xf8f4f0, 0.5);
  fill.position.set(3, 3, -1);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffe8d6, 0.3);
  rim.position.set(0, 2, -4);
  scene.add(rim);

  // Ground
  const groundGeo = new THREE.CircleGeometry(1.5, 64);
  const groundMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(bgColor),
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  return { scene, renderer, camera, keyLight, ground };
}

export function resize(renderer, camera, w, h) {
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
