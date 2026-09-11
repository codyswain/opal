import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, rename, lstat, symlink } from 'fs/promises';
import path from 'path';
import os from 'os';
import { MetadataService } from '@/main/fs/MetadataService';
import { RootRegistry } from '@/main/fs/RootRegistry';
import { FileWriter } from '@/main/fs/FileWriter';
import { DiskReader } from '@/main/fs/DiskReader';

let tmp: string;
let root: string;
let registry: RootRegistry;
let metadata: MetadataService;
let writer: FileWriter;
const item = (name: string) => path.join(root, name);
const exists = (target: string) => lstat(target).then(() => true, () => false);
async function identity(target: string) {
  const initial = await metadata.read(target);
  return metadata.saveProperties(target, { tags: ['keep'], description: 'retain' }, initial.revision);
}
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-managed-'));
  root = path.join(tmp, 'root');
  await mkdir(root);
  await mkdir(item('destination'));
  await writeFile(item('a.jpg'), 'bytes');
  registry = new RootRegistry({ storePath: path.join(tmp, 'roots.json') });
  root = await registry.add(root);
  metadata = new MetadataService({ registry });
  writer = new FileWriter({ registry, metadata, trashItem: async () => undefined });
});
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

describe('metadata-aware file mutations', () => {
  it('carries binary identity across rename and directory subtree moves', async () => {
    const before = await identity(item('a.jpg'));
    await writeFile(item('source.md'), 'source');
    await metadata.addRelated(item('source.md'), item('a.jpg'));
    const renamed = await writer.rename(item('a.jpg'), 'b.png');
    expect((await metadata.read(renamed)).id).toBe(before.id);
    await writer.move(renamed, item('destination'));
    await mkdir(item('archive'));
    await writer.move(item('destination'), item('archive'));
    expect((await metadata.read(item('source.md'))).related[0].targetPath).toBe(item('archive/destination/b.png'));
    expect((await metadata.read(item('archive/destination/b.png'))).properties.tags).toEqual(['keep']);
  });
  it('preserves Markdown and internal directory metadata across rename', async () => {
    await writeFile(item('a.md'), 'body');
    const markdown = await identity(item('a.md'));
    const directory = await identity(item('destination'));
    const newMd = await writer.rename(item('a.md'), 'renamed.md');
    const newDir = await writer.rename(item('destination'), 'folder');
    expect((await metadata.read(newMd)).id).toBe(markdown.id);
    expect((await metadata.read(newDir)).id).toBe(directory.id);
  });
  it.each([false, true])('preflights sidecar destination even if source managed is %s', async (managed) => {
    if (managed) await identity(item('a.jpg'));
    await writeFile(item('destination/a.jpg.opal.yaml'), 'unrelated');
    await expect(writer.move(item('a.jpg'), item('destination'))).rejects.toThrow(/exists|collision/i);
    expect(await readFile(item('a.jpg'), 'utf8')).toBe('bytes');
    expect(await readFile(item('destination/a.jpg.opal.yaml'), 'utf8')).toBe('unrelated');
  });
  it('refuses malformed carriers without overwriting them', async () => {
    await writeFile(item('a.jpg.opal.yaml'), 'unrelated: true');
    await expect(writer.rename(item('a.jpg'), 'b.jpg')).rejects.toThrow(/schema|collision/i);
    expect(await readFile(item('a.jpg.opal.yaml'), 'utf8')).toBe('unrelated: true');
    expect(await exists(item('b.jpg'))).toBe(false);
  });
  it('refuses carrier-format changes before mutation', async () => {
    await identity(item('a.jpg'));
    await expect(writer.rename(item('a.jpg'), 'a.md')).rejects.toThrow(/format|Markdown/i);
    expect(await exists(item('a.jpg.opal.yaml'))).toBe(true);
    expect(await exists(item('a.md'))).toBe(false);
  });
  it('rolls the primary back after sidecar rename fails', async () => {
    const before = await identity(item('a.jpg'));
    writer = new FileWriter({ registry, metadata, trashItem: async () => undefined,
      renameEntry: async (from, to) => { if (from.endsWith('.opal.yaml')) throw new Error('sidecar denied'); await rename(from, to); } });
    await expect(writer.rename(item('a.jpg'), 'b.jpg')).rejects.toThrow(/sidecar denied/);
    expect(await readFile(item('a.jpg'), 'utf8')).toBe('bytes');
    expect((await metadata.read(item('a.jpg'))).id).toBe(before.id);
    expect(await exists(item('b.jpg'))).toBe(false);
  });
  it('reports surviving paths if a rollback fails', async () => {
    await identity(item('a.jpg'));
    let calls = 0;
    writer = new FileWriter({ registry, metadata, trashItem: async () => undefined,
      renameEntry: async (from, to) => { if (++calls > 1) throw new Error('denied'); await rename(from, to); } });
    await expect(writer.rename(item('a.jpg'), 'b.jpg')).rejects.toThrow(/rollback.*b.jpg.*a.jpg.opal.yaml/is);
    expect(await readFile(item('b.jpg'), 'utf8')).toBe('bytes');
    expect(await exists(item('a.jpg.opal.yaml'))).toBe(true);
  });
  it('fails managed binary EXDEV safely instead of copying half a pair', async () => {
    await identity(item('a.jpg'));
    writer = new FileWriter({ registry, metadata, trashItem: async () => undefined,
      renameEntry: async () => { throw Object.assign(new Error('cross device'), { code: 'EXDEV' }); } });
    await expect(writer.move(item('a.jpg'), item('destination'))).rejects.toThrow(/filesystem|cross.*device/i);
    expect(await exists(item('a.jpg'))).toBe(true);
    expect(await exists(item('a.jpg.opal.yaml'))).toBe(true);
    expect(await exists(item('destination/a.jpg'))).toBe(false);
  });
  it('trashes a primary and sidecar together inside a unique same-parent bundle', async () => {
    const before = await identity(item('a.jpg'));
    let trashed = '';
    const trashItem = vi.fn(async (bundle: string) => {
      trashed = bundle;
      expect(path.dirname(bundle)).toBe(root);
      expect(path.basename(bundle)).toMatch(/^\.opal-trash-/);
      expect((await readdir(bundle)).sort()).toEqual(['a.jpg', 'a.jpg.opal.yaml']);
      expect(await readFile(path.join(bundle, 'a.jpg.opal.yaml'), 'utf8')).toContain(before.id);
      await rm(bundle, { recursive: true });
    });
    writer = new FileWriter({ registry, metadata, trashItem });
    await writer.moveToTrash(item('a.jpg'));
    expect(trashItem).toHaveBeenCalledTimes(1);
    expect(await exists(trashed)).toBe(false);
    expect(await exists(item('a.jpg'))).toBe(false);
    expect(await exists(item('a.jpg.opal.yaml'))).toBe(false);
  });
  it.each(['staging', 'trash'])('rolls back a paired %s failure', async (failure) => {
    const before = await identity(item('a.jpg'));
    writer = new FileWriter({ registry, metadata,
      trashItem: async () => { throw new Error('trash denied'); },
      renameEntry: async (from, to) => { if (failure === 'staging' && from === item('a.jpg.opal.yaml')) throw new Error('staging denied'); await rename(from, to); } });
    await expect(writer.moveToTrash(item('a.jpg'))).rejects.toThrow(/denied/);
    expect(await readFile(item('a.jpg'), 'utf8')).toBe('bytes');
    expect((await metadata.read(item('a.jpg'))).id).toBe(before.id);
    expect((await readdir(root)).filter((name) => name.startsWith('.opal-trash-'))).toEqual([]);
  });
  it('rejects dangling destination symlinks as collisions', async () => {
    await symlink(item('missing'), item('b.jpg'));
    await expect(writer.rename(item('a.jpg'), 'b.jpg')).rejects.toThrow(/exists/i);
    expect((await lstat(item('b.jpg'))).isSymbolicLink()).toBe(true);
  });
  it('shares a mutation queue with properties and recovers after failure', async () => {
    const before = await identity(item('a.jpg'));
    const moving = writer.move(item('a.jpg'), item('destination'));
    const staleSave = metadata.saveProperties(item('a.jpg'), { tags: [], description: 'lost' }, before.revision);
    const results = await Promise.allSettled([moving, staleSave]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect((await metadata.read(item('destination/a.jpg'))).properties.tags).toEqual(['keep']);
  });
});

describe('browse listings', () => {
  it('folds only valid adjacent carriers and keeps orphaned, malformed and Markdown collisions visible', async () => {
    await identity(item('a.jpg'));
    await writeFile(item('bad.jpg'), 'bad');
    await writeFile(item('bad.jpg.opal.yaml'), 'unrelated: true');
    await writeFile(item('orphan.jpg.opal.yaml'), await readFile(item('a.jpg.opal.yaml')));
    await writeFile(item('note.md'), 'body');
    await writeFile(item('note.md.opal.yaml'), await readFile(item('a.jpg.opal.yaml')));
    const reader = new DiskReader({ registry });
    const names = (await reader.readDirectory(root)).entries.map((entry) => entry.name);
    expect(names).not.toContain('a.jpg.opal.yaml');
    expect(names).toEqual(expect.arrayContaining(['a.jpg', 'bad.jpg.opal.yaml', 'orphan.jpg.opal.yaml', 'note.md.opal.yaml']));
  });
});


it('can roll back a failed case-only paired rename', async () => {
  const before = await identity(item('a.jpg'));
  writer = new FileWriter({ registry, metadata, trashItem: async () => undefined,
    renameEntry: async (from, to) => { if (from.endsWith('.opal.yaml')) throw new Error('sidecar denied'); await rename(from, to); } });
  await expect(writer.rename(item('a.jpg'), 'A.jpg')).rejects.toThrow(/original files were restored/i);
  expect(await readdir(root)).toContain('a.jpg');
  expect((await metadata.read(item('a.jpg'))).id).toBe(before.id);
});

it('reports recoverable staged paths when trash rollback fails', async () => {
  await identity(item('a.jpg'));
  writer = new FileWriter({ registry, metadata, trashItem: async () => { throw new Error('trash denied'); },
    renameEntry: async (from, to) => { if (from.includes('.opal-trash-')) throw new Error('rollback denied'); await rename(from, to); } });
  await expect(writer.moveToTrash(item('a.jpg'))).rejects.toThrow(/rollback.*\.opal-trash-.*a.jpg.*a.jpg.opal.yaml/is);
  const bundle = (await readdir(root)).find((name) => name.startsWith('.opal-trash-'));
  expect(await readFile(item(`${bundle}/a.jpg`), 'utf8')).toBe('bytes');
  expect(await exists(item(`${bundle}/a.jpg.opal.yaml`))).toBe(true);
});
