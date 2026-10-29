import { vi } from 'vitest';
import type { CollectionsAPI } from '@/renderer/shared/types/collectionsApi';
import type { DiskEntry } from '@/types/disk';
import type { CollectionQueryResult, CollectionRow } from '@/types/collectionQuery';
import { entry } from './diskApi';

type EntryInput = Partial<DiskEntry> & { path: string; name: string };

export function collectionRow(over: Partial<Omit<CollectionRow, 'entry'>> & { entry: EntryInput }): CollectionRow {
  return {
    touchedAt: null,
    ...over,
    entry: entry(over.entry),
  };
}

export function collectionResult(rows: CollectionRow[] = [], over: Partial<CollectionQueryResult> = {}): CollectionQueryResult {
  return {
    rows,
    total: rows.length,
    offset: 0,
    limit: 200,
    warnings: [],
    ...over,
  };
}

/** Installs a fake collectionsAPI on the real `window`; see installDiskApi for why. */
export function installCollectionsApi(overrides: Partial<CollectionsAPI> = {}): CollectionsAPI {
  const api: CollectionsAPI = {
    query: vi.fn(async () => ({ success: true as const, data: collectionResult() })),
    ...overrides,
  };
  (window as unknown as { collectionsAPI: CollectionsAPI }).collectionsAPI = api;
  return api;
}
