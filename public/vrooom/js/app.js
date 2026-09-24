/**
 * Vrooom — App Controller
 * Screen navigation, onboarding flow, map integration, badge display.
 */

import * as db from './services/database.js';
import { nfcService } from './services/nfc.js';
import { locate } from './utils/geo.js';
import { haversine } from './utils/distance.js';
import { fetchNearby, getCachedNearby, setPlaceSource } from './services/playground.js';
import { checkIn, freshGPS } from './services/checkin.js';
import { getBadgeCollection, buildPrintPayload, playgroundBadgeSVG, regularBadgeSVG, milestoneBadgeSVG, MILESTONES } from './services/badge.js';
import { SYNC_PATH, SESSION_ID_RE } from '../../shared/config.js';
import { initMap, placeUser, displayPlaygrounds, formatDistance, showRoute, clearRoute, placesInView } from './utils/map.js';

// ── Available car configs ─────────────────────

// `id` is the contract with the NFC tag in the wood: a tag carries
// .../vrooom/?car=<id>, for life. Ids are the toys' names. The config file
// behind an id can move freely; the id must never change.
const CAR_CONFIGS = [
  { id: 'vrooom', name: 'Classic Vroom', configUrl: './data/conf-vroom.json' },
  { id: 'grreee', name: 'Classic Grree', configUrl: './data/conf-dodge.json' }
];

// The car a tag URL (or the app's own address) names, or null.
function carFromUrl(href) {
  try {
    const id = new URL(href, location.href).searchParams.get('car');
    return CAR_CONFIGS.find(car => car.id === id) || null;
  } catch {
    return null;
  }
}

const AVATARS = ['🧒','👦','👧','🧒🏽','👦🏽','👧🏽','🧒🏿','👦🏿','👧🏿','🦊','🐻','🐰','🐸','🦁','🐼','🐨','🐱','🐶'];

// ── App state ─────────────────────────────────

let profile = null;
let selectedCar = null;
let map = null;
let userCoords = null;
let searchRadius = 1500;
let playgrounds = [];
let selectedPlayground = null;
let selectedAvatar = null;
let pendingCarConfig = null;
let carSideViewUrl = null;
let carSideProfiles = { left: null, right: null };
let carSounds = { horn: null, engine: null };
let garageEngineOn = false;
let garageLightsOn = false;

// ── DOM refs ──────────────────────────────────

const $ = id => document.getElementById(id);

// ── Slider thumb helper ─────────────────────

function applySliderThumb() {
  const url = carSideProfiles.right;
  if (url) $('radius-slider').style.setProperty('--slider-thumb', `url(${url})`);
}

// ── Sound helper ─────────────────────────────

function playSound(url) {
  if (!url) return null;
  const a = new Audio(url);
  a.volume = 0.5;
  a.play().catch(() => {});
  return a;
}

function stopSound(audio) {
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
}

// ── Init ──────────────────────────────────────

async function init() {
  await restoreState();

  setupAvatarGrid();
  setupCarGrid();
  setupEventListeners();

  if (profile && selectedCar) {
    showScreen('garage-screen'); // also loads the garage car
  } else {
    showScreen('welcome');
    loadWelcomeCar();
  }

  await openCarFromLaunchUrl();
}

/**
 * Read the profile, the car, and the car's picture and sounds saved with it.
 * Run at launch and again after an import replaced everything.
 */
async function restoreState() {
  profile = await db.getProfile();
  selectedCar = await db.getSelectedCar();

  carSideViewUrl = await db.getSetting('carSideViewUrl') || null;
  carSideProfiles = { left: null, right: null, ...await db.getSetting('carSideProfiles') };
  applySliderThumb();
  carSounds = { horn: null, engine: null, ...await db.getSetting('carSounds') };
}

/**
 * Tapping the car's tag outside the app opens .../vrooom/?car=<id>: show
 * that car, exactly as an in-app scan would. The parameter is then removed
 * so a reload does not replay it. A tag for the car already selected just
 * lands in the app.
 */
async function openCarFromLaunchUrl() {
  const params = new URLSearchParams(location.search);
  if (!params.has('car')) return;

  const car = carFromUrl(location.href);
  params.delete('car');
  const rest = params.toString();
  history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);

  if (!car) return showToast('Unrecognized car tag');
  if (selectedCar?.config === car.configUrl) return;
  await loadCarFromConfig(car.configUrl);
}

