import { describe, expect, it } from 'vitest';
import {
  EMPTY_TOUCHED_CONFIG,
  folderLabel,
  linkItem,
  linkTitles,
  mondayOf,
  touchedConfig,
  touchedForDay,
  touchedItems,
  weekDates,
  weekdayIndex,
  type TouchedEntry,
  type TouchedLink,
} from '@/common/touchedModel';
import type { TouchedItem, TouchedWeek } from '@/types/touched';

const file = (path: string, label = path): TouchedLink => ({ label, target: path, external: false, file: path });
const url = (target: string, label = target): TouchedLink => ({ label, target, external: true, file: null });
const turn = (time: string, text: string, ...links: TouchedLink[]): TouchedEntry => ({ time, text, kind: 'agent turn', links });
const week = (days: Record<number, TouchedEntry[]>): TouchedEntry[][] => [...Array(7).keys()].map((day) => days[day] ?? []);
const noSkip = () => false;
const byKey = (items: TouchedItem[]) => Object.fromEntries(items.map((item) => [item.key, item]));

describe('touched model: dates', () => {
  it('finds the Monday and the seven dates of a week', () => {
    expect(mondayOf('2026-11-05')).toBe('2026-11-02');
    expect(mondayOf('2026-11-02')).toBe('2026-11-02');
    expect(mondayOf('2026-11-08')).toBe('2026-11-02');
    expect(mondayOf('2027-01-01')).toBe('2026-12-28');
    expect(weekDates('2026-12-28')).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
    expect(weekdayIndex('2026-11-05')).toBe(3);
    expect(weekdayIndex('2026-11-08')).toBe(6);
  });
});

describe('touched model: link items', () => {
  it('keys issues, pull requests and Google Docs, and skips other URLs', () => {
    expect(linkItem(url('https://linear.app/acme/issue/abc-123/fix-the-thing'), EMPTY_TOUCHED_CONFIG, noSkip)).toMatchObject({
      key: 'linear:ABC-123', kind: 'issue', id: 'ABC-123',
    });
    expect(linkItem(url('https://github.com/owner/repo/pull/12/files'), EMPTY_TOUCHED_CONFIG, noSkip)).toMatchObject({
      key: 'github:owner/repo#12', kind: 'pr', id: 'PR 12',
    });
    expect(linkItem(url('https://docs.google.com/spreadsheets/d/1AbC_d-9/edit#gid=0'), EMPTY_TOUCHED_CONFIG, noSkip)).toMatchObject({
      key: 'gdoc:1AbC_d-9', kind: 'doc', id: null,
    });
    expect(linkItem(url('https://github.com/owner/repo/issues/4'), EMPTY_TOUCHED_CONFIG, noSkip)).toBeNull();
    expect(linkItem(url('https://mail.google.com/mail/u/0/#all/abc'), EMPTY_TOUCHED_CONFIG, noSkip)).toBeNull();
    expect(linkItem(url('https://example.com/'), EMPTY_TOUCHED_CONFIG, noSkip)).toBeNull();
  });

  it('groups files under a matching folder, then ignores prefixes, after skipping the day sidebar folders', () => {
    const config = touchedConfig({ groups: ['Projects/*', 'Notes/drafts/*'], ignore: ['Archive/', 'Scratch.md', 'Projects/'] });
    const skip = (path: string) => path.startsWith('Library/chats/');
    expect(linkItem(file('Projects/garden_plan/notes/Plan.md'), config, skip)).toMatchObject({ key: 'Projects/garden_plan', kind: 'folder' });
    expect(linkItem(file('Notes/drafts/essay-one/report.pdf'), config, skip)).toMatchObject({ key: 'Notes/drafts/essay-one', kind: 'folder' });
    // A file directly in the pattern's folder is not below a match, so the ignore list decides.
    expect(linkItem(file('Projects/Plan.md'), config, skip)).toBeNull();
    expect(linkItem(file('Archive/Old.md'), config, skip)).toBeNull();
    expect(linkItem(file('Scratch.md'), config, skip)).toBeNull();
    expect(linkItem(file('Library/chats/thread.md'), config, skip)).toBeNull();
    expect(linkItem(file('Notes/Plan.md'), config, skip)).toMatchObject({ key: 'Notes/Plan.md', kind: 'file' });
    expect(linkItem({ label: 'Gone', target: 'Gone', external: false, file: null }, config, skip)).toBeNull();
  });

  it('reads the config and titles files leniently', () => {
    expect(touchedConfig({ groups: ['/Projects/*/', 3, ''], ignore: 'Archive/' })).toEqual({ groups: ['Projects/*'], ignore: [] });
    expect(touchedConfig(null)).toEqual(EMPTY_TOUCHED_CONFIG);
    expect(touchedConfig([1])).toEqual(EMPTY_TOUCHED_CONFIG);
    expect(linkTitles({ 'linear:ABC-123': ' Fix it ', 'github:owner/repo#1': 4, gdoc: '' })).toEqual({ 'linear:ABC-123': 'Fix it' });
    expect(linkTitles('nope')).toEqual({});
  });

  it('names folders with spaces and a capital', () => {
    expect(folderLabel('Projects/garden_plan-two')).toBe('Garden plan two');
  });
});

