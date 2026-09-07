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
import { emptyQuery, folderScope } from '@/common/collectionQuery';

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
  service = new CollectionQueryService({ registry, index, activity, now: () => NOW });
});
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

describe('CollectionQueryService', () => {
  it('resolves all roots, joins activity and pages deterministically', async () => {
    const first = await service.query({ ...emptyQuery(), sort: { field: 'touched', direction: 'desc' } }, { limit: 2 });
    expect(first.rows.map((row) => row.entry.name)).toEqual(['b.md', 'a.md']);
    expect(first).toMatchObject({ total: 7, offset: 0, limit: 2, indexState: 'ready', unavailableScopes: [], incomplete: false });
    expect(first.rows[0]).toMatchObject({ touchedKind: 'opened', touchedAt: NOW, openedAt: NOW });
    const second = await service.query({ ...emptyQuery(), sort: { field: 'touched', direction: 'desc' } }, { offset: 2, limit: 2 });
    expect(second.rows.map((row) => row.entry.name)).toEqual(['c.md', 'd.pdf']);
    expect(second.generation).toBe(first.generation);
  });

  it('labels results incomplete when a filter had to skip unreadable metadata', async () => {
    const result = await service.query({ ...emptyQuery(), filters: [{ field: 'tags', op: 'is-empty' }] });
    expect(result.rows.map((row) => row.entry.name)).toEqual(['a.md', 'b.md', 'c.md', 'd.pdf', 'e.pdf.opal.yaml', 'Sub']);
    expect(result.incomplete).toBe(true);
    expect(result.warnings).toEqual([expect.stringMatching(/1 item with unreadable metadata was left out/)]);
    const byName = await service.query({ ...emptyQuery(), filters: [{ field: 'name', op: 'contains', value: 'e.pdf' }] });
    expect(byName.rows.map((row) => row.entry.name)).toEqual(['e.pdf', 'e.pdf.opal.yaml']);
    expect(byName.incomplete).toBe(false);
  });

  it('reports a closed scope instead of searching elsewhere', async () => {
    const other = path.join(tmp, 'other');
    await mkdir(other);
    const result = await service.query(emptyQuery(folderScope(other)));
    expect(result).toMatchObject({ rows: [], total: 0, unavailableScopes: [other] });
    const scoped = await service.query(emptyQuery(folderScope(path.join(root, 'Sub'))));
    expect(scoped.rows.map((row) => row.entry.name)).toEqual(['d.pdf', 'e.pdf', 'e.pdf.opal.yaml']);
    expect(scoped.unavailableScopes).toEqual([]);
  });

  it('rejects invalid queries and pages with plain errors', async () => {
    await expect(service.query({ version: 1 })).rejects.toThrow(/filters/i);
    await expect(service.query({ version: 1, filters: [] })).rejects.toThrow(/scope/i);
    await expect(service.query(emptyQuery(), { limit: 0 })).rejects.toThrow(/page/i);
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
    expect(await invoke(emptyQuery(), {})).toMatchObject({ success: true, data: { total: 7 } });
    expect(await invoke({ version: 3 }, {})).toEqual({ success: false, error: expect.stringMatching(/version/i) });
    const broken = new CollectionQueryService({ registry, index: { state: () => 'ready', get: async () => { throw new Error('boom'); } } as unknown as CollectionIndex, activity });
    new CollectionHandlers({ ipc, service: broken }).registerAll();
    expect(await invoke(emptyQuery(), {})).toEqual({ success: false, error: 'Failed to load the collection' });
  });
});