// ── Screen navigation ─────────────────────────

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => {
    s.hidden = s.id !== screenId;
  });

  // Show/hide bottom nav
  const mainScreens = ['garage-screen', 'map-screen', 'badge-screen'];
  $('bottom-nav').hidden = !mainScreens.includes(screenId);

  // Update nav tabs
  if (mainScreens.includes(screenId)) {
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.screen === screenId);
    });
    updateNavDot();
  }

  // Trigger screen-specific init
  if (screenId === 'garage-screen') updateGarageScreen();
  if (screenId === 'map-screen' && !map) initMapScreen();
  if (screenId === 'badge-screen') renderBadges();
}

function updateNavDot() {
  const activeTab = document.querySelector('.nav-tab.active');
  const dot = $('nav-dot');
  if (!activeTab || !dot) return;

  const nav = $('bottom-nav');
  const navRect = nav.getBoundingClientRect();
  const tabRect = activeTab.getBoundingClientRect();

  dot.style.width = tabRect.width + 'px';
  dot.style.left = (tabRect.left - navRect.left) + 'px';
}

// ── Event listeners ───────────────────────────

function setupEventListeners() {
  // Welcome screen
  $('btn-scan-nfc').addEventListener('click', startNFCScan);
  $('btn-pick-car').addEventListener('click', () => showScreen('car-select'));
  $('btn-skip-car').addEventListener('click', () => showScreen('profile-create'));

  // Car select
  $('btn-confirm-car').addEventListener('click', confirmCarSelection);

  // Car onboard
  $('btn-create-profile').addEventListener('click', () => {
    if (profile) {
      // Already has profile — go back to garage
      showScreen('garage-screen');
      $('bottom-nav').hidden = false;
    } else {
      showScreen('profile-create');
    }
  });

  // Profile
  $('btn-save-profile').addEventListener('click', saveProfile);
  $('profile-name').addEventListener('input', validateProfile);

  // Map
  $('btn-locate').addEventListener('click', relocate);
  $('detail-close').addEventListener('click', closeDetail);
  $('btn-checkin').addEventListener('click', doCheckIn);
  $('btn-imhere').addEventListener('click', doCheckIn);
  $('btn-route').addEventListener('click', onRouteButton);
  $('btn-radius').addEventListener('click', toggleRadiusPopover);
  $('radius-slider').addEventListener('input', onRadiusChange);

  // Bottom nav
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => showScreen(tab.dataset.screen));
  });

  // Garage
  $('btn-garage-scan').addEventListener('click', startNFCScan);
  $('btn-garage-pick').addEventListener('click', () => showScreen('car-select'));
  $('btn-export').addEventListener('click', exportData);
  $('btn-import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', importData);

  // Garage toy controls
  $('btn-garage-engine').addEventListener('click', () => {
    const viewer = $('garage-car');
    if (!viewer) return;
    garageEngineOn = !garageEngineOn;
    if (garageEngineOn) viewer.startEngine(); else viewer.stopEngine();
    $('btn-garage-engine').classList.toggle('active', garageEngineOn);
  });

  $('btn-garage-lights').addEventListener('click', () => {
    const viewer = $('garage-car');
    if (!viewer) return;
    garageLightsOn = !garageLightsOn;
    viewer.toggleLights(garageLightsOn);
    $('btn-garage-lights').classList.toggle('active', garageLightsOn);
  });

  $('btn-garage-horn').addEventListener('click', () => {
    playSound(carSounds.horn);
  });

  // NFC modal
  $('btn-nfc-close').addEventListener('click', () => {
    $('nfc-modal').classList.remove('visible');
    nfcService.stopScan();
  });

  // Resize nav dot
  window.addEventListener('resize', updateNavDot);
}

// ── Welcome car ───────────────────────────────

async function loadWelcomeCar() {
  try {
    const res = await fetch(CAR_CONFIGS[0].configUrl);
    const config = await res.json();
    const viewer = $('welcome-car');
    if (viewer) viewer.loadCar(config);
  } catch (err) {
    console.warn('Could not load welcome car:', err);
  }
}

// ── NFC scanning ──────────────────────────────

