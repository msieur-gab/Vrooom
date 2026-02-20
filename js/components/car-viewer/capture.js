/**
 * capture.js — Snap (256px side-view) + Outline (2048px coloring book).
 */
import * as THREE from 'three';

// ── Helpers ──────────────────────────────────────────────

function projectBox3ToScreen(object3D, camera, renderW, renderH) {
  const box = new THREE.Box3().setFromObject(object3D);
  const corners = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of corners) {
    c.project(camera);
    const sx = (c.x * 0.5 + 0.5) * renderW;
    const sy = (1 - (c.y * 0.5 + 0.5)) * renderH;
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }

  return {
    minX: Math.floor(minX), minY: Math.floor(minY),
    maxX: Math.ceil(maxX), maxY: Math.ceil(maxY)
  };
}

function saveState(renderer, camera, scene) {
  return {
    bg: scene.background,
    clearColor: renderer.getClearColor(new THREE.Color()),
    clearAlpha: renderer.getClearAlpha(),
    size: renderer.getSize(new THREE.Vector2()),
    pixelRatio: renderer.getPixelRatio(),
    aspect: camera.aspect
  };
}

function restoreState(renderer, camera, scene, s) {
  renderer.setPixelRatio(s.pixelRatio);
  renderer.setSize(s.size.x, s.size.y, false);
  camera.aspect = s.aspect;
  camera.updateProjectionMatrix();
  scene.background = s.bg;
  renderer.setClearColor(s.clearColor, s.clearAlpha);
}

function hideExtras(ground, headlightsModule) {
  const hidden = [];
  if (ground) {
    ground.visible = false;
    hidden.push(ground);
  }
  if (headlightsModule) {
    for (const obj of headlightsModule.getAddedObjects()) {
      if (obj.visible) { obj.visible = false; hidden.push(obj); }
    }
  }
  return () => { for (const obj of hidden) obj.visible = true; };
}

function renderCropped(scene, renderer, camera, carGroup, renderSize, pad) {
  renderer.setPixelRatio(1);
  renderer.setSize(renderSize, renderSize, false);
  camera.aspect = 1;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);

  const bounds = projectBox3ToScreen(carGroup, camera, renderSize, renderSize);
  const minX = Math.max(0, bounds.minX - pad);
  const minY = Math.max(0, bounds.minY - pad);
  const maxX = Math.min(renderSize - 1, bounds.maxX + pad);
  const maxY = Math.min(renderSize - 1, bounds.maxY + pad);
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = cropW;
  cropCanvas.height = cropH;
  cropCanvas.getContext('2d').drawImage(
    renderer.domElement, minX, minY, cropW, cropH, 0, 0, cropW, cropH
  );
  return cropCanvas.toDataURL('image/png');
}

// ── Side-view snapshot (256px, transparent BG) ──────────

export function sideView(scene, renderer, camera, carGroup, ground, headlightsModule, controls, size = 256) {
  const rs = saveState(renderer, camera, scene);
  const savedPos = camera.position.clone();
  const savedTarget = controls.controls.target.clone();

  // Transparent bg, hide extras
  scene.background = null;
  renderer.setClearColor(0x000000, 0);
  const restoreExtras = hideExtras(ground, headlightsModule);

  // Frame from side
  const box = new THREE.Box3().setFromObject(carGroup);
  const center = box.getCenter(new THREE.Vector3());
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const fov = camera.fov * (Math.PI / 180);
  const dist = sphere.radius / Math.sin(fov / 2) * 1.1;
  camera.position.set(center.x + dist, center.y + sphere.radius * 0.3, center.z);
  controls.controls.target.copy(center);
  controls.controls.update();

  const dataUrl = renderCropped(scene, renderer, camera, carGroup, size, 8);

  // Restore
  restoreState(renderer, camera, scene, rs);
  camera.position.copy(savedPos);
  controls.controls.target.copy(savedTarget);
  controls.controls.update();
  restoreExtras();

  return dataUrl;
}

// ── Outline / coloring-book (2048px) ────────────────────

