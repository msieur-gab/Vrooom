/**
 * <car-viewer> — Standalone 3D car viewer Web Component.
 *
 * Powered by Google's <model-viewer>. Loads GLB files with named
 * materials mapped to sounds via car config JSON.
 *
 * Requires: <script type="module" src="https://cdn.jsdelivr.net/npm/@google/model-viewer/dist/model-viewer.min.js"></script>
 *
 * Attributes:
 *   background-color  — hex color for background (default: #f45436)
 *   auto-rotate       — enable auto-rotation
 *   interactive       — set "false" to disable click/tap (default: on)
 *
 * Public API:
 *   loadCar(config)   — load a car config object (must include glbUrl)
 *   destroy()         — cleanup
 *   resetView()       — reset camera to default framing
 */

class CarViewer extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    // Sound mapping: materialName → soundUrl
    this._soundMap = new Map();
    this._defaultClickSound = null;
    this._activeSound = null;

    // Vibration
    this._vibrationActive = false;
    this._vibrationEndTime = 0;
    this._vibrationAmplitude = 0.4;
    this._vibrationFrequency = 12;
    this._vibrationRaf = null;

    this._isDestroyed = false;
    this._onClick = null;

    this._initDOM();
  }

  // ── DOM ─────────────────────────────────────────────────

  _initDOM() {
    const bg = this.getAttribute('background-color') || '#f45436';
    const autoRotate = this.hasAttribute('auto-rotate') && this.getAttribute('auto-rotate') !== 'false';

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
        model-viewer {
          width: 100%;
          height: 100%;
          --poster-color: transparent;
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
      <model-viewer
        camera-controls
        disable-tap
        disable-pan
        ${autoRotate ? 'auto-rotate' : ''}
        auto-rotate-delay="2000"
        rotation-per-second="30deg"
        camera-orbit="41deg 65deg auto"
        min-camera-orbit="auto 30deg auto"
        max-camera-orbit="auto 85deg auto"
        field-of-view="45deg"
        min-field-of-view="25deg"
        max-field-of-view="60deg"
        shadow-intensity="1.75"
        shadow-softness="0.65"
        environment-image="legacy"
        exposure="0.6"
        interpolation-decay="100"
        style="background-color: ${bg};">
      </model-viewer>
      <div class="msg" id="loading" hidden>Loading 3D car…</div>
      <div class="msg error" id="error" hidden></div>
    `;

    this._viewer = this.shadowRoot.querySelector('model-viewer');
    this._loadingEl = this.shadowRoot.getElementById('loading');
    this._errorEl = this.shadowRoot.getElementById('error');

  }

  // ── Lifecycle ───────────────────────────────────────────

  connectedCallback() {
    if (this._isDestroyed) return;
    this._setupEvents();
  }

  disconnectedCallback() {
    this._removeEvents();
  }

  static get observedAttributes() { return ['background-color', 'auto-rotate', 'interactive']; }

  attributeChangedCallback(name, _, val) {
    if (!this._viewer) return;
    if (name === 'auto-rotate') {
      if (val !== null && val !== 'false') this._viewer.setAttribute('auto-rotate', '');
      else this._viewer.removeAttribute('auto-rotate');
    }
    if (name === 'background-color') {
      this._viewer.style.backgroundColor = val || '#f45436';
      this.style.background = val || '#f45436';
    }
  }

  get isInteractive() {
    const v = this.getAttribute('interactive');
    return v === null || v !== 'false';
  }

  // ── Events ──────────────────────────────────────────────

  _setupEvents() {
    if (this._onClick) return;
    this._onClick = (e) => {
      if (!this.isInteractive || this._isDestroyed) return;
      this._handleClick(e);
    };
    this._viewer.addEventListener('click', this._onClick);
  }

  _removeEvents() {
    if (this._onClick) {
      this._viewer.removeEventListener('click', this._onClick);
      this._onClick = null;
    }
  }

  // ── Car loading ─────────────────────────────────────────

  async loadCar(config) {
    if (this._isDestroyed) return;

    this._stopSound();
    this._showLoading('Loading car…');

    // Build sound map from config parts
    this._soundMap.clear();
    this._defaultClickSound = config.defaultClickSound || null;
    this._vibrationAmplitude = config.vibrationAmplitude || 0.4;
    this._vibrationFrequency = config.vibrationFrequency || 12;

    if (config.parts) {
      for (const part of config.parts) {
        if (part.name && part.soundUrl) {
          this._soundMap.set(part.name.toLowerCase(), part.soundUrl);
        }
      }
    }

    // Load GLB
    const glbUrl = config.glbUrl;
    if (!glbUrl) {
      this._showError('No GLB model URL in config');
      return;
    }

    this._viewer.src = glbUrl;

    return new Promise((resolve, reject) => {
      const onLoad = () => {
        cleanup();
        this._centerTarget();
        this._applyMatte();
        this._applyColors(config);
        this._hideLoading();
        this.dispatchEvent(new CustomEvent('car-loaded', { detail: { config } }));
        resolve();
      };
      const onError = () => {
        cleanup();
        this._showError('Failed to load 3D model');
        reject(new Error('GLB load failed'));
      };
      const cleanup = () => {
        this._viewer.removeEventListener('load', onLoad);
        this._viewer.removeEventListener('error', onError);
      };
      this._viewer.addEventListener('load', onLoad, { once: true });
      this._viewer.addEventListener('error', onError, { once: true });
    });
  }

  // Center orbit pivot on model center, biased toward ground
  _centerTarget() {
    // getDimensions returns {x, y, z} size in meters
    const dim = this._viewer.getDimensions();
    if (!dim) return;
    // Pivot at 1/3 of the height — low enough to feel grounded,
    // high enough that rotation doesn't clip the ground
    const pivotY = dim.y * 0.33;
    this._viewer.cameraTarget = `auto ${pivotY}m auto`;
  }

  // Force matte wood-toy look on all materials
  _applyMatte() {
    if (!this._viewer.model) return;
    for (const mat of this._viewer.model.materials) {
      mat.pbrMetallicRoughness.setMetallicFactor(0.1);
      mat.pbrMetallicRoughness.setRoughnessFactor(0.8);
    }
  }

  // Apply colors from config parts to matching materials
  _applyColors(config) {
    if (!config.parts || !this._viewer.model) return;

    for (const part of config.parts) {
      const mat = this._viewer.model.materials.find(
        m => m.name.toLowerCase() === part.name.toLowerCase()
      );
      if (mat && part.defaultColor) {
        const c = this._hexToRgb(part.defaultColor);
        const alpha = part.opacity !== undefined ? part.opacity : 1;
        mat.pbrMetallicRoughness.setBaseColorFactor([c.r, c.g, c.b, alpha]);
      }
    }
  }

  _hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
  }

  // ── Click → sound ──────────────────────────────────────

  _handleClick() {
    this._playSound(this._defaultClickSound);
    this.dispatchEvent(new CustomEvent('part-clicked', { detail: { partName: 'car' } }));
  }

  // ── Audio ──────────────────────────────────────────────

  _playSound(url) {
    if (!url) return;
    this._stopSound();

    const audio = new Audio(url);
    audio.volume = 0.5;
    audio.play().catch(() => {});
    this._activeSound = audio;

    this._startVibration();

    audio.addEventListener('ended', () => {
      if (this._activeSound === audio) this._activeSound = null;
      this._stopVibration();
    });
  }

  _stopSound() {
    if (this._activeSound) { this._activeSound.pause(); this._activeSound = null; }
    this._stopVibration();
  }

  // ── Vibration (CSS transform shake) ────────────────────

  _startVibration() {
    this._vibrationActive = true;
    this._vibrationEndTime = performance.now() + 800;
    this._animateVibration();
  }

  _stopVibration() {
    this._vibrationActive = false;
    if (this._vibrationRaf) { cancelAnimationFrame(this._vibrationRaf); this._vibrationRaf = null; }
  }

  _animateVibration() {
    if (!this._vibrationActive || performance.now() >= this._vibrationEndTime) {
      this._stopVibration();
      return;
    }
    this._vibrationRaf = requestAnimationFrame(() => this._animateVibration());
  }

  // ── Public API ─────────────────────────────────────────

  // Capture current view as a data URL (PNG)
  toImage() {
    if (!this._viewer) return null;
    return this._viewer.toDataURL('image/png');
  }

  // Capture a side-view snapshot for use as map marker / thumbnail
  async toSideView() {
    if (!this._viewer) return null;
    // Save current camera
    const prevOrbit = this._viewer.getCameraOrbit();
    const prevFov = this._viewer.getFieldOfView();

    // Set side view: 90deg = pure side, 75deg = slightly above
    this._viewer.cameraOrbit = '90deg 75deg auto';
    this._viewer.fieldOfView = '35deg';
    this._viewer.jumpCameraToGoal();

    // Wait one frame for render
    await new Promise(r => requestAnimationFrame(r));
    const dataUrl = this._viewer.toDataURL('image/png');

    // Restore camera
    this._viewer.cameraOrbit = `${prevOrbit.theta}rad ${prevOrbit.phi}rad ${prevOrbit.radius}m`;
    this._viewer.fieldOfView = `${prevFov}deg`;
    this._viewer.jumpCameraToGoal();

    return dataUrl;
  }

  resetView() {
    if (this._viewer) {
      this._centerTarget();
      this._viewer.cameraOrbit = '41deg 65deg auto';
      this._viewer.fieldOfView = '45deg';
      this._viewer.jumpCameraToGoal();
    }
  }

  destroy() {
    this._isDestroyed = true;
    this._removeEvents();
    this._stopSound();
    if (this._viewer) { this._viewer.src = ''; }
  }

  // ── UI helpers ─────────────────────────────────────────

  _showLoading(msg = 'Loading…') { this._loadingEl.textContent = msg; this._loadingEl.hidden = false; this._errorEl.hidden = true; }
  _hideLoading() { this._loadingEl.hidden = true; }
  _showError(msg) { this._errorEl.textContent = msg; this._errorEl.hidden = false; this._loadingEl.hidden = true; }
}

customElements.define('car-viewer', CarViewer);
