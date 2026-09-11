import { describe, expect, it } from 'vitest';
import { dateRequest } from '@/main/chat/datedNotes';

const now = new Date(2026, 8, 9, 12);
describe('calendar request boundaries', () => {
  it.each([
    ['this week', '2026-09-07', '2026-09-09'],
    ['last week', '2026-08-31', '2026-09-06'],
    ['past week', '2026-09-03', '2026-09-09'],
    ['this month', '2026-09-01', '2026-09-09'],
    ['last month', '2026-08-01', '2026-08-31'],
    ['last ten days', '2026-08-31', '2026-09-09'],
    ['on 2026-08-14', '2026-08-14', '2026-08-14'],
    ['from 2026-08-14 through 2026-09-03', '2026-08-14', '2026-09-03'],
    ['between 2026-09-03 and 2026-08-14', '2026-08-14', '2026-09-03'],
  ])('resolves %s to calendar dates', (question, start, end) => {
    expect(dateRequest(question, now)).toEqual({ start, end });
  });
  it('handles leap-month and year boundaries', () => {
    expect(dateRequest('last month', new Date(2024, 2, 4, 12))).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(dateRequest('last week', new Date(2026, 0, 1, 12))).toEqual({ start: '2025-12-22', end: '2025-12-28' });
  });
  it('does not turn invalid dates or unrelated multiple dates into a range', () => {
    expect(dateRequest('on 2026-02-30', now)).toBeNull();
    expect(dateRequest('compare 2026-08-14 with 2026-09-03', now)).toBeNull();
    expect(dateRequest('How do I plan a garden?', now)).toBeNull();
  });
});