export function outline(scene, renderer, camera, carGroup, ground, headlightsModule, controls, size = 2048) {
  // 1. Swap to flat pastel materials + add edge lines
  const saved = [];
  const addedLines = [];
  const partColors = [
    0xffe0e0, 0xe0ffe0, 0xe0e0ff, 0xffffe0, 0xffe0ff,
    0xe0ffff, 0xfff0e0, 0xf0e0ff, 0xe0fff0, 0xf0ffe0
  ];
  let colorIdx = 0;

  carGroup.traverse((child) => {
    if (!child.isMesh) return;
    saved.push({ mesh: child, material: child.material });
    child.material = new THREE.MeshBasicMaterial({
      color: partColors[colorIdx % partColors.length],
      side: THREE.FrontSide
    });
    colorIdx++;
    const edgesGeo = new THREE.EdgesGeometry(child.geometry, 12);
    const lines = new THREE.LineSegments(edgesGeo, new THREE.LineBasicMaterial({ color: 0x000000 }));
    child.add(lines);
    addedLines.push({ parent: child, lines });
  });

  // 2. Setup
  const restoreExtras = hideExtras(ground, headlightsModule);
  const rs = saveState(renderer, camera, scene);
  scene.background = new THREE.Color(0xfefefe);
  renderer.setClearColor(0xfefefe, 1);

  const savedCamPos = camera.position.clone();
  const savedTarget = controls.controls.target.clone();

  // Frame camera
  const box = new THREE.Box3().setFromObject(carGroup);
  const center = box.getCenter(new THREE.Vector3());
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const fov = camera.fov * (Math.PI / 180);
  const fitDist = sphere.radius / Math.sin(fov / 2) * 1.1;
  const dir = camera.position.clone().sub(controls.controls.target).normalize();
  camera.position.copy(center).addScaledVector(dir, fitDist);
  controls.controls.target.copy(center);
  controls.controls.update();

  // 3. Render at high res
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  camera.aspect = 1;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);

  // 4. Crop
  const bounds = projectBox3ToScreen(carGroup, camera, size, size);
  const pad = 20;
  const minX = Math.max(0, bounds.minX - pad);
  const minY = Math.max(0, bounds.minY - pad);
  const maxX = Math.min(size - 1, bounds.maxX + pad);
  const maxY = Math.min(size - 1, bounds.maxY + pad);
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;

  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = size;
  tmpCanvas.height = size;
  const tmpCtx = tmpCanvas.getContext('2d');
  tmpCtx.drawImage(renderer.domElement, 0, 0);
  const src = tmpCtx.getImageData(minX, minY, cropW, cropH).data;

  // Restore renderer + camera
  restoreState(renderer, camera, scene, rs);
  camera.position.copy(savedCamPos);
  controls.controls.target.copy(savedTarget);
  controls.controls.update();

  // 5. Edge detection
  const edgeMap = new Uint8Array(cropW * cropH);
  for (let y = 1; y < cropH - 1; y++) {
    for (let x = 1; x < cropW - 1; x++) {
      const i = (y * cropW + x) * 4;
      const r = src[i], g = src[i + 1], b = src[i + 2];
      if (r + g + b < 100) { edgeMap[y * cropW + x] = 1; continue; }
      const neighbors = [
        (y * cropW + x + 1) * 4,
        (y * cropW + x - 1) * 4,
        ((y + 1) * cropW + x) * 4,
        ((y - 1) * cropW + x) * 4
      ];
      for (const ni of neighbors) {
        const diff = Math.abs(r - src[ni]) + Math.abs(g - src[ni + 1]) + Math.abs(b - src[ni + 2]);
        if (diff > 20) { edgeMap[y * cropW + x] = 1; break; }
      }
    }
  }

  // Dilate 1px cross
  const dilated = new Uint8Array(cropW * cropH);
  for (let y = 1; y < cropH - 1; y++) {
    for (let x = 1; x < cropW - 1; x++) {
      if (edgeMap[y * cropW + x]) {
        dilated[y * cropW + x] = 1;
        dilated[y * cropW + x + 1] = 1;
        dilated[y * cropW + x - 1] = 1;
        dilated[(y + 1) * cropW + x] = 1;
        dilated[(y - 1) * cropW + x] = 1;
      }
    }
  }

  // 6. Output: black edges, white fill, transparent outside
  const offscreen = document.createElement('canvas');
  offscreen.width = cropW;
  offscreen.height = cropH;
  const ctx = offscreen.getContext('2d');
  const out = ctx.createImageData(cropW, cropH);

  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      const oi = (y * cropW + x) * 4;
      const si = (y * cropW + x) * 4;
      if (dilated[y * cropW + x]) {
        out.data[oi] = 0; out.data[oi + 1] = 0; out.data[oi + 2] = 0; out.data[oi + 3] = 255;
      } else if (src[si] < 253 || src[si + 1] < 253 || src[si + 2] < 253) {
        out.data[oi] = 255; out.data[oi + 1] = 255; out.data[oi + 2] = 255; out.data[oi + 3] = 255;
      }
    }
  }
  ctx.putImageData(out, 0, 0);

  // 7. Restore materials
  for (const s of saved) s.mesh.material = s.material;
  for (const entry of addedLines) {
    entry.parent.remove(entry.lines);
    entry.lines.geometry.dispose();
    entry.lines.material.dispose();
  }
  restoreExtras();

  return offscreen.toDataURL('image/png');
}
