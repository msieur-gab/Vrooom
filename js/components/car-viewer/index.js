/**
 * <car-viewer> — Three.js Web Component for STL car rendering.
 *
 * Drop-in replacement for the model-viewer-based car-viewer.
 * Same public API, same <car-viewer> tag.
 *
 * Attributes:
 *   background-color  — hex color for background (default: #f45436)
 *   auto-rotate       — enable auto-rotation
 *   interactive       — set "false" to disable click/tap
 *
 * Public API:
 *   loadCar(config)       — load a car config object
 *   toSideView()          — 256px side-view PNG data URL
 *   toOutline()           — 2048px coloring book PNG data URL
 *   resetView()           — reset camera
 *   startEngine()         — engine idle vibration + sound
 *   stopEngine()          — stop engine
 *   toggleLights(on, p)   — headlights on/off with optional params
 *   destroy()             — cleanup
 *
 * Events: car-loaded, part-clicked
 */

import { createScene, resize } from './scene.js';
import { loadCar } from './car-loader.js';
import { createControls } from './controls.js';
import { createInteraction } from './interaction.js';
import { createVibration } from './vibration.js';
import { createHeadlights } from './headlights.js';
import { sideView, outline } from './capture.js';

const THROTTLE_MS = 33; // ~30fps for auto-rotate — plenty for a slow spin

