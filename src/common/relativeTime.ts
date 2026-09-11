import type { ActivityKind } from '@/types/activity';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Coarse, stable phrasing; timestamps are UTC epoch ms and dates render locally. */
export function formatRelativeTime(then: number, now: number): string {
  const elapsed = now - then;
  if (elapsed < 45_000) return 'just now';
  if (elapsed < HOUR) {
    const minutes = Math.max(1, Math.round(elapsed / MINUTE));
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  if (elapsed < DAY) {
    const hours = Math.max(1, Math.round(elapsed / HOUR));
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  if (elapsed < 2 * DAY) return 'yesterday';
  if (elapsed < 14 * DAY) return `${Math.round(elapsed / DAY)} days ago`;
  return new Date(then).toLocaleDateString();
}

const LABEL: Record<ActivityKind, string> = {
  opened: 'Opened',
  organized: 'Organized',
  edited: 'Edited',
};

export function activityReason(kind: ActivityKind, at: number, now: number): string {
  return `${LABEL[kind]} ${formatRelativeTime(at, now)}`;
}
