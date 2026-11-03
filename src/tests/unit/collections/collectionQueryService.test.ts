import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import type { IpcMain } from 'electron';
vi.mock('@/main/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
import { ActivityStore } from '@/main/activity/ActivityStore';
import { CollectionHandlers } from '@/main/collections/CollectionHandlers';
import { CollectionIndex } from '@/main/collections/CollectionIndex';
import { CollectionQueryService } from '@/main/collections/CollectionQueryService';
import { RootRegistry } from '@/main/fs/RootRegistry';
import type { CollectionQuery } from '@/types/collectionQuery';

const everything = (sort: CollectionQuery['sort'] = { field: 'name', direction: 'asc' }): CollectionQuery =>
  ({ version: 1, scope: { kind: 'all-roots' }, filters: [], sort });

let tmp: string;
let root: string;
let registry: RootRegistry;
let service: CollectionQueryService;
let activity: ActivityStore;
const NOW = 1_800_000_000_000;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-query-service-'));
  root = path.join(tmp, 'root');
  await mkdir(path.join(root, 'Sub'), { recursive: true });
  for (const name of ['a.md', 'b.md', 'c.md']) await writeFile(path.join(root, name), `# ${name}`);
  await writeFile(path.join(root, 'Sub', 'd.pdf'), 'pdf');
  await writeFile(path.join(root, 'Sub', 'e.pdf'), 'pdf');
  await writeFile(path.join(root, 'Sub', 'e.pdf.opal.yaml'), 'tags: [nope');
  registry = new RootRegistry({ storePath: path.join(tmp, 'roots.json') });
  root = await registry.add(root);
  activity = new ActivityStore({ storePath: path.join(tmp, 'activity.json'), now: () => NOW });
  await activity.load();
  await activity.touch(path.join(root, 'b.md'), 'opened', null);
  const index = new CollectionIndex({ registry, updateDebounceMs: 0 });
  service = new CollectionQueryService({ registry, index, activity });
});
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

describe('CollectionQueryService', () => {
  it('searches all roots, joins activity and pages deterministically', async () => {
    const first = await service.query(everything({ field: 'touched', direction: 'desc' }), { limit: 2 });
    expect(first.rows.map((row) => row.entry.name)).toEqual(['b.md', 'a.md']);
    expect(first).toMatchObject({ total: 7, offset: 0, limit: 2, warnings: [] });
    expect(first.rows[0]).toMatchObject({ touchedAt: NOW });
    const second = await service.query(everything({ field: 'touched', direction: 'desc' }), { offset: 2, limit: 2 });
    expect(second.rows.map((row) => row.entry.name)).toEqual(['c.md', 'd.pdf']);
  });

  it('finds files by name, folders left out, whatever their metadata', async () => {
    const result = await service.query({
      ...everything(),
      filters: [
        { field: 'name', op: 'contains', value: 'e' },
        { field: 'kind', op: 'not-in', values: ['directory'] },
      ],
    });
    expect(result.rows.map((row) => row.entry.name)).toEqual(['e.pdf', 'e.pdf.opal.yaml']);
  });

  it('rejects invalid queries and pages with plain errors', async () => {
    await expect(service.query({ version: 1 })).rejects.toThrow(/filters/i);
    await expect(service.query({ version: 1, filters: [] })).rejects.toThrow(/scope/i);
    await expect(service.query(everything(), { limit: 0 })).rejects.toThrow(/page/i);
  });
});

describe('CollectionHandlers', () => {
  it('registers the query channel and translates failures', async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
    const ipc = { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler) } as unknown as IpcMain;
    new CollectionHandlers({ ipc, service }).registerAll();
    expect([...handlers.keys()]).toEqual(['collections:query']);
    const invoke = (...args: unknown[]) => {
      const handler = handlers.get('collections:query');
      if (!handler) throw new Error('missing handler');
      return handler({}, ...args);
    };
    expect(await invoke(everything(), {})).toMatchObject({ success: true, data: { total: 7 } });
    expect(await invoke({ version: 3 }, {})).toEqual({ success: false, error: expect.stringMatching(/version/i) });
    const broken = new CollectionQueryService({ registry, index: { get: async () => { throw new Error('boom'); } } as unknown as CollectionIndex, activity });
    new CollectionHandlers({ ipc, service: broken }).registerAll();
    expect(await invoke(everything(), {})).toEqual({ success: false, error: 'Failed to load the collection' });
  });
});
