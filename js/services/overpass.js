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
  // OpenStreetMap France. Measured 2026-09-22: worldwide (Lyon 63, Zürich 40,
  // Tokyo 15 — matching other instances), `ACAO: *`, ~0.9s, and stable over six
  // rapid consecutive queries. Five times faster than mail.ru and it keeps the
  // GPS coordinates of children inside the EU, which mail.ru did not.
  'https://overpass.openstreetmap.fr/api/interpreter',

  // Fallbacks. mail.ru is worldwide and reachable but was saturating; it stays
  // because it is the only other instance that answered at all today.
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',

  // Answers 406 to every request shape tried (UA, Referer, Accept, GET, POST)
  // while its /api/status answers 200 from the same IP, so the block is
  // endpoint-level and deliberate. No API key or paid tier exists for it.
  // Kept only because its refusal costs ~200ms and it may recover.
  'https://overpass-api.de/api/interpreter'
];

// NEVER add a mirror without checking it returns real data FOR THE REGION IN
// USE. overpass.osm.ch answers 200 with valid JSON and ZERO elements outside
// Switzerland, which blanks the map with no error. Use tools/overpass-check.html.

// The client must wait LONGER than the server is allowed to work, or a slow
// but successful query gets killed by our own abort.
export const SERVER_TIMEOUT_S = 10;
export const CLIENT_TIMEOUT_MS = 12000;
