/**
 * <pwa-install-overlay> — Self-contained web component for PWA install prompts.
 *
 * Shows platform-appropriate install guidance:
 * - Android/Chrome/Edge: "Install" button triggering beforeinstallprompt
 * - iOS Safari: Step-by-step visual guide (Share → Add to Home Screen)
 * - Desktop: "Install" button
 * - Also shows an update toast when a new SW version is available
 *
 * @example
 * <pwa-install-overlay></pwa-install-overlay>
 * <script type="module">
 *   import { PWALifecycle } from './pwa-lifecycle.js';
 *   import './pwa-install-overlay.js';
 *   const pwa = new PWALifecycle({ swPath: './sw.js' });
 *   document.querySelector('pwa-install-overlay').lifecycle = pwa;
 * </script>
 */

const DISMISS_KEY = 'pwa-install-overlay-dismissed';
const UPDATE_DISMISS_KEY = 'pwa-update-toast-dismissed';

// Fresh page load = fresh chance to show the overlay
sessionStorage.removeItem(DISMISS_KEY);

class PWAInstallOverlay extends HTMLElement {
  #lifecycle = null;
  #root = null;
  #onCanInstall = null;
  #onInstalled = null;
  #onDismissed = null;
  #onUpdateAvailable = null;
  #onUpdateApplied = null;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
  }

  set lifecycle(instance) {
    // Unbind previous
    if (this.#lifecycle) this.#unbind();

    this.#lifecycle = instance;
    this.#bind();

    // If already installed, don't show anything
    if (instance.isInstalled) return;

    // If canPromptInstall is already true or iOS detected, show immediately
    if (instance.canPromptInstall || (instance.isIOS && !instance.isInstalled)) {
      this.#showInstall(instance.platform);
    }
  }

  get lifecycle() {
    return this.#lifecycle;
  }

  #bind() {
    const lc = this.#lifecycle;

    this.#onCanInstall = ({ platform }) => {
      if (!sessionStorage.getItem(DISMISS_KEY)) {
        this.#showInstall(platform);
      }
    };

    this.#onInstalled = () => this.#hideInstall();
    this.#onDismissed = () => this.#hideInstall();

    this.#onUpdateAvailable = () => {
      if (!sessionStorage.getItem(UPDATE_DISMISS_KEY)) {
        this.#showUpdateToast();
      }
    };

    this.#onUpdateApplied = () => this.#hideUpdateToast();

    lc.on('canInstall', this.#onCanInstall);
    lc.on('installed', this.#onInstalled);
    lc.on('dismissed', this.#onDismissed);
    lc.on('updateAvailable', this.#onUpdateAvailable);
    lc.on('updateApplied', this.#onUpdateApplied);
  }

  #unbind() {
    const lc = this.#lifecycle;
    if (!lc) return;
    lc.off('canInstall', this.#onCanInstall);
    lc.off('installed', this.#onInstalled);
    lc.off('dismissed', this.#onDismissed);
    lc.off('updateAvailable', this.#onUpdateAvailable);
    lc.off('updateApplied', this.#onUpdateApplied);
  }

  disconnectedCallback() {
    this.#unbind();
  }

  // ── Install overlay ─────────────────────────────────────

  #showInstall(platform) {
    if (sessionStorage.getItem(DISMISS_KEY)) return;

    const isIOS = platform === 'ios';
    const body = isIOS ? this.#iosInstructions() : this.#promptButton(platform);

    this.#root.innerHTML = `
      ${this.#styles()}
      <div class="overlay" part="overlay">
        <div class="card" part="card">
          <button class="close" part="close" aria-label="Dismiss">&times;</button>
          <div class="content" part="content">
            ${body}
          </div>
        </div>
      </div>
    `;

    // Close button
    this.#root.querySelector('.close').addEventListener('click', () => {
      this.#dismiss();
    });

    // Overlay backdrop click
    this.#root.querySelector('.overlay').addEventListener('click', (e) => {
      if (e.target.classList.contains('overlay')) this.#dismiss();
    });

    // Install button (non-iOS)
    const btn = this.#root.querySelector('.install-btn');
    if (btn) {
      btn.addEventListener('click', () => {
        this.#lifecycle?.promptInstall();
      });
    }
  }

  #hideInstall() {
    const overlay = this.#root.querySelector('.overlay');
    if (overlay) overlay.remove();
  }

  #dismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1');
    this.#hideInstall();
  }

  #promptButton(platform) {
    const label = platform === 'desktop' ? 'Install app' : 'Install';
    return `
      <h2 class="title">Install this app</h2>
      <p class="subtitle">Add to your home screen for the best experience.</p>
      <button class="install-btn" part="install-btn">${label}</button>
    `;
  }

  #iosInstructions() {
    // iOS 13+ uses the box-with-arrow share icon
    // Older iOS uses the square-with-arrow — but iOS < 13 is negligible now
    const shareIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>`;

    const plusIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`;

    return `
      <h2 class="title">Install this app</h2>
      <p class="subtitle">Add to your home screen in two steps:</p>
      <ol class="steps">
        <li class="step">
          <span class="step-icon">${shareIcon}</span>
          <span>Tap the <strong>Share</strong> button in the toolbar below</span>
        </li>
        <li class="step">
          <span class="step-icon">${plusIcon}</span>
          <span>Scroll down and tap <strong>Add to Home Screen</strong></span>
        </li>
      </ol>
    `;
  }

  // ── Update toast ────────────────────────────────────────

  #showUpdateToast() {
    // Remove existing toast if any
    this.#hideUpdateToast();

    const toast = document.createElement('div');
    toast.classList.add('toast');
    toast.setAttribute('part', 'toast');
    toast.innerHTML = `
      <span class="toast-text">Update available</span>
      <button class="toast-btn" part="toast-btn">Refresh</button>
      <button class="toast-close" part="toast-close" aria-label="Dismiss">&times;</button>
    `;

    // Inject styles if not already present
    if (!this.#root.querySelector('style')) {
      this.#root.innerHTML = this.#styles();
    }

    this.#root.appendChild(toast);

    toast.querySelector('.toast-btn').addEventListener('click', () => {
      // Tell the waiting SW to take over
      const reg = this.#lifecycle?.swRegistration;
      if (reg?.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      window.location.reload();
    });

    toast.querySelector('.toast-close').addEventListener('click', () => {
      sessionStorage.setItem(UPDATE_DISMISS_KEY, '1');
      this.#hideUpdateToast();
    });
  }

  #hideUpdateToast() {
    const toast = this.#root.querySelector('.toast');
    if (toast) toast.remove();
  }

  // ── Styles ──────────────────────────────────────────────

  #styles() {
    return `<style>
      :host {
        --_overlay-bg: var(--pwa-overlay-bg, rgba(0, 0, 0, 0.6));
        --_card-bg: var(--pwa-card-bg, #fff);
        --_card-radius: var(--pwa-card-radius, 16px);
        --_accent: var(--pwa-accent, #007AFF);
        --_text: var(--pwa-text, #1a1a1a);
        --_text-secondary: var(--pwa-text-secondary, #666);
        --_font: var(--pwa-font, system-ui, -apple-system, sans-serif);
        --_toast-bg: var(--pwa-toast-bg, #333);
        --_toast-text: var(--pwa-toast-text, #fff);

        display: contents;
        font-family: var(--_font);
      }

      .overlay {
        position: fixed;
        inset: 0;
        z-index: 10000;
        background: var(--_overlay-bg);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        animation: fadeIn 0.2s ease-out;
      }

      .card {
        background: var(--_card-bg);
        border-radius: var(--_card-radius);
        padding: 32px 28px 28px;
        max-width: 360px;
        width: 100%;
        position: relative;
        animation: slideUp 0.3s ease-out;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
      }

      .close {
        position: absolute;
        top: 12px;
        right: 12px;
        background: none;
        border: none;
        font-size: 24px;
        color: var(--_text-secondary);
        cursor: pointer;
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background-color 0.15s;
      }

      .close:hover {
        background: rgba(0, 0, 0, 0.05);
      }

      .title {
        margin: 0 0 8px;
        font-size: 20px;
        font-weight: 600;
        color: var(--_text);
      }

      .subtitle {
        margin: 0 0 20px;
        font-size: 15px;
        color: var(--_text-secondary);
        line-height: 1.4;
      }

      .install-btn {
        display: block;
        width: 100%;
        padding: 14px;
        background: var(--_accent);
        color: #fff;
        border: none;
        border-radius: 12px;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        font-family: var(--_font);
        transition: opacity 0.15s;
      }

      .install-btn:hover {
        opacity: 0.9;
      }

      .install-btn:active {
        opacity: 0.8;
      }

      .steps {
        list-style: none;
        padding: 0;
        margin: 0;
      }

      .step {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 14px 0;
        font-size: 15px;
        color: var(--_text);
        line-height: 1.4;
      }

      .step + .step {
        border-top: 1px solid rgba(0, 0, 0, 0.06);
      }

      .step-icon {
        flex-shrink: 0;
        width: 40px;
        height: 40px;
        background: rgba(0, 122, 255, 0.1);
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--_accent);
      }

      /* Update toast */
      .toast {
        position: fixed;
        bottom: 24px;
        left: 24px;
        right: 24px;
        z-index: 10001;
        background: var(--_toast-bg);
        color: var(--_toast-text);
        border-radius: 12px;
        padding: 14px 16px;
        display: flex;
        align-items: center;
        gap: 12px;
        font-family: var(--_font);
        font-size: 14px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
        animation: slideUpToast 0.3s ease-out;
        max-width: 480px;
        margin: 0 auto;
      }

      .toast-text {
        flex: 1;
      }

      .toast-btn {
        background: var(--_accent);
        color: #fff;
        border: none;
        border-radius: 8px;
        padding: 8px 16px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        font-family: var(--_font);
        white-space: nowrap;
        transition: opacity 0.15s;
      }

      .toast-btn:hover {
        opacity: 0.9;
      }

      .toast-close {
        background: none;
        border: none;
        color: var(--_toast-text);
        font-size: 20px;
        cursor: pointer;
        opacity: 0.6;
        padding: 0 4px;
        transition: opacity 0.15s;
      }

      .toast-close:hover {
        opacity: 1;
      }

      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @keyframes slideUp {
        from { opacity: 0; transform: translateY(24px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @keyframes slideUpToast {
        from { opacity: 0; transform: translateY(16px); }
        to { opacity: 1; transform: translateY(0); }
      }
    </style>`;
  }
}

customElements.define('pwa-install-overlay', PWAInstallOverlay);
