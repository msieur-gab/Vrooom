/**
 * NFC service — scan NFC tags on wooden cars.
 * Migrated from Ha_ouais/services/nfc.js. Returns the tag's URL; which car
 * it names is decided by the app (carFromUrl in app.js).
 */

class NFCService {
  constructor() {
    this.isSupported = 'NDEFReader' in window;
    this.isScanning = false;
    this._controller = null;
  }

  /**
   * Resolves with the first tag read. Rejects on timeout, on a read error,
   * or with an AbortError when stopScan() cancels it.
   */
  startScan() {
    if (!this.isSupported) {
      return Promise.reject(new Error('NFC is not supported on this device'));
    }
    if (this.isScanning) {
      return Promise.reject(new Error('NFC scan already in progress'));
    }

    // A Web NFC scan has no stop method: aborting the signal passed to scan()
    // is the only way to end it. Dropping the reader left the old scan
    // listening, and it could still deliver a tag after Cancel.
    const controller = new AbortController();
    const { signal } = controller;
    this._controller = controller;
    this.isScanning = true;

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (settle, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (this._controller === controller) {
          this._controller = null;
          this.isScanning = false;
        }
        controller.abort(); // ends the scan; a no-op if already aborted
        settle(value);
      };

      const timeout = setTimeout(
        () => finish(reject, new Error('NFC scan timeout — try again')), 30000);

      signal.addEventListener('abort', () =>
        finish(reject, new DOMException('NFC scan cancelled', 'AbortError')));

      const reader = new NDEFReader();
      reader.addEventListener('reading', ({ message, serialNumber }) => {
        finish(resolve, { ...this._parseMessage(message), serialNumber });
      }, { signal });
      reader.addEventListener('readingerror', () => {
        finish(reject, new Error('NFC reading error — try again'));
      }, { signal });

      reader.scan({ signal }).catch(error => {
        finish(reject, new Error('Failed to start NFC scan: ' + error.message));
      });
    });
  }

  /** Cancel the scan in progress, if any. */
  stopScan() {
    this._controller?.abort();
  }

  _parseMessage(message) {
    const data = { records: [], url: null };

    for (const record of message.records) {
      if (record.recordType === 'url') {
        const url = new TextDecoder().decode(record.data);
        data.url = url;
        data.records.push({ type: 'url', data: url });
      } else if (record.recordType === 'text') {
        const text = new TextDecoder().decode(record.data);
        data.records.push({ type: 'text', data: text });
      }
    }

    return data;
  }
}

export const nfcService = new NFCService();
