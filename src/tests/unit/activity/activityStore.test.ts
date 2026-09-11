import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'fs/promises';
import os from 'os';
import path from 'path';
import { ActivityStore } from '@/main/activity/ActivityStore';

let tmp: string;
let storePath: string;
let now = 1_000_000;
const clock = () => now;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-activity-'));
  storePath = path.join(tmp, 'library', 'activity.json');
  now = 1_000_000;
});
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

async function fresh(limit = 2000) {
  const store = new ActivityStore({ storePath, now: clock, limit });
  await store.load();
  return store;
}

describe('ActivityStore', () => {
  it('starts empty when the file is missing and creates the directory on first write', async () => {
    const store = await fresh();
    expect(store.list()).toEqual([]);
    expect(await store.touch('/V/a.md', 'opened', null)).toBe(true);
    const parsed = JSON.parse(await readFile(storePath, 'utf8'));
    expect(parsed).toEqual({ version: 1, items: [{ path: '/V/a.md', id: null, openedAt: 1_000_000, organizedAt: null, editedAt: null }] });
  });

  it('reloads records in a fresh instance', async () => {
    const store = await fresh();
    await store.touch('/V/a.md', 'opened', 'id-a');
    now += 5_000;
    await store.touch('/V/a.md', 'organized', 'id-a');
    const again = await fresh();
    expect(again.get('/V/a.md')).toEqual({ path: '/V/a.md', id: 'id-a', openedAt: 1_000_000, organizedAt: 1_005_000, editedAt: null });
  });

  it('coalesces repeated opens within 30 seconds without rewriting', async () => {
    const store = await fresh();
    await store.touch('/V/a.md', 'opened', null);
    now += 29_000;
    expect(await store.touch('/V/a.md', 'opened', null)).toBe(false);
    expect(store.get('/V/a.md')?.openedAt).toBe(1_000_000);
    now += 2_000;
    expect(await store.touch('/V/a.md', 'opened', null)).toBe(true);
    expect(store.get('/V/a.md')?.openedAt).toBe(1_031_000);
  });

  it('updates the id when a later touch supplies one, and keeps it when a later touch cannot read one', async () => {
    const store = await fresh();
    await store.touch('/V/a.md', 'opened', null);
    now += 60_000;
    await store.touch('/V/a.md', 'organized', 'id-a');
    expect(store.get('/V/a.md')?.id).toBe('id-a');
    now += 60_000;
    await store.touch('/V/a.md', 'opened', null);
    expect(store.get('/V/a.md')?.id).toBe('id-a');
  });

  it('evicts the least recently touched record beyond the limit', async () => {
    const store = await fresh(2);
    await store.touch('/V/a', 'opened', null);
    now += 60_000; await store.touch('/V/b', 'opened', null);
    now += 60_000; await store.touch('/V/c', 'opened', null);
    expect(store.list().map((record) => record.path).sort()).toEqual(['/V/b', '/V/c']);
  });

  it('remaps a file and a whole directory subtree', async () => {
    const store = await fresh();
    await store.touch('/V/Old/a.md', 'opened', 'id-a');
    await store.touch('/V/Old/Deep/b.png', 'opened', null);
    await store.touch('/V/Other/c.md', 'opened', null);
    expect(await store.remap('/V/Old', '/V/New')).toBe(true);
    expect(store.list().map((record) => record.path).sort()).toEqual(['/V/New/Deep/b.png', '/V/New/a.md', '/V/Other/c.md']);
    expect(store.get('/V/New/a.md')?.id).toBe('id-a');
    expect(await store.remap('/V/Missing', '/V/Elsewhere')).toBe(false);
  });

  it('removes subtrees and clears everything', async () => {
    const store = await fresh();
    await store.touch('/V/Old/a.md', 'opened', null);
    await store.touch('/V/Old-2/b.md', 'opened', null);
    expect(await store.remove(['/V/Old'])).toBe(true);
    expect(store.list().map((record) => record.path)).toEqual(['/V/Old-2/b.md']);
    expect(await store.clear()).toBe(true);
    expect(store.list()).toEqual([]);
    expect(await store.clear()).toBe(false);
    expect(JSON.parse(await readFile(storePath, 'utf8'))).toEqual({ version: 1, items: [] });
  });

  it('preserves an unreadable file aside, starts empty and reports a warning', async () => {
    await mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(storePath, '{ not json');
    const store = await fresh();
    expect(store.list()).toEqual([]);
    expect(store.warnings()).toEqual([expect.stringMatching(/could not be read/i)]);
    const files = await readdir(path.dirname(storePath));
    expect(files.some((name) => name.startsWith('activity.json.invalid-'))).toBe(true);
    // A later successful write does not hide that earlier history was set aside.
    await store.touch('/V/a.md', 'opened', null);
    expect(store.warnings()).toEqual([expect.stringMatching(/could not be read/i)]);
    expect(JSON.parse(await readFile(storePath, 'utf8')).items).toHaveLength(1);
  });

  it('keeps the in-memory change and reports a persistence failure without throwing', async () => {
    await mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(storePath, '{"version":1,"items":[]}');
    const store = new ActivityStore({ storePath, now: clock, writeFile: async () => { throw new Error('disk full'); } });
    await store.load();
    expect(await store.touch('/V/a.md', 'opened', null)).toBe(true);
    expect(store.get('/V/a.md')).not.toBeNull();
    expect(store.warnings()).toEqual([expect.stringMatching(/disk full/)]);
  });

  it('derives touchedAt and touchedKind, preferring organized over opened on ties', () => {
    const store = new ActivityStore({ storePath, now: clock });
    expect(store.touchedKind({ path: '/x', id: null, openedAt: 5, organizedAt: 5, editedAt: null })).toBe('organized');
    expect(store.touchedAt({ path: '/x', id: null, openedAt: 5, organizedAt: 9, editedAt: 7 })).toBe(9);
    expect(store.touchedKind({ path: '/x', id: null, openedAt: 5, organizedAt: 9, editedAt: 7 })).toBe('organized');
  });
});
