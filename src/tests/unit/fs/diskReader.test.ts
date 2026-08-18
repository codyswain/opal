import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import { RootRegistry, PathNotAllowedError } from '@/main/fs/RootRegistry';
import { DiskReader } from '@/main/fs/DiskReader';

let tmp: string;
let root: string;
let registry: RootRegistry;
let reader: DiskReader;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-reader-'));
  root = path.join(tmp, 'Vault');
  await mkdir(path.join(root, 'Photos'), { recursive: true });
  await writeFile(path.join(root, 'note.md'), '# hello');
  await writeFile(path.join(root, 'Photos', 'a.jpg'), 'jpegbytes');
  await writeFile(path.join(root, 'Photos', 'b.png'), 'pngbytes');
  await writeFile(path.join(root, '.hidden'), 'secret');

  registry = new RootRegistry({ storePath: path.join(tmp, 'roots.json') });
  await registry.load();
  await registry.add(root);
  reader = new DiskReader({ registry });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('DiskReader.readDirectory', () => {
  it('lists immediate children only', async () => {
    const listing = await reader.readDirectory(root);
    const names = listing.entries.map((e) => e.name).sort();
    expect(names).toEqual(['Photos', 'note.md']);
  });

  it('marks directories and classifies files', async () => {
    const listing = await reader.readDirectory(root);
    const photos = listing.entries.find((e) => e.name === 'Photos');
    const note = listing.entries.find((e) => e.name === 'note.md');

    expect(photos?.isDirectory).toBe(true);
    expect(photos?.kind).toBe('directory');
    expect(note?.isDirectory).toBe(false);
    expect(note?.kind).toBe('markdown');
  });

  it('omits dotfiles by default', async () => {
    const listing = await reader.readDirectory(root);
    expect(listing.entries.some((e) => e.name === '.hidden')).toBe(false);
  });

  it('sorts directories before files, then alphabetically', async () => {
    await mkdir(path.join(root, 'Archive'));
    await writeFile(path.join(root, 'aaa.md'), 'x');

    const listing = await reader.readDirectory(root);
    expect(listing.entries.map((e) => e.name)).toEqual([
      'Archive', 'Photos', 'aaa.md', 'note.md',
    ]);
  });

  it('reports size and mtime for files', async () => {
    const listing = await reader.readDirectory(path.join(root, 'Photos'));
    const a = listing.entries.find((e) => e.name === 'a.jpg');
    expect(a?.size).toBe('jpegbytes'.length);
    expect(a?.mtimeMs).toBeGreaterThan(0);
  });

  it('returns absolute resolved paths', async () => {
    const listing = await reader.readDirectory(root);
    for (const entry of listing.entries) {
      expect(path.isAbsolute(entry.path)).toBe(true);
      expect(entry.path.endsWith(entry.name)).toBe(true);
    }
  });

  it('reads a nested directory that is inside a root', async () => {
    const listing = await reader.readDirectory(path.join(root, 'Photos'));
    expect(listing.entries.map((e) => e.name).sort()).toEqual(['a.jpg', 'b.png']);
  });

  it('refuses a directory outside every root', async () => {
    const outside = path.join(tmp, 'Outside');
    await mkdir(outside);
    await expect(reader.readDirectory(outside)).rejects.toThrow(PathNotAllowedError);
  });

  it('rejects a path that is a file, not a directory', async () => {
    await expect(reader.readDirectory(path.join(root, 'note.md'))).rejects.toThrow(
      /not a directory/i
    );
  });

  it('returns an empty listing for an empty directory', async () => {
    const empty = path.join(root, 'Empty');
    await mkdir(empty);
    const listing = await reader.readDirectory(empty);
    expect(listing.entries).toEqual([]);
  });
});

describe('DiskReader.statEntry', () => {
  it('describes a single file', async () => {
    const entry = await reader.statEntry(path.join(root, 'Photos', 'a.jpg'));
    expect(entry.name).toBe('a.jpg');
    expect(entry.kind).toBe('image');
    expect(entry.isDirectory).toBe(false);
  });

  it('refuses a file outside every root', async () => {
    const outside = path.join(tmp, 'outside.txt');
    await writeFile(outside, 'nope');
    await expect(reader.statEntry(outside)).rejects.toThrow(PathNotAllowedError);
  });
});

describe('DiskReader.readTextFile', () => {
  it('reads a file inside a root', async () => {
    const result = await reader.readTextFile(path.join(root, 'note.md'));
    expect(result.text).toBe('# hello');
    expect(result.truncated).toBe(false);
    expect(result.size).toBe('# hello'.length);
  });

  it('refuses a file outside every root', async () => {
    const outside = path.join(tmp, 'outside.txt');
    await writeFile(outside, 'nope');
    await expect(reader.readTextFile(outside)).rejects.toThrow(PathNotAllowedError);
  });

  it('truncates a file larger than maxBytes and reports it', async () => {
    const big = path.join(root, 'big.txt');
    await writeFile(big, 'x'.repeat(5000));

    const result = await reader.readTextFile(big, { maxBytes: 1000 });
    expect(result.text).toHaveLength(1000);
    expect(result.truncated).toBe(true);
    expect(result.size).toBe(5000);
  });

  it('rejects a directory', async () => {
    await expect(reader.readTextFile(path.join(root, 'Photos'))).rejects.toThrow(
      /not a file/i
    );
  });
});
