import { describe, expect, it } from 'vitest';
import { evaluateCollectionQuery, type EvaluationInput } from '@/main/collections/evaluateQuery';
import type { IndexedItem } from '@/main/collections/CollectionIndex';
import type { ActivityRecord } from '@/types/activity';
import type { CollectionFilter, CollectionQuery, CollectionSort } from '@/types/collectionQuery';

const NOW = 1_000_000_000_000;
const DAY = 24 * 3600 * 1000;

function item(over: Partial<IndexedItem> & { path: string }): IndexedItem {
  const name = over.path.split('/').pop() ?? over.path;
  return {
    name, kind: 'markdown', isDirectory: false, size: 10, mtimeMs: NOW - 5 * DAY,
    id: null, tags: [], descriptionEmpty: true, metadataWarning: null, ...over,
  };
}

const items: IndexedItem[] = [
  item({ path: '/V', name: 'V', kind: 'directory', isDirectory: true }),
  item({ path: '/V/Projects', kind: 'directory', isDirectory: true, tags: ['project'] }),
  item({ path: '/V/Projects/atlas.pdf', kind: 'pdf', tags: ['research', 'reference'], descriptionEmpty: false, mtimeMs: NOW - DAY }),
  item({ path: '/V/Projects/Deep/cover.png', kind: 'image', tags: ['reference'], mtimeMs: NOW - 10 * DAY }),
  item({ path: '/V/Projects/Deep', kind: 'directory', isDirectory: true }),
  item({ path: '/V/notes.md', tags: ['research'], descriptionEmpty: true, mtimeMs: NOW - 30 * DAY }),
  item({ path: '/V/Blank.md', tags: [], descriptionEmpty: true }),
  item({ path: '/V/mystery.pdf', kind: 'pdf', tags: null, descriptionEmpty: null, metadataWarning: 'bad yaml' }),
  item({ path: '/Elsewhere/out.md' }),
];

const activity: Record<string, ActivityRecord> = {
  '/V/Projects/atlas.pdf': { path: '/V/Projects/atlas.pdf', id: null, openedAt: NOW - 2 * DAY, organizedAt: NOW - DAY, editedAt: null },
  '/V/notes.md': { path: '/V/notes.md', id: null, openedAt: NOW - 20 * DAY, organizedAt: null, editedAt: null },
  '/V/Blank.md': { path: '/V/Blank.md', id: null, openedAt: null, organizedAt: NOW - 3 * DAY, editedAt: null },
};

function run(filters: CollectionFilter[] = [], over: Partial<CollectionQuery> = {}, sort: CollectionSort = { field: 'name', direction: 'asc' }) {
  const query: CollectionQuery = { version: 1, scope: { kind: 'all-roots' }, filters, sort, ...over };
  const input: EvaluationInput = {
    items,
    activity: (target) => activity[target] ?? null,
    touchedOf: (record) => {
      const at = Math.max(record.openedAt ?? 0, record.organizedAt ?? 0, record.editedAt ?? 0);
      return { at, kind: record.organizedAt === at ? 'organized' : 'opened' };
    },
    allowedRoots: ['/V'],
    query,
    now: NOW,
  };
  return evaluateCollectionQuery(input);
}
const paths = (result: ReturnType<typeof run>) => result.rows.map((row) => row.entry.path);

