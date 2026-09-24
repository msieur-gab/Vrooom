/**
 * Playground cache — IndexedDB store for offline/instant access.
 * Adapted from Drop's water-cache.js.
 */

import { haversine } from '../utils/distance.js';

const DB_NAME = 'vrooom-playground-cache';
const DB_VERSION = 1;
const STORE = 'playgrounds';
const MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

let dbPromise;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function cachePoints(points) {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const now = Date.now();
  for (const pt of points) {
    store.put({
      id: pt.id,
      lat: pt.lat,
      lon: pt.lon,
      name: pt.name,
      surface: pt.surface,
      min_age: pt.min_age,
      max_age: pt.max_age,
      access: pt.access,
      operator: pt.operator,
      tags: pt.tags || {},
      fetchedAt: now
    });
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedNearby(lat, lon, radius) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const results = req.result.filter(pt =>
        haversine(lat, lon, pt.lat, pt.lon) <= radius
      );
      resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function pruneStale(freshIds) {
  const db = await openDB();
  const cutoff = Date.now() - MAX_AGE;
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const req = store.openCursor();
  req.onsuccess = () => {
    const cursor = req.result;
    if (!cursor) return;
    if (cursor.value.fetchedAt < cutoff && !freshIds.has(cursor.value.id)) {
      cursor.delete();
    }
    cursor.continue();
  };
}