describe('touched model: a week', () => {
  const ISSUE = 'https://linear.app/acme/issue/ABC-123/fix';
  const PR = 'https://github.com/owner/repo/pull/12';
  const DOC = 'https://docs.google.com/document/d/doc1/edit';

  it('counts agent turns only, each line once per item, with the latest line as the day sentence', () => {
    const items = touchedItems(
      week({
        0: [
          turn('09:00', 'First pass on the plan.', file('Notes/Plan.md'), file('Notes/Plan.md', 'the plan')),
          turn('11:00', 'Second pass on the plan.', file('Notes/Plan.md')),
          { time: '12:00', text: 'Routine.', kind: 'routine run', links: [file('Notes/Plan.md')] },
          { time: '12:30', text: 'Connector.', kind: '3 connector calls', links: [file('Notes/Plan.md')] },
          { time: '13:00', text: 'Old line.', kind: null, links: [file('Notes/Plan.md')] },
          { time: '10:00', text: 'Plural turns.', kind: '2 agent turns', links: [file('Notes/Plan.md')] },
        ],
      }),
      EMPTY_TOUCHED_CONFIG,
      {},
      noSkip,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: 'Notes/Plan.md', kind: 'file', name: 'the plan', path: 'Notes/Plan.md', url: null, colour: null });
    expect(items[0].days[0]).toEqual({ lines: 3, text: 'Second pass on the plan.' });
    expect(items[0].days.slice(1)).toEqual([null, null, null, null, null, null]);
  });

  it('colours multi-day items by first day touched, then key, and names URL items', () => {
    const items = byKey(
      touchedItems(
        week({
          0: [turn('09:00', 'Opened the issue.', url(ISSUE)), turn('09:30', 'Doc.', url(DOC, 'docs.google.com'))],
          1: [turn('09:00', 'Reviewed.', url(PR), url(ISSUE)), turn('10:00', 'Doc again.', url(DOC, 'Budget sheet'))],
          2: [turn('09:00', 'Merged.', url(PR)), turn('09:10', 'Report.', file('report.pdf'))],
          3: [turn('09:00', 'Another.', file('B.md')), turn('10:00', 'Again.', file('B.md'))],
          4: [turn('09:00', 'Twice.', file('A.md'), url(`${DOC}?usp=sharing`, 'Budget sheet'))],
          5: [turn('09:00', 'Twice.', file('A.md'))],
        }),
        EMPTY_TOUCHED_CONFIG,
        { 'github:owner/repo#12': 'Ship the thing' },
        noSkip,
      ),
    );
    // Monday: the doc and the issue (by key); Tuesday: the PR; Friday: A.md.
    expect(items['gdoc:doc1'].colour).toBe(0);
    expect(items['linear:ABC-123'].colour).toBe(1);
    expect(items['github:owner/repo#12'].colour).toBe(2);
    expect(items['A.md'].colour).toBe(3);
    expect(items['B.md'].colour).toBeNull();
    expect(items['report.pdf']).toMatchObject({ colour: null, name: 'report.pdf' });
    expect(items['linear:ABC-123']).toMatchObject({ id: 'ABC-123', name: '', url: ISSUE });
    expect(items['github:owner/repo#12']).toMatchObject({ id: 'PR 12', name: 'Ship the thing' });
    // A bare host label never names a doc; the latest URL written is the one opened.
    expect(items['gdoc:doc1']).toMatchObject({ name: 'Budget sheet', url: `${DOC}?usp=sharing` });
  });

  it('names a doc "Google Doc" when its only labels are hosts or URLs', () => {
    const [item] = touchedItems(week({ 0: [turn('09:00', 'Doc.', url(DOC, 'docs.google.com'), url(DOC))] }), EMPTY_TOUCHED_CONFIG, {}, noSkip);
    expect(item.name).toBe('Google Doc');
  });

  it('opens a group at its most-linked file', () => {
    const config = touchedConfig({ groups: ['Projects/*'] });
    const [item] = touchedItems(
      week({
        0: [turn('09:00', 'One.', file('Projects/garden/b.md'), file('Projects/garden/a.md'))],
        1: [turn('09:00', 'Two.', file('Projects/garden/b.md'))],
      }),
      config,
      {},
      noSkip,
    );
    expect(item).toMatchObject({ key: 'Projects/garden', kind: 'folder', name: 'Garden', path: 'Projects/garden/b.md', colour: 0 });
    expect(item.days[0]).toEqual({ lines: 1, text: 'One.' });
  });

  it('gives the palette out again after eight', () => {
    const files = [...'ABCDEFGHI'].map((letter) => `${letter}.md`);
    const items = byKey(
      touchedItems(
        week({ 0: files.map((name) => turn('09:00', name, file(name))), 1: files.map((name) => turn('09:00', name, file(name))) }),
        EMPTY_TOUCHED_CONFIG,
        {},
        noSkip,
      ),
    );
    expect(files.map((name) => items[name].colour)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0]);
  });
});