async function startNFCScan() {
  if (!nfcService.isSupported) {
    showToast('NFC not supported on this device');
    return;
  }

  const modal = $('nfc-modal');
  $('nfc-modal-title').textContent = 'Scanning…';
  $('nfc-modal-text').textContent = 'Hold your phone near the NFC tag on your wooden car.';
  $('btn-nfc-close').textContent = 'Cancel';
  modal.classList.add('visible');

  try {
    const result = await nfcService.startScan();
    modal.classList.remove('visible');

    // Same contract as a tap outside the app: .../vrooom/?car=<id>
    const car = result.url && carFromUrl(result.url);
    if (car) await loadCarFromConfig(car.configUrl);
    else showToast('Unrecognized NFC tag');
  } catch (err) {
    modal.classList.remove('visible');
    if (!err.message.includes('timeout')) {
      showToast(err.message);
    }
  }
}

async function loadCarFromConfig(configUrl) {
  try {
    const res = await fetch(configUrl);
    const config = await res.json();
    pendingCarConfig = config;

    // Extract sounds for map interactions
    const parts = config.parts || [];
    const findSound = name => parts.find(p => p.name.toLowerCase() === name)?.soundUrl;
    carSounds.horn = findSound('roof') || config.defaultClickSound;
    carSounds.engine = findSound('body') || config.defaultClickSound;

    // Save car to DB
    const car = await db.addCar(config.carName || 'My Car', configUrl);
    selectedCar = car;

    // Show onboard screen
    $('onboard-car-name').textContent = config.carName || 'Your Car';
    $('btn-create-profile').textContent = profile ? 'Back to Garage' : 'Create Your Profile';
    showScreen('car-onboard');

    const viewer = $('onboard-car');
    if (viewer) {
      await viewer.loadCar(config);
      carSideViewUrl = await viewer.toSideView();
      carSideProfiles = viewer.toSideProfiles(64) || carSideProfiles;
      applySliderThumb();
    }

    // Persist car image and sounds for next launch
    await db.setSetting('carSideViewUrl', carSideViewUrl);
    await db.setSetting('carSideProfiles', carSideProfiles);
    await db.setSetting('carSounds', carSounds);
  } catch (err) {
    showToast('Failed to load car config');
  }
}

// ── Car selection (manual) ────────────────────

function setupCarGrid() {
  const grid = $('car-grid');
  grid.innerHTML = CAR_CONFIGS.map(car => `
    <div class="car-option" data-car-id="${car.id}" data-config-url="${car.configUrl}">
      <div style="font-size:40px;margin-bottom:4px;">🚗</div>
      <div class="car-option-name">${car.name}</div>
    </div>
  `).join('');

  grid.addEventListener('click', e => {
    const opt = e.target.closest('.car-option');
    if (!opt) return;

    grid.querySelectorAll('.car-option').forEach(o => o.classList.remove('selected'));
    opt.classList.add('selected');
    $('btn-confirm-car').disabled = false;
  });
}

async function confirmCarSelection() {
  const selected = document.querySelector('.car-option.selected');
  if (!selected) return;

  const configUrl = selected.dataset.configUrl;
  await loadCarFromConfig(configUrl);
}

// ── Avatar grid ───────────────────────────────

function setupAvatarGrid() {
  const grid = $('avatar-grid');
  grid.innerHTML = AVATARS.map(a => `
    <div class="avatar-option" data-avatar="${a}">${a}</div>
  `).join('');

  grid.addEventListener('click', e => {
    const opt = e.target.closest('.avatar-option');
    if (!opt) return;

    grid.querySelectorAll('.avatar-option').forEach(o => o.classList.remove('selected'));
    opt.classList.add('selected');
    selectedAvatar = opt.dataset.avatar;
    validateProfile();
  });
}

function validateProfile() {
  const name = $('profile-name').value.trim();
  $('btn-save-profile').disabled = !name || !selectedAvatar;
}

async function saveProfile() {
  const name = $('profile-name').value.trim();
  if (!name || !selectedAvatar) return;

  profile = await db.createProfile(name, selectedAvatar);

  // If no car yet, add default
  if (!selectedCar) {
    const car = await db.addCar('Classic Vroom', CAR_CONFIGS[0].configUrl);
    selectedCar = car;
  }

  showScreen('garage-screen'); // also loads the garage car
  showToast(`Welcome, ${name}!`);
}

// ── Map screen ────────────────────────────────

async function initMapScreen() {
  if (map) return;

  map = initMap('map');
  setPlaceSource(() => placesInView(map));

  // Try to locate user
  await relocate();
}

