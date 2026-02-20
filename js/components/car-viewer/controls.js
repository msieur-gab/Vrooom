/**
 * controls.js — OrbitControls wrapper with constraints, auto-rotate, damping.
 */
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as THREE from 'three';

const DEG = Math.PI / 180;

export function createControls(camera, canvas, opts = {}) {
  const controls = new OrbitControls(camera, canvas);

  controls.target.set(0, 0.4, 0);
  controls.minDistance = 1.5;
  controls.maxDistance = 8;
  controls.minPolarAngle = 20 * DEG;
  controls.maxPolarAngle = 80 * DEG;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.rotateSpeed = 0.5;
  controls.autoRotate = opts.autoRotate !== false;
  controls.autoRotateSpeed = 0.4;

  const onChange = opts.onChange || (() => {});

  controls.addEventListener('change', onChange);

  return {
    controls,
    update() { controls.update(); },
    reset() {
      controls.target.set(0, 0.4, 0);
      camera.position.set(2.5, 1.5, 2.5);
      controls.update();
    },
    setAutoRotate(on) {
      controls.autoRotate = on;
    },
    dispose() {
      controls.removeEventListener('change', onChange);
      controls.dispose();
    }
  };
}
