/**
 * Badge SVG generators — pure functions, zero dependencies.
 * Used by both the app (badge.js) and the website (connect.html).
 */

/**
 * Make text safe to put inside markup. Place names come from OpenStreetMap,
 * which anyone can edit, and from the relay, which anyone holding a session
 * id can post to — a name like `<img src=x onerror=…>` must stay text.
 */
export function escapeXML(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Shortened first, escaped after, so the length counts letters, not entities.
function caption(text, max) {
  const short = text.length > max ? text.substring(0, max - 2) + '…' : text;
  return escapeXML(short);
}

export function playgroundBadgeSVG(name = 'Playground') {
  const displayName = caption(name, 20);
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#2a2520" stroke-width="1.5">
    <circle cx="60" cy="60" r="56" stroke-width="2"/>
    <circle cx="60" cy="60" r="50" stroke-dasharray="4 3"/>
    <!-- Swing set -->
    <line x1="35" y1="35" x2="35" y2="75"/>
    <line x1="85" y1="35" x2="85" y2="75"/>
    <line x1="30" y1="35" x2="90" y2="35"/>
    <line x1="45" y1="35" x2="42" y2="60"/>
    <line x1="75" y1="35" x2="72" y2="60"/>
    <rect x="38" y="60" width="8" height="3" rx="1"/>
    <rect x="68" y="60" width="8" height="3" rx="1"/>
    <!-- Star -->
    <polygon points="60,20 62,26 68,26 63,30 65,36 60,32 55,36 57,30 52,26 58,26" stroke-width="1"/>
    <text x="60" y="95" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="8" font-weight="500" stroke="none" fill="#2a2520">${displayName}</text>
  </svg>`;
}

export function regularBadgeSVG(name = 'Place') {
  const displayName = caption(name, 18);
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#2a2520" stroke-width="1.5">
    <circle cx="60" cy="60" r="56" stroke-width="2"/>
    <circle cx="60" cy="60" r="50" stroke-dasharray="4 3"/>
    <!-- Heart -->
    <path d="M60 85 C40 68 25 55 25 43 C25 33 33 25 43 25 C50 25 56 29 60 35 C64 29 70 25 77 25 C87 25 95 33 95 43 C95 55 80 68 60 85Z" stroke-width="2"/>
    <!-- 10x label -->
    <text x="60" y="60" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="14" font-weight="700" stroke="none" fill="#2a2520">10x</text>
    <text x="60" y="103" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="7" font-weight="500" stroke="none" fill="#2a2520">${displayName}</text>
  </svg>`;
}

export function milestoneBadgeSVG(title = 'Milestone', threshold = 0) {
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#2a2520" stroke-width="1.5">
    <!-- Shield shape -->
    <path d="M60 10 L100 30 L100 65 Q100 95 60 110 Q20 95 20 65 L20 30 Z" stroke-width="2"/>
    <path d="M60 18 L94 35 L94 63 Q94 89 60 103 Q26 89 26 63 L26 35 Z" stroke-dasharray="4 3"/>
    <!-- Number -->
    <text x="60" y="62" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="24" font-weight="700" stroke="none" fill="#2a2520">${escapeXML(threshold)}</text>
    <!-- Star crown -->
    <polygon points="60,22 63,28 70,28 65,32 67,38 60,34 53,38 55,32 50,28 57,28" stroke-width="1"/>
    <text x="60" y="88" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="7" font-weight="500" stroke="none" fill="#2a2520">${escapeXML(title)}</text>
  </svg>`;
}