class CarViewer extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._isDestroyed = false;
    this._rafId = null;
    this._needsContinuous = false; // true when auto-rotate or engine active
    this._needsHighFPS = false;    // true only during vibration/engine
    this._isVisible = false;
    this._initialized = false;     // WebGL not created until loadCar()
    this._lastRenderTime = 0;

    // Module refs (set after _initThree / loadCar)
    this._scene = null;
    this._renderer = null;
    this._camera = null;
    this._ground = null;
    this._carGroup = null;
    this._partMap = null;
    this._controls = null;
    this._interaction = null;
    this._vibration = null;
    this._headlights = null;
    this._config = null;
    this._resizeObs = null;
    this._intersectionObs = null;
  }

  connectedCallback() {
    if (this._isDestroyed) return;
    this._initShell();
  }

  disconnectedCallback() {
    this.destroy();
  }

  static get observedAttributes() { return ['background-color', 'auto-rotate', 'interactive']; }

  attributeChangedCallback(name, _, val) {
    if (!this._initialized) return;
    if (name === 'background-color' && this._scene) {
      const c = val || '#f45436';
      this._scene.background.set(c);
      this._renderer.setClearColor(c, 1);
      if (this._ground) this._ground.material.color.set(c);
      this._scheduleRender();
    }
    if (name === 'auto-rotate' && this._controls) {
      const on = val !== null && val !== 'false';
      this._controls.setAutoRotate(on);
      this._needsContinuous = on || this._needsHighFPS;
      if (on) this._scheduleRender();
    }
  }

  get isInteractive() {
    const v = this.getAttribute('interactive');
    return v === null || v !== 'false';
  }

  // ── Shell (lightweight — no WebGL) ─────────────────────

  _initShell() {
    const bg = this.getAttribute('background-color') || '#f45436';

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          height: 100%;
          position: relative;
          background: ${bg};
          border-radius: 0.5rem;
          overflow: hidden;
          min-height: 250px;
        }
        canvas {
          width: 100%;
          height: 100%;
          display: block;
          touch-action: none;
        }
        .msg {
          position: absolute; top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          color: white; font-family: 'DM Sans', system-ui, sans-serif;
          font-size: 0.9rem; font-weight: 500; text-align: center;
          pointer-events: none; z-index: 10; max-width: 90%;
        }
        .msg.error {
          color: #fee2e2; background: rgba(239,68,68,0.15);
          padding: 0.75rem 1rem; border-radius: 0.5rem;
          border: 1px solid rgba(239,68,68,0.25);
        }
        .msg[hidden] { display: none; }
      </style>
      <canvas></canvas>
      <div class="msg" id="loading" hidden>Loading car...</div>
      <div class="msg error" id="error" hidden></div>
    `;

    this._canvas = this.shadowRoot.querySelector('canvas');
    this._loadingEl = this.shadowRoot.getElementById('loading');
    this._errorEl = this.shadowRoot.getElementById('error');

    // Track visibility — don't render when off-screen
    this._intersectionObs = new IntersectionObserver((entries) => {
      this._isVisible = entries[0].isIntersecting;
      if (this._isVisible && this._initialized) this._scheduleRender();
    }, { threshold: 0 });
    this._intersectionObs.observe(this);
  }

  // ── Lazy WebGL init (called once, on first loadCar) ────

  _initThree() {
    if (this._initialized) return;
    this._initialized = true;

    const bg = this.getAttribute('background-color') || '#f45436';
    const { scene, renderer, camera, keyLight, ground } = createScene(this._canvas, bg);
    this._scene = scene;
    this._renderer = renderer;
    this._camera = camera;
    this._ground = ground;

    // Size canvas
    const rect = this.getBoundingClientRect();
    resize(renderer, camera, rect.width || 300, rect.height || 300);

    // Controls
    const autoRotate = this.hasAttribute('auto-rotate') && this.getAttribute('auto-rotate') !== 'false';
    this._controls = createControls(camera, this._canvas, {
      autoRotate,
      onChange: () => this._scheduleRender()
    });
    this._needsContinuous = autoRotate;

    // ResizeObserver
    this._resizeObs = new ResizeObserver(() => {
      const r = this.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        resize(this._renderer, this._camera, r.width, r.height);
        this._scheduleRender();
      }
    });
    this._resizeObs.observe(this);
  }

  // ── Render loop (throttled) ────────────────────────────

  _scheduleRender() {
    if (this._isDestroyed || this._rafId || !this._isVisible || !this._initialized) return;
    this._rafId = requestAnimationFrame((t) => {
      this._rafId = null;
      this._tick(t);
    });
  }

  _tick(timestamp) {
    if (this._isDestroyed || !this._isVisible) return;

    // Throttle: skip frame if we rendered recently (unless high-fps mode)
    if (!this._needsHighFPS) {
      const elapsed = timestamp - this._lastRenderTime;
      if (elapsed < THROTTLE_MS) {
        // Re-schedule for next frame instead of skipping entirely
        if (this._needsContinuous) {
          this._rafId = requestAnimationFrame((t) => { this._rafId = null; this._tick(t); });
        }
        return;
      }
    }

    this._lastRenderTime = timestamp;
    this._controls.update();

    const vibrating = this._vibration ? this._vibration.update() : false;
    this._needsHighFPS = vibrating;

    this._renderer.render(this._scene, this._camera);

    // Continue loop if needed
    if (this._needsContinuous || vibrating) {
      this._rafId = requestAnimationFrame((t) => { this._rafId = null; this._tick(t); });
    }
  }

  // ── Public API ─────────────────────────────────────────

  async loadCar(config) {
    if (this._isDestroyed) return;

    // Lazy-init WebGL on first load
    this._initThree();

    // Cleanup previous car
    this._disposeCarModules();

    this._showLoading('Loading car...');
    this._config = config;

    try {
      const { carGroup, partMap, wheelsMesh } = await loadCar(config);

      this._carGroup = carGroup;
      this._partMap = partMap;
      this._scene.add(carGroup);

      // Vibration
      this._vibration = createVibration(carGroup, config);
      this._vibration.setWheels(wheelsMesh);

      // Headlights
      this._headlights = createHeadlights(carGroup, partMap);

      // Interaction
      if (this.isInteractive) {
        this._interaction = createInteraction(this._camera, this._canvas, {
          partMap,
          carGroup,
          defaultClickSound: config.defaultClickSound,
          onPartClicked: (partName, mesh) => {
            const vibratableParts = config.vibratableParts || [];
            if (vibratableParts.includes(partName)) {
              this._vibration.triggerClickShake();
              this._scheduleRender();
            }
            this.dispatchEvent(new CustomEvent('part-clicked', { detail: { partName } }));
          },
          requestRender: () => this._scheduleRender()
        });
      }

      this._hideLoading();
      this._scheduleRender();
      this.dispatchEvent(new CustomEvent('car-loaded', { detail: { config } }));
    } catch (err) {
      console.error('[car-viewer] Load error:', err);
      this._showError('Failed to load 3D model');
      throw err;
    }
  }

  async toSideView() {
    if (!this._carGroup || !this._controls) return null;
    return sideView(
      this._scene, this._renderer, this._camera,
      this._carGroup, this._ground, this._headlights,
      this._controls, 256
    );
  }

  toOutline() {
    if (!this._carGroup || !this._controls) return null;
    return outline(
      this._scene, this._renderer, this._camera,
      this._carGroup, this._ground, this._headlights,
      this._controls, 2048
    );
  }

  resetView() {
    if (this._controls) {
      this._controls.reset();
      this._scheduleRender();
    }
  }

  startEngine() {
    if (!this._vibration || !this._interaction) return;
    this._vibration.startEngine(this._interaction.getAudioMap());
    this._needsContinuous = true;
    this._needsHighFPS = true;
    this._scheduleRender();
  }

  stopEngine() {
    if (!this._vibration) return;
    this._vibration.stopEngine();
    this._needsHighFPS = false;
    const autoRotate = this.hasAttribute('auto-rotate') && this.getAttribute('auto-rotate') !== 'false';
    this._needsContinuous = autoRotate;
    this._scheduleRender();
  }

  toggleLights(on, params) {
    if (!this._headlights) return;
    this._headlights.toggle(on, params);
    this._scheduleRender();
  }

  destroy() {
    this._isDestroyed = true;
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
    if (this._intersectionObs) { this._intersectionObs.disconnect(); this._intersectionObs = null; }
    this._disposeCarModules();
    if (this._controls) { this._controls.dispose(); this._controls = null; }
    if (this._renderer) { this._renderer.dispose(); this._renderer = null; }
  }

  _disposeCarModules() {
    if (this._interaction) { this._interaction.dispose(); this._interaction = null; }
    if (this._vibration && this._vibration.isEngineRunning) { this._vibration.stopEngine(); }
    this._vibration = null;
    if (this._headlights && this._headlights.isOn) { this._headlights.toggle(false); }
    this._headlights = null;
    if (this._carGroup && this._scene) {
      this._scene.remove(this._carGroup);
      this._carGroup.traverse((child) => {
        if (child.isMesh) {
          child.geometry.dispose();
          child.material.dispose();
        }
      });
    }
    this._carGroup = null;
    this._partMap = null;
  }

  // ── UI helpers ─────────────────────────────────────────

  _showLoading(msg = 'Loading...') { this._loadingEl.textContent = msg; this._loadingEl.hidden = false; this._errorEl.hidden = true; }
  _hideLoading() { this._loadingEl.hidden = true; }
  _showError(msg) { this._errorEl.textContent = msg; this._errorEl.hidden = false; this._loadingEl.hidden = true; }
}

customElements.define('car-viewer', CarViewer);
