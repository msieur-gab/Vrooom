/**
 * <peer-qrcode> — QR code generator web component
 *
 * Renders a QR code canvas in shadow DOM.
 * Attributes: value, size, error-correction
 * CSS parts: ::part(canvas)
 * Events: qr-generated, qr-error
 */

import QRCode from 'https://esm.sh/qrcode@1';

const template = document.createElement('template');
template.innerHTML = `
  <style>
    :host { display: inline-block; }
    .container { display: flex; align-items: center; justify-content: center; }
  </style>
  <div class="container" part="container">
    <canvas part="canvas"></canvas>
  </div>
`;

class PeerQRCode extends HTMLElement {

  static get observedAttributes() {
    return ['value', 'size', 'error-correction'];
  }

  #canvas = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(template.content.cloneNode(true));
    this.#canvas = this.shadowRoot.querySelector('canvas');
  }

  connectedCallback() {
    this.#generate();
  }

  attributeChangedCallback() {
    this.#generate();
  }

  get value() { return this.getAttribute('value') || ''; }
  set value(v) { this.setAttribute('value', v); }

  get size() { return parseInt(this.getAttribute('size'), 10) || 200; }
  set size(v) { this.setAttribute('size', String(v)); }

  get errorCorrection() { return this.getAttribute('error-correction') || 'M'; }
  set errorCorrection(v) { this.setAttribute('error-correction', v); }

  async #generate() {
    if (!this.value || !this.#canvas) return;

    try {
      await QRCode.toCanvas(this.#canvas, this.value, {
        width: this.size,
        margin: 1,
        errorCorrectionLevel: this.errorCorrection,
      });

      this.dispatchEvent(new CustomEvent('qr-generated', {
        bubbles: true, composed: true,
        detail: { value: this.value },
      }));
    } catch (err) {
      this.dispatchEvent(new CustomEvent('qr-error', {
        bubbles: true, composed: true,
        detail: { error: err.message },
      }));
    }
  }
}

customElements.define('peer-qrcode', PeerQRCode);

export { PeerQRCode };
