/**
 * how.js — the toys on the page (from design/prototype, 2026-11-04):
 * both carousels' arrows, the real "I'm here!" button, a badge you colour in
 * with a tap, and the printed badge sheet.
 */
import { milestoneBadgeSVG, playgroundBadgeSVG, regularBadgeSVG } from '../shared/badge-svg.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Carousels (How it works, Why families love it): arrows move one card ── */

document.querySelectorAll('.rail-head').forEach(head => {
  const track = head.nextElementSibling;
  const btns = head.querySelectorAll('.rail-btn');
  const gap = () => parseFloat(getComputedStyle(track).columnGap) || 0;
  const step = () => track.firstElementChild.offsetWidth + gap();
  const ends = () => {
    btns[0].disabled = track.scrollLeft < 8;
    btns[1].disabled = track.scrollLeft > track.scrollWidth - track.clientWidth - 8;
    // Nothing to scroll (a wide screen): no arrows
    head.classList.toggle('still', track.scrollWidth <= track.clientWidth + 8);
  };
  btns.forEach(b => b.addEventListener('click', () =>
    track.scrollBy({ left: step() * Number(b.dataset.dir), behavior: reduced ? 'auto' : 'smooth' })));
  track.addEventListener('scroll', ends, { passive: true });
  new ResizeObserver(ends).observe(track);
});

/* ── Card 3: the app's real check-in button ── */

const checkin = document.querySelector('.app-checkin');
const note = document.querySelector('.checkin-note');
checkin?.addEventListener('click', () => {
  const done = checkin.classList.toggle('done');
  checkin.textContent = done ? 'Checked in' : "I'm here!";
  note.textContent = done ? 'Phone away. Go play.' : '';
});

/* ── Badges as printed, coloured in with a crayon scribble ── */

const SHIELD = 'M60 10 L100 30 L100 65 Q100 95 60 110 Q20 95 20 65 L20 30 Z';
const CIRCLE = 'M60 4 A56 56 0 1 1 59.99 4 Z';
const CRAYONS = ['#ffc21a', '#14b3a3', '#ff5d8f', '#2f8cff', '#3fae49'];

// Back-and-forth strokes, top to bottom, the way a kid fills a shape
const SCRIBBLE = (() => {
  let d = 'M14 12', y = 12, right = true;
  while (y < 114) { y += 7; d += ` L${right ? 108 : 12} ${y + (right ? -3 : 3)}`; right = !right; }
  return d;
})();

const inner = svg => svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
let clipN = 0;

function crayonBadge(svg, shape, colour) {
  const id = `crayon${clipN++}`;
  return `
  <svg viewBox="0 0 120 120" aria-hidden="true">
    <defs>
      <clipPath id="${id}"><path d="${shape}"/></clipPath>
      <filter id="${id}f" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="${clipN}" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="5"/>
        <feComponentTransfer><feFuncA type="table" tableValues="0 .8 .9"/></feComponentTransfer>
      </filter>
    </defs>
    <g clip-path="url(#${id})">
      <path class="scribble" d="${SCRIBBLE}" pathLength="1" filter="url(#${id}f)" style="stroke:${colour || 'none'}"/>
    </g>
    <g fill="none" stroke="#2a2520" stroke-width="1.5">${inner(svg)}</g>
  </svg>`;
}

/* ── Card 4: tap the badge to colour it in, each time with the next crayon ── */

const colourIn = document.querySelector('.colour-in');
if (colourIn) {
  colourIn.innerHTML = crayonBadge(milestoneBadgeSVG('First Adventure', 1), SHIELD);
  const scribble = colourIn.querySelector('.scribble');
  let crayon = 0;
  colourIn.addEventListener('click', () => {
    colourIn.classList.remove('coloured');
    scribble.style.stroke = CRAYONS[crayon++ % CRAYONS.length];
    scribble.getBoundingClientRect();          // restart the stroke from zero
    colourIn.classList.add('coloured');
    colourIn.setAttribute('aria-label', 'Colour the badge again, with another crayon');
  });
}

/* ── The print sheet: what the connect page prints, a few already coloured,
      the Explorer badge already cut out (it's the sticker on the title) ── */

const sheet = document.querySelector('.sheet-grid');
if (sheet) {
  const cells = [
    [milestoneBadgeSVG('First Adventure', 1), SHIELD, '#ffc21a'],
    'cut',
    [regularBadgeSVG('Our park'), CIRCLE],
    [playgroundBadgeSVG('Hofgarten'), CIRCLE, '#3fae49'],
    [playgroundBadgeSVG('Luitpoldpark'), CIRCLE],
    [playgroundBadgeSVG('Englischer Garten'), CIRCLE],
    [playgroundBadgeSVG('Alter Nordfriedhof'), CIRCLE],
    [playgroundBadgeSVG('Petuelpark'), CIRCLE, '#ff5d8f'],
    [playgroundBadgeSVG('Bayerpark'), CIRCLE]
  ];
  sheet.innerHTML = cells.map(c => c === 'cut'
    ? '<div class="sheet-cell cut"></div>'
    : `<div class="sheet-cell">${crayonBadge(...c)}</div>`).join('');
}
