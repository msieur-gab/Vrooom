/**
 * Leaflet map helpers — init, markers, playground display.
 * Adapted from Drop's map.js for playground discovery.
 */

import { haversine } from './distance.js';

/* global L */

// ── Map init ──────────────────────────────────

// `?style=bright` switches style while we compare; Positron is the default.
// Positron is recoloured: its parks and water are grey by design, and a child
// finds a playground by the green around it.
const BASEMAPS = {
  positron: {
    url: 'https://tiles.openfreemap.org/styles/positron',
    paint: {
      park:           ['fill-color', '#d8e8c8'],
      landcover_wood: ['fill-color', '#c8dcb4'],
      water:          ['fill-color', '#aecfe2'],
      waterway:       ['line-color', '#a0c8f0']
    }
  },
  bright: { url: 'https://tiles.openfreemap.org/styles/bright' }
};

const PLACE_CLASSES = ['playground', 'park', 'swimming_pool', 'swimming', 'water_park'];

function chooseBasemap() {
  const name = new URLSearchParams(location.search).get('style');
  return BASEMAPS[name] || BASEMAPS.positron;
}

/**
 * Applied as soon as the style is parsed, before anything is drawn:
 *  - no points of interest are drawn (petrol stations, churches, shops… are
 *    noise between a child and their markers);
 *  - the style's own colour tweaks;
 *  - an invisible layer on the places we read. MapLibre only keeps the tile
 *    data a style layer uses — Positron draws no POI at all, so without it
 *    placesInView would find nothing.
 */
function tuneStyle(gl, basemap) {
  for (const layer of gl.getStyle().layers) {
    if (layer['source-layer'] === 'poi') gl.removeLayer(layer.id);
  }
  for (const [id, [prop, value]] of Object.entries(basemap.paint || {})) {
    if (gl.getLayer(id)) gl.setPaintProperty(id, prop, value);
  }
  gl.addLayer({
    id: 'vrooom-places',
    type: 'circle',
    source: 'openmaptiles',
    'source-layer': 'poi',
    filter: ['in', ['get', 'class'], ['literal', PLACE_CLASSES]],
    paint: { 'circle-radius': 1, 'circle-opacity': 0 }
  });
}