async function relocate() {
  const barDot = $('bar-dot');
  const barCount = $('bar-count');

  barDot.className = 'bar-dot searching';
  barCount.textContent = 'Locating…';

  try {
    userCoords = await locate();
    map.setView([userCoords.lat, userCoords.lon], 15);
    placeUser(map, userCoords.lat, userCoords.lon, carSideViewUrl, () => playSound(carSounds.horn));

    barCount.textContent = 'Searching playgrounds…';
    await searchPlaygrounds();
  } catch (err) {
    barDot.className = 'bar-dot';
    barCount.textContent = 'Location unavailable';
    showToast('Could not get your location');

    // Try cached data
    try {
      const cached = await getCachedNearby(48.137, 11.575, searchRadius);
      if (cached.length > 0) {
        playgrounds = cached;
        displayResults();
      }
    } catch { /* ignore */ }
  }
}

async function searchPlaygrounds() {
  const barDot = $('bar-dot');
  const barCount = $('bar-count');

  try {
    // Show cached results first
    const cached = await getCachedNearby(userCoords.lat, userCoords.lon, searchRadius);
    if (cached.length > 0) {
      playgrounds = cached;
      displayResults();
    }

    // Then fetch fresh
    const fresh = await fetchNearby(userCoords.lat, userCoords.lon, searchRadius);
    playgrounds = fresh;
    displayResults();
  } catch (err) {
    barDot.className = 'bar-dot';
    if (playgrounds.length === 0) {
      barCount.textContent = 'No playgrounds found';
    }
    console.warn('Playground search error:', err);
  }
}

function displayResults() {
  const barDot = $('bar-dot');
  const barCount = $('bar-count');

  const count = displayPlaygrounds(map, playgrounds, userCoords.lat, userCoords.lon, onPlaygroundSelect);

  barDot.className = 'bar-dot active';
  barCount.textContent = `${count} playground${count !== 1 ? 's' : ''} nearby`;
}

function onPlaygroundSelect(playground) {
  // A route drawn to the previous place (or still loading) no longer applies.
  hideRoute();
  selectedPlayground = playground;
  $('radius-popover').classList.remove('visible');

  $('detail-name').textContent = playground.name || 'Unnamed Playground';

  // Build meta info
  const meta = [];
  if (playground.surface) meta.push(`Surface: ${playground.surface}`);
  if (playground.min_age || playground.max_age) {
    const age = [playground.min_age, playground.max_age].filter(Boolean).join('–');
    meta.push(`Ages: ${age}`);
  }
  if (playground.operator) meta.push(`By: ${playground.operator}`);
  $('detail-meta').textContent = meta.join(' · ');

  $('detail-dist').textContent = formatDistance(playground.distance);

  // Check-in always enabled — the service does its own GPS + proximity check
  $('btn-checkin').disabled = false;
  $('btn-checkin').textContent = "I'm here!";

  $('detail-panel').classList.add('visible');
}

function closeDetail() {
  $('detail-panel').classList.remove('visible');
  hideRoute();
  selectedPlayground = null;
}

async function doCheckIn() {
  if (!profile) return;

  // Disable both check-in buttons during the process
  const btns = [$('btn-checkin'), $('btn-imhere')].filter(Boolean);
  btns.forEach(b => { b.disabled = true; b.dataset.prevText = b.textContent; b.textContent = 'Locating…'; });

  try {
    // The places are read from the tiles the map has loaded, so the map must
    // be where the child is — not where it was left when the map first opened.
    const coords = await freshGPS();
    userCoords = coords;
    if (map) {
      map.setView([coords.lat, coords.lon], 15);
      placeUser(map, coords.lat, coords.lon, carSideViewUrl, () => playSound(carSounds.horn));
    }

    const carId = selectedCar?.id || null;
    const result = await checkIn(profile.id, carId, coords);

    // Close detail panel if open
    closeDetail();

    const placeName = result.place.name || result.place.type;
    const dist = Math.round(result.place.distance);

    if (result.newBadges.length > 0) {
      const names = result.newBadges.map(b => b.title).join(', ');
      showToast(`Checked in at ${placeName} (${dist}m away) — Badge earned: ${names}`);
    } else {
      showToast(`Checked in at ${placeName} (${dist}m away)!`);
    }
  } catch (err) {
    showToast(err.message);
  } finally {
    btns.forEach(b => { b.disabled = false; b.textContent = b.dataset.prevText || "I'm here!"; });
  }

  // The map moved: show the playgrounds around the new position.
  if (map && userCoords) searchPlaygrounds();
}

