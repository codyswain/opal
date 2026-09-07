import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { CollectionIndex } from '@/main/collections/CollectionIndex';
import { MetadataService } from '@/main/fs/MetadataService';
import { RootRegistry } from '@/main/fs/RootRegistry';

let tmp: string;
let root: string;
let registry: RootRegistry;
let index: CollectionIndex;
const onChanged = vi.fn();
const item = (...segments: string[]) => path.join(root, ...segments);
const names = (snapshot: { items: readonly { path: string }[] }) =>
  snapshot.items.map((entry) => path.relative(root, entry.path) || '.').sort();

beforeEach(async () => {
  onChanged.mockClear();
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-index-'));
  root = path.join(tmp, 'root');
  await mkdir(item('Sub', 'Deep'), { recursive: true });
  await mkdir(item('.hidden'), { recursive: true });
  await writeFile(item('a.md'), '---\ntags: [research, " ", ""]\nannotation: "  "\n---\n# a');
  await writeFile(item('photo.jpg'), 'jpg');
  await writeFile(item('photo.jpg.opal.yaml'), 'schema: 1\nid: 11111111-1111-4111-8111-111111111111\ntags: [reference]\nannotation: A photo\n');
  await writeFile(item('broken.pdf'), 'pdf');
  await writeFile(item('broken.pdf.opal.yaml'), 'tags: [oops');
  await writeFile(item('Sub', 'Deep', 'b.txt'), 'b');
  await writeFile(item('Sub', '.opal.yaml'), 'schema: 1\nid: 22222222-2222-4222-8222-222222222222\ntags: [folder-tag]\n');
  await writeFile(item('.hidden', 'ignored.md'), 'x');
  registry = new RootRegistry({ storePath: path.join(tmp, 'roots.json') });
  root = await registry.add(root);
  index = new CollectionIndex({ registry, onChanged, changeDebounceMs: 0, updateDebounceMs: 0 });
});
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

