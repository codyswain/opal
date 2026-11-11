import { describe, expect, it } from 'vitest';
import { cleanReason, currentTest, parseDailyTest, parseTestAnswer, testDates, type TestDay } from '@/common/dailyTest';
import { parseVariantSides } from '@/common/variants';

const interfaceTest = {
  version: 1,
  id: '2026-01-05-row-height',
  title: 'Tighter rows in the file tree',
  question: 'Which tree is easier to scan?',
  kind: 'interface',
  variant: 'tree-row-height',
  where: 'daily',
  a: { label: 'Current' },
  b: { label: 'Tighter' },
};

const pageTest = {
  version: 1,
  id: '2026-01-05-summary',
  title: 'Two summaries',
  question: 'Which reads faster?',
  kind: 'page',
  a: { label: 'Long', path: 'Notes/long.md' },
  b: { label: 'Short', path: 'Notes/short.md' },
};

describe('parseDailyTest', () => {
  it('reads an interface test and a page test', () => {
    expect(parseDailyTest(interfaceTest)).toEqual({
      id: '2026-01-05-row-height',
      title: 'Tighter rows in the file tree',
      question: 'Which tree is easier to scan?',
      kind: 'interface',
      variant: 'tree-row-height',
      where: 'daily',
      a: { label: 'Current', path: null },
      b: { label: 'Tighter', path: null },
    });
    expect(parseDailyTest({ ...interfaceTest, where: undefined })?.where).toBeNull();
    expect(parseDailyTest({ ...interfaceTest, where: 'Notes/plan.md' })?.where).toBe('Notes/plan.md');
    expect(parseDailyTest(pageTest)).toMatchObject({
      kind: 'page',
      variant: null,
      where: null,
      a: { label: 'Long', path: 'Notes/long.md' },
      b: { label: 'Short', path: 'Notes/short.md' },
    });
  });

  it('reads anything malformed as no test', () => {
    const bad: unknown[] = [
      null,
      [],
      'text',
      { ...interfaceTest, version: 2 },
      { ...interfaceTest, id: '' },
      { ...interfaceTest, title: 'two\nlines' },
      { ...interfaceTest, kind: 'other' },
      { ...interfaceTest, variant: 'Not A Name' },
      { ...interfaceTest, variant: undefined },
      { ...interfaceTest, where: '../outside.md' },
      { ...interfaceTest, where: '/abs/path.md' },
      { ...interfaceTest, a: { label: 'Current', path: 'Notes/a.md' } },
      { ...interfaceTest, b: {} },
      { ...pageTest, variant: 'tree-row-height' },
      { ...pageTest, where: 'daily' },
      { ...pageTest, b: { label: 'Short' } },
      { ...pageTest, b: { label: 'Short', path: 'Notes/long.md' } },
      { ...pageTest, a: { label: 'Long', path: 'Notes/../../x.md' } },
      { ...pageTest, a: { label: 'Long', path: 'Notes\\x.md' } },
      { ...pageTest, a: { label: 'x'.repeat(41), path: 'Notes/long.md' } },
    ];
    for (const json of bad) expect(parseDailyTest(json)).toBeNull();
  });
});

describe('parseTestAnswer', () => {
  const answer = { version: 1, id: 'x', choice: 'b', reason: 'Easier.', answeredAt: '2026-01-05T16:20:00Z' };
  it('reads a well-formed answer and refuses the rest', () => {
    expect(parseTestAnswer(answer)).toEqual(answer);
    expect(parseTestAnswer({ ...answer, reason: '' })?.reason).toBe('');
    expect(parseTestAnswer({ ...answer, choice: 'c' })).toBeNull();
    expect(parseTestAnswer({ ...answer, answeredAt: 'soon' })).toBeNull();
    expect(parseTestAnswer({ ...answer, reason: 'two\nlines' })).toBeNull();
  });

  it('keeps a reason on one line', () => {
    expect(cleanReason('  one\ntwo  ')).toBe('one two');
  });
});

describe('currentTest', () => {
  const test = (id: string) => ({ id });
  const answer = (id: string) => ({ version: 1 as const, id, choice: 'a' as const, reason: '', answeredAt: '2026-01-05T00:00:00Z' });
  const day = (date: string, id: string | null, answered: string | null = null): TestDay<{ id: string }> => ({
    date,
    test: id ? test(id) : null,
    answer: answered ? answer(answered) : null,
  });
  const today = '2026-01-05';

  it('looks at today and the two days before', () => {
    expect(testDates(today)).toEqual(['2026-01-05', '2026-01-04', '2026-01-03']);
    expect(testDates('2026-03-01')).toEqual(['2026-03-01', '2026-02-28', '2026-02-27']);
  });

  it('picks the newest test with no answer', () => {
    expect(currentTest(today, [day('2026-01-05', 't5'), day('2026-01-04', 't4'), day('2026-01-03', null)])?.test.id).toBe('t5');
    expect(currentTest(today, [day('2026-01-05', 't5', 't5'), day('2026-01-04', 't4'), day('2026-01-03', 't3')])?.test.id).toBe('t4');
    expect(currentTest(today, [day('2026-01-05', null), day('2026-01-04', 't4', 't4'), day('2026-01-03', 't3')])?.date).toBe('2026-01-03');
  });

  it('shows today’s answered test when every one is answered, else none', () => {
    const answered = currentTest(today, [day('2026-01-05', 't5', 't5'), day('2026-01-04', 't4', 't4'), day('2026-01-03', null)]);
    expect(answered).toMatchObject({ date: today, test: { id: 't5' }, answer: { id: 't5' } });
    expect(currentTest(today, [day('2026-01-05', null), day('2026-01-04', 't4', 't4'), day('2026-01-03', null)])).toBeNull();
    expect(currentTest(today, [day('2026-01-05', null), day('2026-01-04', null), day('2026-01-03', null)])).toBeNull();
  });

  it('counts an answer only for the test it names', () => {
    const current = currentTest(today, [day('2026-01-05', 't5', 'old'), day('2026-01-04', null), day('2026-01-03', null)]);
    expect(current).toMatchObject({ test: { id: 't5' }, answer: null });
  });
});

describe('parseVariantSides', () => {
  it('keeps well-formed variants on B and reads anything else as A', () => {
    expect(parseVariantSides({ version: 1, sides: { 'row-height': 'b', other: 'a', 'Bad Name': 'b', x: 3 } })).toEqual({ 'row-height': 'b' });
    expect(parseVariantSides({ version: 2, sides: { 'row-height': 'b' } })).toEqual({});
    expect(parseVariantSides(null)).toEqual({});
  });
});
