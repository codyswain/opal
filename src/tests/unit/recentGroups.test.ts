import { describe, expect, it } from 'vitest';
import {
  groupRecent,
  recentSince,
  recentTime,
} from '@/renderer/features/disk-explorer/activity/recentGroups';
import { recentItem } from '@/tests/helpers/activityApi';

const NOW = new Date(2026, 9, 28, 0, 30).getTime();
const at = (month: number, day: number, hour = 12) => new Date(2026, month, day, hour).getTime();
const item = (name: string, touchedAt: number) =>
  recentItem({ entry: { path: `/V/${name}`, name }, touchedAt });

describe('groupRecent', () => {
  it('groups by local calendar day, not by hours elapsed', () => {
    const groups = groupRecent(
      [
        item('just-now.md', at(9, 28, 0)),
        item('late-last-night.md', at(9, 27, 23)),
        item('two-days.md', at(9, 26)),
        item('a-week.md', at(9, 21)),
        item('eight-days.md', at(9, 20)),
        item('thirty-days.md', at(8, 28)),
      ],
      NOW
    );
    expect(groups.map((group) => [group.label, group.items.map((entry) => entry.entry.name)])).toEqual([
      ['Today', ['just-now.md']],
      ['Yesterday', ['late-last-night.md']],
      ['Previous 7 days', ['two-days.md', 'a-week.md']],
      ['Earlier', ['eight-days.md', 'thirty-days.md']],
    ]);
  });

  it('leaves out anything older than 30 days and empty groups', () => {
    const groups = groupRecent([item('old.md', at(8, 27, 23)), item('today.md', at(9, 28, 0))], NOW);
    expect(groups).toEqual([{ label: 'Today', items: [expect.objectContaining({ touchedAt: at(9, 28, 0) })] }]);
    expect(groupRecent([], NOW)).toEqual([]);
  });

  it('starts the 30 days at local midnight', () => {
    expect(recentSince(NOW)).toBe(new Date(2026, 8, 28).getTime());
  });
});

describe('recentTime', () => {
  it('shows the time for today and yesterday, the weekday this week, and the date before', () => {
    expect(recentTime(new Date(2026, 9, 28, 0, 5).getTime(), NOW)).toMatch(/^12:05\sAM$/);
    expect(recentTime(new Date(2026, 9, 27, 14, 15).getTime(), NOW)).toMatch(/^2:15\sPM$/);
    expect(recentTime(at(9, 24), NOW)).toBe('Saturday');
    expect(recentTime(at(9, 8), NOW)).toBe('Oct 8');
  });
});
