import { describe, it, expect } from 'vitest';
import { BUDGETS } from '@/renderer/shared/perf/marks';
import { sortEntries } from '@/common/sortEntries';
import { filterEntries } from '@/common/filterEntries';
import type { DiskEntry } from '@/types/disk';

function makeEntries(count: number): DiskEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `/V/file-${index}.txt`,
    name: `file-${String(index).padStart(5, '0')}.txt`,
    isDirectory: index % 100 === 0,
    kind: 'text',
    size: index * 13,
    mtimeMs: 1_700_000_000_000 + index,
  })) as DiskEntry[];
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
  const entries = makeEntries(5000);

  it('sorts 5,000 entries by name within the listing budget', () => {
    const elapsed = medianMs(() => sortEntries(entries, 'name', 'asc'));
    expect(elapsed).toBeLessThan(BUDGETS.listingMs);
  });

  it('sorts 5,000 entries by size within the listing budget', () => {
    const elapsed = medianMs(() => sortEntries(entries, 'size', 'desc'));
    expect(elapsed).toBeLessThan(BUDGETS.listingMs);
  });

  it('sorts 5,000 entries by modified date within the listing budget', () => {
    const elapsed = medianMs(() => sortEntries(entries, 'modified', 'desc'));
    expect(elapsed).toBeLessThan(BUDGETS.listingMs);
  });
});

describe('keystroke budget', () => {
  const entries = makeEntries(5000);

  it('filters 5,000 entries within the keystroke budget', () => {
    // Every keystroke in the filter box re-runs this. Exceeding 16ms means
    // dropping a frame per character typed.
    const elapsed = medianMs(() => filterEntries(entries, 'file-4'));
    expect(elapsed).toBeLessThan(BUDGETS.keystrokeMs);
  });

  it('filters with a no-match term within the keystroke budget', () => {
    const elapsed = medianMs(() => filterEntries(entries, 'zzzzz-no-match'));
    expect(elapsed).toBeLessThan(BUDGETS.keystrokeMs);
  });

  it('runs filter then sort — the real per-keystroke path — within budget', () => {
    const elapsed = medianMs(() =>
      sortEntries(filterEntries(entries, 'file-1'), 'name', 'asc')
    );
    expect(elapsed).toBeLessThan(BUDGETS.keystrokeMs * 4);
  });
});
