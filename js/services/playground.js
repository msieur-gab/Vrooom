/**
 * Fetch nearby playgrounds from Overpass API.
 * Adapted from Drop's water.js — queries leisure=playground instead.
 */

import { cachePoints, getCachedNearby, pruneStale } from './playground-cache.js';

export { getCachedNearby };

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];

export async function fetchNearby(lat, lon, radius = 1500) {
  const query = `
    [out:json][timeout:12];
    (
      way["leisure"="playground"](around:${radius},${lat},${lon});
      node["leisure"="playground"](around:${radius},${lat},${lon});
    );
    out center body;
  `;

  const body = 'data=' + encodeURIComponent(query);
  let lastErr;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(15000)
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      const points = normalize(data.elements);
      cachePoints(points).then(() => {
        const freshIds = new Set(points.map(p => p.id));
        pruneStale(freshIds);
      });
      return points;
    } catch (err) {
      lastErr = err;
    }
  }

  throw new Error(`All Overpass endpoints failed: ${lastErr?.message}`);
}

/**
 * Normalize Overpass elements — ways have center coords, nodes have lat/lon directly.
 * Extract useful tags.
 */
function normalize(elements) {
  const seen = new Set();

  return elements
    .map(el => {
      const lat = el.center?.lat ?? el.lat;
      const lon = el.center?.lon ?? el.lon;
      if (!lat || !lon) return null;

      const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
      if (seen.has(key)) return null;
      seen.add(key);

      const tags = el.tags || {};

      return {
        id: el.id,
        lat,
        lon,
        name: tags.name || null,
        surface: tags.surface || null,
        min_age: tags.min_age || null,
        max_age: tags.max_age || null,
        access: tags.access || null,
        operator: tags.operator || null,
        tags
      };
    })
    .filter(Boolean);
}
