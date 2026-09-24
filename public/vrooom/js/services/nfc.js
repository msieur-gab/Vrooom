/**
 * NFC service — scan NFC tags on wooden cars.
 * Migrated from Ha_ouais/services/nfc.js with Vrooom-specific URL parsing.
 */

class NFCService {
  constructor() {
    this.isSupported = 'NDEFReader' in window;
    this.reader = null;
    this.isScanning = false;
  }

  async startScan() {
    if (!this.isSupported) {
      throw new Error('NFC is not supported on this device');
    }
    if (this.isScanning) {
      throw new Error('NFC scan already in progress');
    }

    try {
      this.reader = new NDEFReader();
      await this.reader.scan();
      this.isScanning = true;

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.stopScan();
          reject(new Error('NFC scan timeout — try again'));
        }, 30000);

        this.reader.addEventListener('reading', ({ message, serialNumber }) => {
          clearTimeout(timeout);
          this.stopScan();
          const result = this._parseMessage(message);
          resolve({ ...result, serialNumber });
        });

        this.reader.addEventListener('readingerror', () => {
          clearTimeout(timeout);
          this.stopScan();
          reject(new Error('NFC reading error — try again'));
        });
      });
    } catch (error) {
      this.isScanning = false;
      throw new Error('Failed to start NFC scan: ' + error.message);
    }
  }

  stopScan() {
    this.isScanning = false;
    this.reader = null;
  }

  _parseMessage(message) {
    const data = { records: [], carConfig: null, url: null };

    for (const record of message.records) {
      if (record.recordType === 'url') {
        const url = new TextDecoder().decode(record.data);
        data.url = url;
        data.records.push({ type: 'url', data: url });

        try {
          const urlObj = new URL(url);
          const config = urlObj.searchParams.get('config');
          if (config) data.carConfig = config;
        } catch { /* invalid URL */ }
      } else if (record.recordType === 'text') {
        const text = new TextDecoder().decode(record.data);
        data.records.push({ type: 'text', data: text });
      }
    }

    return data;
  }
}

export const nfcService = new NFCService();
