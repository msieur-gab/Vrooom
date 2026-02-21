/**
 * Database service — Dexie.js wrapper for Vrooom.
 */

/* global Dexie */

const db = new Dexie('vrooom');

db.version(1).stores({
  profiles:         '++id, name, avatar, created',
  cars:             '++id, name, config, selected, created',
  check_ins:        '++id, profileId, carId, playgroundId, playgroundName, coords, timestamp',
  badges:           '++id, profileId, type, playgroundId, unlocked, timestamp',
  playground_cache: 'id, lat, lon, tags, fetchedAt',
  settings:         'key, value'
});

// ── Profiles ──────────────────────────────────

export async function getProfile() {
  return db.profiles.toCollection().first();
}

export async function createProfile(name, avatar) {
  const id = await db.profiles.add({ name, avatar, created: Date.now() });
  return db.profiles.get(id);
}

export async function updateProfile(id, updates) {
  await db.profiles.update(id, updates);
  return db.profiles.get(id);
}

// ── Cars ──────────────────────────────────────

export async function getSelectedCar() {
  return db.cars.where('selected').equals(1).first();
}

export async function getAllCars() {
  return db.cars.toArray();
}

export async function addCar(name, config) {
  // Deselect all first
  await db.cars.toCollection().modify({ selected: 0 });
  const id = await db.cars.add({ name, config, selected: 1, created: Date.now() });
  return db.cars.get(id);
}

export async function selectCar(id) {
  await db.cars.toCollection().modify({ selected: 0 });
  await db.cars.update(id, { selected: 1 });
  return db.cars.get(id);
}

// ── Check-ins ─────────────────────────────────

export async function addCheckIn(profileId, carId, playgroundId, playgroundName, coords) {
  const id = await db.check_ins.add({
    profileId, carId, playgroundId, playgroundName, coords,
    timestamp: Date.now()
  });
  return db.check_ins.get(id);
}

export async function getCheckIns(profileId) {
  return db.check_ins.where('profileId').equals(profileId).reverse().sortBy('timestamp');
}

export async function getCheckInCount(profileId) {
  return db.check_ins.where('profileId').equals(profileId).count();
}

export async function getUniquePlaygrounds(profileId) {
  const checkIns = await db.check_ins.where('profileId').equals(profileId).toArray();
  const unique = new Set(checkIns.map(c => c.playgroundId));
  return unique.size;
}

export async function getVisitCount(profileId, playgroundId) {
  return db.check_ins.where('profileId').equals(profileId)
    .filter(c => c.playgroundId === playgroundId)
    .count();
}

export async function hasCheckedIn(profileId, playgroundId) {
  const count = await db.check_ins
    .where('[profileId+playgroundId]')
    .equals([profileId, playgroundId])
    .count()
    .catch(() => {
      // Fallback if compound index doesn't exist
      return db.check_ins.where('profileId').equals(profileId).filter(c => c.playgroundId === playgroundId).count();
    });
  return count > 0;
}

// ── Badges ────────────────────────────────────

export async function addBadge(profileId, type, playgroundId = null) {
  const id = await db.badges.add({
    profileId, type, playgroundId,
    unlocked: Date.now(),
    timestamp: Date.now()
  });
  return db.badges.get(id);
}

export async function getBadges(profileId) {
  return db.badges.where('profileId').equals(profileId).toArray();
}

export async function hasBadge(profileId, type, playgroundId = null) {
  let query = db.badges.where('profileId').equals(profileId).filter(b => b.type === type);
  if (playgroundId) query = query.filter(b => b.playgroundId === playgroundId);
  return (await query.count()) > 0;
}

// ── Settings ──────────────────────────────────

export async function getSetting(key) {
  const row = await db.settings.get(key);
  return row?.value;
}

export async function setSetting(key, value) {
  await db.settings.put({ key, value });
}

// ── Export ─────────────────────────────────────

export async function exportAll() {
  return {
    profiles: await db.profiles.toArray(),
    cars: await db.cars.toArray(),
    check_ins: await db.check_ins.toArray(),
    badges: await db.badges.toArray(),
    settings: await db.settings.toArray()
  };
}

export { db };
