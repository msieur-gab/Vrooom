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

// How long the connect page keeps polling before declaring its QR stale. This
// is a patience budget for the parent, not a security control.
//
// Not to be confused with the relay's payload TTL, which is enforced server
// side and starts when the phone uploads — see BADGE-SYNC-TODO.md.
export const QR_LIFETIME_MS = 15 * 60 * 1000;