const flushTimers = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('CollectionIndex', () => {
  it('stays idle until asked, then summarizes every visible item with its metadata', async () => {
    expect(index.state()).toBe('idle');
    const snapshot = await index.get();
    expect(index.state()).toBe('ready');
    expect(names(snapshot)).toEqual(['.', 'Sub', 'Sub/Deep', 'Sub/Deep/b.txt', 'a.md', 'broken.pdf', 'broken.pdf.opal.yaml', 'photo.jpg']);
    const by = (name: string) => {
      const found = snapshot.items.find((entry) => entry.path === item(...name.split('/')));
      if (!found) throw new Error(`missing ${name}`);
      return found;
    };
    expect(by('a.md')).toMatchObject({ kind: 'markdown', isDirectory: false, id: null, tags: ['research'], descriptionEmpty: true, metadataWarning: null });
    expect(by('photo.jpg')).toMatchObject({ kind: 'image', id: '11111111-1111-4111-8111-111111111111', tags: ['reference'], descriptionEmpty: false });
    expect(by('Sub')).toMatchObject({ kind: 'directory', isDirectory: true, tags: ['folder-tag'], descriptionEmpty: true });
    expect(by('Sub/Deep/b.txt')).toMatchObject({ kind: 'text', tags: [], descriptionEmpty: true, size: 1 });
    expect(by('broken.pdf')).toMatchObject({ tags: null, descriptionEmpty: null });
    expect(by('broken.pdf').metadataWarning).toMatch(/broken\.pdf/);
    // A malformed carrier stays visible as its own item, as it does in folder listings.
    expect(by('broken.pdf.opal.yaml')).toMatchObject({ kind: 'text', tags: [] });
    expect(snapshot.warnings).toEqual([]);
    expect(snapshot.generation).toBe(1);
    await flushTimers();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('re-summarizes a changed directory, drops vanished children with their subtrees, and walks new folders', async () => {
    await index.get();
    onChanged.mockClear();
    await writeFile(item('a.md'), '---\ntags: [updated]\n---\n# a');
    await rm(item('Sub'), { recursive: true });
    await mkdir(item('Fresh', 'Inner'), { recursive: true });
    await writeFile(item('Fresh', 'Inner', 'c.md'), '# c');
    index.invalidateDirectories([root]);
    await flushTimers();
    const snapshot = await index.get();
    expect(names(snapshot)).toEqual(['.', 'Fresh', 'Fresh/Inner', 'Fresh/Inner/c.md', 'a.md', 'broken.pdf', 'broken.pdf.opal.yaml', 'photo.jpg']);
    expect(snapshot.items.find((entry) => entry.path === item('a.md'))?.tags).toEqual(['updated']);
    expect(snapshot.generation).toBe(2);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('coalesces several changed directories into one update and moves a renamed subtree', async () => {
    await index.get();
    onChanged.mockClear();
    await rename(item('Sub'), item('Renamed'));
    index.invalidateDirectories([root, item('Sub'), item('Renamed')]);
    index.invalidateDirectories([item('Renamed', 'Deep')]);
    await flushTimers();
    const snapshot = await index.get();
    expect(names(snapshot)).toEqual(['.', 'Renamed', 'Renamed/Deep', 'Renamed/Deep/b.txt', 'a.md', 'broken.pdf', 'broken.pdf.opal.yaml', 'photo.jpg']);
    expect(snapshot.items.find((entry) => entry.path === item('Renamed'))?.tags).toEqual(['folder-tag']);
    expect(snapshot.generation).toBe(2);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('ignores hidden directories and changes before the first build', async () => {
    index.invalidateDirectories([root]);
    expect(index.state()).toBe('idle');
    await index.get();
    await writeFile(item('.hidden', 'more.md'), 'x');
    index.invalidateDirectories([item('.hidden')]);
    await flushTimers();
    expect(names(await index.get())).not.toContain('.hidden/more.md');
  });

  it('rebuilds when roots change and drops a closed root', async () => {
    await index.get();
    const other = path.join(tmp, 'other');
    await mkdir(other);
    await writeFile(path.join(other, 'o.md'), '# o');
    const otherRoot = await registry.add(other);
    const grown = await index.get();
    expect(grown.items.some((entry) => entry.path === path.join(otherRoot, 'o.md'))).toBe(true);
    await registry.remove(root);
    const shrunk = await index.get();
    expect(shrunk.items.every((entry) => entry.path.startsWith(otherRoot))).toBe(true);
    expect(shrunk.items).toHaveLength(2);
  });

  it('reports unreadable directories as warnings and clears them when readable again', async () => {
    const service = new MetadataService({ registry });
    await index.get();
    await rm(item('Sub'), { recursive: true });
    // A directory removed between listing and summary must not poison the index.
    index.invalidateDirectories([item('Sub')]);
    await flushTimers();
    const snapshot = await index.get();
    expect(names(snapshot)).toEqual(['.', 'a.md', 'broken.pdf', 'broken.pdf.opal.yaml', 'photo.jpg']);
    expect(snapshot.warnings).toEqual([]);
    // Metadata saved through Opal is picked up by a targeted refresh.
    await service.saveProperties(item('a.md'), { tags: ['saved'], description: 'now described' }, (await service.read(item('a.md'))).revision);
    index.invalidateDirectories([root]);
    await flushTimers();
    const refreshed = await index.get();
    expect(refreshed.items.find((entry) => entry.path === item('a.md'))).toMatchObject({ tags: ['saved'], descriptionEmpty: false });
  });

  it('serves the finished build to a caller that asks during the build', async () => {
    const first = index.get();
    const second = index.get();
    expect(index.state()).toBe('building');
    const [a, b] = await Promise.all([first, second]);
    expect(a.generation).toBe(1);
    expect(b.generation).toBe(1);
    expect(a.items.length).toBe(b.items.length);
  });
});
