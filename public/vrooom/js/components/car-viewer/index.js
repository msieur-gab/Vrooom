/**
 * <car-viewer> — Three.js Web Component for STL car rendering.
 *
 * Attributes:
 *   background-color  — hex color for background (default: #f45436)
 *   auto-rotate       — enable auto-rotation
 *   interactive       — set "false" to disable click/tap
 *
 * Public API:
 *   loadCar(config)       — load a car config object
 *   toSideView()          — 256px 3/4 view PNG data URL
 *   toSideProfiles(size)  — { left, right } pure side-view PNGs
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

const FRAME_MS = 1000 / 30; // 30fps — plenty for a toy car

class CarViewer extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._loop = null;
    this._visible = false;
    this._initialized = false;

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
    this._loadCount = 0; // bumped per loadCar; an overtaken load is dropped
  }

  connectedCallback() {
    this._buildShell();
  }

  disconnectedCallback() {
    this.destroy();
  }

  static get observedAttributes() { return ['background-color', 'auto-rotate']; }

  attributeChangedCallback(name, _, val) {
    if (!this._initialized) return;
    if (name === 'background-color') {
      const c = val || '#f45436';
      this._scene.background.set(c);
      this._renderer.setClearColor(c, 1);
      if (this._ground) this._ground.material.color.set(c);
    }
    if (name === 'auto-rotate' && this._controls) {
      this._controls.setAutoRotate(val !== null && val !== 'false');
    }
  }

  // ── Shell (no WebGL yet) ──────────────────────────────

  _buildShell() {
    const bg = this.getAttribute('background-color') || '#f45436';
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; width:100%; height:100%; position:relative;
                background:${bg}; border-radius:0.5rem; overflow:hidden; min-height:250px; }
        canvas { width:100%; height:100%; display:block; touch-action:none; }
        .msg { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
               color:white; font-family:'DM Sans',system-ui,sans-serif;
               font-size:0.9rem; font-weight:500; text-align:center;
               pointer-events:none; z-index:10; max-width:90%; }
        .msg.error { color:#fee2e2; background:rgba(239,68,68,0.15);
                     padding:0.75rem 1rem; border-radius:0.5rem;
                     border:1px solid rgba(239,68,68,0.25); }
        .msg[hidden] { display:none; }
      </style>
      <canvas></canvas>
      <div class="msg" id="loading" hidden>Loading car…</div>
      <div class="msg error" id="error" hidden></div>
    `;

    this._canvas = this.shadowRoot.querySelector('canvas');
    this._loadingEl = this.shadowRoot.getElementById('loading');
    this._errorEl = this.shadowRoot.getElementById('error');

    // Visible → 30fps loop. Hidden → stop. Simple.
    new IntersectionObserver(([e]) => {
      this._visible = e.isIntersecting;
      if (this._visible) this._startLoop();
      else this._stopLoop();
    }, { threshold: 0 }).observe(this);
  }

  // ── Lazy WebGL (first loadCar call) ───────────────────

  _initThree() {
    if (this._initialized) return;
    this._initialized = true;

    const bg = this.getAttribute('background-color') || '#f45436';
    const { scene, renderer, camera, ground } = createScene(this._canvas, bg);
    Object.assign(this, { _scene: scene, _renderer: renderer, _camera: camera, _ground: ground });

    const rect = this.getBoundingClientRect();
    resize(renderer, camera, rect.width || 300, rect.height || 300);

    const autoRotate = this.hasAttribute('auto-rotate') && this.getAttribute('auto-rotate') !== 'false';
    this._controls = createControls(camera, this._canvas, { autoRotate });

    new ResizeObserver(() => {
      const r = this.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) resize(this._renderer, this._camera, r.width, r.height);
    }).observe(this);
  }

  // ── 30fps loop ────────────────────────────────────────

  _startLoop() {
    if (this._loop || !this._initialized) return;
    this._loop = setInterval(() => {
      if (this._controls) this._controls.update();
      if (this._vibration) this._vibration.update();
      if (this._renderer) this._renderer.render(this._scene, this._camera);
    }, FRAME_MS);
  }

  _stopLoop() {
    if (this._loop) { clearInterval(this._loop); this._loop = null; }
  }

  // ── Public API ────────────────────────────────────────

  async loadCar(config) {
    this._initThree();
    this._disposeCar();
    this._showLoading();
    this._config = config;
    const load = ++this._loadCount;

    try {
      const { carGroup, partMap, wheelsMesh } = await loadCar(config);

      // A newer loadCar started while this one was fetching: its car is the
      // one to show. Adding this one too would put two cars in the scene.
      if (load !== this._loadCount) {
        disposeGroup(carGroup);
        return;
      }

      this._carGroup = carGroup;
      this._partMap = partMap;
      this._scene.add(carGroup);

      this._vibration = createVibration(carGroup, config);
      this._vibration.setWheels(wheelsMesh);
      this._headlights = createHeadlights(carGroup, partMap);

      if (this.getAttribute('interactive') !== 'false') {
        this._interaction = createInteraction(this._camera, this._canvas, {
          partMap, carGroup,
          defaultClickSound: config.defaultClickSound,
          onPartClicked: (partName) => {
            if ((config.vibratableParts || []).includes(partName)) {
              this._vibration.triggerClickShake();
            }
            this.dispatchEvent(new CustomEvent('part-clicked', { detail: { partName } }));
          }
        });
      }

      this._hideLoading();
      if (this._visible) this._startLoop();
      this.dispatchEvent(new CustomEvent('car-loaded', { detail: { config } }));
    } catch (err) {
      if (load !== this._loadCount) return; // overtaken: its failure no longer matters
      console.error('[car-viewer] Load error:', err);
      this._showError('Failed to load 3D model');
      throw err;
    }
  }

  async toSideView() {
    if (!this._carGroup) return null;
    return sideView(this._scene, this._renderer, this._camera,
      this._carGroup, this._ground, this._headlights, this._controls, 256);
  }

  toSideProfiles(size = 64) {
    if (!this._carGroup) return null;
    const args = [this._scene, this._renderer, this._camera,
      this._carGroup, this._ground, this._headlights, this._controls, size];
    return {
      left: sideView(...args, 'left'),
      right: sideView(...args, 'right')
    };
  }

  toOutline() {
    if (!this._carGroup) return null;
    return outline(this._scene, this._renderer, this._camera,
      this._carGroup, this._ground, this._headlights, this._controls, 2048);
  }

  resetView() {
    if (this._controls) this._controls.reset();
  }

  startEngine() {
    if (!this._vibration || !this._interaction) return;
    this._vibration.startEngine(this._interaction.getAudioMap());
  }

  stopEngine() {
    if (this._vibration) this._vibration.stopEngine();
  }

  toggleLights(on, params) {
    if (this._headlights) this._headlights.toggle(on, params);
  }

  destroy() {
    this._stopLoop();
    this._disposeCar();
    if (this._controls) { this._controls.dispose(); this._controls = null; }
    if (this._renderer) { this._renderer.dispose(); this._renderer = null; }
  }

  _disposeCar() {
    if (this._interaction) { this._interaction.dispose(); this._interaction = null; }
    if (this._vibration?.isEngineRunning) this._vibration.stopEngine();
    this._vibration = null;
    if (this._headlights?.isOn) this._headlights.toggle(false);
    this._headlights = null;
    if (this._carGroup && this._scene) {
      this._scene.remove(this._carGroup);
      disposeGroup(this._carGroup);
    }
    this._carGroup = null;
    this._partMap = null;
  }

  _showLoading() { this._loadingEl.textContent = 'Loading car…'; this._loadingEl.hidden = false; this._errorEl.hidden = true; }
  _hideLoading() { this._loadingEl.hidden = true; }
  _showError(msg) { this._errorEl.textContent = msg; this._errorEl.hidden = false; this._loadingEl.hidden = true; }
}

function disposeGroup(group) {
  group.traverse((c) => {
    if (c.isMesh) { c.geometry.dispose(); c.material.dispose(); }
  });
}

customElements.define('car-viewer', CarViewer);
