import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, rename, readFile } from 'fs/promises';
import os from 'os';
import path from 'path';
vi.mock('@/main/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
import { ActivityService } from '@/main/activity/ActivityService';
import { ActivityStore } from '@/main/activity/ActivityStore';
import { DiskReader } from '@/main/fs/DiskReader';
import { MetadataService } from '@/main/fs/MetadataService';
import { RootRegistry } from '@/main/fs/RootRegistry';

let tmp: string; let root: string; let other: string;
let registry: RootRegistry; let store: ActivityStore; let service: ActivityService;
let now = 1_000_000;
const onChanged = vi.fn();
const item = (name: string) => path.join(root, name);

beforeEach(async () => {
  vi.useFakeTimers();
  now = 1_000_000;
  onChanged.mockClear();
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-activity-service-'));
  root = path.join(tmp, 'root'); other = path.join(tmp, 'other');
  await mkdir(root); await mkdir(other);
  await writeFile(item('a.md'), '# a'); await writeFile(item('b.pdf'), 'pdf'); await mkdir(item('Folder'));
  await writeFile(path.join(other, 'outside.md'), '# out');
  registry = new RootRegistry({ storePath: path.join(tmp, 'roots.json') });
  root = await registry.add(root);
  store = new ActivityStore({ storePath: path.join(tmp, 'library', 'activity.json'), now: () => now });
  await store.load();
  const reader = new DiskReader({ registry });
  service = new ActivityService({ registry, store, statEntry: (target) => reader.statEntry(target), onChanged, changeDebounceMs: 100 });
});
afterEach(async () => { vi.useRealTimers(); await rm(tmp, { recursive: true, force: true }); });

describe('ActivityService', () => {
  it('records explicit opens inside opened roots and refuses everything else', async () => {
    await service.recordOpened(item('a.md'));
    expect(store.get(item('a.md'))?.openedAt).toBe(1_000_000);
    await expect(service.recordOpened(path.join(other, 'outside.md'))).rejects.toThrow(/not inside any folder/i);
    await expect(service.recordOpened(item('missing.md'))).rejects.toThrow();
    expect(store.list()).toHaveLength(1);
  });

  it('captures an existing UUID without allocating one', async () => {
    const metadata = new MetadataService({ registry });
    const saved = await metadata.saveProperties(item('a.md'), { tags: ['x'], description: '' }, (await metadata.read(item('a.md'))).revision);
    await service.recordOpened(item('a.md'));
    await service.recordOpened(item('b.pdf'));
    expect(store.get(item('a.md'))?.id).toBe(saved.id);
    expect(store.get(item('b.pdf'))?.id).toBeNull();
    expect((await metadata.read(item('b.pdf'))).id).toBeNull();
  });

  it('lists recent items newest first with deterministic tie-breaks and readable reasons', async () => {
    await service.recordOpened(item('b.pdf'));
    now += 60_000; await service.recordOpened(item('a.md'));
    now += 10_000; await service.recordOpened(item('a.md')); // within 30 s: coalesced, timestamp unchanged
    now += 50_000; await service.noteOrganized(item('Folder'));
    const result = await service.recent();
    expect(result.items.map((row) => [row.entry.name, row.touchedKind, row.touchedAt])).toEqual([
      ['Folder', 'organized', 1_120_000], ['a.md', 'opened', 1_060_000], ['b.pdf', 'opened', 1_000_000],
    ]);
    expect(result.items[0].entry.isDirectory).toBe(true);
    expect(result).toMatchObject({ total: 3, truncated: false, warnings: [] });
    // Equal timestamps fall back to case-insensitive name order, never folders first.
    await service.noteOrganized(item('b.pdf'));
    expect((await service.recent()).items.map((row) => row.entry.name)).toEqual(['b.pdf', 'Folder', 'a.md']);
  });

  it('applies and caps the limit', async () => {
    for (const name of ['a.md', 'b.pdf', 'Folder']) { await service.recordOpened(item(name)); now += 60_000; }
    const limited = await service.recent({ limit: 2 });
    expect(limited.items).toHaveLength(2);
    expect(limited.truncated).toBe(true);
    const capped = await service.recent({ limit: 5000 });
    expect(capped.items).toHaveLength(3);
  });

  it('omits missing items and items in closed roots without deleting their records', async () => {
    await service.recordOpened(item('a.md'));
    await service.recordOpened(item('b.pdf'));
    await rm(item('b.pdf'));
    expect((await service.recent()).items.map((row) => row.entry.name)).toEqual(['a.md']);
    await registry.remove(root);
    expect((await service.recent()).items).toEqual([]);
    expect(store.list()).toHaveLength(2);
  });

  it('drops a record whose annotated item was replaced by a different identity, and keeps duplicate copies separate', async () => {
    const metadata = new MetadataService({ registry });
    await metadata.saveProperties(item('b.pdf'), { tags: [], description: 'd' }, (await metadata.read(item('b.pdf'))).revision);
    await service.recordOpened(item('b.pdf'));
    // Copy the pair: same UUID in two places is two rows, never merged.
    await writeFile(item('copy.pdf'), 'pdf');
    await writeFile(item('copy.pdf.opal.yaml'), await readFile(item('b.pdf.opal.yaml'), 'utf8'));
    now += 60_000; await service.recordOpened(item('copy.pdf'));
    expect((await service.recent()).items.map((row) => row.entry.name)).toEqual(['copy.pdf', 'b.pdf']);
    // Replace b.pdf's carrier with a different identity.
    await rm(item('b.pdf.opal.yaml'));
    await writeFile(item('b.pdf.opal.yaml'), 'schema: 1\nid: 00000000-0000-4000-8000-000000000000\n');
    expect((await service.recent()).items.map((row) => row.entry.name)).toEqual(['copy.pdf']);
  });

  it('remaps on move, records organized at the new path, removes on trash, and never throws from recorder methods', async () => {
    await service.recordOpened(item('Folder'));
    await mkdir(item('Folder/Inner')); await writeFile(item('Folder/Inner/c.md'), '# c');
    await service.recordOpened(item('Folder/Inner/c.md'));
    now += 60_000;
    await rename(item('Folder'), item('Renamed'));
    await service.noteMoved(item('Folder'), item('Renamed'));
    expect(store.get(item('Renamed'))?.organizedAt).toBe(1_060_000);
    expect(store.get(item('Renamed/Inner/c.md'))?.openedAt).toBe(1_000_000);
    expect(store.get(item('Folder'))).toBeNull();
    await service.noteRemoved(item('Renamed/Inner'));
    expect(store.get(item('Renamed/Inner/c.md'))).toBeNull();
    await expect(service.noteOrganized(path.join(other, 'outside.md'))).resolves.toBeUndefined();
    await expect(service.noteOrganized(item('nope.md'))).resolves.toBeUndefined();
    expect(store.list().map((record) => record.path)).toEqual([item('Renamed')]);
  });

  it('clears activity and reports store warnings in results', async () => {
    await service.recordOpened(item('a.md'));
    await service.clear();
    expect((await service.recent()).items).toEqual([]);
    const failing = new ActivityStore({ storePath: path.join(tmp, 'library', 'activity.json'), now: () => now, writeFile: async () => { throw new Error('disk full'); } });
    await failing.load();
    const reader = new DiskReader({ registry });
    const broken = new ActivityService({ registry, store: failing, statEntry: (target) => reader.statEntry(target) });
    await broken.recordOpened(item('a.md'));
    expect((await broken.recent()).warnings).toEqual([expect.stringMatching(/disk full/)]);
  });

  it('coalesces change notifications', async () => {
    await service.recordOpened(item('a.md'));
    now += 60_000; await service.recordOpened(item('b.pdf'));
    expect(onChanged).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
