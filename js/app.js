/**
 * Vrooom — App Controller
 * Screen navigation, onboarding flow, map integration, badge display.
 */

import * as db from './services/database.js';
import { nfcService } from './services/nfc.js';
import { locate } from './utils/geo.js';
import { haversine } from './utils/distance.js';
import { fetchNearby, getCachedNearby } from './services/playground.js';
import { checkIn } from './services/checkin.js';
import { getBadgeCollection, playgroundBadgeSVG, milestoneBadgeSVG, MILESTONES } from './services/badge.js';
import { initMap, placeUser, displayPlaygrounds, formatDistance, showRoute, clearRoute } from './utils/map.js';

// ── Available car configs ─────────────────────

const CAR_CONFIGS = [
  { id: 'vroom', name: 'Classic Vroom', configUrl: './data/conf-vroom.json' },
  { id: 'dodge',  name: 'Classic Grree', configUrl: './data/conf-dodge.json' }
];

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

// ── DOM refs ──────────────────────────────────

const $ = id => document.getElementById(id);

// ── Init ──────────────────────────────────────

async function init() {
  profile = await db.getProfile();
  selectedCar = await db.getSelectedCar();

  setupAvatarGrid();
  setupCarGrid();
  setupEventListeners();

  if (profile && selectedCar) {
    showScreen('map-screen');
    $('bottom-nav').hidden = false;
    initMapScreen();
    updateSettingsScreen();
  } else {
    showScreen('welcome');
    loadWelcomeCar();
  }
}

// ── Screen navigation ─────────────────────────

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => {
    s.hidden = s.id !== screenId;
  });

  // Show/hide bottom nav
  const mainScreens = ['map-screen', 'badge-screen', 'settings-screen'];
  $('bottom-nav').hidden = !mainScreens.includes(screenId);

  // Update nav tabs
  if (mainScreens.includes(screenId)) {
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.screen === screenId);
    });
    updateNavDot();
  }

  // Trigger screen-specific init
  if (screenId === 'map-screen' && !map) initMapScreen();
  if (screenId === 'badge-screen') renderBadges();
  if (screenId === 'settings-screen') updateSettingsScreen();
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
  $('btn-create-profile').addEventListener('click', () => showScreen('profile-create'));

  // Profile
  $('btn-save-profile').addEventListener('click', saveProfile);
  $('profile-name').addEventListener('input', validateProfile);

  // Map
  $('btn-locate').addEventListener('click', relocate);
  $('detail-close').addEventListener('click', closeDetail);
  $('btn-checkin').addEventListener('click', doCheckIn);
  $('btn-route').addEventListener('click', doRoute);
  $('btn-radius').addEventListener('click', toggleRadiusPopover);
  $('radius-slider').addEventListener('input', onRadiusChange);

  // Bottom nav
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => showScreen(tab.dataset.screen));
  });

  // Settings
  $('btn-settings-scan').addEventListener('click', startNFCScan);
  $('btn-settings-pick').addEventListener('click', () => showScreen('car-select'));
  $('btn-export').addEventListener('click', exportData);

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

    if (result.carConfig) {
      // Load car from NFC config URL
      const configUrl = result.carConfig;
      await loadCarFromConfig(configUrl);
    } else if (result.url) {
      // Try parsing URL for config param
      try {
        const url = new URL(result.url);
        const cfg = url.searchParams.get('config');
        if (cfg) await loadCarFromConfig(cfg);
      } catch {
        showToast('Unrecognized NFC tag');
      }
    }
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

    // Save car to DB
    const car = await db.addCar(config.carName || 'My Car', configUrl);
    selectedCar = car;

    // Show onboard screen
    $('onboard-car-name').textContent = config.carName || 'Your Car';
    showScreen('car-onboard');

    const viewer = $('onboard-car');
    if (viewer) {
      await viewer.loadCar(config);
      // Capture side view for map marker
      carSideViewUrl = await viewer.toSideView();
    }
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

  showScreen('map-screen');
  $('bottom-nav').hidden = false;
  initMapScreen();
  updateSettingsScreen();
  showToast(`Welcome, ${name}!`);
}

// ── Map screen ────────────────────────────────

async function initMapScreen() {
  if (map) return;

  map = initMap('map');

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
    placeUser(map, userCoords.lat, userCoords.lon, carSideViewUrl);

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

  // Enable/disable check-in button based on proximity
  const btn = $('btn-checkin');
  if (playground.distance <= 200) {
    btn.disabled = false;
    btn.textContent = 'Check In!';
  } else {
    btn.disabled = true;
    btn.textContent = `Get closer (${formatDistance(playground.distance)})`;
  }

  $('detail-panel').classList.add('visible');
}

function closeDetail() {
  $('detail-panel').classList.remove('visible');
  $('detail-walk').textContent = '';
  if (map) clearRoute(map);
  selectedPlayground = null;

  // Reset route button
  const btn = $('btn-route');
  btn.textContent = 'Walk there';
  btn.disabled = false;
}

async function doCheckIn() {
  if (!selectedPlayground || !profile || !userCoords) return;

  const btn = $('btn-checkin');
  btn.disabled = true;
  btn.textContent = 'Checking in…';

  try {
    const carId = selectedCar?.id || null;
    const result = await checkIn(profile.id, carId, selectedPlayground, userCoords);

    closeDetail();

    if (result.newBadges.length > 0) {
      const names = result.newBadges.map(b => b.title).join(', ');
      showToast(`🏅 Badge earned: ${names}`);
    } else {
      showToast(`Checked in at ${selectedPlayground.name || 'playground'}!`);
    }
  } catch (err) {
    showToast(err.message);
    btn.disabled = false;
    btn.textContent = 'Check In!';
  }
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

async function doRoute() {
  if (!selectedPlayground || !userCoords || !map) return;

  const btn = $('btn-route');
  btn.disabled = true;
  btn.textContent = 'Loading…';

  try {
    const result = await showRoute(
      map,
      [userCoords.lat, userCoords.lon],
      [selectedPlayground.lat, selectedPlayground.lon]
    );

    if (result) {
      $('detail-walk').textContent = `${result.duration} min walk · ${formatDistance(result.distance)}`;
      btn.textContent = 'Clear route';
      btn.disabled = false;
      btn.onclick = () => {
        clearRoute(map);
        $('detail-walk').textContent = '';
        btn.textContent = 'Walk there';
        btn.onclick = null;
        $('btn-route').addEventListener('click', doRoute);
      };
    } else {
      showToast('Could not find a walking route');
      btn.textContent = 'Walk there';
      btn.disabled = false;
    }
  } catch (err) {
    showToast('Route failed — try again');
    btn.textContent = 'Walk there';
    btn.disabled = false;
  }
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

// ── Settings screen ───────────────────────────

function updateSettingsScreen() {
  if (profile) {
    $('settings-avatar').textContent = profile.avatar;
    $('settings-name').textContent = profile.name;
  }
  if (selectedCar) {
    $('settings-car-name').textContent = selectedCar.name || 'Car selected';
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
