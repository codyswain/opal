import { describe, expect, it } from 'vitest';
import { activityReason, formatRelativeTime } from '@/common/relativeTime';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatRelativeTime', () => {
  const now = Date.UTC(2026, 8, 6, 12, 0, 0);

  it('rounds to friendly units', () => {
    expect(formatRelativeTime(now - 10_000, now)).toBe('just now');
    expect(formatRelativeTime(now - 1 * MIN, now)).toBe('1 minute ago');
    expect(formatRelativeTime(now - 10 * MIN, now)).toBe('10 minutes ago');
    expect(formatRelativeTime(now - 3 * HOUR, now)).toBe('3 hours ago');
    expect(formatRelativeTime(now - 26 * HOUR, now)).toBe('yesterday');
    expect(formatRelativeTime(now - 5 * DAY, now)).toBe('5 days ago');
    expect(formatRelativeTime(now + MIN, now)).toBe('just now');
  });

  it('falls back to a local date beyond two weeks', () => {
    expect(formatRelativeTime(now - 30 * DAY, now)).toMatch(/\d/);
    expect(formatRelativeTime(now - 30 * DAY, now)).not.toMatch(/ago/);
  });

  it('prefixes the activity kind', () => {
    expect(activityReason('opened', now - 10 * MIN, now)).toBe('Opened 10 minutes ago');
    expect(activityReason('organized', now - 26 * HOUR, now)).toBe('Organized yesterday');
    expect(activityReason('edited', now, now)).toBe('Edited just now');
  });
});
