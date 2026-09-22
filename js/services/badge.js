/**
 * Badge service — definitions, unlock logic, milestones.
 */

import * as db from './database.js';
import { MILESTONES } from './milestones.js';

export { playgroundBadgeSVG, regularBadgeSVG, milestoneBadgeSVG } from './badge-svg.js';
export { MILESTONES };

// ── Regular visitor threshold ─────────────────
const REGULAR_VISIT_COUNT = 10;

// ── Badge check after each check-in ──────────

export async function checkAndAwardBadges(profileId, playground) {
  const newBadges = [];

  // 1. Per-playground badge
  const hasPlaygroundBadge = await db.hasBadge(profileId, 'playground', playground.id);
  if (!hasPlaygroundBadge) {
    const badge = await db.addBadge(profileId, 'playground', playground.id);
    newBadges.push({
      ...badge,
      title: playground.name || 'Playground',
      description: `Visited ${playground.name || 'a playground'}!`
    });
  }

  // 2. Regular visitor badge — 10+ visits to the same place
  const visitCount = await db.getVisitCount(profileId, playground.id);
  if (visitCount >= REGULAR_VISIT_COUNT) {
    const hasRegular = await db.hasBadge(profileId, 'regular', playground.id);
    if (!hasRegular) {
      const badge = await db.addBadge(profileId, 'regular', playground.id);
      newBadges.push({
        ...badge,
        title: `${playground.name || 'Place'} Regular`,
        description: `Visited ${playground.name || 'this place'} ${REGULAR_VISIT_COUNT} times!`
      });
    }
  }

  // 3. Milestone badges
  const uniqueCount = await db.getUniquePlaygrounds(profileId);

  for (const milestone of MILESTONES) {
    if (uniqueCount >= milestone.threshold) {
      const hasMilestone = await db.hasBadge(profileId, milestone.type);
      if (!hasMilestone) {
        const badge = await db.addBadge(profileId, milestone.type);
        newBadges.push({
          ...badge,
          title: milestone.title,
          description: milestone.description
        });
      }
    }
  }

  return newBadges;
}

// ── Get all badge data for display ────────────

export async function getBadgeCollection(profileId) {
  const badges = await db.getBadges(profileId);
  const checkIns = await db.getCheckIns(profileId);

  // Map playground badges with names
  const playgroundBadges = badges
    .filter(b => b.type === 'playground')
    .map(b => {
      const checkIn = checkIns.find(c => c.playgroundId === b.playgroundId);
      return {
        ...b,
        title: checkIn?.playgroundName || 'Playground',
        icon: 'playground'
      };
    });

  // Map regular visitor badges
  const regularBadges = badges
    .filter(b => b.type === 'regular')
    .map(b => {
      const checkIn = checkIns.find(c => c.playgroundId === b.playgroundId);
      return {
        ...b,
        title: `${checkIn?.playgroundName || 'Place'} Regular`,
        icon: 'regular'
      };
    });

  // Map milestone badges
  const milestoneBadges = MILESTONES.map(m => {
    const earned = badges.find(b => b.type === m.type);
    return {
      type: m.type,
      title: m.title,
      description: m.description,
      threshold: m.threshold,
      icon: 'milestone',
      unlocked: earned?.unlocked || null,
      earned: !!earned
    };
  });

  return {
    playgrounds: playgroundBadges,
    regulars: regularBadges,
    milestones: milestoneBadges,
    totalEarned: playgroundBadges.length + regularBadges.length + milestoneBadges.filter(m => m.earned).length,
    uniquePlaygrounds: playgroundBadges.length
  };
}


// ── Print payload ─────────────────────────────

/**
 * Build what the phone hands to the computer for printing.
 *
 * Place names are deliberately absent: a named child plus the list of
 * playgrounds they visit is a location profile, so only counts travel. The
 * computer knows how many badges to lay out, never where they were earned.
 *
 * Badge captions are pending the naming strategy — see BADGE-NAMING-TODO.md.
 */
export async function buildPrintPayload(profile, car) {
  const collection = await getBadgeCollection(profile.id);

  return {
    v: 1,
    user: profile.name,
    car: car?.name || null,
    badges: {
      playgrounds: collection.playgrounds.length,
      regulars: collection.regulars.length,
      milestones: collection.milestones.filter(m => m.earned).map(m => m.threshold)
    }
  };
}
