/**
 * vibration.js — Click shake + engine idle loop, wheel counter-offset.
 */

export function createVibration(carGroup, config) {
  let engineRunning = false;
  let engineAudio = null;
  let wheelsMesh = null;
  let wheelsOrigPos = null;
  const origPos = { x: 0, y: 0, z: 0 };
  let clickShakeStart = -1;

  const freq = config.vibrationFrequency || 12;
  const axis = config.vibrationAxis || 'y';

  function setWheels(mesh) {
    wheelsMesh = mesh;
  }

  function saveOrigPos() {
    origPos.x = carGroup.position.x;
    origPos.y = carGroup.position.y;
    origPos.z = carGroup.position.z;
    if (wheelsMesh) {
      wheelsOrigPos = { x: wheelsMesh.position.x, y: wheelsMesh.position.y, z: wheelsMesh.position.z };
    }
  }

  function applyOffset(offset) {
    carGroup.position.set(origPos.x, origPos.y, origPos.z);
    const carScale = carGroup.scale.x || 1;

    // Apply to car
    if (axis === 'x') carGroup.position.x += offset;
    else if (axis === 'z') carGroup.position.z += offset;
    else carGroup.position.y += offset;

    // Counter-offset wheels (Z-up to Y-up: world X=local X, world Y=local Z, world Z=local -Y)
    if (wheelsMesh && wheelsOrigPos) {
      const counter = -offset / carScale;
      wheelsMesh.position.set(wheelsOrigPos.x, wheelsOrigPos.y, wheelsOrigPos.z);
      if (axis === 'x') wheelsMesh.position.x += counter;
      else if (axis === 'y') wheelsMesh.position.z += counter;
      else wheelsMesh.position.y -= counter;
    }
  }

  function resetPos() {
    carGroup.position.set(origPos.x, origPos.y, origPos.z);
    if (wheelsMesh && wheelsOrigPos) {
      wheelsMesh.position.set(wheelsOrigPos.x, wheelsOrigPos.y, wheelsOrigPos.z);
    }
  }

  // ── Click shake (one-shot, 600ms decaying sine) ──

  function triggerClickShake() {
    if (engineRunning) return; // don't fight idle loop
    saveOrigPos();
    clickShakeStart = performance.now();
  }

  // ── Engine idle ──

  function startEngine(audioMap) {
    if (engineRunning) return;
    engineRunning = true;
    saveOrigPos();

    // Play engine sound looped
    const audio = audioMap?.get('Body');
    if (audio) {
      audio.loop = true;
      audio.currentTime = 0;
      audio.play().catch(() => {});
      engineAudio = audio;
    }
  }

  function stopEngine() {
    engineRunning = false;
    if (engineAudio) {
      engineAudio.pause();
      engineAudio.currentTime = 0;
      engineAudio.loop = false;
      engineAudio = null;
    }
    resetPos();
  }

  // ── Per-frame update (no-op when idle) ──

  function update() {
    const now = performance.now();

    if (engineRunning) {
      const idle = 0.012;
      const offset = (Math.sin(now * freq * 0.05) * 0.6 + Math.sin(now * freq * 0.08) * 0.4) * idle;
      applyOffset(offset);
      return true; // needs continuous render
    }

    if (clickShakeStart >= 0) {
      const elapsed = now - clickShakeStart;
      const duration = 600;
      if (elapsed >= duration) {
        resetPos();
        clickShakeStart = -1;
        return false;
      }
      const decay = 1 - (elapsed / duration);
      const shake = 0.03;
      const offset = Math.sin(elapsed * freq * 0.06) * shake * decay;
      applyOffset(offset);
      return true; // needs continuous render
    }

    return false; // idle, no render needed
  }

  return {
    setWheels,
    triggerClickShake,
    startEngine,
    stopEngine,
    update,
    get isActive() { return engineRunning || clickShakeStart >= 0; },
    get isEngineRunning() { return engineRunning; }
  };
}
