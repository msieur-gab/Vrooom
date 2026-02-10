/**
 * <car-viewer> — Standalone 3D car viewer Web Component.
 *
 * Portable: works in any page with just Three.js globals (THREE.Scene, etc.).
 * Drop in a <script> tag + Three.js CDN and you're good.
 *
 * Attributes:
 *   background-color  — hex color for scene background (default: #f45436)
 *   auto-rotate       — presence enables auto-rotation
 *   interactive       — presence enables click/touch interaction (default: true if absent? no — default ON, set interactive="false" to disable)
 *
 * Public API:
 *   loadCar(config)   — load a car config JSON object
 *   destroy()         — full cleanup
 *   resetView()       — reset camera to fit loaded car
 */

class CarViewer extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    this.instanceId = 'cv-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

    // Three.js scene objects
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.loadedObjects = new Map();
    this.group = null; // created after THREE is available
    this.groundPlane = null;

    // Audio
    this.audioListener = null;
    this.audioBuffers = new Map();
    this.defaultClickSoundBuffer = null;
    this.activeAudio = null;

    // Interaction
    this.raycaster = null;
    this.mouse = null;

    // Vibration
    this.vibrationActive = false;
    this.vibrationEndTime = 0;
    this.vibrationAmplitude = 0.4;
    this.vibrationFrequency = 12;
    this.vibrationAxis = 'x';
    this.vibratableParts = [];
    this.originalPositions = new Map();
    this.originalEmissive = new Map();

    // State
    this.animationId = null;
    this.isInitialized = false;
    this.isDestroyed = false;
    this.loadAbortController = null;

    // Event handler refs for cleanup
    this._onResize = null;
    this._onClick = null;

    this._initDOM();
  }

  // ── DOM scaffold ────────────────────────────────────────

  _initDOM() {
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
          display: block;
          width: 100%;
          height: 100%;
        }
        .msg {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          color: white;
          font-family: 'DM Sans', system-ui, sans-serif;
          font-size: 0.9rem;
          font-weight: 500;
          text-align: center;
          pointer-events: none;
          z-index: 10;
          max-width: 90%;
        }
        .msg.error {
          color: #fee2e2;
          background: rgba(239,68,68,0.15);
          padding: 0.75rem 1rem;
          border-radius: 0.5rem;
          border: 1px solid rgba(239,68,68,0.25);
        }
        .msg[hidden] { display: none; }
      </style>
      <canvas></canvas>
      <div class="msg" id="loading">Loading 3D car…</div>
      <div class="msg error" id="error" hidden></div>
    `;

    this._canvas = this.shadowRoot.querySelector('canvas');
    this._loadingEl = this.shadowRoot.getElementById('loading');
    this._errorEl = this.shadowRoot.getElementById('error');
  }

  // ── Lifecycle ───────────────────────────────────────────

  connectedCallback() {
    if (this.isDestroyed) return;

    if (!this.isInitialized) {
      // Use rAF instead of setTimeout hack — guarantees layout is ready
      requestAnimationFrame(() => {
        if (this.isDestroyed || this.isInitialized) return;
        this._setup().then(() => {
          if (!this.isDestroyed) this._startAnimation();
        }).catch(err => {
          console.error(`[CarViewer ${this.instanceId}] setup failed:`, err);
        });
      });
    } else {
      this._startAnimation();
      this._handleResize();
    }
  }

  disconnectedCallback() {
    this._stopAnimation();
  }

  static get observedAttributes() {
    return ['background-color', 'auto-rotate', 'interactive'];
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (name === 'auto-rotate' && this.controls) {
      this.controls.autoRotate = newVal !== null && newVal !== 'false';
    }
    if (name === 'background-color' && this.scene) {
      this.scene.background = new THREE.Color(newVal || '#f45436');
    }
    if (name === 'interactive') {
      // toggling interactive mode — handled in click handler
    }
  }

  get isInteractive() {
    const attr = this.getAttribute('interactive');
    return attr === null || attr !== 'false'; // default true
  }

  // ── Three.js setup ──────────────────────────────────────

  async _setup() {
    if (this.isDestroyed) return;

    if (typeof THREE === 'undefined') {
      this._showError('Three.js not loaded');
      return;
    }

    // WebGL check
    try {
      const c = document.createElement('canvas');
      if (!(c.getContext('webgl') || c.getContext('experimental-webgl'))) throw 0;
    } catch {
      this._showError('WebGL not supported');
      return;
    }

    const bg = this.getAttribute('background-color') || '#f45436';

    this.group = new THREE.Group();
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(bg);
    this.scene.add(this.group);

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    this.camera.position.set(-60, 30, 90);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this._canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Context loss handling
    this._canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      this._stopAnimation();
    });
    this._canvas.addEventListener('webglcontextrestored', () => {
      this._startAnimation();
    });

    this._handleResize();
    this._setupLighting();
    this._setupGround();
    this._setupControls();
    this._setupAudio();
    this._setupEvents();

    // ResizeObserver
    this._resizeObs = new ResizeObserver(() => {
      if (!this.isDestroyed) this._handleResize();
    });
    this._resizeObs.observe(this);

    this.isInitialized = true;
    this._hideLoading();
  }

  _setupLighting() {
    this.scene.add(new THREE.AmbientLight(0x404040, 2));

    const dir1 = new THREE.DirectionalLight(0xe2e2e2, 1);
    dir1.position.set(50, 200, 100);
    dir1.castShadow = true;
    dir1.shadow.mapSize.set(2048, 2048);
    dir1.shadow.camera.near = 0.5;
    dir1.shadow.camera.far = 500;
    dir1.shadow.camera.left = -80;
    dir1.shadow.camera.right = 80;
    dir1.shadow.camera.top = 80;
    dir1.shadow.camera.bottom = -80;
    dir1.shadow.bias = -0.0005;
    dir1.shadow.normalBias = 0.02;
    dir1.shadow.radius = 8;
    this.scene.add(dir1);

    const dir2 = new THREE.DirectionalLight(0xe2e2e2, 0.8);
    dir2.position.set(-50, -100, -50).normalize();
    this.scene.add(dir2);
  }

  _setupGround() {
    const geo = new THREE.CircleGeometry(90, 64);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.2 });
    this.groundPlane = new THREE.Mesh(geo, mat);
    this.groundPlane.rotation.x = -Math.PI / 2;
    this.groundPlane.position.y = -50;
    this.groundPlane.receiveShadow = true;
    this.scene.add(this.groundPlane);
  }

  _setupControls() {
    this.controls = new THREE.OrbitControls(this.camera, this._canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 500;
    this.controls.autoRotate = this.hasAttribute('auto-rotate') && this.getAttribute('auto-rotate') !== 'false';
    this.controls.autoRotateSpeed = 4.0;
    this.controls.target.set(0, 0, 0);
  }

  _setupAudio() {
    this.audioListener = new THREE.AudioListener();
    this.camera.add(this.audioListener);
  }

  _setupEvents() {
    this._onClick = (e) => {
      if (!this.isInteractive || this.isDestroyed || !this.isInitialized) return;
      this._handleInteraction(e);
    };
    this._canvas.addEventListener('click', this._onClick);
    this._canvas.addEventListener('touchstart', this._onClick);
  }

  // ── Animation loop ──────────────────────────────────────

  _startAnimation() {
    if (this.isDestroyed || this.animationId) return;

    const loop = () => {
      if (this.isDestroyed) return;
      this.animationId = requestAnimationFrame(loop);
      if (this.controls) this.controls.update();
      this._updateVibration();
      if (this.renderer && this.scene && this.camera) {
        try { this.renderer.render(this.scene, this.camera); }
        catch { this._stopAnimation(); }
      }
    };
    loop();
  }

  _stopAnimation() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  // ── Car loading ─────────────────────────────────────────

  async loadCar(config) {
    if (this.isDestroyed) return;

    // Abort any in-flight load
    if (this.loadAbortController) {
      this.loadAbortController.abort();
    }
    this.loadAbortController = new AbortController();
    const signal = this.loadAbortController.signal;

    try {
      if (!this.isInitialized) {
        await this._setup();
      }

      this._clearAllParts();
      this._showLoading('Loading car…');

      // Vibration config
      this.vibrationAmplitude = config.vibrationAmplitude || 0.4;
      this.vibrationFrequency = config.vibrationFrequency || 12;
      this.vibrationAxis = (config.vibrationAxis || 'x').toLowerCase();
      this.vibratableParts = (config.vibratableParts || []).map(p => p.toLowerCase());

      // Default click sound
      if (config.defaultClickSound) {
        try {
          this.defaultClickSoundBuffer = await this._loadAudioBuffer(config.defaultClickSound);
        } catch { /* non-critical */ }
      }

      if (signal.aborted) return;

      // Load parts with Promise.allSettled — partial load on STL failure
      const results = await Promise.allSettled(
        config.parts.map(part => this._loadPart(part, signal))
      );

      if (signal.aborted) return;

      const loaded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected');

      if (failed.length > 0) {
        console.warn(`[CarViewer] ${failed.length} part(s) failed to load`);
        failed.forEach(f => console.warn('  -', f.reason?.message || f.reason));
      }

      if (loaded === 0) {
        this._showError('Failed to load car parts');
        return;
      }

      this._updateCamera();
      this._hideLoading();

      if (!this.animationId && !this.isDestroyed) {
        this._startAnimation();
      }

      this.dispatchEvent(new CustomEvent('car-loaded', { detail: { config, loaded, failed: failed.length } }));
    } catch (err) {
      if (!signal.aborted) {
        this._showError(`Failed to load car: ${err.message}`);
      }
    }
  }

  async _loadPart(partConfig, signal) {
    if (this.isDestroyed || signal?.aborted) return;

    const geometry = await this._loadSTL(partConfig.stlUrl);
    if (signal?.aborted) throw new Error('aborted');

    const matProps = { roughness: 0.8, metalness: 0.1 };
    const hasColors = geometry.hasColors && geometry.attributes.color?.count > 0;

    if (hasColors) {
      matProps.vertexColors = true;
      matProps.roughness = 0.7;
    } else {
      matProps.color = new THREE.Color(partConfig.defaultColor || '#007bff');
      if (partConfig.transparent !== undefined) matProps.transparent = partConfig.transparent;
      if (partConfig.opacity !== undefined) matProps.opacity = partConfig.opacity;
    }

    const material = new THREE.MeshStandardMaterial(matProps);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Part-specific sound
    let soundBuffer = null;
    if (partConfig.soundUrl) {
      try { soundBuffer = await this._loadAudioBuffer(partConfig.soundUrl); }
      catch { /* non-critical */ }
    }

    const partId = `${this.instanceId}-${partConfig.name}-${Date.now().toString(36)}`;
    this.loadedObjects.set(partId, {
      mesh,
      originalFileName: partConfig.name,
      hasEmbeddedColor: hasColors,
      soundBuffer,
      id: partId
    });
    this.group.add(mesh);
  }

  _loadSTL(url) {
    return new Promise((resolve, reject) => {
      const loader = new THREE.STLLoader();
      loader.load(
        url,
        geo => { geo.computeBoundingBox(); resolve(geo); },
        undefined,
        err => reject(new Error(`STL load failed: ${url}`))
      );
    });
  }

  _loadAudioBuffer(url) {
    if (this.audioBuffers.has(url)) return Promise.resolve(this.audioBuffers.get(url));
    return new Promise((resolve, reject) => {
      new THREE.AudioLoader().load(
        url,
        buffer => { this.audioBuffers.set(url, buffer); resolve(buffer); },
        undefined,
        reject
      );
    });
  }

  // ── Interaction ─────────────────────────────────────────

  _handleInteraction(event) {
    if (!this.isInitialized || this.isDestroyed) return;
    event.preventDefault();

    const touch = event.touches?.[0];
    const cx = touch ? touch.clientX : event.clientX;
    const cy = touch ? touch.clientY : event.clientY;

    const rect = this._canvas.getBoundingClientRect();
    this.mouse.x = ((cx - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((cy - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.group.children, true);

    if (hits.length > 0) {
      const hitObj = hits[0].object;
      for (const [, data] of this.loadedObjects) {
        if (data.mesh === hitObj || hitObj.parent === data.mesh || data.mesh.children?.includes(hitObj)) {
          this._playPartSound(data);
          this.dispatchEvent(new CustomEvent('part-clicked', {
            detail: { partName: data.originalFileName, partData: data }
          }));
          break;
        }
      }
    }
  }

  _playPartSound(partData) {
    // Stop + dispose previous audio
    if (this.activeAudio) {
      if (this.activeAudio.isPlaying) this.activeAudio.stop();
      this.activeAudio.disconnect();
      this.activeAudio = null;
    }
    this._stopVibration();

    const buffer = partData.soundBuffer || this.defaultClickSoundBuffer;
    if (!buffer) return;

    this.activeAudio = new THREE.Audio(this.audioListener);
    this.activeAudio.setBuffer(buffer);
    this.activeAudio.setLoop(false);
    this.activeAudio.setVolume(0.5);

    const endTime = performance.now() + buffer.duration * 1000;
    this._startVibration(endTime);
    this.activeAudio.play();
  }

  // ── Vibration ───────────────────────────────────────────

  _startVibration(endTimeMs) {
    this.vibrationActive = true;
    this.vibrationEndTime = endTimeMs;
    this.originalPositions.clear();
    this.originalEmissive.clear();

    for (const [id, data] of this.loadedObjects) {
      const name = data.originalFileName.toLowerCase();
      if (this.vibratableParts.includes(name)) {
        this.originalPositions.set(id, data.mesh.position.clone());
      }
      if (name.includes('light') && data.mesh.material?.isMeshStandardMaterial) {
        this.originalEmissive.set(id, {
          color: data.mesh.material.emissive.clone(),
          intensity: data.mesh.material.emissiveIntensity
        });
        data.mesh.material.emissive.copy(data.mesh.material.color);
        data.mesh.material.emissiveIntensity = 0.8;
        data.mesh.material.needsUpdate = true;
      }
    }
  }

  _stopVibration() {
    this.vibrationActive = false;
    for (const [id, data] of this.loadedObjects) {
      if (this.originalPositions.has(id)) data.mesh.position.copy(this.originalPositions.get(id));
      if (this.originalEmissive.has(id)) {
        const orig = this.originalEmissive.get(id);
        data.mesh.material.emissive.copy(orig.color);
        data.mesh.material.emissiveIntensity = orig.intensity;
        data.mesh.material.needsUpdate = true;
      }
    }
    this.originalPositions.clear();
    this.originalEmissive.clear();
  }

  _updateVibration() {
    if (!this.vibrationActive) return;
    const now = performance.now();
    if (now >= this.vibrationEndTime) { this._stopVibration(); return; }

    const elapsed = now - (this.vibrationEndTime -
      (this.activeAudio?.buffer ? this.activeAudio.buffer.duration : 0) * 1000);
    const offset = Math.sin(elapsed * 0.001 * this.vibrationFrequency * Math.PI * 2) * this.vibrationAmplitude;

    for (const [id, data] of this.loadedObjects) {
      if (!this.originalPositions.has(id)) continue;
      data.mesh.position.copy(this.originalPositions.get(id));
      data.mesh.position[this.vibrationAxis] += offset;
    }
  }

  // ── Camera ──────────────────────────────────────────────

  _updateCamera() {
    if (this.loadedObjects.size === 0) {
      this.camera.position.set(-60, 30, 90);
      this.controls.target.set(0, 0, 0);
      this.controls.update();
      this.group.position.set(0, 0, 0);
      return;
    }

    const box = new THREE.Box3().setFromObject(this.group);
    const center = new THREE.Vector3();
    box.getCenter(center);

    // Align to ground
    this.group.position.y += this.groundPlane.position.y - box.min.y;
    this.group.position.x -= center.x;
    this.group.position.z -= center.z;

    box.setFromObject(this.group);
    box.getCenter(center);
    this.controls.target.copy(center);

    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = this.camera.fov * (Math.PI / 180);
    const dist = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5;

    this.camera.position.copy(center);
    this.camera.position.x += dist * 0.7;
    this.camera.position.z += dist * 0.8;
    this.camera.position.y += dist * 0.5;
    this.camera.lookAt(center);
    this.controls.update();
  }

  resetView() {
    this._updateCamera();
  }

  // ── Cleanup ─────────────────────────────────────────────

  _clearAllParts() {
    // Stop & dispose active audio
    if (this.activeAudio) {
      if (this.activeAudio.isPlaying) this.activeAudio.stop();
      this.activeAudio.disconnect();
      this.activeAudio = null;
    }
    this._stopVibration();

    // Dispose geometries & materials
    if (this.group) {
      this.group.children.forEach(child => {
        if (child.isMesh) {
          child.geometry?.dispose();
          child.material?.dispose();
        }
      });
      this.group.clear();
    }
    this.loadedObjects.clear();
    this.defaultClickSoundBuffer = null;
  }

  destroy() {
    this.isDestroyed = true;
    this._stopAnimation();

    // Abort in-flight loads
    if (this.loadAbortController) {
      this.loadAbortController.abort();
      this.loadAbortController = null;
    }

    if (this._resizeObs) this._resizeObs.disconnect();

    if (this._onClick) {
      this._canvas.removeEventListener('click', this._onClick);
      this._canvas.removeEventListener('touchstart', this._onClick);
    }

    this._clearAllParts();

    // Dispose audio buffers
    this.audioBuffers.clear();

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer = null;
    }
    if (this.controls) {
      this.controls.dispose();
      this.controls = null;
    }

    this.scene = null;
    this.camera = null;
  }

  // ── Resize ──────────────────────────────────────────────

  _handleResize() {
    if (!this.renderer || !this.camera || this.isDestroyed) return;
    const { width, height } = this.getBoundingClientRect();
    if (width > 0 && height > 0) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
    }
  }

  // ── UI helpers ──────────────────────────────────────────

  _showLoading(msg = 'Loading…') {
    this._loadingEl.textContent = msg;
    this._loadingEl.hidden = false;
    this._errorEl.hidden = true;
  }

  _hideLoading() {
    this._loadingEl.hidden = true;
  }

  _showError(msg) {
    this._errorEl.textContent = msg;
    this._errorEl.hidden = false;
    this._loadingEl.hidden = true;
  }
}

customElements.define('car-viewer', CarViewer);
