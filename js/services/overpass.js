/**
 * Overpass endpoints — shared by the map search and the check-in.
 *
 * Kept in one place because the two callers used to hold separate copies that
 * drifted apart, which is how an inverted timeout went unnoticed.
 *
 * Order matters: the first reachable one wins, so the list runs from most
 * reliable to least.
 *
 * A browser needs `Access-Control-Allow-Origin` on the response, and Overpass
 * only sends it on SUCCESSFUL replies — an error page has no CORS header, so
 * the browser reports "blocked by CORS policy" and hides the real status code.
 * A mirror that refuses requests is therefore indistinguishable from one that
 * is misconfigured. Verified 2026-09-22: overpass.osm.ch answers 200 with
 * `ACAO: *`; overpass-api.de was answering 406 with no CORS header at all.
 *
 * Removed: maps.mail.ru — a Russian mirror, which is a poor place to send the
 * GPS coordinates of children.
 */
export const OVERPASS_ENDPOINTS = [
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];

// The client must wait LONGER than the server is allowed to work, or a slow
// but successful query gets killed by our own abort.
export const SERVER_TIMEOUT_S = 10;
export const CLIENT_TIMEOUT_MS = 12000;
