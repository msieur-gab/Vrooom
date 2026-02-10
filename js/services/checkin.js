/**
 * Check-in service — manual playground check-in with proximity validation.
 */

import { haversine } from '../utils/distance.js';
import * as db from './database.js';
import { checkAndAwardBadges } from './badge.js';

const MAX_CHECKIN_DISTANCE = 200; // meters — generous for GPS accuracy

export async function checkIn(profileId, carId, playground, userCoords) {
  // Proximity validation
  const dist = haversine(userCoords.lat, userCoords.lon, playground.lat, playground.lon);
  if (dist > MAX_CHECKIN_DISTANCE) {
    throw new Error(`Too far from playground (${Math.round(dist)}m). Get within ${MAX_CHECKIN_DISTANCE}m to check in.`);
  }

  // Save check-in
  const checkIn = await db.addCheckIn(
    profileId,
    carId,
    playground.id,
    playground.name || 'Unknown Playground',
    { lat: userCoords.lat, lon: userCoords.lon }
  );

  // Check for new badges
  const newBadges = await checkAndAwardBadges(profileId, playground);

  return { checkIn, newBadges };
}

export { MAX_CHECKIN_DISTANCE };
