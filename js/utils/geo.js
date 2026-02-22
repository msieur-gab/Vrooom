/**
 * Geolocation wrapper.
 */

export function isAvailable() {
  return 'geolocation' in navigator;
}

export function locate({ timeout = 10000 } = {}) {
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
