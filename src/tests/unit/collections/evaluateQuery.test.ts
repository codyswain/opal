import { describe, expect, it } from 'vitest';
import { evaluateCollectionQuery, type EvaluationInput } from '@/main/collections/evaluateQuery';
import type { IndexedItem } from '@/main/collections/CollectionIndex';
import type { ActivityRecord } from '@/types/activity';
import type { CollectionFilter, CollectionQuery, CollectionSort } from '@/types/collectionQuery';

const NOW = 1_000_000_000_000;
const DAY = 24 * 3600 * 1000;

function item(over: Partial<IndexedItem> & { path: string }): IndexedItem {
  const name = over.path.split('/').pop() ?? over.path;
  return { name, kind: 'markdown', isDirectory: false, size: 10, mtimeMs: NOW - 5 * DAY, id: null, ...over };
}

const items: IndexedItem[] = [
  item({ path: '/V', name: 'V', kind: 'directory', isDirectory: true }),
  item({ path: '/V/Projects', kind: 'directory', isDirectory: true }),
  item({ path: '/V/Projects/atlas.pdf', kind: 'pdf' }),
  item({ path: '/V/Projects/Deep/cover.png', kind: 'image' }),
  item({ path: '/V/Projects/Deep', kind: 'directory', isDirectory: true }),
  item({ path: '/V/notes.md' }),
  item({ path: '/V/Blank.md' }),
  item({ path: '/V/mystery.pdf', kind: 'pdf' }),
  item({ path: '/Elsewhere/out.md' }),
];

const activity: Record<string, ActivityRecord> = {
  '/V/Projects/atlas.pdf': { path: '/V/Projects/atlas.pdf', id: null, openedAt: NOW - 2 * DAY, organizedAt: NOW - DAY, editedAt: null },
  '/V/notes.md': { path: '/V/notes.md', id: null, openedAt: NOW - 20 * DAY, organizedAt: null, editedAt: null },
  '/V/Blank.md': { path: '/V/Blank.md', id: null, openedAt: null, organizedAt: NOW - 3 * DAY, editedAt: null },
};

const touchedAt = (record: ActivityRecord) =>
  Math.max(record.openedAt ?? 0, record.organizedAt ?? 0, record.editedAt ?? 0);

function run(filters: CollectionFilter[] = [], sort: CollectionSort = { field: 'name', direction: 'asc' }) {
  const query: CollectionQuery = { version: 1, scope: { kind: 'all-roots' }, filters, sort };
  const input: EvaluationInput = {
    items,
    activity: (target) => activity[target] ?? null,
    touchedAt,
    allowedRoots: ['/V'],
    query,
  };
  return evaluateCollectionQuery(input);
}
const paths = (rows: ReturnType<typeof run>) => rows.map((row) => row.entry.path);

describe('scope', () => {
  it('lists everything under allowed roots except the roots themselves', () => {
    expect(paths(run())).toEqual([
      '/V/Projects/atlas.pdf', '/V/Blank.md', '/V/Projects/Deep/cover.png', '/V/Projects/Deep', '/V/mystery.pdf', '/V/notes.md', '/V/Projects',
    ]);
  });
});

describe('predicates', () => {
  it('name is a case-insensitive literal', () => {
    expect(paths(run([{ field: 'name', op: 'contains', value: 'ATLAS' }]))).toEqual(['/V/Projects/atlas.pdf']);
    expect(paths(run([{ field: 'name', op: 'contains', value: '.p' }]))).toEqual(['/V/Projects/atlas.pdf', '/V/Projects/Deep/cover.png', '/V/mystery.pdf']);
    expect(paths(run([{ field: 'name', op: 'not-contains', value: 'e' }]))).toEqual(['/V/Projects/atlas.pdf', '/V/Blank.md']);
  });
  it('kind in / not in', () => {
    expect(paths(run([{ field: 'kind', op: 'in', values: ['pdf', 'image'] }]))).toEqual(['/V/Projects/atlas.pdf', '/V/Projects/Deep/cover.png', '/V/mystery.pdf']);
    expect(paths(run([{ field: 'kind', op: 'not-in', values: ['directory', 'pdf', 'image'] }]))).toEqual(['/V/Blank.md', '/V/notes.md']);
  });
  it('every filter must match', () => {
    expect(paths(run([
      { field: 'name', op: 'contains', value: 'a' },
      { field: 'kind', op: 'not-in', values: ['directory'] },
    ]))).toEqual(['/V/Projects/atlas.pdf', '/V/Blank.md']);
  });
});

describe('identity', () => {
  it('does not let a replaced item inherit the old record\'s activity', () => {
    const replaced = item({ path: '/V/replaced.pdf', kind: 'pdf', id: 'new-id' });
    const unannotated = item({ path: '/V/plain.pdf', kind: 'pdf', id: null });
    const records: Record<string, ActivityRecord> = {
      '/V/replaced.pdf': { path: '/V/replaced.pdf', id: 'old-id', openedAt: NOW - DAY, organizedAt: null, editedAt: null },
      '/V/plain.pdf': { path: '/V/plain.pdf', id: 'was-annotated', openedAt: NOW - DAY, organizedAt: null, editedAt: null },
    };
    const rows = evaluateCollectionQuery({
      items: [replaced, unannotated],
      activity: (target) => records[target] ?? null,
      touchedAt: (record) => record.openedAt ?? 0,
      allowedRoots: ['/V'],
      query: { version: 1, scope: { kind: 'all-roots' }, filters: [], sort: { field: 'name', direction: 'asc' } },
    });
    expect(rows.map((row) => [row.entry.path, row.touchedAt])).toEqual([
      ['/V/plain.pdf', NOW - DAY],
      ['/V/replaced.pdf', null],
    ]);
  });
});

describe('sorting', () => {
  it('sorts by name both ways with path tie-break and no folders-first rule', () => {
    expect(paths(run([], { field: 'name', direction: 'desc' }))).toEqual([
      '/V/Projects', '/V/notes.md', '/V/mystery.pdf', '/V/Projects/Deep', '/V/Projects/Deep/cover.png', '/V/Blank.md', '/V/Projects/atlas.pdf',
    ]);
  });
  it('sorts by touched with missing timestamps last in both directions', () => {
    expect(paths(run([], { field: 'touched', direction: 'desc' }))).toEqual([
      '/V/Projects/atlas.pdf', '/V/Blank.md', '/V/notes.md', '/V/Projects/Deep/cover.png', '/V/Projects/Deep', '/V/mystery.pdf', '/V/Projects',
    ]);
    expect(paths(run([], { field: 'touched', direction: 'asc' }))).toEqual([
      '/V/notes.md', '/V/Blank.md', '/V/Projects/atlas.pdf', '/V/Projects/Deep/cover.png', '/V/Projects/Deep', '/V/mystery.pdf', '/V/Projects',
    ]);
  });
});
