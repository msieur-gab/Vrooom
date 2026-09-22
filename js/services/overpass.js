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
  // NOT overpass.openstreetmap.fr. It answers 200 to curl and 403 to anything
  // that looks like an application: a browser User-Agent, `Mozilla/5.0`,
  // `node-fetch` and even a descriptive `Vrooom/1.0` are all refused, while no
  // UA at all or `curl/8.5.0` pass. OSM France is deliberately keeping app
  // traffic off a volunteer-run server. A browser cannot change its
  // User-Agent, and spoofing one from a proxy would be circumventing a stated
  // policy on someone else's infrastructure. Do not add it back.

  // The only instance that answers this app from a browser.
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',

  // Answers 406 to every request shape tried while its /api/status answers 200
  // from the same IP — the block is endpoint-level and deliberate, and no API
  // key or paid tier exists for it. Kept because the refusal is fast.
  'https://overpass-api.de/api/interpreter'
];



// NEVER add a mirror without checking it returns real data FOR THE REGION IN
// USE. overpass.osm.ch answers 200 with valid JSON and ZERO elements outside
// Switzerland, which blanks the map with no error. Use tools/overpass-check.html.

// The client must wait LONGER than the server is allowed to work, or a slow
// but successful query gets killed by our own abort.
export const SERVER_TIMEOUT_S = 10;
export const CLIENT_TIMEOUT_MS = 12000;
