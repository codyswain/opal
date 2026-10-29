import { describe, expect, it } from 'vitest';
import {
  CollectionQueryError,
  validateCollectionPage,
  validateCollectionQuery,
} from '@/common/collectionQuery';
import type { CollectionFilter } from '@/types/collectionQuery';

const base = (filters: unknown[] = [], scope: unknown = { kind: 'all-roots' }): unknown => ({
  version: 1,
  scope,
  filters,
  sort: { field: 'touched', direction: 'desc' },
});

describe('validateCollectionQuery', () => {
  it('accepts the palette search and normalizes it', () => {
    const query = validateCollectionQuery(base([
      { field: 'name', op: 'contains', value: '  Atlas (v2)* ' },
      { field: 'kind', op: 'not-in', values: ['directory', 'directory'] },
    ]));
    expect(query).toEqual({
      version: 1,
      scope: { kind: 'all-roots' },
      filters: [
        { field: 'name', op: 'contains', value: 'Atlas (v2)*' },
        { field: 'kind', op: 'not-in', values: ['directory'] },
      ],
      sort: { field: 'touched', direction: 'desc' },
    });
  });

  it('accepts every supported filter shape', () => {
    const filters: CollectionFilter[] = [
      { field: 'kind', op: 'in', values: ['pdf', 'image'] },
      { field: 'name', op: 'not-contains', value: 'draft' },
    ];
    expect(validateCollectionQuery(base(filters)).filters).toEqual(filters);
  });

  it.each([
    ['unknown field', [{ field: 'tags', op: 'is-empty' }]],
    ['unknown op', [{ field: 'name', op: 'matches', value: 'x' }]],
    ['empty name', [{ field: 'name', op: 'contains', value: '   ' }]],
    ['long name', [{ field: 'name', op: 'contains', value: 'x'.repeat(257) }]],
    ['unknown kind', [{ field: 'kind', op: 'in', values: ['spreadsheet'] }]],
    ['no kinds', [{ field: 'kind', op: 'in', values: [] }]],
    ['too many filters', Array.from({ length: 17 }, () => ({ field: 'name', op: 'contains', value: 'a' }))],
  ])('rejects %s', (_, filters) => {
    expect(() => validateCollectionQuery(base(filters))).toThrow(CollectionQueryError);
  });

  it('searches every opened folder and nothing narrower', () => {
    expect(() =>
      validateCollectionQuery(base([], { kind: 'folders', folders: ['/etc'], includeDescendants: true }))
    ).toThrow(/scope/i);
  });

  it('rejects wrong versions, sorts and shapes', () => {
    expect(() => validateCollectionQuery({ ...(base() as object), version: 2 })).toThrow(/version/i);
    expect(() => validateCollectionQuery({ ...(base() as object), sort: { field: 'size', direction: 'asc' } })).toThrow(/sort/i);
    expect(() => validateCollectionQuery({ ...(base() as object), sort: { field: 'name', direction: 'up' } })).toThrow(/direction/i);
    expect(() => validateCollectionQuery(null)).toThrow(CollectionQueryError);
    expect(() => validateCollectionQuery('query')).toThrow(CollectionQueryError);
  });
});

describe('validateCollectionPage', () => {
  it('defaults, clamps and rejects pages', () => {
    expect(validateCollectionPage(undefined)).toEqual({ offset: 0, limit: 200 });
    expect(validateCollectionPage({ offset: 40, limit: 5000 })).toEqual({ offset: 40, limit: 1000 });
    expect(() => validateCollectionPage({ offset: -1 })).toThrow(CollectionQueryError);
    expect(() => validateCollectionPage({ limit: 0 })).toThrow(CollectionQueryError);
  });
});