describe('touched model: a day', () => {
  const item = (key: string, counts: number[]): TouchedItem => ({
    key,
    kind: 'file',
    id: null,
    name: key,
    path: key,
    url: null,
    days: [...Array(7).keys()].map((day) => (counts[day] ? { lines: counts[day], text: key } : null)),
    colour: null,
  });
  const at = (items: TouchedItem[]): TouchedWeek => ({ root: '/vault', monday: '2026-11-02', items, digests: [] });

  it('shows items touched twice that day or also on another day, by count, spread, then key', () => {
    const rows = touchedForDay(
      at([item('once.md', [0, 1]), item('twice.md', [0, 2]), item('spread.md', [1, 2]), item('also.md', [0, 1, 1]), item('b.md', [0, 3]), item('a.md', [0, 3])]),
      1,
    );
    expect(rows.map((row) => row.key)).toEqual(['a.md', 'b.md', 'spread.md', 'twice.md', 'also.md']);
  });

  it('shows at most eight, and nothing on a day with none', () => {
    const many = [...Array(10).keys()].map((index) => item(`${index}.md`, [2]));
    expect(touchedForDay(at(many), 0)).toHaveLength(8);
    expect(touchedForDay(at(many), 3)).toEqual([]);
  });
});

describe('touched model: file names', () => {
  it('names a file by its most common log label, and by its file name when the label repeats the path', () => {
    const items = byKey(
      touchedItems(
        week({
          0: [
            turn('09:00', 'Wrote it.', file('Notes/2026-01-05-trip.md', 'Trip plan')),
            turn('10:00', 'Fixed it.', file('Notes/2026-01-05-trip.md', 'Trip plan')),
            turn('11:00', 'Read it.', file('Notes/2026-01-05-trip.md', 'trip notes')),
            turn('12:00', 'No alias.', file('Notes/Plan.md', 'Notes/Plan')),
          ],
        }),
        EMPTY_TOUCHED_CONFIG,
        {},
        noSkip,
      ),
    );
    expect(items['Notes/2026-01-05-trip.md'].name).toBe('Trip plan');
    expect(items['Notes/Plan.md'].name).toBe('Plan');
  });
});
