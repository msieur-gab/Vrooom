/**
 * Overpass endpoints — shared by the map search and the check-in.
 *
 * Kept in one place because the two callers used to hold separate copies that
 * drifted apart, which is how an inverted timeout went unnoticed.
 *
 * Order matters: the first reachable one wins.
 *
 * DO NOT add a mirror without checking it returns real data FOR YOUR REGION.
 * overpass.osm.ch was briefly promoted here and broke the map: it is a Swiss
 * instance holding only Swiss data, so it answered 200 with valid JSON and
 * ZERO elements for France. A silent empty success is worse than a failure —
 * the app cannot tell it apart from "no playgrounds nearby" and shows a blank
 * map with no error. Use tools/overpass-check.html to measure candidates from
 * a real browser before touching this list.
 *
 * Two traps worth knowing:
 *  - Overpass sends `Access-Control-Allow-Origin` only on SUCCESSFUL replies,
 *    so an error page has no CORS header and the browser reports "blocked by
 *    CORS policy", hiding the real status code.
 *  - Some mirrors answer HTTP 200 with an HTML error body (osm.ch does this
 *    for repeated identical queries: `duplicate_query`). Status alone is not
 *    proof of success.
 *
 * maps.mail.ru is a Russian mirror and a poor place to send the GPS
 * coordinates of children — kept only as a last resort until a measured
 * replacement is chosen.
 */
export const OVERPASS_ENDPOINTS = [
  // Our own proxy first. Server to server there is no CORS, so it can reach
  // mirrors the browser cannot — measured from a real browser on 2026-09-22,
  // kumi, private.coffee and openstreetmap.ru all time out, leaving mail.ru as
  // the ONLY endpoint a browser can use directly. The proxy exists to end that.
  '/api/overpass',

  // Direct fallbacks, kept so the app still works if the proxy is unavailable
  // (a different host, a failed deploy, or running the PWA from a file server).
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];

// The client must wait LONGER than the server is allowed to work, or a slow
// but successful query gets killed by our own abort.
export const SERVER_TIMEOUT_S = 10;

const DIRECT_TIMEOUT_MS = 12000;
const PROXY_TIMEOUT_MS = 20000;   // the proxy may try several mirrors in turn

/**
 * Our own proxy needs a longer budget than a direct call: it walks its mirror
 * list server-side. Aborting it at the direct timeout killed every proxied
 * request before it could answer.
 */
export function timeoutFor(endpoint) {
  return endpoint.startsWith('/') ? PROXY_TIMEOUT_MS : DIRECT_TIMEOUT_MS;
}
