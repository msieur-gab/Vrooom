/**
 * Geolocation wrapper.
 */

export function isAvailable() {
  return 'geolocation' in navigator;
}

export function locate({ timeout = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!isAvailable()) {
      return reject(new Error('Geolocation not available'));
    }

    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      err => reject(err),
      { enableHighAccuracy: true, timeout }
    );
  });
}
