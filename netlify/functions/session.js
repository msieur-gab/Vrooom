/**
 * session.js — badge sync relay.
 *
 * A dumb postbox. The computer invents a session id and puts it in a QR code;
 * the phone scans it and POSTs the badge payload; the computer polls until the
 * payload shows up. Pure HTTP, so it works through every NAT and firewall that
 * WebRTC used to die behind.
 *
 * POST /api/session?id=ABCD1234   store payload
 * GET  /api/session?id=ABCD1234   204 while empty, 200 + payload once uploaded
 *
 * The mirror of this file for OVH shared hosting is server/php/session.php.
 */

import { getStore } from '@netlify/blobs';

// Measured from the upload, not from when the QR appeared. The handover takes
// about 20 seconds, so this is deliberately tight — it is the window in which
// a payload sits readable on the relay.
const TTL_MS = 2 * 60 * 1000;
const MAX_BYTES = 64 * 1024;
const ID_RE = /^[A-Z0-9]{8}$/;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store'
};

const JSON_HEADERS = { ...CORS, 'Content-Type': 'application/json' };

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const id = (new URL(request.url).searchParams.get('id') || '').toUpperCase();
  if (!ID_RE.test(id)) {
    return new Response('{"error":"bad session id"}', { status: 400, headers: JSON_HEADERS });
  }

  // Strong consistency is required: Blobs reads are eventually consistent by
  // default, so the computer's poll right after the phone's upload can come
  // back empty.
  const store = getStore({ name: 'vrooom-sessions', consistency: 'strong' });

  // — Phone uploads —
  if (request.method === 'POST') {
    const body = await request.text();
    if (body.length > MAX_BYTES) {
      return new Response('{"error":"payload too large"}', { status: 413, headers: JSON_HEADERS });
    }
    try {
      JSON.parse(body); // reject anything that isn't a payload
    } catch {
      return new Response('{"error":"not json"}', { status: 400, headers: JSON_HEADERS });
    }
    await store.set(id, body, { metadata: { at: Date.now() } });
    return new Response('{"ok":true}', { status: 200, headers: JSON_HEADERS });
  }

  // — Computer polls —
  if (request.method === 'GET') {
    const entry = await store.getWithMetadata(id, { type: 'text', consistency: 'strong' });
    if (!entry) return new Response(null, { status: 204, headers: CORS });

    // Only expire when we actually know the write time. Defaulting a missing
    // timestamp to 0 would make every entry look older than the TTL and throw
    // away a payload that just arrived.
    const writtenAt = Number(entry.metadata?.at);
    if (Number.isFinite(writtenAt) && Date.now() - writtenAt > TTL_MS) {
      await store.delete(id);
      return new Response(null, { status: 204, headers: CORS });
    }

    // Deliberately NOT deleted on read. If the response were lost in transit a
    // one-shot read would leave the computer polling an empty slot forever —
    // which is the "Waiting for connection…" limbo this rewrite exists to kill.
    // The TTL above is what cleans up instead.
    return new Response(entry.data, { status: 200, headers: JSON_HEADERS });
  }

  return new Response('{"error":"method not allowed"}', { status: 405, headers: JSON_HEADERS });
};
