import { describe, expect, it } from 'vitest';
import {
  CollectionQueryError,
  DURATION_PRESETS,
  dayBoundary,
  describeFilter,
  emptyQuery,
  folderScope,
  startOfLocalDay,
  validateCollectionPage,
  validateCollectionQuery,
} from '@/common/collectionQuery';
import type { CollectionFilter, CollectionQuery } from '@/types/collectionQuery';

const base = (filters: unknown[] = [], scope: unknown = { kind: 'all-roots' }): unknown => ({
  version: 1,
  scope,
  filters,
  sort: { field: 'name', direction: 'asc' },
});

describe('validateCollectionQuery', () => {
  it('accepts the handoff example and normalizes it', () => {
    const query = validateCollectionQuery(base([
      { field: 'kind', op: 'in', values: ['pdf', 'image', 'pdf'] },
      { field: 'tags', op: 'has-any', values: ['research', ' reference ', '', '  '] },
      { field: 'name', op: 'contains', value: '  Atlas (v2)* ' },
    ], { kind: 'folders', folders: ['/Vault/Projects/', '/Vault/Projects'], includeDescendants: true }));
    expect(query).toEqual({
      version: 1,
      scope: { kind: 'folders', folders: ['/Vault/Projects'], includeDescendants: true },
      filters: [
        { field: 'kind', op: 'in', values: ['pdf', 'image'] },
        { field: 'tags', op: 'has-any', values: ['research', ' reference '] },
        { field: 'name', op: 'contains', value: 'Atlas (v2)*' },
      ],
      sort: { field: 'name', direction: 'asc' },
    });
  });

  it('keeps tag case and accepts every supported filter shape', () => {
    const filters: CollectionFilter[] = [
      { field: 'tags', op: 'has-all', values: ['Research', 'research'] },
      { field: 'tags', op: 'has-none', values: ['x'] },
      { field: 'tags', op: 'is-empty' },
      { field: 'description', op: 'is-not-empty' },
      { field: 'touched', op: 'within', durationMs: DURATION_PRESETS[2].ms },
      { field: 'opened', op: 'never' },
      { field: 'opened', op: 'before', at: 1_700_000_000_000 },
      { field: 'modified', op: 'after', at: 1_700_000_000_000 },
      { field: 'kind', op: 'not-in', values: ['directory'] },
      { field: 'name', op: 'not-contains', value: 'draft' },
    ];
    expect(validateCollectionQuery(base(filters)).filters).toEqual(filters);
  });

  it.each([
    ['unknown field', [{ field: 'size', op: 'gt', value: 1 }]],
    ['unknown op', [{ field: 'name', op: 'matches', value: 'x' }]],
    ['empty name', [{ field: 'name', op: 'contains', value: '   ' }]],
    ['long name', [{ field: 'name', op: 'contains', value: 'x'.repeat(257) }]],
    ['empty tags', [{ field: 'tags', op: 'has-any', values: [''] }]],
    ['too many tags', [{ field: 'tags', op: 'has-any', values: Array.from({ length: 33 }, (_, i) => `t${i}`) }]],
    ['long tag', [{ field: 'tags', op: 'has-any', values: ['x'.repeat(65)] }]],
    ['unknown kind', [{ field: 'kind', op: 'in', values: ['spreadsheet'] }]],
    ['no kinds', [{ field: 'kind', op: 'in', values: [] }]],
    ['non-finite at', [{ field: 'modified', op: 'before', at: Number.NaN }]],
    ['tiny duration', [{ field: 'touched', op: 'within', durationMs: 10 }]],
    ['huge duration', [{ field: 'touched', op: 'within', durationMs: 1e15 }]],
    ['modified never', [{ field: 'modified', op: 'never' }]],
    ['too many filters', Array.from({ length: 17 }, () => ({ field: 'tags', op: 'is-empty' }))],
  ])('rejects %s', (_, filters) => {
    expect(() => validateCollectionQuery(base(filters))).toThrow(CollectionQueryError);
  });

  it.each([
    ['unknown scope', { kind: 'everything' }],
    ['no folders', { kind: 'folders', folders: [], includeDescendants: true }],
    ['relative folder', { kind: 'folders', folders: ['Vault'], includeDescendants: true }],
    ['too many folders', { kind: 'folders', folders: Array.from({ length: 33 }, (_, i) => `/V/${i}`), includeDescendants: false }],
  ])('rejects scope: %s', (_, scope) => {
    expect(() => validateCollectionQuery(base([], scope))).toThrow(CollectionQueryError);
  });

  it('rejects wrong versions, sorts and shapes', () => {
    expect(() => validateCollectionQuery({ ...(base() as object), version: 2 })).toThrow(/version/i);
    expect(() => validateCollectionQuery({ ...(base() as object), sort: { field: 'colour', direction: 'asc' } })).toThrow(/sort/i);
    expect(() => validateCollectionQuery({ ...(base() as object), sort: { field: 'name', direction: 'up' } })).toThrow(/direction/i);
    expect(() => validateCollectionQuery(null)).toThrow(CollectionQueryError);
    expect(() => validateCollectionQuery('query')).toThrow(CollectionQueryError);
  });
});

describe('pages and helpers', () => {
  it('defaults, clamps and rejects pages', () => {
    expect(validateCollectionPage(undefined)).toEqual({ offset: 0, limit: 200 });
    expect(validateCollectionPage({ offset: 40, limit: 5000 })).toEqual({ offset: 40, limit: 1000 });
    expect(() => validateCollectionPage({ offset: -1 })).toThrow(CollectionQueryError);
    expect(() => validateCollectionPage({ limit: 0 })).toThrow(CollectionQueryError);
  });

  it('builds empty and folder-scoped queries', () => {
    const query: CollectionQuery = emptyQuery();
    expect(query).toEqual({ version: 1, scope: { kind: 'all-roots' }, filters: [], sort: { field: 'name', direction: 'asc' } });
    expect(folderScope('/Vault/A/')).toEqual({ kind: 'folders', folders: ['/Vault/A'], includeDescendants: true });
  });

  it('uses local-day boundaries with an exclusive end', () => {
    const midnight = new Date(2026, 8, 6).getTime();
    expect(startOfLocalDay('2026-09-06')).toBe(midnight);
    expect(dayBoundary('before', '2026-09-06')).toBe(midnight);
    expect(dayBoundary('after', '2026-09-06')).toBe(new Date(2026, 8, 7).getTime());
    expect(() => startOfLocalDay('yesterday')).toThrow(CollectionQueryError);
  });

  it('describes chips in plain language', () => {
    expect(describeFilter({ field: 'kind', op: 'in', values: ['pdf', 'image'] })).toBe('Kind is one of PDF, Image');
    expect(describeFilter({ field: 'tags', op: 'has-any', values: ['research', 'reference'] })).toBe('Tags has any of research, reference');
    expect(describeFilter({ field: 'touched', op: 'within', durationMs: 7 * 24 * 3600 * 1000 })).toBe('Last touched past 7 days');
    expect(describeFilter({ field: 'opened', op: 'never' })).toBe('Last opened never');
    expect(describeFilter({ field: 'description', op: 'is-empty' })).toBe('Description is empty');
    expect(describeFilter({ field: 'name', op: 'not-contains', value: 'draft' })).toBe('Name does not contain “draft”');
  });
});
