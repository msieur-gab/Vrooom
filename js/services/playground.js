/**
 * Nearby places — read from the basemap's own vector tiles (OpenFreeMap).
 * Adapted from Drop's water.js.
 *
 * The map screen registers a source (setPlaceSource) that reads playgrounds,
 * parks and pools out of the tiles MapLibre has already downloaded to draw
 * the map. No other request is made: no Overpass, no position sent anywhere
 * beyond the tile requests every map makes. Results go to the local cache,
 * which the map and the 150 m check-in read.
 */

import { cachePoints, getCachedNearby as getCachedAll, pruneStale } from './playground-cache.js';

let placeSource = null;

/** Called by the map screen once the map exists: () => Promise<points>. */
export function setPlaceSource(fn) {
  placeSource = fn;
}

/**
 * What kind of place this is, or null if Vrooom should not offer it.
 *
 * Sorting rules on OSM tags. The tiles carry no `access` tag, so on this
 * source only the pool rule bites; the access rules stay for points cached
 * from Overpass and for any source that has the tag.
 *  - access=private / no → never offered.
 *  - playground with access=customers → a restaurant or shop playground, not
 *    a public one.
 *  - swimming pool without a name and without access=yes → almost always a
 *    garden pool (96 of 97 within 2.5 km of the test point were unnamed; the
 *    one named was the public Dantebad).
 */
export function placeKind(tags = {}) {
  const access = tags.access;
  if (access === 'private' || access === 'no') return null;

  if (tags.leisure === 'playground') {
    return access === 'customers' ? null : 'playground';
  }
  if (tags.leisure === 'park') return 'park';
  if (tags.leisure === 'water_park') return 'swimming_pool';
  if (tags.leisure === 'swimming_pool') {
    return tags.name || access === 'yes' ? 'swimming_pool' : null;
  }
  return null;
}

/**
 * Read the places in the tiles currently loaded into the cache.
 * The arguments are kept for the callers' sake: what is covered is whatever
 * the map has loaded — the view and its margin, centred on the child.
 */
export async function ensureArea(lat, lon, radius) {
  if (!placeSource) throw new Error('Map not ready');
  const points = (await placeSource()).filter(p => placeKind(p.tags));
  await cachePoints(points);
  pruneStale(new Set(points.map(p => p.id)));
}

/**
 * Cached places of the given kinds within `radius` of the real position.
 * Rules are re-applied here so points cached before they existed are sorted too.
 */
export async function getCachedPlaces(lat, lon, radius, kinds) {
  const cached = await getCachedAll(lat, lon, radius);
  return cached.filter(pt => kinds.includes(placeKind(pt.tags)));
}

/** Playgrounds for the map — the cache, topped up from the map's tiles. */
export async function fetchNearby(lat, lon, radius = 1500) {
  await ensureArea(lat, lon, radius);
  return getCachedPlaces(lat, lon, radius, ['playground']);
}

export function getCachedNearby(lat, lon, radius) {
  return getCachedPlaces(lat, lon, radius, ['playground']);
}
