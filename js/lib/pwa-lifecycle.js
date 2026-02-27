/**
 * PWALifecycle — Service worker registration, install detection, update lifecycle.
 * Drop-in module for any PWA. No dependencies.
 *
 * @example
 * const pwa = new PWALifecycle({ swPath: './sw.js', updateInterval: 60000 });
 * pwa.on('canInstall', ({ platform }) => console.log('Install available on', platform));
 * pwa.on('updateAvailable', () => console.log('New version ready'));
 */

export class PWALifecycle {
  #listeners = {};
  #deferredPrompt = null;
  #swRegistration = null;
  #hadController = false;
  #updateTimer = null;

  constructor({ swPath = null, updateInterval = 60000 } = {}) {
    this.swPath = swPath;
    this.updateInterval = updateInterval;

    // Detect platform
    this.platform = this.#detectPlatform();
    this.isIOS = this.platform === 'ios';
    this.isInstalled = this.#checkStandalone();
    this.canPromptInstall = false;

    // Capture beforeinstallprompt (Android / desktop Chrome & Edge)
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.#deferredPrompt = e;
      this.canPromptInstall = true;
      this.#emit('canInstall', { platform: this.platform });
    });

    // Listen for appinstalled
    window.addEventListener('appinstalled', () => {
      this.isInstalled = true;
      this.canPromptInstall = false;
      this.#deferredPrompt = null;
      this.#emit('installed', { platform: this.platform });
    });

    // iOS: emit canInstall if not already installed
    if (this.isIOS && !this.isInstalled) {
      // Defer so listeners attached after construction still catch it
      queueMicrotask(() => {
        this.#emit('canInstall', { platform: 'ios' });
      });
    }

    // Register service worker
    if (swPath && 'serviceWorker' in navigator) {
      this.#registerSW();
    }
  }

  get swRegistration() {
    return this.#swRegistration;
  }

  /**
   * Trigger the deferred install prompt (Android / desktop Chrome & Edge).
   * @returns {Promise<{ outcome: 'accepted' | 'dismissed' }>}
   */
  async promptInstall() {
    if (!this.#deferredPrompt) {
      return { outcome: 'dismissed' };
    }

    this.#deferredPrompt.prompt();
    const { outcome } = await this.#deferredPrompt.userChoice;

    this.#deferredPrompt = null;
    this.canPromptInstall = false;

    if (outcome === 'accepted') {
      this.#emit('installed', { platform: this.platform });
    } else {
      this.#emit('dismissed', { platform: this.platform });
    }

    return { outcome };
  }

  /** Manually trigger a service worker update check. */
  async checkForUpdate() {
    if (!this.#swRegistration) return;
    try {
      await this.#swRegistration.update();
    } catch {
      // Network errors during update check are expected offline
    }
  }

  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {Function} callback
   */
  on(event, callback) {
    if (!this.#listeners[event]) this.#listeners[event] = [];
    this.#listeners[event].push(callback);
  }

  /**
   * Unsubscribe from an event.
   * @param {string} event
   * @param {Function} callback
   */
  off(event, callback) {
    const list = this.#listeners[event];
    if (!list) return;
    const idx = list.indexOf(callback);
    if (idx !== -1) list.splice(idx, 1);
  }

  /** Stop update polling and clean up. */
  destroy() {
    if (this.#updateTimer) {
      clearInterval(this.#updateTimer);
      this.#updateTimer = null;
    }
  }

  // ── Private ───────────────────────────────────────────────

  async #registerSW() {
    // Track whether a controller already existed (Pilipala pattern)
    this.#hadController = !!navigator.serviceWorker.controller;

    // Listen for controller change — means a new SW took over
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (this.#hadController) {
        this.#emit('updateApplied', {});
      }
    });

    try {
      const reg = await navigator.serviceWorker.register(this.swPath);
      this.#swRegistration = reg;

      // If there's already a waiting worker, emit updateAvailable
      if (reg.waiting) {
        this.#emit('updateAvailable', { registration: reg });
      }

      // Watch for new installing workers
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            this.#emit('updateAvailable', { registration: reg });
          }
        });
      });

      // SW is active and ready
      if (reg.active) {
        this.#emit('swReady', { registration: reg });
      } else {
        // Wait for the installing worker to become active
        const worker = reg.installing || reg.waiting;
        if (worker) {
          worker.addEventListener('statechange', () => {
            if (worker.state === 'activated') {
              this.#emit('swReady', { registration: reg });
            }
          });
        }
      }

      // Start polling for updates
      if (this.updateInterval > 0) {
        this.#updateTimer = setInterval(() => this.checkForUpdate(), this.updateInterval);
      }
    } catch (error) {
      this.#emit('swError', { error });
    }
  }

  #detectPlatform() {
    // Allow override via URL param for testing: ?platform=ios
    const override = new URLSearchParams(window.location.search).get('platform');
    if (override && ['ios', 'android', 'desktop'].includes(override)) return override;

    const ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) return 'ios';
    if (/Android/.test(ua)) return 'android';
    return 'desktop';
  }

  #checkStandalone() {
    // iOS standalone
    if (navigator.standalone === true) return true;
    // Standard display-mode
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.matchMedia('(display-mode: minimal-ui)').matches) return true;
    return false;
  }

  #emit(event, payload) {
    const list = this.#listeners[event];
    if (!list) return;
    for (const cb of list) {
      try {
        cb(payload);
      } catch (e) {
        console.error(`[PWALifecycle] Error in ${event} handler:`, e);
      }
    }
  }
}
