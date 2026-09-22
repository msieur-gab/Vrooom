/**
 * Milestone definitions — pure data, zero dependencies.
 *
 * Lives apart from badge.js so the website can import it: badge.js pulls in
 * database.js, which needs the Dexie global that the site never loads.
 */

export const MILESTONES = [
  { type: 'milestone_1',  threshold: 1,  title: 'First Adventure',  description: 'Visit your first playground!' },
  { type: 'milestone_5',  threshold: 5,  title: 'Explorer',         description: 'Visit 5 different playgrounds' },
  { type: 'milestone_10', threshold: 10, title: 'Adventurer',       description: 'Visit 10 different playgrounds' },
  { type: 'milestone_25', threshold: 25, title: 'World Traveler',   description: 'Visit 25 different playgrounds' },
  { type: 'milestone_50', threshold: 50, title: 'Playground Legend', description: 'Visit 50 different playgrounds' }
];

export function milestoneByThreshold(threshold) {
  return MILESTONES.find(m => m.threshold === threshold) || null;
}