function toggleRadiusPopover() {
  $('radius-popover').classList.toggle('visible');
}

function onRadiusChange(e) {
  searchRadius = parseInt(e.target.value);
  const label = searchRadius >= 1000
    ? `${(searchRadius / 1000).toFixed(1)} km`
    : `${searchRadius} m`;

  $('radius-value').textContent = label;
  $('bar-radius-label').textContent = label;

  if (userCoords) searchPlaygrounds();
}

// One handler for the route button, toggling on state. The button used to
// carry a permanent doRoute listener plus an onclick added for "Clear route",
// so clearing fired both: the route was cleared and immediately recomputed.
let routeShown = false;
let routeRequest = 0; // bumped to discard a route that arrives after it stopped mattering
let routeSound = null; // the engine that starts with a route stops with it

function onRouteButton() {
  if (routeShown) hideRoute();
  else doRoute();
}

function hideRoute() {
  routeRequest++;
  routeShown = false;
  stopSound(routeSound);
  routeSound = null;
  if (map) clearRoute(map);
  $('detail-walk').textContent = '';
  const btn = $('btn-route');
  btn.textContent = 'Walk there';
  btn.disabled = false;
}

async function doRoute() {
  if (!selectedPlayground || !userCoords || !map) return;

  const request = ++routeRequest;
  const isCurrent = () => request === routeRequest;

  const btn = $('btn-route');
  btn.disabled = true;
  btn.textContent = 'Loading…';
  stopSound(routeSound);
  routeSound = playSound(carSounds.engine);

  try {
    const result = await showRoute(
      map,
      [userCoords.lat, userCoords.lon],
      [selectedPlayground.lat, selectedPlayground.lon],
      isCurrent
    );
    if (!isCurrent()) return;

    if (result) {
      routeShown = true;
      $('detail-walk').textContent = `${result.duration} min walk · ${formatDistance(result.distance)}`;
      btn.textContent = 'Clear route';
    } else {
      showToast('Could not find a walking route');
      btn.textContent = 'Walk there';
    }
  } catch (err) {
    if (!isCurrent()) return;
    showToast('Route failed — try again');
    btn.textContent = 'Walk there';
  }
  btn.disabled = false;
}

// ── Badge screen ──────────────────────────────

async function renderBadges() {
  if (!profile) return;

  const collection = await getBadgeCollection(profile.id);
  $('badge-stats').textContent = `${collection.totalEarned} badge${collection.totalEarned !== 1 ? 's' : ''} earned · ${collection.uniquePlaygrounds} playground${collection.uniquePlaygrounds !== 1 ? 's' : ''} visited`;

  const grid = $('badge-grid');
  let html = '';

  // Milestone badges first
  for (const m of collection.milestones) {
    const svg = milestoneBadgeSVG(m.title, m.threshold);
    html += `<div class="badge-item ${m.earned ? '' : 'locked'}">${svg}<span class="badge-item-name">${m.title}</span></div>`;
  }

  // Regular visitor badges
  for (const r of collection.regulars) {
    const svg = regularBadgeSVG(r.title);
    html += `<div class="badge-item">${svg}<span class="badge-item-name">${r.title}</span></div>`;
  }

  // Playground badges
  for (const p of collection.playgrounds) {
    const svg = playgroundBadgeSVG(p.title);
    html += `<div class="badge-item">${svg}<span class="badge-item-name">${p.title}</span></div>`;
  }

  if (html === '') {
    html = '<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:40px 0;">Visit playgrounds to earn badges!</div>';
  }

  grid.innerHTML = html;
}

// ── Connect to Print ─────────────────────────

$('btn-connect-print').addEventListener('click', openPrintModal);
$('btn-scanner-close').addEventListener('click', closePrintModal);
$('btn-start-scan').addEventListener('click', startScan);
$('btn-scanner-back').addEventListener('click', backToIntro);

let scannerLoaded = false; // lazy-loaded

function openPrintModal() {
  $('scanner-step-intro').hidden = false;
  $('scanner-step-scan').hidden = true;
  $('scanner-modal').classList.add('visible');
}

function closePrintModal() {
  const scanner = $('qr-scanner');
  if (scanner.stop) scanner.stop();
  $('scanner-modal').classList.remove('visible');
}

