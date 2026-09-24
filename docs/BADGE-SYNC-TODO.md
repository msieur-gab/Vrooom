# Badge Sync — working document

Status as of 2026-09-22. PeerJS is gone; the print bridge is an HTTP relay.
Supersedes the pre-decision analysis this file used to hold.

## The flow

1. Parent opens the connect page on a computer. It invents an 8-character
   session id and renders it into a QR code.
2. The kid scans that QR with the Vrooom PWA.
3. The phone POSTs the badge payload to the relay, keyed by that id.
4. The connect page, polling every 2s, picks it up and renders a printable
   badge sheet.

The QR is a **pairing token**, not a data carrier — it identifies which kid,
car and badges the computer is about to receive. Data always flows
phone -> relay -> computer.

## Why PeerJS was replaced

- Depended on the `peerjs.com` cloud broker, with no TURN fallback, so it died
  silently behind restrictive NATs.
- Imported `peerjs`, `jsqr` and `qrcode` from `esm.sh` at runtime — the phone
  needed a live internet round trip just to open the scanner, which broke the
  offline-first promise of the PWA.
- 330 lines of state machine (heartbeat, timeout, retry, wake lock) whose only
  user-visible failure mode was "Waiting for connection…".

Pure HTTP works through every NAT, school firewall and corporate proxy that
WebRTC died behind. `jsQR` and `qrcode` are now vendored.

## Implementation

| file | role |
|---|---|
| `netlify/functions/session.js` | relay on Netlify Blobs (demo host) |
| `server/php/session.php` | same contract for OVH shared hosting, no build step |
| `site/connect.html` | QR + 2s poll + badge sheet render |
| `js/app.js` | scan -> `buildPrintPayload` -> one POST |
| `js/services/badge.js` | `buildPrintPayload` |

Contract:

```
POST /api/session?id=ABCD1234   store payload
GET  /api/session?id=ABCD1234   204 while empty, 200 + payload once uploaded
```

The phone resolves `/api/session` against the **origin of the scanned QR**, so
the same app works against Netlify and OVH with no per-host configuration.

Two decisions worth not re-litigating:

- **Reads use strong consistency.** Netlify Blobs reads are eventually
  consistent by default, and a poll immediately after the upload returns the
  slot empty. Caused a real production bug; fixed.
- **Reads do not delete.** A one-shot read whose response was lost in transit
  would leave the computer polling an empty slot forever — the exact
  "Waiting for connection…" limbo this rewrite exists to kill. The TTL cleans
  up instead.

## Two separate clocks

Conflating these makes the page expire in the parent's face.

| clock | where | value | meaning |
|---|---|---|---|
| QR lifetime | `js/config.js` `QR_LIFETIME_MS` | 15 min | how long the page keeps polling before calling its QR stale. A patience budget, not a security control. |
| payload TTL | `session.js` `TTL_MS`, `session.php` `$TTL` | 2 min | how long an uploaded payload stays readable. Measured **from the upload**, not from when the QR appeared. |

## Payload

v2 (current) sends place names so badges can be captioned:

```json
{ "v": 2, "user": "Emma", "car": "Classic Vroom",
  "badges": { "playgrounds": ["Parc Blandan"], "regulars": [], "milestones": [1] } }
```

v1 sent counts instead of arrays. The connect page still accepts it — a phone
on a cached older service worker keeps sending v1 until its worker updates.

## Threat model

What an uploaded payload exposes while it sits on the relay.

### Not a realistic risk: guessing a session id

Ids are 8 characters from a 32-symbol alphabet drawn from
`crypto.getRandomValues` — 32^8 ~ 1.1 x 10^12 (40 bits). The alphabet is
exactly 32 symbols and 256 divides evenly by 32, so `b % 32` is unbiased;
there are no weak ids.

An attacker making 10 requests/second for the whole window gets ~1,200 guesses
against a trillion-wide space containing one live session: odds around
1 in 10^9, before Netlify's rate limiting. Wrong guesses return a bare `204`,
so there is no oracle to narrow the search.

### The real exposures

1. **Anyone who can see the screen.** The QR is displayed on a computer in
   whatever room you are in. Photograph it and you can fetch the payload — and
   because reads do not delete, you can fetch it *after* the parent has. In a
   home this is irrelevant. In a library, cafe or school it is the actual
   attack surface, and no amount of key length changes it.
2. **The host can read it.** Netlify Blobs is unencrypted from our point of
   view. Same on OVH, with the difference that OVH is our box.

In transit it is TLS, which is fine.

### Why there is no encryption layer

An E2E-encrypted design was proposed and rejected: the computer would generate
a key alongside the session id, put it in the QR's **fragment** (never sent to
a server), and the phone would AES-GCM the payload so the relay stored only
ciphertext.

It was dropped because the v1 payload carried no place names and so had nothing
worth protecting — "the idea is to simplify and bring robustness, not to build
a bunker no one can enter."

**That premise weakened when v2 reintroduced names.** A child's first name plus
the playgrounds they visit repeatedly is a home-neighbourhood profile. The
mitigation chosen instead was to cut the exposure window: TTL 15 min -> 2 min.
If the exposure ever feels too large, the fragment-key design is the thing to
reach for, and it is maybe 30 lines of WebCrypto.

### Mitigations not yet applied

- **Delete shortly after a successful read** (say 60s), preserving the retry
  safety that motivated not deleting at all, while closing the long tail.
- **12-character session ids** — essentially free, though already the
  strongest link in the chain.
- **Strip names for places the kid has visited only once**, which are the most
  location-revealing and the least meaningful as a printed keepsake.

## Open

- Badge captions are often the generic string `Playground` — see
  `BADGE-NAMING-TODO.md`, which also records a `placeKey` bug that can merge
  two playgrounds into one badge or split one park into two.
- The phone half (camera scan -> POST) has not been exercised on a real device.
- `server/php/session.php` has never been executed; PHP is not installed on the
  dev machine, so it is reviewed by eye only.
