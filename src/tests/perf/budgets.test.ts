import { describe, it, expect } from 'vitest';
import { BUDGETS } from '@/renderer/shared/perf/marks';
import { flattenFileTree } from '@/renderer/features/shell/utils/flattenFileTree';
import { evaluateCollectionQuery } from '@/main/collections/evaluateQuery';
import type { IndexedItem } from '@/main/collections/CollectionIndex';
import type { CollectionQuery } from '@/types/collectionQuery';
import type { DiskEntry } from '@/types/disk';

const ROOT = '/V';

function makeEntries(count: number): DiskEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `${ROOT}/file-${index}.txt`,
    name: `file-${String(index).padStart(5, '0')}.txt`,
    isDirectory: false,
    kind: 'text',
    size: index * 13,
    mtimeMs: 1_700_000_000_000 + index,
  })) as DiskEntry[];
}

function makeItems(count: number): IndexedItem[] {
  return makeEntries(count).map((entry) => ({ ...entry, id: null, title: null }));
}

/** Median of several runs — a single timing on a shared CI runner is noise. */
function medianMs(run: () => void, iterations = 7): number {
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

describe('budget table', () => {
  it('declares every budget the design approved', () => {
    expect(BUDGETS.coldLaunchMs).toBe(400);
    expect(BUDGETS.routeSwitchMs).toBe(50);
    expect(BUDGETS.listingMs).toBe(150);
    expect(BUDGETS.keystrokeMs).toBe(16);
  });
});

describe('listing budget', () => {
  it('lays out a 5,000-entry folder in the sidebar tree within the listing budget', () => {
    const listings = { [ROOT]: makeEntries(5000) };
    const elapsed = medianMs(() => flattenFileTree({ roots: [ROOT], listings, expanded: {} }));
    expect(elapsed).toBeLessThan(BUDGETS.listingMs);
  });
});

describe('keystroke budget', () => {
  const items = makeItems(5000);
  const search = (value: string): CollectionQuery => ({
    version: 1,
    scope: { kind: 'all-roots' },
    filters: [{ field: 'name', op: 'contains', value }],
    sort: { field: 'touched', direction: 'desc' },
  });

  it('searches 5,000 file names within the keystroke budget', () => {
    // The palette runs this search as the name is typed. Exceeding 16ms means
    // dropping a frame per character.
    const elapsed = medianMs(() =>
      evaluateCollectionQuery({
        items,
        activity: () => null,
        touchedAt: () => 0,
        allowedRoots: [ROOT],
        query: search('file-4'),
      })
    );
    expect(elapsed).toBeLessThan(BUDGETS.keystrokeMs);
  });

  it('ranks 5,000 file names, paths and titles within the keystroke budget', () => {
    // Date-prefixed names in nested folders, some with a title, like a vault's.
    const vault = items.map((entry, index) => ({
      ...entry,
      path: `${ROOT}/Library/folder-${index % 40}/sub ${index % 7}/2026-10-${String(index % 28).padStart(2, '0')} note ${index}.md`,
      name: `2026-10-${String(index % 28).padStart(2, '0')} note ${index}.md`,
      kind: 'markdown' as const,
      title: index % 3 === 0 ? `Meeting about topic ${index}` : null,
    }));
    const elapsed = medianMs(() =>
      evaluateCollectionQuery({
        items: vault,
        activity: () => null,
        touchedAt: () => 0,
        allowedRoots: [ROOT],
        query: { ...search('ignored'), filters: [{ field: 'name', op: 'matches', value: 'topic 12 meeting' }], sort: { field: 'match', direction: 'desc' } },
      })
    );
    expect(elapsed).toBeLessThan(BUDGETS.keystrokeMs);
  });
});
