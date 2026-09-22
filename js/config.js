/**
 * Shared configuration.
 */

// Relay path, resolved against the origin of the scanned QR code — so the app
// talks to whichever host served the connect page (Netlify demo, OVH later)
// without needing to know about it in advance.
export const SYNC_PATH = '/api/session';

// Session id: 8 chars, no vowels or look-alike glyphs (0/O, 1/I).
export const SESSION_ID_RE = /^[A-Z0-9]{8}$/;

export const POLL_INTERVAL_MS = 2000;
export const SESSION_TTL_MS = 15 * 60 * 1000;
