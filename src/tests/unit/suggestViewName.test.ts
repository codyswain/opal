import { describe, expect, it } from 'vitest';
import { DURATION_PRESETS, emptyQuery, folderScope, suggestViewName } from '@/common/collectionQuery';
import type { CollectionQuery } from '@/types/collectionQuery';

const query = (over: Partial<CollectionQuery>): CollectionQuery => ({ ...emptyQuery(), ...over });

describe('suggestViewName', () => {
  it('is empty when nothing narrows the query', () => {
    expect(suggestViewName(emptyQuery())).toBe('');
  });

  it('names by kind, tags, name, time and scope in a readable order', () => {
    expect(suggestViewName(query({ filters: [{ field: 'kind', op: 'in', values: ['pdf'] }] }))).toBe('PDFs');
    expect(suggestViewName(query({
      scope: folderScope('/Vault/Projects'),
      filters: [
        { field: 'kind', op: 'in', values: ['pdf', 'image'] },
        { field: 'tags', op: 'has-any', values: ['research', 'maps'] },
        { field: 'modified', op: 'within', durationMs: DURATION_PRESETS[0].ms },
      ],
    }))).toBe(`PDFs and Images tagged research, maps modified ${DURATION_PRESETS[0].label} in Projects`);
    expect(suggestViewName(query({ filters: [{ field: 'tags', op: 'has-all', values: ['a', 'b'] }] }))).toBe('Items tagged a and b');
    expect(suggestViewName(query({ filters: [{ field: 'name', op: 'contains', value: 'atlas' }] }))).toBe('Items named “atlas”');
    expect(suggestViewName(query({ scope: folderScope('/Vault/Reading') }))).toBe('Everything in Reading');
  });

  it('ignores filters that cannot name anything and stays within the name limit', () => {
    expect(suggestViewName(query({ filters: [{ field: 'tags', op: 'is-empty' }] }))).toBe('');
    const long = suggestViewName(query({ filters: [{ field: 'name', op: 'contains', value: 'x'.repeat(200) }] }));
    expect(long.length).toBeLessThanOrEqual(120);
  });
});
