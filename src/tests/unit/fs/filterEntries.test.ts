import { describe, it, expect } from 'vitest';
import { filterEntries } from '@/common/filterEntries';
import type { DiskEntry } from '@/types/disk';

function make(name: string): DiskEntry {
  return {
    path: `/V/${name}`,
    name,
    kind: 'other',
    isDirectory: false,
    size: 0,
    mtimeMs: 0,
  } as DiskEntry;
}

const ENTRIES = ['IMG_2041.jpg', 'IMG_2042.jpg', 'notes.md', 'Rwanda Trip.pdf'].map(make);
const names = (entries: DiskEntry[]) => entries.map((entry) => entry.name);

describe('filterEntries', () => {
  it('returns everything for an empty query', () => {
    expect(filterEntries(ENTRIES, '')).toHaveLength(4);
    expect(filterEntries(ENTRIES, '   ')).toHaveLength(4);
  });

  it('matches a substring, case-insensitively', () => {
    expect(names(filterEntries(ENTRIES, 'img'))).toEqual(['IMG_2041.jpg', 'IMG_2042.jpg']);
    expect(names(filterEntries(ENTRIES, 'RWANDA'))).toEqual(['Rwanda Trip.pdf']);
  });

  it('matches on extension', () => {
    expect(names(filterEntries(ENTRIES, '.md'))).toEqual(['notes.md']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterEntries(ENTRIES, 'zzzz')).toEqual([]);
  });

  it('ignores surrounding whitespace in the query', () => {
    expect(names(filterEntries(ENTRIES, '  notes  '))).toEqual(['notes.md']);
  });

  it('treats the query literally, not as a regex', () => {
    // A user typing '.' or '*' must not blow up or match everything.
    expect(() => filterEntries(ENTRIES, '*')).not.toThrow();
    expect(filterEntries(ENTRIES, '*')).toEqual([]);
    expect(names(filterEntries(ENTRIES, '.'))).toHaveLength(4);
  });

  it('does not mutate its input', () => {
    const original = [...ENTRIES];
    filterEntries(ENTRIES, 'img');
    expect(ENTRIES).toEqual(original);
  });
});
