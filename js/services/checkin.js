/**
 * Check-in service — destination-agnostic "I'm here!" check-in.
 *
 * No pre-selected destination. Fresh GPS read → Overpass query at
 * current position → nearest match within CHECKIN_RADIUS → log visit.
 */

import { haversine } from '../utils/distance.js';
import * as db from './database.js';
import { checkAndAwardBadges } from './badge.js';

const CHECKIN_RADIUS = 150; // meters — search radius for nearby places

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];

/**
 * Build a dedup key from type + lat/lng rounded to 3 decimals.
 * e.g. "playground_48.137_11.575"
 */
function placeKey(type, lat, lon) {
  return `${type}_${lat.toFixed(3)}_${lon.toFixed(3)}`;
}

/**
 * Fresh GPS read — high accuracy, no cache.
 */
function freshGPS() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      return reject(new Error('Geolocation not available'));
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      err => reject(err),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

/**
 * Query Overpass for playground, park, and swimming_pool within radius.
 */
async function queryNearbyPlaces(lat, lon, radius) {
  const query = `
    [out:json][timeout:15];
    (
      nwr["leisure"~"^(playground|park|swimming_pool)$"](around:${radius},${lat},${lon});
      nwr["amenity"="swimming_pool"](around:${radius},${lat},${lon});
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
        signal: AbortSignal.timeout(12000)
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      return normalizeElements(data.elements, lat, lon);
    } catch (err) {
      lastErr = err;
    }
  }

  throw new Error(`Could not reach map servers. Try again.`);
}

/**
 * Normalize Overpass elements and compute distance from user.
 */
function normalizeElements(elements, userLat, userLon) {
  const seen = new Set();

  return elements
    .map(el => {
      const lat = el.center?.lat ?? el.lat;
      const lon = el.center?.lon ?? el.lon;
      if (!lat || !lon) return null;

      const tags = el.tags || {};
      const type = tags.leisure || tags.amenity || 'unknown';

      const key = placeKey(type, lat, lon);
      if (seen.has(key)) return null;
      seen.add(key);

      const dist = haversine(userLat, userLon, lat, lon);

      return {
        id: el.id,
        placeKey: key,
        type,
        lat,
        lon,
        name: tags.name || null,
        distance: dist,
        tags
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance);
}

/**
 * Destination-agnostic check-in.
 *
 * 1. Fresh GPS read
 * 2. Overpass query at position for playground/park/pool within 150m
 * 3. Nearest match wins
 * 4. Log visit with dedup key
 * 5. Award badges
 *
 * @returns {{ place, checkIn, newBadges }}
 */
export async function checkIn(profileId, carId) {
  // 1. Fresh GPS
  const coords = await freshGPS();

  // 2. Query nearby places
  const places = await queryNearbyPlaces(coords.lat, coords.lon, CHECKIN_RADIUS);

  if (places.length === 0) {
    throw new Error('No playground, park or pool found within 150m. Get closer and try again!');
  }

  // 3. Nearest match
  const place = places[0];

  // 4. Log the visit
  const displayName = place.name || friendlyType(place.type);
  const record = await db.addCheckIn(
    profileId,
    carId,
    place.placeKey,
    displayName,
    { lat: coords.lat, lon: coords.lon }
  );

  // 5. Award badges
  const newBadges = await checkAndAwardBadges(profileId, {
    id: place.placeKey,
    name: displayName
  });

  return { place, checkIn: record, newBadges };
}

/**
 * Friendly display name for a place type.
 */
function friendlyType(type) {
  const map = {
    playground: 'Playground',
    park: 'Park',
    swimming_pool: 'Swimming Pool'
  };
  return map[type] || 'Place';
}

export { CHECKIN_RADIUS, freshGPS };
