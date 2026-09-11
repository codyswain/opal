import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import type { IpcMain } from 'electron';
vi.mock('@/main/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
import { ViewHandlers } from '@/main/views/ViewHandlers';
import { ViewRepository } from '@/main/views/ViewRepository';
import { emptyQuery } from '@/common/collectionQuery';

let tmp: string;
let invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
let channels: string[];

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-view-handlers-'));
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
  const ipc = { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler) } as unknown as IpcMain;
  new ViewHandlers({ ipc, repository: new ViewRepository({ libraryDirectory: tmp }) }).registerAll();
  channels = [...handlers.keys()].sort();
  invoke = (channel, ...args) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`Missing ${channel}`);
    return handler({}, ...args);
  };
});
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

describe('ViewHandlers', () => {
  it('registers every view channel', () => {
    expect(channels).toEqual(['views:create', 'views:duplicate', 'views:list', 'views:remove', 'views:restore', 'views:save']);
  });

  it('runs the create, save, conflict, duplicate, remove and restore flow through IPC', async () => {
    const definition = { name: 'Needs tags', layout: 'list', query: { ...emptyQuery(), filters: [{ field: 'tags', op: 'is-empty' }] } };
    const created = await invoke('views:create', definition) as { success: boolean; data: { id: string; revision: string } };
    expect(created.success).toBe(true);
    expect(await invoke('views:list')).toMatchObject({ success: true, data: { views: [{ id: created.data.id, name: 'Needs tags' }], unreadable: [] } });
    const saved = await invoke('views:save', created.data.id, { ...definition, name: 'Untagged' }, created.data.revision) as { data: { revision: string } };
    await writeFile(path.join(tmp, 'views', `${created.data.id}.yaml`), `schema: 1\nid: ${created.data.id}\nname: External\nlayout: gallery\nquery:\n  version: 1\n  scope: { kind: all-roots }\n  filters: []\n  sort: { field: name, direction: asc }\n`);
    expect(await invoke('views:save', created.data.id, definition, saved.data.revision)).toEqual({ success: false, error: expect.stringMatching(/changed on disk/), conflict: true });
    expect(await invoke('views:save', 'nope', definition, 'x')).toEqual({ success: false, error: expect.stringMatching(/Invalid view id/) });
    expect(await invoke('views:create', { ...definition, name: '' })).toEqual({ success: false, error: expect.stringMatching(/1 to 120/) });
    const copy = await invoke('views:duplicate', created.data.id) as { data: { id: string; name: string } };
    expect(copy.data.name).toBe('External copy');
    const removed = await invoke('views:remove', copy.data.id) as { data: { undoToken: string } };
    expect(await invoke('views:list')).toMatchObject({ data: { views: [{ id: created.data.id }] } });
    expect(await invoke('views:restore', removed.data.undoToken)).toMatchObject({ success: true, data: { id: copy.data.id } });
    expect(await invoke('views:restore', 'garbage')).toEqual({ success: false, error: expect.stringMatching(/Nothing to restore/) });
  });
});
