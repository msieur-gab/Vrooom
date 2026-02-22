/**
 * Badge service — definitions, unlock logic, milestones.
 */

import * as db from './database.js';
export { playgroundBadgeSVG, regularBadgeSVG, milestoneBadgeSVG } from './badge-svg.js';

// ── Milestone definitions ─────────────────────

export const MILESTONES = [
  { type: 'milestone_1',  threshold: 1,  title: 'First Adventure',   description: 'Visit your first playground!' },
  { type: 'milestone_5',  threshold: 5,  title: 'Explorer',          description: 'Visit 5 different playgrounds' },
  { type: 'milestone_10', threshold: 10, title: 'Adventurer',        description: 'Visit 10 different playgrounds' },
  { type: 'milestone_25', threshold: 25, title: 'World Traveler',    description: 'Visit 25 different playgrounds' },
  { type: 'milestone_50', threshold: 50, title: 'Playground Legend',  description: 'Visit 50 different playgrounds' }
];

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

