/**
 * interaction.js — Raycaster click, audio playback, color picker event.
 */
import * as THREE from 'three';

export function createInteraction(camera, canvas, { partMap, carGroup, defaultClickSound, onPartClicked, requestRender }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const audioMap = new Map();
  let activeAudio = null;

  // Pre-create audio objects
  for (const [name, { config }] of partMap) {
    if (config.soundUrl) {
      const audio = new Audio(config.soundUrl);
      audio.volume = 0.5;
      audio.preload = 'auto';
      audioMap.set(name, audio);
    }
  }
  if (defaultClickSound) {
    const dflt = new Audio(defaultClickSound);
    dflt.volume = 0.3;
    dflt.preload = 'auto';
    audioMap.set('__default__', dflt);
  }

  function stopSound() {
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.currentTime = 0;
      activeAudio = null;
    }
  }

  function onClick(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects(carGroup.children, true);

    if (intersects.length === 0) return;

    // Find the part
    let hitMesh = intersects[0].object;
    let partName = hitMesh.userData.partName;

    // Walk up if we hit a child (e.g. edge lines)
    while (!partName && hitMesh.parent) {
      hitMesh = hitMesh.parent;
      partName = hitMesh.userData.partName;
    }
    if (!partName) return;

    // Play sound
    stopSound();
    const audio = audioMap.get(partName) || audioMap.get('__default__');
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      activeAudio = audio;
    }

    if (onPartClicked) onPartClicked(partName, hitMesh);
  }

  // Use pointerup for reliable click detection (avoids drag-as-click)
  let pointerDownPos = null;
  function onPointerDown(e) {
    pointerDownPos = { x: e.clientX, y: e.clientY };
  }
  function onPointerUp(e) {
    if (!pointerDownPos) return;
    const dx = e.clientX - pointerDownPos.x;
    const dy = e.clientY - pointerDownPos.y;
    if (dx * dx + dy * dy < 25) { // less than 5px movement = click
      onClick(e);
    }
    pointerDownPos = null;
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);

  return {
    stopSound,
    getAudioMap() { return audioMap; },
    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      stopSound();
    }
  };
}
