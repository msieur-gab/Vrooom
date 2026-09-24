/**
 * Nearby places — one Overpass query per area, shared by the map and the check-in.
 * Adapted from Drop's water.js.
 *
 * Privacy: the query never carries the phone's real position. It is snapped to
 * a ~1 km grid cell (GRID degrees) and the radius widened to cover the whole
 * cell, so the server only learns "someone in this square kilometre". The
 * precise GPS fix stays on the device: distances, the map and the 150 m
 * check-in match are all computed locally against the cache.
 *
 * Load: an area already fetched within CELL_MAX_AGE is served from the cache
 * without any request. Playgrounds do not move.
 */

import { cachePoints, getCachedNearby as getCachedAll, pruneStale } from './playground-cache.js';
import { OVERPASS_ENDPOINTS, SERVER_TIMEOUT_S, CLIENT_TIMEOUT_MS } from './overpass.js';
import { haversine } from '../utils/distance.js';

const GRID = 0.01;                       // degrees — ~1.1 km north-south
const CELL_HALF_DIAGONAL = 800;          // meters — farthest a point in a cell can be from its snapped centre
const CELL_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // matches the cache's own MAX_AGE
const CELLS_KEY = 'vrooom-fetched-cells-v2';

/**
 * What kind of place this is, or null if Vrooom should not offer it.
 *
 * Sorting rules on OSM tags (measured in Munich, 2026-09-24: about a quarter of
 * mapped playgrounds are tagged private or customers-only):
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

// ── Grid cells ─────────────────────────────────

function snap(lat, lon) {
  return {
    lat: Math.round(lat / GRID) * GRID,
    lon: Math.round(lon / GRID) * GRID
  };
}

function cellKey(c) {
  return `${c.lat.toFixed(2)},${c.lon.toFixed(2)}`;
}

// Per-viewer bookkeeping only: if storage is unavailable every call simply
// goes to the network, as before.
function readCells() {
  try { return JSON.parse(localStorage.getItem(CELLS_KEY)) || {}; }
  catch { return {}; }
}

/**
 * Is every place within `radius` of (lat, lon) already in the cache?
 * True when ANY area fetched this week reaches that far — not only the one
 * for this exact cell. Walking from home to the playground crosses into the
 * next cell, but the circle fetched from home usually covers it already.
 * Runs on the real position: this comparison never leaves the device.
 */
function isCovered(lat, lon, radius) {
  const cells = readCells();
  const now = Date.now();
  for (const key in cells) {
    const entry = cells[key];
    if (now - entry.at >= CELL_MAX_AGE) continue;
    const [cLat, cLon] = key.split(',').map(Number);
    if (haversine(cLat, cLon, lat, lon) + radius <= entry.radius) return true;
  }
  return false;
}

function markCell(key, queryRadius) {
  try {
    const cells = readCells();
    const now = Date.now();
    for (const k in cells) {
      if (now - cells[k].at >= CELL_MAX_AGE) delete cells[k];
    }
    cells[key] = { at: now, radius: queryRadius };
    localStorage.setItem(CELLS_KEY, JSON.stringify(cells));
  } catch { /* storage unavailable — next call refetches */ }
}

// ── Fetch ──────────────────────────────────────

/**
 * Make sure the cache holds every place within `radius` of (lat, lon).
 * Sends only the snapped cell centre. Resolves without a request when an
 * area fetched this week already covers it.
 */
export async function ensureArea(lat, lon, radius) {
  const centre = snap(lat, lon);
  const key = cellKey(centre);
  const queryRadius = Math.ceil(radius + CELL_HALF_DIAGONAL);

  if (isCovered(lat, lon, radius)) return;

  // One regex clause, one spatial scan: measured on the saturated mail.ru
  // (2026-09-24) at ~17 s against 20–28 s for the same set split into
  // separate clauses. Garden pools come back too and are dropped by placeKind.
  const around = `(around:${queryRadius},${centre.lat.toFixed(2)},${centre.lon.toFixed(2)})`;
  const query = `
    [out:json][timeout:${SERVER_TIMEOUT_S}];
    nwr["leisure"~"^(playground|park|water_park|swimming_pool)$"]${around};
    out center tags;
  `;

  const body = 'data=' + encodeURIComponent(query);
  let lastErr;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS)
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      // A query that runs out of time or memory still answers 200, with
      // whatever it had gathered so far and a `remark` saying so. Caching that
      // would mark the cell fresh for a week with half its playgrounds
      // missing — and prune the good ones already cached.
      if (data.remark) throw new Error(`Overpass: ${data.remark}`);
      if (!Array.isArray(data.elements)) throw new Error('Overpass: unexpected reply');
      const points = normalize(data.elements);
      await cachePoints(points);
      pruneStale(new Set(points.map(p => p.id)));
      markCell(key, queryRadius);
      return;
    } catch (err) {
      lastErr = err;
    }
  }

  throw new Error(`All Overpass endpoints failed: ${lastErr?.message}`);
}

/**
 * Cached places of the given kinds within `radius` of the real position.
 * Rules are re-applied here so points cached before they existed are sorted too.
 */
export async function getCachedPlaces(lat, lon, radius, kinds) {
  const cached = await getCachedAll(lat, lon, radius);
  return cached.filter(pt => kinds.includes(placeKind(pt.tags)));
}

/** Playgrounds for the map — the cache, topped up from the network if needed. */
export async function fetchNearby(lat, lon, radius = 1500) {
  await ensureArea(lat, lon, radius);
  return getCachedPlaces(lat, lon, radius, ['playground']);
}

export function getCachedNearby(lat, lon, radius) {
  return getCachedPlaces(lat, lon, radius, ['playground']);
}

/**
 * Normalize Overpass elements — ways have center coords, nodes have lat/lon directly.
 * Extract useful tags. Places the rules reject are never cached.
 */
function normalize(elements) {
  const seen = new Set();

  return elements
    .map(el => {
      const lat = el.center?.lat ?? el.lat;
      const lon = el.center?.lon ?? el.lon;
      if (!lat || !lon) return null;

      const tags = el.tags || {};
      if (!placeKind(tags)) return null;

      const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
      if (seen.has(key)) return null;
      seen.add(key);

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
