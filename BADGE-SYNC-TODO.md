# Badge Sync — Replace PeerJS

## Context

The Vrooom app lets kids earn badges at playgrounds. To print them, the flow is:

1. Parent opens `vrooom.app/print` (the `site/connect.html` page) on a computer
2. Website generates a unique session QR code
3. Kid scans QR with the Vrooom app on the phone
4. App sends badge data → website renders a printable badge sheet

Data flows **phone → [somewhere] → website**. A relay of some kind is unavoidable since the website initiates the session (it shows the QR) and the phone responds.

---

## Why PeerJS is a problem

Current implementation lives in `site/lib/peer-drop/` (peer-bridge.js, peer-qrcode.js, peer-scanner.js).

- Depends on **peerjs.com cloud signaling** being up — if it's down, nothing works
- ICE/STUN/TURN negotiation silently fails behind some corporate or school NATs
- ~250 lines of protocol: heartbeat, timeout, retry, wake lock, connection state machine
- Users experience "Waiting for connection…" limbo with no clear failure mode
- External dependency on `esm.sh/peerjs@1` CDN import

---

## Proposal evaluated: HTTP relay on Netlify

Since the app is already on Netlify, one small function handles everything:

```
POST /session         → creates slot, returns { sessionId: "XK7P2Q" }
PUT  /session/:id     → phone uploads badge JSON (single fetch call)
GET  /session/:id     → website polls every 2s, gets data once phone uploaded
```

Sessions stored in Netlify Blobs, auto-expire after 15 minutes.

**Pros:**
- Works across any network — pure HTTP, no NAT issues
- Phone-side: one `fetch()` PUT call, zero state machine
- Website-side: `setInterval` poll every 2s, clear error on failure
- No external signaling dependency
- Deletes `site/lib/peer-drop/` entirely (~250 lines gone)

**Cons / open questions:**
- Badge data (playground names, badge types) briefly touches Netlify Blobs — not sensitive, but worth noting
- Requires Netlify to be up (already the case for the whole site)
- 2s polling latency (minor)
- Session management: what if website tab is closed before phone scans?

**Rough implementation scope:**
1. `netlify/functions/session.js` — ~50 lines relay function
2. Rewrite `site/connect.html` — replace PeerBridge with simple poll loop
3. Rewrite scanner wiring in `app.js` — replace peer-scanner.js with one fetch()
4. Delete `site/lib/peer-drop/`

---

## Alternatives NOT yet explored

This analysis stopped at the first viable option. Before committing, the next agent should
also evaluate:

### A. Phone-generated QR (reversed flow)
App taps "Print" → compresses badge collection (gzip + base64url) → encodes directly into QR → parent scans with laptop camera → opens `vrooom.app/print#<data>` → renders instantly.

- Zero server, zero relay, works offline
- Data never leaves the device
- Requires flipping UX: **phone shows QR**, parent scans — not website shows QR, phone scans
- Gab specifically said website shows QR — but worth discussing whether the UX trade-off is acceptable
- QR capacity: ~600 chars for a typical badge collection (fits at M error correction)
- `CompressionStream` API available natively in all modern browsers

### B. Short-lived clipboard relay (transfer code)
Phone uploads to relay → gets back a 6-digit human-readable code → user types code on website.
No QR needed on website, no scanning. More friction but completely network-agnostic.

### C. Local network direct (no relay)
Phone and computer on same Wi-Fi → phone hosts a tiny local HTTP server → website connects directly.
No external dependency. But requires same network (school Wi-Fi, home), and "tiny local server" from a PWA is not straightforward (Web Serial? mDNS? Local IP discovery?). Probably not worth the complexity.

### D. WebSocket relay (vs. polling)
Same as the Netlify HTTP relay proposal but using a WebSocket for instant push instead of 2s polling.
Netlify Functions don't natively support WebSockets — would need a different host (Fly.io, Railway, etc.) or a third-party service. Adds infrastructure complexity. Polling at 2s is probably fine for this use case.

### E. Firebase / Supabase realtime
Use an existing realtime backend (free tier). Phone writes to a doc, website subscribes.
Adds a dependency on Google/Supabase. Overkill for what is essentially a one-shot data transfer.

---

## Decision needed from Gab

- Is the UX constraint firm (website shows QR, phone scans) or can it flip (phone shows QR)?
  - If it can flip → Option A (phone-generated QR) is the cleanest solution, zero infrastructure
  - If website-shows-QR is firm → HTTP relay on Netlify is the right call
- Privacy comfort level: ok with badge data touching Netlify Blobs for 15 min?

---

## Files to touch when implementing

- `site/connect.html` — website QR + badge render page
- `site/lib/peer-drop/` — delete entirely
- `js/app.js` — scanner wiring (search for `bridge`, `PeerBridge`, `peer-scanner`)
- `netlify/functions/session.js` — new file (relay, if HTTP relay chosen)
- `netlify.toml` — may need functions config
