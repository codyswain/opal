import { describe, it, expect } from 'vitest';
import { sortEntries } from '@/common/sortEntries';
import type { DiskEntry } from '@/types/disk';

function make(over: Partial<DiskEntry> & { name: string }): DiskEntry {
  return {
    path: `/V/${over.name}`,
    kind: 'other',
    isDirectory: false,
    size: 0,
    mtimeMs: 0,
    ...over,
  } as DiskEntry;
}

const ENTRIES: DiskEntry[] = [
  make({ name: 'banana.txt', size: 300, mtimeMs: 200, kind: 'text' }),
  make({ name: 'Apple.jpg', size: 100, mtimeMs: 300, kind: 'image' }),
  make({
    name: 'Zebra',
    isDirectory: true,
    kind: 'directory',
    size: 0,
    mtimeMs: 100,
  }),
  make({ name: 'cherry.md', size: 200, mtimeMs: 400, kind: 'markdown' }),
];

const names = (entries: DiskEntry[]) => entries.map((entry) => entry.name);

describe('sortEntries', () => {
  it('always puts directories first, whatever the field', () => {
    for (const field of ['name', 'modified', 'size', 'kind'] as const) {
      for (const direction of ['asc', 'desc'] as const) {
        expect(sortEntries(ENTRIES, field, direction)[0].name).toBe('Zebra');
      }
    }
  });

  it('sorts by name case-insensitively', () => {
    expect(names(sortEntries(ENTRIES, 'name', 'asc'))).toEqual([
      'Zebra',
      'Apple.jpg',
      'banana.txt',
      'cherry.md',
    ]);
  });

  it('reverses on desc', () => {
    expect(names(sortEntries(ENTRIES, 'name', 'desc'))).toEqual([
      'Zebra',
      'cherry.md',
      'banana.txt',
      'Apple.jpg',
    ]);
  });

  it('sorts by modified time, newest first on desc', () => {
    expect(names(sortEntries(ENTRIES, 'modified', 'desc'))).toEqual([
      'Zebra',
      'cherry.md',
      'Apple.jpg',
      'banana.txt',
    ]);
  });

  it('sorts by size', () => {
    expect(names(sortEntries(ENTRIES, 'size', 'asc'))).toEqual([
      'Zebra',
      'Apple.jpg',
      'cherry.md',
      'banana.txt',
    ]);
  });

  it('sorts by kind, then name within a kind', () => {
    const sorted = sortEntries(
      [
        make({ name: 'b.jpg', kind: 'image' }),
        make({ name: 'a.jpg', kind: 'image' }),
        make({ name: 'c.md', kind: 'markdown' }),
      ],
      'kind',
      'asc'
    );
    expect(names(sorted)).toEqual(['a.jpg', 'b.jpg', 'c.md']);
  });

  it('does not mutate its input', () => {
    const original = [...ENTRIES];
    sortEntries(ENTRIES, 'name', 'desc');
    expect(ENTRIES).toEqual(original);
  });

  it('is stable for equal keys', () => {
    const equal = [
      make({ name: 'a', size: 5 }),
      make({ name: 'b', size: 5 }),
      make({ name: 'c', size: 5 }),
    ];
    expect(names(sortEntries(equal, 'size', 'asc'))).toEqual(['a', 'b', 'c']);
  });

  it('handles an empty list', () => {
    expect(sortEntries([], 'name', 'asc')).toEqual([]);
  });
});
