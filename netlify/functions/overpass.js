/**
 * overpass.js — server-side Overpass proxy.
 *
 * The app can only talk to mirrors that send CORS headers to a browser, which
 * left exactly one usable endpoint (a Russian mirror) as measured from a real
 * browser on 2026-09-22. Server to server there is no origin policy at all, so
 * this widens the choice to any reachable instance — and the child's IP never
 * reaches the mirror, only ours.
 *
 * POST /api/overpass   body: data=<url-encoded Overpass QL>
 *
 * Mirrors are tried in order and the FIRST response that is genuinely usable
 * wins. "Usable" is deliberately strict, because Overpass mirrors fail in ways
 * that look like success:
 *   - HTTP 200 with an HTML error body (osm.ch does this for duplicate queries)
 *   - HTTP 200 with valid JSON and zero elements, because the instance only
 *     holds another region's data (osm.ch outside Switzerland). That one blanked
 *     the map with no error at all, so an empty reply is never trusted while
 *     another mirror is still untried.
 */

// Measured through this proxy on 2026-09-22: mail.ru is the only mirror
// Netlify can reach either. It goes first so the common path costs one round
// trip — trying the dead ones first cost 25s instead of 5s. The rest stay as
// fallbacks in case they come back.
const MIRRORS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];

const MAX_QUERY_BYTES = 8 * 1024;
const UPSTREAM_TIMEOUT_MS = 8000;   // a dead mirror must not cost 20s
const TOTAL_BUDGET_MS = 16000;      // answer before the client gives up at 20s

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store'
};
const JSON_HEADERS = { ...CORS, 'Content-Type': 'application/json' };

export default async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') {
    return new Response('{"error":"method not allowed"}', { status: 405, headers: JSON_HEADERS });
  }

  const body = await request.text();

  // Not an open proxy: only Overpass QL, only to mirrors chosen here.
  if (body.length > MAX_QUERY_BYTES || !body.startsWith('data=')) {
    return new Response('{"error":"bad query"}', { status: 400, headers: JSON_HEADERS });
  }
  const query = decodeURIComponent(body.slice(5));
  if (!query.includes('[out:json]')) {
    return new Response('{"error":"bad query"}', { status: 400, headers: JSON_HEADERS });
  }

  const tried = [];
  let emptyFallback = null;
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  for (const mirror of MIRRORS) {
    const left = deadline - Date.now();
    if (left < 1500) { tried.push(`${host(mirror)}:skipped-no-time`); continue; }

    try {
      const res = await fetch(mirror, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(Math.min(UPSTREAM_TIMEOUT_MS, left))
      });

      if (!res.ok) { tried.push(`${host(mirror)}:${res.status}`); continue; }

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        tried.push(`${host(mirror)}:not-json`);   // 200 with an HTML error page
        continue;
      }

      const count = (data.elements || []).length;
      if (count === 0) {
        // Could be a genuinely empty area, or a regional instance that has no
        // data here. Keep it, but let a mirror with results win first.
        emptyFallback ??= { text, mirror };
        tried.push(`${host(mirror)}:empty`);
        continue;
      }

      return new Response(text, {
        status: 200,
        headers: { ...JSON_HEADERS, 'X-Overpass-Mirror': host(mirror) }
      });

    } catch (err) {
      tried.push(`${host(mirror)}:${err.name === 'TimeoutError' ? 'timeout' : 'unreachable'}`);
    }
  }

  // Every mirror with data failed. An empty-but-valid reply beats no reply.
  if (emptyFallback) {
    return new Response(emptyFallback.text, {
      status: 200,
      headers: { ...JSON_HEADERS, 'X-Overpass-Mirror': `${host(emptyFallback.mirror)} (empty)` }
    });
  }

  return new Response(JSON.stringify({ error: 'all mirrors failed', tried }), {
    status: 502,
    headers: JSON_HEADERS
  });
};

function host(url) {
  return new URL(url).hostname;
}
