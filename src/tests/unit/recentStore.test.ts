import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRecentStore } from '@/renderer/features/disk-explorer/store/recentStore';
import { recordOpened } from '@/renderer/features/disk-explorer/activity/recordActivity';
import { installActivityApi, recentItem, recentResult } from '@/tests/helpers/activityApi';

beforeEach(() => {
  useRecentStore.getState().reset();
});

describe('recentStore', () => {
  it('loads results and clears errors', async () => {
    installActivityApi({
      recent: vi.fn(async () => ({
        success: true as const,
        data: recentResult([recentItem({ entry: { path: '/V/a.md', name: 'a.md' } })]),
      })),
    });
    useRecentStore.setState({ error: 'old' });
    await useRecentStore.getState().load();
    expect(useRecentStore.getState().result?.items.map((row) => row.entry.path)).toEqual(['/V/a.md']);
    expect(useRecentStore.getState()).toMatchObject({ loading: false, error: null });
  });

  it('reports failures without discarding the last good result', async () => {
    installActivityApi({ recent: vi.fn(async () => ({ success: false as const, error: 'nope' })) });
    useRecentStore.setState({ result: recentResult() });
    await useRecentStore.getState().load();
    expect(useRecentStore.getState()).toMatchObject({ error: 'nope', result: recentResult(), loading: false });
  });

  it('ignores a stale response that resolves after a newer request', async () => {
    let resolveFirst!: (value: unknown) => void;
    const first = new Promise((resolve) => { resolveFirst = resolve; });
    const recent = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(async () => ({
        success: true as const,
        data: recentResult([recentItem({ entry: { path: '/V/new.md', name: 'new.md' } })]),
      }));
    installActivityApi({ recent });
    const pending = useRecentStore.getState().load();
    await useRecentStore.getState().load();
    resolveFirst({ success: true, data: recentResult([recentItem({ entry: { path: '/V/old.md', name: 'old.md' } })]) });
    await pending;
    expect(useRecentStore.getState().result?.items[0].entry.path).toBe('/V/new.md');
  });

  it('clear asks main and reloads', async () => {
    const api = installActivityApi();
    await useRecentStore.getState().clear();
    expect(api.clear).toHaveBeenCalled();
    expect(api.recent).toHaveBeenCalled();
  });
});

describe('recordOpened', () => {
  it('forwards explicit opens and tolerates a missing bridge', () => {
    const api = installActivityApi();
    recordOpened('/V/a.md');
    expect(api.record).toHaveBeenCalledWith('/V/a.md', 'opened');
    delete (window as unknown as { activityAPI?: unknown }).activityAPI;
    expect(() => recordOpened('/V/a.md')).not.toThrow();
  });
});