export function initMap(elementId) {
  const map = L.map(elementId, {
    zoomControl: true,
    attributionControl: true
  }).setView([48.137, 11.575], 15);

  // OpenFreeMap vector tiles, drawn on the phone by MapLibre inside Leaflet —
  // markers, routes and everything else in this file stay plain Leaflet.
  // Positron has no POI or house-number layer: a neutral background for our
  // own markers. Free, keyless, commercial use allowed. The same tiles carry
  // the places (see placesInView), so no separate Overpass query is needed.
  //
  // Raster OSM was too noisy for a child and cannot lose what is baked into
  // it; CARTO, Stadia and MapTiler forbid commercial use on their free plans.
  const basemap = chooseBasemap();
  map._basemap = L.maplibreGL({
    style: basemap.url,
    attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  const gl = map._basemap.getMaplibreMap();
  gl.once('style.load', () => tuneStyle(gl, basemap));

  map._playgroundLayer = L.layerGroup().addTo(map);
  map._meMarker = null;
  map._mePulse = null;

  return map;
}

// ── User position ─────────────────────────────

export function placeUser(map, lat, lon, carImageUrl, onTap) {
  if (map._meMarker) {
    map.removeLayer(map._meMarker);
    map.removeLayer(map._mePulse);
  }

  map._mePulse = L.marker([lat, lon], {
    icon: L.divIcon({ className: 'me-pulse', iconSize: [50, 50], iconAnchor: [25, 25] }),
    interactive: false
  }).addTo(map);

  // Use car side-view image if available, otherwise default dot
  const markerHtml = carImageUrl
    ? `<img src="${carImageUrl}" style="width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.3));">`
    : `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
        <circle cx="8" cy="8" r="6" fill="var(--accent)" stroke="white" stroke-width="3"/>
      </svg>`;

  const size = carImageUrl ? [80, 80] : [16, 16];
  const anchor = carImageUrl ? [40, 40] : [8, 8];

  map._meMarker = L.marker([lat, lon], {
    icon: L.divIcon({
      className: 'me-marker',
      iconSize: size,
      iconAnchor: anchor,
      html: markerHtml
    }),
    interactive: !!onTap,
    zIndexOffset: 1000
  }).addTo(map);

  if (onTap) map._meMarker.on('click', onTap);
}

// ── Playground markers ────────────────────────

export function displayPlaygrounds(map, points, userLat, userLon, onSelect) {
  map._playgroundLayer.clearLayers();

  points.forEach(pg => {
    const dist = haversine(userLat, userLon, pg.lat, pg.lon);

    const icon = L.divIcon({
      className: 'playground-marker',
      iconSize: [28, 36],
      iconAnchor: [14, 36],
      html: `<svg viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg">
        <path d="M14 0C14 0 0 12 0 20a14 14 0 0 0 28 0C28 12 14 0 14 0z" fill="var(--accent)" stroke="white" stroke-width="2"/>
        <text x="14" y="23" text-anchor="middle" font-size="14" fill="white">&#9899;</text>
      </svg>`
    });

    const marker = L.marker([pg.lat, pg.lon], { icon }).addTo(map._playgroundLayer);
    marker.on('click', () => onSelect({ ...pg, distance: Math.round(dist) }));
  });

  return points.length;
}

// ── Places from the basemap tiles ─────────────

// OpenMapTiles `poi` classes → the OSM leisure value the rest of the app uses.
// `swimming` is a sports centre with sport=swimming — the public baths.
const POI_LEISURE = {
  playground: 'playground',
  park: 'park',
  swimming_pool: 'swimming_pool',
  swimming: 'swimming_pool',
  water_park: 'water_park'
};

/**
 * Playgrounds, parks and pools in the tiles MapLibre has loaded — the view
 * plus its margin. Waits for loading to settle first.
 *
 * The feature id is the OSM id ×10 plus a type digit (1 node, 2 way,
 * 3 relation); dividing by 10 gives back the OSM id Overpass used.
 * No `access` tag exists in these tiles, so private playgrounds are not
 * filtered — the known cost of this source.
 */
export function placesInView(map) {
  const gl = map._basemap?.getMaplibreMap();
  if (!gl) return Promise.resolve([]);

  const read = () => {
    const seen = new Set();
    return gl.querySourceFeatures('openmaptiles', { sourceLayer: 'poi' })
      .filter(f => {
        const p = f.properties;
        if (!POI_LEISURE[p.class]) return false;
        if (p.class === 'park' && p.subclass !== 'park') return false; // bbq spots etc.
        if (f.geometry.type !== 'Point' || f.id == null || seen.has(f.id)) return false;
        seen.add(f.id);
        return true;
      })
      .map(f => {
        const [lon, lat] = f.geometry.coordinates;
        const name = f.properties.name || null;
        const tags = { leisure: POI_LEISURE[f.properties.class] };
        if (name) tags.name = name;
        return { id: Math.floor(f.id / 10), lat, lon, name, tags };
      });
  };

  // A Leaflet move reaches MapLibre on its next frame, so "loaded" right
  // after setView still describes the OLD view. Let two frames pass, then
  // wait for the new tiles; the timeout keeps a stuck load from hanging the
  // caller (it then reads whatever is there).
  return new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (gl.loaded() && gl.areTilesLoaded()) return resolve(read());
      const timer = setTimeout(() => resolve(read()), 15000);
      gl.once('idle', () => { clearTimeout(timer); resolve(read()); });
    }));
  });
}

// ── Routing (Valhalla) ────────────────────────

const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';

/**
 * `isCurrent` is checked once the route arrives: if the caller has moved on
 * (another place selected, route cleared), nothing is drawn.
 */
export async function showRoute(map, fromLatLon, toLatLon, isCurrent = () => true) {
  clearRoute(map);

  const params = {
    locations: [
      { lat: fromLatLon[0], lon: fromLatLon[1] },
      { lat: toLatLon[0],   lon: toLatLon[1] }
    ],
    costing: 'pedestrian',
    units: 'km'
  };

  const url = `${VALHALLA_URL}?json=${encodeURIComponent(JSON.stringify(params))}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const data = await res.json();

  if (!isCurrent()) return null;
  if (!data.trip?.legs?.length) return null;

  const leg = data.trip.legs[0];
  const coords = decodePolyline(leg.shape);

  map._routeLayer = L.layerGroup([
    L.polyline(coords, {
      color: 'rgba(244,84,54,0.12)',
      weight: 10,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false
    }),
    L.polyline(coords, {
      color: '#f45436',
      weight: 5,
      dashArray: '1 12',
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false
    })
  ]).addTo(map);

  map.fitBounds(L.latLngBounds(coords), {
    padding: [60, 40, 160, 40],
    animate: true,
    duration: 0.5
  });

  const summary = data.trip.summary;
  return {
    duration: Math.round(summary.time / 60),
    distance: Math.round(summary.length * 1000)
  };
}

export function clearRoute(map) {
  if (map._routeLayer) {
    map.removeLayer(map._routeLayer);
    map._routeLayer = null;
  }
}

function decodePolyline(str) {
  const coords = [];
  let lat = 0, lon = 0, i = 0;
  while (i < str.length) {
    let shift = 0, result = 0, byte;
    do { byte = str.charCodeAt(i++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { byte = str.charCodeAt(i++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lon += (result & 1) ? ~(result >> 1) : (result >> 1);
    coords.push([lat / 1e6, lon / 1e6]);
  }
  return coords;
}

// ── Helpers ────────────────────────────────────

export function formatDistance(meters) {
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