function backToIntro() {
  const scanner = $('qr-scanner');
  if (scanner.stop) scanner.stop();
  $('scanner-step-scan').hidden = true;
  $('scanner-step-intro').hidden = false;
}

async function startScan() {
  const status = $('scanner-status');
  status.textContent = '';
  status.className = 'scanner-status';

  if (!scannerLoaded) {
    try {
      await import('./lib/qr-scanner.js');
      scannerLoaded = true;
    } catch (err) {
      status.textContent = 'Could not open the scanner';
      status.className = 'scanner-status error';
      return;
    }
  }

  $('scanner-step-intro').hidden = true;
  $('scanner-step-scan').hidden = false;

  const scanner = $('qr-scanner');
  scanner.addEventListener('scan-success', onScanSuccess, { once: true });
  scanner.addEventListener('scan-error', onScanError, { once: true });
  scanner.start();
}

/**
 * Turn a scanned connect URL into the relay endpoint.
 *
 * The endpoint is resolved against the origin that served the QR code, so the
 * same app works against the demo host and a self-hosted one with no config.
 */
function endpointFrom(scannedData) {
  const scanned = new URL(scannedData);
  const id = (scanned.searchParams.get('s') || '').toUpperCase();
  if (!SESSION_ID_RE.test(id)) throw new Error('no session id');
  return new URL(`${SYNC_PATH}?id=${id}`, scanned.origin).href;
}

async function onScanSuccess(e) {
  const status = $('scanner-status');

  let endpoint;
  try {
    endpoint = endpointFrom(e.detail.data);
  } catch {
    status.textContent = 'Invalid QR code — not a Vrooom connect code';
    status.className = 'scanner-status error';
    return;
  }

  status.textContent = 'Sending badges\u2026';
  status.className = 'scanner-status sending';

  try {
    const payload = await buildPrintPayload(profile, selectedCar);

    const res = await fetch(endpoint, {
      method: 'POST',
      // text/plain keeps this a simple request, so there is no CORS preflight
      // to fail — one round trip, one thing that can go wrong.
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    status.textContent = 'Badges sent! You can print from the computer now.';
    status.className = 'scanner-status done';
    setTimeout(() => closePrintModal(), 2500);
  } catch (err) {
    status.textContent = navigator.onLine
      ? 'Could not reach Vrooom \u2014 tap back and try again'
      : 'You appear to be offline \u2014 reconnect and try again';
    status.className = 'scanner-status error';
  }
}

function onScanError(e) {
  const status = $('scanner-status');
  status.textContent = e.detail.error;
  status.className = 'scanner-status error';
}

// ── Garage screen ─────────────────────────────

async function updateGarageScreen() {
  // Reset toy controls
  garageEngineOn = false;
  garageLightsOn = false;
  $('btn-garage-engine').classList.remove('active');
  $('btn-garage-lights').classList.remove('active');

  if (profile) {
    $('garage-avatar').textContent = profile.avatar;
    $('garage-name').textContent = profile.name;
  }
  if (selectedCar) {
    $('garage-car-name').textContent = selectedCar.name || 'Car selected';
    // Load car model into garage viewer
    try {
      const res = await fetch(selectedCar.config);
      const config = await res.json();
      const viewer = $('garage-car');
      if (viewer) viewer.loadCar(config);
    } catch (err) {
      console.warn('Could not load garage car:', err);
    }
  }
}

async function exportData() {
  try {
    const data = await db.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vrooom-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Data exported!');
  } catch (err) {
    showToast('Export failed');
  }
}

async function importData(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.profiles || !data.cars) {
      showToast('Invalid backup file');
      return;
    }

    await db.importAll(data);
    showToast('Data restored!');

    await restoreState();
    if (profile && selectedCar) {
      showScreen('garage-screen');
    } else {
      showScreen('welcome');
      loadWelcomeCar();
    }
  } catch (err) {
    showToast('Import failed');
  } finally {
    e.target.value = '';
  }
}

// ── Toast ─────────────────────────────────────

let toastTimer = null;

function showToast(message, icon = '') {
  const toast = $('toast');
  $('toast-icon').textContent = icon;
  $('toast-text').textContent = message;
  toast.classList.add('visible');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3000);
}

// ── Boot ──────────────────────────────────────

init().catch(err => console.error('App init failed:', err));
