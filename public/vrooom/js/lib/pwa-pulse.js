/**
 * PWAPulse — Minimal anonymous telemetry for PWAs.
 * Fire-and-forget. No cookies, no localStorage IDs, no fingerprinting.
 * Auto-reads manifest for self-registration.
 *
 * @example
 * const pulse = new PWAPulse({
 *   app: 'tiptap',
 *   version: '1.2.0',
 *   endpoint: 'https://pwa-pulse.netlify.app/.netlify/functions/pulse',
 * });
 * pulse.ping('visit');
 * pulse.ping('install');
 */

export class PWAPulse {
  #app;
  #version;
  #endpoint;
  #context;
  #meta = null;
  #ready;

  constructor({ app, version = '0.0.0', endpoint }) {
    this.#app = app;
    this.#version = version;
    this.#endpoint = endpoint;
    this.#context = this.#detectContext();
    this.#ready = this.#readManifest();
  }

  /**
   * Send a pulse event. Fire-and-forget.
   * Deduplicates within a page session via sessionStorage.
   * Waits for manifest read so registration can piggyback the first ping.
   * @param {'visit' | 'install' | 'update' | 'launch'} event
   */
  ping(event) {
    const dedupKey = `pulse_${event}_sent`;
    if (sessionStorage.getItem(dedupKey)) return;
    sessionStorage.setItem(dedupKey, '1');

    // Wait for manifest read, then send
    this.#ready.then(() => {
      this.#maybeSendRegister();

      const payload = JSON.stringify({
        app: this.#app,
        version: this.#version,
        event,
        ...this.#context,
        date: new Date().toISOString().slice(0, 10),
      });

      this.#send(payload);
    });
  }

  #send(payload) {
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      const sent = navigator.sendBeacon(this.#endpoint, blob);
      if (sent) return;
    }

    try {
      fetch(this.#endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Silent failure
    }
  }

  async #readManifest() {
    try {
      const link = document.querySelector('link[rel="manifest"]');
      if (!link) return;

      const resp = await fetch(link.href);
      if (!resp.ok) return;
      const manifest = await resp.json();

      // Pick the largest PNG icon
      let icon = null;
      if (Array.isArray(manifest.icons)) {
        const pngs = manifest.icons.filter(i =>
          !i.type || i.type.includes('png')
        );
        if (pngs.length) {
          icon = pngs.reduce((best, cur) => {
            const size = parseInt(cur.sizes?.split('x')[0]) || 0;
            const bestSize = parseInt(best.sizes?.split('x')[0]) || 0;
            return size > bestSize ? cur : best;
          });
        }
      }

      // Resolve icon URL relative to manifest location
      const iconUrl = icon
        ? new URL(icon.src, link.href).href
        : null;

      this.#meta = {
        name: manifest.name || manifest.short_name || this.#app,
        description: manifest.description || '',
        icon: iconUrl,
        url: window.location.origin,
        categories: manifest.categories || [],
        start_url: manifest.start_url || './',
      };
    } catch {
      // Manifest fetch failed — graceful degradation, pings still work
    }
  }

  #maybeSendRegister() {
    if (!this.#meta) return;

    const regKey = `pulse_registered`;
    if (sessionStorage.getItem(regKey)) return;

    const payload = JSON.stringify({
      app: this.#app,
      event: 'register',
      version: this.#version,
      meta: this.#meta,
      ...this.#context,
      date: new Date().toISOString().slice(0, 10),
    });

    this.#send(payload);
    sessionStorage.setItem(regKey, '1');
  }

  #detectContext() {
    const ua = navigator.userAgent;

    return {
      platform: this.#detectPlatform(ua),
      browser: this.#detectBrowser(ua),
      os: this.#detectOS(ua),
      language: (navigator.language || 'en').split('-')[0],
      display: window.matchMedia('(display-mode: standalone)').matches
        ? 'standalone'
        : 'browser',
    };
  }

  #detectPlatform(ua) {
    if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    return 'desktop';
  }

  #detectBrowser(ua) {
    if (/Edg\//.test(ua)) return 'edge';
    if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return 'chrome';
    if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'safari';
    if (/Firefox\//.test(ua)) return 'firefox';
    return 'other';
  }

  #detectOS(ua) {
    if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    if (/Windows/.test(ua)) return 'windows';
    if (/Mac OS X/.test(ua)) return 'macos';
    if (/Linux/.test(ua)) return 'linux';
    return 'other';
  }
}
