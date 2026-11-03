/**
 * stickers.js — the app's real badges, stuck on the page as vinyl stickers.
 *
 * Each <span data-sticker="…"> gets the badge drawing the app prints
 * (shared/badge-svg.js), coloured in with one crayon colour, then made into a
 * sticker: a die-cut white edge, a glossy plastic sheen, and one corner
 * peeling up to show the paper backing.
 *   data-sticker="milestone" data-n="1" data-title="First Adventure"
 *   data-sticker="playground" | "regular" data-title="…"
 *   data-colour="#f2c94c"   data-peel="br" | "tr"  (which corner curls)
 */
import { playgroundBadgeSVG, regularBadgeSVG, milestoneBadgeSVG } from '../shared/badge-svg.js';

const SHIELD = 'M60 10 L100 30 L100 65 Q100 95 60 110 Q20 95 20 65 L20 30 Z';
const CIRCLE = 'M60 4 A56 56 0 1 1 59.99 4 Z';
const EDGE = 6;                      // white die-cut margin, in badge units

// Mirror point p across the line through a and b
function reflect(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  const fx = a.x + t * dx, fy = a.y + t * dy;
  return { x: 2 * fx - p.x, y: 2 * fy - p.y };
}

// A small seeded random, so each sticker's scribble is the same on every visit
function random(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fat wax crayon, coloured in the way a kid does: back-and-forth zigzags at
// a slant, a bit over the lines, a gap here and there, a second lighter pass.
function scribble(rand, angle, spacing, from, to, gaps) {
  const a = angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const at = (u, v) => `${(60 + u * ca - v * sa).toFixed(1)} ${(60 + u * sa + v * ca).toFixed(1)}`;
  let d = '', pen = false;
  for (let k = 0, v = from; v < to; k++, v += spacing * (0.7 + rand() * 0.6)) {
    if (rand() < gaps) { pen = false; continue; }            // the crayon lifts
    const u = (k % 2 ? 1 : -1) * (58 + rand() * 14);         // overshoot the edge, unevenly
    d += `${pen ? 'L' : 'M'}${at(u, v + (rand() - 0.5) * 4)}`;
    pen = true;
  }
  return d;
}

// The part cut away by the curl, and the flap it folds into
function peelFor(shape, corner) {
  if (shape === 'circle') {
    // A chord across the corner; the flap is that cap folded back over the chord
    const R = 56 + EDGE, d = 47;
    const ang = corner === 'tr' ? -Math.PI / 4 : Math.PI / 4;
    const dir = { x: Math.cos(ang), y: Math.sin(ang) };
    const half = Math.sqrt(R * R - d * d);
    const m = { x: 60 + d * dir.x, y: 60 + d * dir.y };
    const a = { x: m.x - half * dir.y, y: m.y + half * dir.x };
    const b = { x: m.x + half * dir.y, y: m.y - half * dir.x };
    const f = n => n.toFixed(1);
    return {
      cut:  `M${f(a.x)} ${f(a.y)} A${R} ${R} 0 0 0 ${f(b.x)} ${f(b.y)} Z`,
      flap: `M${f(a.x)} ${f(a.y)} A${R} ${R} 0 0 1 ${f(b.x)} ${f(b.y)} Z`,
      fold: [a, b]
    };
  }
  // Shield: fold the top-right corner
  const p1 = { x: 84, y: 22 }, p2 = { x: 100, y: 48 };
  const tip = { x: 100 + EDGE, y: 30 - EDGE * 0.6 };
  const c2 = reflect(tip, p1, p2);
  const f = n => n.toFixed(1);
  return {
    cut:  `M${p1.x} ${p1.y} L78 0 L130 0 L130 54 L${p2.x} ${p2.y} Z`,
    flap: `M${p1.x} ${p1.y} Q${f((p1.x + c2.x) / 2 - 2)} ${f((p1.y + c2.y) / 2 + 3)} ${f(c2.x)} ${f(c2.y)} L${p2.x} ${p2.y} Z`,
    fold: [p1, p2]
  };
}

let count = 0;

function sticker({ sticker, title = '', n = 0, colour = '#f2c94c', peel }) {
  const id = `stk${count}`;
  const rand = random(1000 + count++ * 7919);
  const badge = sticker === 'milestone' ? milestoneBadgeSVG(title, Number(n))
    : sticker === 'regular' ? regularBadgeSVG(title)
    : playgroundBadgeSVG(title);
  // Keep the drawing's own defaults (no fill, ink lines) around its content
  const inner = badge.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const shape = sticker === 'milestone' ? 'shield' : 'circle';
  const outline = shape === 'shield' ? SHIELD : CIRCLE;
  const { cut, flap, fold } = peelFor(shape, peel || (shape === 'shield' ? 'tr' : 'br'));
  const [fa, fb] = fold;

  return `
  <svg viewBox="-12 -12 144 144" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <mask id="${id}m"><rect x="-12" y="-12" width="144" height="144" fill="white"/><path d="${cut}" fill="black"/></mask>
      <linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity="0.45"/>
        <stop offset="0.28" stop-color="#fff" stop-opacity="0.06"/>
        <stop offset="0.42" stop-color="#fff" stop-opacity="0"/>
        <stop offset="0.5" stop-color="#fff" stop-opacity="0.5"/>
        <stop offset="0.56" stop-color="#fff" stop-opacity="0"/>
        <stop offset="1" stop-color="#000" stop-opacity="0.08"/>
      </linearGradient>
      <linearGradient id="${id}b" gradientUnits="userSpaceOnUse"
        x1="${((fa.x + fb.x) / 2).toFixed(1)}" y1="${((fa.y + fb.y) / 2).toFixed(1)}" x2="60" y2="60">
        <stop offset="0" stop-color="#cfcac2"/>
        <stop offset="0.35" stop-color="#f7f5f1"/>
        <stop offset="1" stop-color="#ffffff"/>
      </linearGradient>
      <clipPath id="${id}k"><path d="${outline}" transform="translate(60 60) scale(1.06) translate(-60 -60)"/></clipPath>
      <filter id="${id}c" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="${count}" result="grain"/>
        <feDisplacementMap in="SourceGraphic" in2="grain" scale="2.5" xChannelSelector="R" yChannelSelector="G" result="rough"/>
        <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.3 1.45" result="wax"/>
        <feComposite in="rough" in2="wax" operator="in"/>
      </filter>
      <filter id="${id}s" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="-1.5" dy="-1" stdDeviation="2" flood-color="#000" flood-opacity="0.28"/>
      </filter>
    </defs>
    <g mask="url(#${id}m)">
      <path d="${outline}" fill="#fff" stroke="#fff" stroke-width="${EDGE * 2}" stroke-linejoin="round"/>
      <g clip-path="url(#${id}k)" filter="url(#${id}c)" fill="none" stroke="${colour}"
         stroke-linecap="round" stroke-linejoin="round">
        <path d="${scribble(rand, -32 + rand() * 14, 10, -66, 66, 0.05)}" stroke-width="7"/>
        <path d="${scribble(rand, 38 + rand() * 20, 12, -40 + rand() * 30, 30 + rand() * 30, 0.2)}" stroke-width="6" stroke-opacity="0.6"/>
      </g>
      <g fill="none" stroke="#2a2520" stroke-width="1.5">${inner}</g>
      <path d="${outline}" fill="url(#${id}g)" stroke="url(#${id}g)" stroke-width="${EDGE * 2}" stroke-linejoin="round"/>
      <path d="${outline}" fill="none" stroke="#000" stroke-opacity="0.07" stroke-width="${EDGE * 2 + 1}" stroke-linejoin="round"/>
    </g>
    <path d="${flap}" fill="url(#${id}b)" filter="url(#${id}s)"/>
  </svg>`;
}

const els = [...document.querySelectorAll('[data-sticker]')];
els.forEach(el => {
  el.innerHTML = sticker(el.dataset);
  el.setAttribute('aria-hidden', 'true');
});

// Drag and drop: pick a sticker up and stick it anywhere on the page. On the
// first grab it leaves its section and lives on the page itself, so a card's
// scrolling or a title's line can't clip it. Not remembered after a reload.
const pageZoom = () => parseFloat(getComputedStyle(document.body).zoom) || 1;

els.forEach(el => {
  el.addEventListener('pointerdown', down => {
    if (down.button > 0) return;
    down.preventDefault();
    const z = pageZoom();
    const box = el.getBoundingClientRect();
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    const grabX = down.clientX - cx, grabY = down.clientY - cy;
    const half = el.offsetWidth / 2;
    const place = (x, y) => {
      el.style.left = `${(x + scrollX) / z - half}px`;
      el.style.top = `${(y + scrollY) / z - half}px`;
    };
    if (el.parentElement !== document.body) {
      document.body.append(el);
      el.classList.add('is-loose');
    }
    place(cx, cy);
    el.classList.add('is-dragging');
    el.setPointerCapture(down.pointerId);

    const drag = e => place(e.clientX - grabX, e.clientY - grabY);
    const drop = () => {
      el.classList.remove('is-dragging');
      el.style.setProperty('--tilt', `${Math.round(Math.random() * 28 - 14)}deg`);
      el.removeEventListener('pointermove', drag);
      el.removeEventListener('pointerup', drop);
      el.removeEventListener('pointercancel', drop);
    };
    el.addEventListener('pointermove', drag);
    el.addEventListener('pointerup', drop);
    el.addEventListener('pointercancel', drop);
  });
});

// Scrolling turns and lifts each sticker a little, each at its own pace,
// so they feel stuck on a page that moves rather than printed on it.
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const pace = els.map((_, i) => (i % 2 ? -1 : 1) * (14 + i * 4));
  let queued = false;
  const move = () => {
    queued = false;
    els.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      // -1 when the sticker enters at the bottom, +1 when it leaves at the top
      const t = Math.max(-1, Math.min(1, 1 - 2 * (r.top + r.height / 2) / innerHeight));
      el.style.setProperty('--spin', `${(t * pace[i]).toFixed(2)}deg`);
      el.style.setProperty('--lift', `${(t * -18).toFixed(1)}px`);
    });
  };
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(move); } }, { passive: true });
  move();
}
