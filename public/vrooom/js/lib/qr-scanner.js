/**
 * <qr-scanner> — QR code scanner web component
 *
 * Rear camera + jsQR frame scanning in shadow DOM.
 * Methods: start(), stop()
 * Events: scan-start, scan-success, scan-error
 * CSS parts: ::part(video), ::part(overlay)
 *
 * jsQR is vendored (js/vendor/jsQR.js) rather than pulled from a CDN, so the
 * scanner opens with no network. It decodes in software, which means it works
 * in every browser — not just the ones with a native BarcodeDetector.
 */

// Vendored jsQR is a UMD bundle exposing a global. Injected on first use so the
// 250 KB only loads when someone actually opens the scanner.
let jsQRLoading = null;

function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (!jsQRLoading) {
    jsQRLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('../vendor/jsQR.js', import.meta.url).href;
      script.onload = () => window.jsQR
        ? resolve(window.jsQR)
        : reject(new Error('jsQR loaded but did not register'));
      script.onerror = () => {
        jsQRLoading = null;
        reject(new Error('scanner library failed to load'));
      };
      document.head.appendChild(script);
    });
  }
  return jsQRLoading;
}

const template = document.createElement('template');
template.innerHTML = `
  <style>
    :host { display: inline-block; position: relative; overflow: hidden; }
    video { display: block; width: 100%; height: 100%; object-fit: cover; }
    canvas { display: none; }
    .overlay {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      pointer-events: none;
    }
  </style>
  <video part="video" playsinline muted></video>
  <canvas></canvas>
  <div class="overlay" part="overlay"></div>
`;

class QRScanner extends HTMLElement {

  #video = null;
  #canvas = null;
  #ctx = null;
  #stream = null;
  #animationId = null;
  #active = false;
  #jsQR = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(template.content.cloneNode(true));
    this.#video = this.shadowRoot.querySelector('video');
    this.#canvas = this.shadowRoot.querySelector('canvas');
    this.#ctx = this.#canvas.getContext('2d', { willReadFrequently: true });
  }

  get active() { return this.#active; }

  async start() {
    if (this.#active) return;
    this.#active = true;

    try {
      this.#jsQR = await loadJsQR();

      this.#stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: 640, height: 480 },
        audio: false,
      });

      this.#video.srcObject = this.#stream;
      await this.#video.play();

      this.dispatchEvent(new CustomEvent('scan-start', {
        bubbles: true, composed: true,
      }));

      this.#scanFrame();
    } catch (err) {
      this.#active = false;

      let message;
      if (err.message === 'scanner library failed to load') {
        message = 'Scanner unavailable offline — reconnect and reopen the app';
      } else if (!window.isSecureContext) {
        message = 'Camera requires HTTPS — serve over HTTPS or use localhost';
      } else if (err.name === 'NotAllowedError') {
        message = 'Camera permission denied';
      } else if (err.name === 'NotFoundError') {
        message = 'No camera found on this device';
      } else {
        message = `Camera unavailable: ${err.message}`;
      }

      this.dispatchEvent(new CustomEvent('scan-error', {
        bubbles: true, composed: true,
        detail: { error: message },
      }));
    }
  }

  stop() {
    this.#active = false;

    if (this.#animationId) {
      cancelAnimationFrame(this.#animationId);
      this.#animationId = null;
    }

    if (this.#stream) {
      this.#stream.getTracks().forEach(t => t.stop());
      this.#stream = null;
    }

    this.#video.srcObject = null;
  }

  disconnectedCallback() {
    this.stop();
  }

  #scanFrame() {
    if (!this.#active || !this.#stream) return;

    if (this.#video.readyState !== this.#video.HAVE_ENOUGH_DATA) {
      this.#animationId = requestAnimationFrame(() => this.#scanFrame());
      return;
    }

    const { videoWidth, videoHeight } = this.#video;
    this.#canvas.width = videoWidth;
    this.#canvas.height = videoHeight;

    this.#ctx.drawImage(this.#video, 0, 0);
    const imageData = this.#ctx.getImageData(0, 0, videoWidth, videoHeight);

    // Grayscale conversion — improves jsQR detection
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      d[i] = d[i + 1] = d[i + 2] = gray;
    }

    const code = this.#jsQR(d, videoWidth, videoHeight, {
      inversionAttempts: 'attemptBoth',
    });

    if (code) {
      this.stop();
      this.dispatchEvent(new CustomEvent('scan-success', {
        bubbles: true, composed: true,
        detail: { data: code.data },
      }));
      return;
    }

    this.#animationId = requestAnimationFrame(() => this.#scanFrame());
  }
}

customElements.define('qr-scanner', QRScanner);

export { QRScanner };
