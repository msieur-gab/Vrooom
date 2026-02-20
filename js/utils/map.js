/**
 * Leaflet map helpers — init, markers, playground display.
 * Adapted from Drop's map.js for playground discovery.
 */

import { haversine } from './distance.js';

/* global L */

// ── Map init ──────────────────────────────────

export function initMap(elementId) {
  const map = L.map(elementId, {
    zoomControl: true,
    attributionControl: true
  }).setView([48.137, 11.575], 15);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://openstreetmap.org/copyright">OSM</a> &middot; <a href="https://carto.com/">CARTO</a>'
  }).addTo(map);

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

// ── Routing (Valhalla) ────────────────────────

const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';

export async function showRoute(map, fromLatLon, toLatLon) {
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
