/**
 * Geolocation wrapper.
 */

export function isAvailable() {
  return 'geolocation' in navigator;
}

/**
 * Testing aid: `?at=48.15,11.58` in the URL replaces the GPS fix, so the app
 * can be exercised at a real place from a desktop browser (Brave's desktop
 * geolocation often fails, and the app then sits at the Munich fallback).
 */
export function testPosition() {
  const at = new URLSearchParams(location.search).get('at');
  const [lat, lon] = (at || '').split(',').map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) && at ? { lat, lon } : null;
}

export function locate({ timeout = 10000 } = {}) {
  const override = testPosition();
  if (override) return Promise.resolve(override);

  return new Promise((resolve, reject) => {
    if (!isAvailable()) {
      return reject(new Error('Geolocation not available'));
    }

    let settled = false;

    // Safety net — browsers don't always respect the timeout option
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Location timed out'));
      }
    }, timeout + 2000);

    navigator.geolocation.getCurrentPosition(
      pos => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      err => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
      { enableHighAccuracy: true, timeout }
    );
  });
}
