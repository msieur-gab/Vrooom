/**
 * Check-in service — destination-agnostic "I'm here!" check-in.
 *
 * No pre-selected destination. Fresh GPS read → nearest cached place within
 * CHECKIN_RADIUS → log visit.
 *
 * The precise position never leaves the phone: the match runs against the
 * local cache, and when the area is not cached yet it is fetched the same way
 * the map does it — by rounded grid cell (see playground.js).
 */

import { haversine } from '../utils/distance.js';
import * as db from './database.js';
import { checkAndAwardBadges } from './badge.js';
import { ensureArea, getCachedPlaces } from './playground.js';
import { testPosition } from '../utils/geo.js';

const CHECKIN_RADIUS = 150; // meters — search radius for nearby places

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
  const override = testPosition();
  if (override) return Promise.resolve(override);

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

// How much to fetch when the check-in lands in an area the map never loaded.
const AREA_RADIUS = 1000;

/**
 * Playgrounds, parks and pools within radius, from the local cache.
 * placeKey is built from the cached coordinates exactly as before, so a
 * check-in lands on the SAME badge it always did.
 */
async function cachedNearbyPlaces(lat, lon, radius) {
  const cached = await getCachedPlaces(lat, lon, radius, ['playground', 'park', 'swimming_pool']);

  return cached
    .map(pt => {
      const tags = pt.tags || {};
      const type = tags.leisure || tags.amenity || 'playground';
      return {
        id: pt.id,
        placeKey: placeKey(type, pt.lat, pt.lon),
        type,
        lat: pt.lat,
        lon: pt.lon,
        name: pt.name || null,
        distance: haversine(lat, lon, pt.lat, pt.lon),
        tags
      };
    })
    .sort((a, b) => a.distance - b.distance);
}

/**
 * Destination-agnostic check-in.
 *
 * 1. Fresh GPS read
 * 2. Nearest cached playground/park/pool within 150m (area fetched by grid cell if needed)
 * 3. Nearest match wins
 * 4. Log visit with dedup key
 * 5. Award badges
 *
 * @returns {{ place, checkIn, newBadges, fromCache }}
 */
export async function checkIn(profileId, carId) {
  // 1. Fresh GPS
  const coords = await freshGPS();

  // 2. Top up the cache for this area (a no-op when it is fresh), then match
  //    locally. A kid standing at a playground they have visited before can
  //    still check in when Overpass is unreachable.
  let fromCache = false;
  let networkErr = null;
  try {
    await ensureArea(coords.lat, coords.lon, AREA_RADIUS);
  } catch (err) {
    networkErr = err;
    fromCache = true;
  }

  const places = await cachedNearbyPlaces(coords.lat, coords.lon, CHECKIN_RADIUS);

  // Nothing cached and no network — say so rather than "nothing nearby".
  if (places.length === 0 && networkErr) {
    throw new Error('Could not reach map servers. Try again.');
  }

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

  return { place, checkIn: record, newBadges, fromCache };
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
