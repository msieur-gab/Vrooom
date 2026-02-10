/**
 * Badge service — definitions, unlock logic, milestones.
 */

import * as db from './database.js';

// ── Milestone definitions ─────────────────────

export const MILESTONES = [
  { type: 'milestone_1',  threshold: 1,  title: 'First Adventure',   description: 'Visit your first playground!' },
  { type: 'milestone_5',  threshold: 5,  title: 'Explorer',          description: 'Visit 5 different playgrounds' },
  { type: 'milestone_10', threshold: 10, title: 'Adventurer',        description: 'Visit 10 different playgrounds' },
  { type: 'milestone_25', threshold: 25, title: 'World Traveler',    description: 'Visit 25 different playgrounds' },
  { type: 'milestone_50', threshold: 50, title: 'Playground Legend',  description: 'Visit 50 different playgrounds' }
];

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

  // 2. Milestone badges
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
    milestones: milestoneBadges,
    totalEarned: playgroundBadges.length + milestoneBadges.filter(m => m.earned).length,
    uniquePlaygrounds: playgroundBadges.length
  };
}

// ── SVG badge generators ──────────────────────

export function playgroundBadgeSVG(name = 'Playground') {
  const displayName = name.length > 20 ? name.substring(0, 18) + '…' : name;
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#2a2520" stroke-width="1.5">
    <circle cx="60" cy="60" r="56" stroke-width="2"/>
    <circle cx="60" cy="60" r="50" stroke-dasharray="4 3"/>
    <!-- Swing set -->
    <line x1="35" y1="35" x2="35" y2="75"/>
    <line x1="85" y1="35" x2="85" y2="75"/>
    <line x1="30" y1="35" x2="90" y2="35"/>
    <line x1="45" y1="35" x2="42" y2="60"/>
    <line x1="75" y1="35" x2="72" y2="60"/>
    <rect x="38" y="60" width="8" height="3" rx="1"/>
    <rect x="68" y="60" width="8" height="3" rx="1"/>
    <!-- Star -->
    <polygon points="60,20 62,26 68,26 63,30 65,36 60,32 55,36 57,30 52,26 58,26" stroke-width="1"/>
    <text x="60" y="95" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="8" font-weight="500" stroke="none" fill="#2a2520">${displayName}</text>
  </svg>`;
}

export function milestoneBadgeSVG(title = 'Milestone', threshold = 0) {
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#2a2520" stroke-width="1.5">
    <!-- Shield shape -->
    <path d="M60 10 L100 30 L100 65 Q100 95 60 110 Q20 95 20 65 L20 30 Z" stroke-width="2"/>
    <path d="M60 18 L94 35 L94 63 Q94 89 60 103 Q26 89 26 63 L26 35 Z" stroke-dasharray="4 3"/>
    <!-- Number -->
    <text x="60" y="62" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="24" font-weight="700" stroke="none" fill="#2a2520">${threshold}</text>
    <!-- Star crown -->
    <polygon points="60,22 63,28 70,28 65,32 67,38 60,34 53,38 55,32 50,28 57,28" stroke-width="1"/>
    <text x="60" y="88" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="7" font-weight="500" stroke="none" fill="#2a2520">${title}</text>
  </svg>`;
}
