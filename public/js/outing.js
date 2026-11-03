/**
 * outing.js — "An afternoon with Vrooom", as it is designed (not measured).
 *
 * A plain timeline: one green line for everything physical, an orange point
 * for each moment on the screen. Phases are as long as they last; the screen
 * moments take seconds, so they are points. Edit TIMELINE to change it.
 */

const TIMELINE = [
  { screen: 'Tap the car' },
  { phase: 'Walk there', min: 15 },
  { screen: "I'm here!" },
  { phase: 'Play, for hours', min: 120 },
  { phase: 'Walk home', min: 15 },
  { screen: 'Scan to print' },
  { phase: 'Cut, colour, glue', min: 45 }
];

function render(root) {
  const total = TIMELINE.reduce((n, t) => n + (t.min || 0), 0);
  const at = m => `${((m / total) * 100).toFixed(2)}%`;
  let now = 0;
  let points = 0;
  const marks = TIMELINE.map(t => {
    if (t.screen) {
      // Labels alternate between two rows so close points never collide
      return `<li class="tl-point" data-row="${points++ % 2}" style="--at: ${at(now)}"><span>${t.screen}</span></li>`;
    }
    const mid = now + t.min / 2;
    now += t.min;
    return `<li class="tl-phase" style="--at: ${at(mid)}"><span>${t.phase}</span></li>`;
  }).join('');
  root.querySelector('.tl').innerHTML = `<li class="tl-line" aria-hidden="true"></li>${marks}`;

  new IntersectionObserver(([entry], observer) => {
    if (!entry.isIntersecting) return;
    root.classList.add('is-drawn');
    observer.disconnect();
  }, { threshold: 0.5 }).observe(root.querySelector('.tl'));
}

const root = document.querySelector('.afternoon');
if (root) render(root);
