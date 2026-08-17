import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readdir } from 'fs/promises';
import path from 'path';
import os from 'os';
import { RootRegistry, PathNotAllowedError } from '@/main/fs/RootRegistry';
import { ThumbnailService } from '@/main/fs/ThumbnailService';

let tmp: string;
let root: string;
let cacheDir: string;
let registry: RootRegistry;
let createThumbnail: ReturnType<typeof vi.fn>;
let service: ThumbnailService;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-thumbs-'));
  root = path.join(tmp, 'Vault');
  cacheDir = path.join(tmp, 'cache');
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'a.jpg'), 'jpegbytes');

  registry = new RootRegistry({ storePath: path.join(tmp, 'roots.json') });
  await registry.load();
  await registry.add(root);

  createThumbnail = vi.fn(async () => ({ toPNG: () => Buffer.from('PNGDATA'), isEmpty: () => false }));
  service = new ThumbnailService({ registry, cacheDir, createThumbnail });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('ThumbnailService', () => {
  it('generates a thumbnail and returns its cached path', async () => {
    const result = await service.getThumbnailPath(path.join(root, 'a.jpg'));
    expect(result).toContain(cacheDir);
    expect(result.endsWith('.png')).toBe(true);
    expect(createThumbnail).toHaveBeenCalledTimes(1);
  });

  it('reuses the cache on a second request', async () => {
    const target = path.join(root, 'a.jpg');
    const first = await service.getThumbnailPath(target);
    const second = await service.getThumbnailPath(target);

    expect(second).toBe(first);
    expect(createThumbnail).toHaveBeenCalledTimes(1);
  });

  it('regenerates when the source file changes', async () => {
    const target = path.join(root, 'a.jpg');
    await service.getThumbnailPath(target);

    // Different size and mtime, so a different cache key.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(target, 'completely different bytes');

    await service.getThumbnailPath(target);
    expect(createThumbnail).toHaveBeenCalledTimes(2);
  });

  it('refuses a source outside every root', async () => {
    const outside = path.join(tmp, 'outside.jpg');
    await writeFile(outside, 'x');
    await expect(service.getThumbnailPath(outside)).rejects.toThrow(PathNotAllowedError);
  });

  it('reports a generation failure', async () => {
    createThumbnail.mockRejectedValue(new Error('unsupported format'));
    await expect(service.getThumbnailPath(path.join(root, 'a.jpg'))).rejects.toThrow();
  });

  it('does not retry a source that already failed', async () => {
    createThumbnail.mockRejectedValue(new Error('unsupported format'));
    const target = path.join(root, 'a.jpg');

    await expect(service.getThumbnailPath(target)).rejects.toThrow();
    await expect(service.getThumbnailPath(target)).rejects.toThrow();

    // The tombstone means the expensive call happened only once.
    expect(createThumbnail).toHaveBeenCalledTimes(1);
  });

  it('writes nothing outside its cache directory', async () => {
    await service.getThumbnailPath(path.join(root, 'a.jpg'));
    expect(await readdir(root)).toEqual(['a.jpg']);
  });
});
