/**
 * Make text safe to put inside HTML or SVG markup — pure, zero dependencies.
 * Used by the app and, through badge-svg.js, by the website.
 *
 * Place names come from OpenStreetMap, which anyone can edit, and from the
 * relay, which anyone holding a session id can post to — a name like
 * `<img src=x onerror=…>` must stay text.
 */
export function escapeXML(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
