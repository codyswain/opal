import type { RecentItem } from '@/types/activity';

/** Recent reaches this many days back, counted from the start of today. */
export const RECENT_DAYS = 30;

export type RecentGroupLabel = 'Today' | 'Yesterday' | 'Previous 7 days' | 'Earlier';

export interface RecentGroup {
  label: RecentGroupLabel;
  items: RecentItem[];
}

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Whole local calendar days between two times; daylight saving shifts do not count. */
function daysBetween(then: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
}

/** The oldest time Recent asks for: local midnight, RECENT_DAYS days ago. */
export function recentSince(now: number): number {
  const date = new Date(startOfDay(now));
  date.setDate(date.getDate() - RECENT_DAYS);
  return date.getTime();
}

function groupOf(touchedAt: number, now: number): RecentGroupLabel {
  const days = daysBetween(touchedAt, now);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days <= 7) return 'Previous 7 days';
  return 'Earlier';
}

const GROUP_ORDER: readonly RecentGroupLabel[] = ['Today', 'Yesterday', 'Previous 7 days', 'Earlier'];

/** Splits items into day groups, as Finder and Safari history do. Items keep their order. */
export function groupRecent(items: readonly RecentItem[], now: number): RecentGroup[] {
  const since = recentSince(now);
  const groups = GROUP_ORDER.map((label): RecentGroup => ({ label, items: [] }));
  for (const item of items) {
    if (item.touchedAt < since) continue;
    groups[GROUP_ORDER.indexOf(groupOf(item.touchedAt, now))].items.push(item);
  }
  return groups.filter((group) => group.items.length > 0);
}

/** "2:14 PM" within the last two days, "Monday" this week, "Oct 8" before that. */
export function recentTime(touchedAt: number, now: number): string {
  const date = new Date(touchedAt);
  const days = daysBetween(touchedAt, now);
  if (days <= 1) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days <= 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
