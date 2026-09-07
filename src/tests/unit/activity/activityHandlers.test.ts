import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMain } from 'electron';
vi.mock('@/main/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
import { ActivityHandlers } from '@/main/activity/ActivityHandlers';
import type { ActivityService } from '@/main/activity/ActivityService';
import { PathNotAllowedError } from '@/main/fs/RootRegistry';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
function ipcStub() {
  const handlers = new Map<string, Handler>();
  return {
    ipc: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) } as unknown as IpcMain,
    invoke: (channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`Missing ${channel}`);
      return handler({}, ...args);
    },
    channels: () => [...handlers.keys()].sort(),
  };
}

describe('ActivityHandlers', () => {
  let stub: ReturnType<typeof ipcStub>;
  let service: { recordOpened: ReturnType<typeof vi.fn>; recent: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    stub = ipcStub();
    service = {
      recordOpened: vi.fn(async () => undefined),
      recent: vi.fn(async () => ({ items: [], total: 0, truncated: false, warnings: [] })),
      clear: vi.fn(async () => undefined),
    };
    new ActivityHandlers({ ipc: stub.ipc, service: service as unknown as ActivityService }).registerAll();
  });

  it('registers the activity channels', () => {
    expect(stub.channels()).toEqual(['activity:clear', 'activity:recent', 'activity:record']);
  });

  it('accepts only explicit opens from the renderer', async () => {
    expect(await stub.invoke('activity:record', '/V/a.md', 'opened')).toEqual({ success: true });
    expect(service.recordOpened).toHaveBeenCalledWith('/V/a.md');
    expect(await stub.invoke('activity:record', '/V/a.md', 'organized')).toMatchObject({ success: false });
    expect(await stub.invoke('activity:record', '', 'opened')).toMatchObject({ success: false });
    expect(service.recordOpened).toHaveBeenCalledTimes(1);
  });

  it('validates the recent limit and passes it through', async () => {
    expect(await stub.invoke('activity:recent', { limit: 50 })).toMatchObject({ success: true });
    expect(service.recent).toHaveBeenCalledWith({ limit: 50 });
    expect(await stub.invoke('activity:recent', undefined)).toMatchObject({ success: true });
    expect(await stub.invoke('activity:recent', { limit: -1 })).toMatchObject({ success: false });
    expect(await stub.invoke('activity:recent', { limit: 'lots' })).toMatchObject({ success: false });
  });

  it('surfaces allowed-root refusals and hides other failures', async () => {
    service.recordOpened.mockRejectedValueOnce(new PathNotAllowedError('/x'));
    expect(await stub.invoke('activity:record', '/x', 'opened')).toEqual({ success: false, error: expect.stringMatching(/not inside/i) });
    service.recent.mockRejectedValueOnce(new Error('boom'));
    expect(await stub.invoke('activity:recent', {})).toEqual({ success: false, error: 'Failed to load recent activity' });
    expect(await stub.invoke('activity:clear')).toEqual({ success: true });
  });
});