describe('scope', () => {
  it('all roots lists everything under allowed roots except the roots themselves', () => {
    expect(paths(run())).toEqual([
      '/V/Projects/atlas.pdf', '/V/Blank.md', '/V/Projects/Deep/cover.png', '/V/Projects/Deep', '/V/mystery.pdf', '/V/notes.md', '/V/Projects',
    ]);
  });
  it('folder scope with descendants includes nested items but not the folder itself', () => {
    expect(paths(run([], { scope: { kind: 'folders', folders: ['/V/Projects'], includeDescendants: true } })))
      .toEqual(['/V/Projects/atlas.pdf', '/V/Projects/Deep/cover.png', '/V/Projects/Deep']);
  });
  it('folder scope without descendants lists direct children only', () => {
    expect(paths(run([], { scope: { kind: 'folders', folders: ['/V/Projects'], includeDescendants: false } })))
      .toEqual(['/V/Projects/atlas.pdf', '/V/Projects/Deep']);
  });
  it('never reaches outside allowed roots even when scoped there', () => {
    expect(paths(run([], { scope: { kind: 'folders', folders: ['/Elsewhere'], includeDescendants: true } }))).toEqual([]);
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
  it('tags are exact and case-sensitive; unknown metadata is excluded and counted', () => {
    const any = run([{ field: 'tags', op: 'has-any', values: ['research', 'Reference'] }]);
    expect(paths(any)).toEqual(['/V/Projects/atlas.pdf', '/V/notes.md']);
    expect(any.excludedUnknown).toBe(1);
    expect(paths(run([{ field: 'tags', op: 'has-all', values: ['research', 'reference'] }]))).toEqual(['/V/Projects/atlas.pdf']);
    expect(paths(run([{ field: 'tags', op: 'has-none', values: ['research', 'reference', 'project'] }]))).toEqual(['/V/Blank.md', '/V/Projects/Deep']);
    const empty = run([{ field: 'tags', op: 'is-empty' }]);
    expect(paths(empty)).toEqual(['/V/Blank.md', '/V/Projects/Deep']);
    expect(empty.excludedUnknown).toBe(1);
  });
  it('description emptiness treats unknown as excluded', () => {
    const notEmpty = run([{ field: 'description', op: 'is-not-empty' }]);
    expect(paths(notEmpty)).toEqual(['/V/Projects/atlas.pdf']);
    expect(notEmpty.excludedUnknown).toBe(1);
  });
  it('name-only queries keep items with unreadable metadata', () => {
    const result = run([{ field: 'name', op: 'contains', value: 'mystery' }]);
    expect(paths(result)).toEqual(['/V/mystery.pdf']);
    expect(result.excludedUnknown).toBe(0);
  });
  it('activity windows use evaluation time; never matches untouched items', () => {
    expect(paths(run([{ field: 'touched', op: 'within', durationMs: 7 * DAY }]))).toEqual(['/V/Projects/atlas.pdf', '/V/Blank.md']);
    expect(paths(run([{ field: 'opened', op: 'within', durationMs: 7 * DAY }]))).toEqual(['/V/Projects/atlas.pdf']);
    expect(paths(run([{ field: 'opened', op: 'before', at: NOW - 10 * DAY }]))).toEqual(['/V/notes.md']);
    expect(paths(run([{ field: 'opened', op: 'after', at: NOW - 2 * DAY }]))).toEqual(['/V/Projects/atlas.pdf']);
    expect(paths(run([{ field: 'touched', op: 'never' }]))).toEqual(['/V/Projects/Deep/cover.png', '/V/Projects/Deep', '/V/mystery.pdf', '/V/Projects']);
    expect(paths(run([{ field: 'opened', op: 'never' }]))).toContain('/V/Blank.md');
  });
  it('modified uses filesystem time', () => {
    expect(paths(run([{ field: 'modified', op: 'within', durationMs: 7 * DAY }]))).toEqual(['/V/Projects/atlas.pdf', '/V/Blank.md', '/V/Projects/Deep', '/V/mystery.pdf', '/V/Projects']);
    expect(paths(run([{ field: 'modified', op: 'before', at: NOW - 7 * DAY }]))).toEqual(['/V/Projects/Deep/cover.png', '/V/notes.md']);
  });
  it('conjoins chips with OR inside a chip', () => {
    const result = run([
      { field: 'kind', op: 'in', values: ['pdf', 'image'] },
      { field: 'tags', op: 'has-any', values: ['research', 'reference'] },
    ]);
    expect(paths(result)).toEqual(['/V/Projects/atlas.pdf', '/V/Projects/Deep/cover.png']);
    expect(result.excludedUnknown).toBe(1);
    // An item failing a definite predicate is not counted as unknown.
    const mixed = run([{ field: 'kind', op: 'in', values: ['image'] }, { field: 'tags', op: 'is-empty' }]);
    expect(paths(mixed)).toEqual([]);
    expect(mixed.excludedUnknown).toBe(0);
  });
});

describe('identity', () => {
  it('does not let a replaced item inherit the old record\'s activity', () => {
    const replaced = item({ path: '/V/replaced.pdf', kind: 'pdf', id: 'new-id' });
    const unannotated = item({ path: '/V/plain.pdf', kind: 'pdf', id: null });
    const unreadable = item({ path: '/V/unknown.pdf', kind: 'pdf', id: null, tags: null, metadataWarning: 'bad' });
    const records: Record<string, ActivityRecord> = {
      '/V/replaced.pdf': { path: '/V/replaced.pdf', id: 'old-id', openedAt: NOW - DAY, organizedAt: null, editedAt: null },
      '/V/plain.pdf': { path: '/V/plain.pdf', id: 'was-annotated', openedAt: NOW - DAY, organizedAt: null, editedAt: null },
      '/V/unknown.pdf': { path: '/V/unknown.pdf', id: 'some-id', openedAt: NOW - DAY, organizedAt: null, editedAt: null },
    };
    const result = evaluateCollectionQuery({
      items: [replaced, unannotated, unreadable],
      activity: (target) => records[target] ?? null,
      touchedOf: (record) => ({ at: record.openedAt ?? 0, kind: 'opened' }),
      allowedRoots: ['/V'],
      query: { version: 1, scope: { kind: 'all-roots' }, filters: [{ field: 'opened', op: 'within', durationMs: 7 * DAY }], sort: { field: 'name', direction: 'asc' } },
      now: NOW,
    });
    expect(paths(result)).toEqual(['/V/plain.pdf', '/V/unknown.pdf']);
  });
});

describe('sorting', () => {
  it('sorts by name both ways with path tie-break and no folders-first rule', () => {
    expect(paths(run([], {}, { field: 'name', direction: 'desc' }))).toEqual([
      '/V/Projects', '/V/notes.md', '/V/mystery.pdf', '/V/Projects/Deep', '/V/Projects/Deep/cover.png', '/V/Blank.md', '/V/Projects/atlas.pdf',
    ]);
  });
  it('sorts by touched with missing timestamps last in both directions', () => {
    expect(paths(run([], {}, { field: 'touched', direction: 'desc' }))).toEqual([
      '/V/Projects/atlas.pdf', '/V/Blank.md', '/V/notes.md', '/V/Projects/Deep/cover.png', '/V/Projects/Deep', '/V/mystery.pdf', '/V/Projects',
    ]);
    expect(paths(run([], {}, { field: 'touched', direction: 'asc' }))).toEqual([
      '/V/notes.md', '/V/Blank.md', '/V/Projects/atlas.pdf', '/V/Projects/Deep/cover.png', '/V/Projects/Deep', '/V/mystery.pdf', '/V/Projects',
    ]);
  });
  it('sorts by modified and reports touched kind', () => {
    const result = run([], {}, { field: 'modified', direction: 'asc' });
    expect(paths(result).slice(0, 2)).toEqual(['/V/notes.md', '/V/Projects/Deep/cover.png']);
    expect(result.rows.find((row) => row.entry.path === '/V/Projects/atlas.pdf')).toMatchObject({ touchedKind: 'organized', touchedAt: NOW - DAY, openedAt: NOW - 2 * DAY });
  });
});
