import { vi } from 'vitest';
import type { ActivityAPI } from '@/renderer/shared/types/activityApi';
import type { DiskEntry } from '@/types/disk';
import type { RecentItem, RecentResult } from '@/types/activity';
import { entry } from './diskApi';

type EntryInput = Partial<DiskEntry> & { path: string; name: string };

export function recentItem(over: Partial<Omit<RecentItem, 'entry'>> & { entry: EntryInput }): RecentItem {
  return {
    touchedAt: 1_000_000,
    touchedKind: 'opened',
    openedAt: 1_000_000,
    organizedAt: null,
    editedAt: null,
    ...over,
    entry: entry(over.entry),
  };
}

export function recentResult(items: RecentItem[] = [], over: Partial<RecentResult> = {}): RecentResult {
  return { items, total: items.length, truncated: false, warnings: [], ...over };
}

/** Installs a fake activityAPI on the real `window`; see installDiskApi for why. */
export function installActivityApi(overrides: Partial<ActivityAPI> = {}): ActivityAPI {
  const api: ActivityAPI = {
    record: vi.fn(async () => ({ success: true as const, data: undefined })),
    recent: vi.fn(async () => ({ success: true as const, data: recentResult() })),
    clear: vi.fn(async () => ({ success: true as const, data: undefined })),
    onChanged: vi.fn(() => () => undefined),
    ...overrides,
  };
  (window as unknown as { activityAPI: ActivityAPI }).activityAPI = api;
  return api;
}
