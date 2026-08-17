import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import { RootRegistry, PathNotAllowedError } from '@/main/fs/RootRegistry';

let tmp: string;
let storePath: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-roots-'));
  storePath = path.join(tmp, 'roots.json');
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('RootRegistry', () => {
  it('starts empty when no store file exists', async () => {
    const registry = new RootRegistry({ storePath });
    await registry.load();
    expect(registry.list()).toEqual([]);
  });

  it('adds a root and reports it', async () => {
    const photos = path.join(tmp, 'Photos');
    await mkdir(photos);

    const registry = new RootRegistry({ storePath });
    await registry.load();
    await registry.add(photos);

    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]).toContain('Photos');
  });

  it('persists roots across instances', async () => {
    const photos = path.join(tmp, 'Photos');
    await mkdir(photos);

    const first = new RootRegistry({ storePath });
    await first.load();
    await first.add(photos);

    const second = new RootRegistry({ storePath });
    await second.load();
    expect(second.list()).toHaveLength(1);
  });

  it('does not add the same root twice', async () => {
    const photos = path.join(tmp, 'Photos');
    await mkdir(photos);

    const registry = new RootRegistry({ storePath });
    await registry.load();
    await registry.add(photos);
    await registry.add(photos);
    await registry.add(`${photos}/`);

    expect(registry.list()).toHaveLength(1);
  });

  it('rejects adding a path that is not a directory', async () => {
    const file = path.join(tmp, 'a.txt');
    await writeFile(file, 'hi');

    const registry = new RootRegistry({ storePath });
    await registry.load();
    await expect(registry.add(file)).rejects.toThrow(/not a directory/i);
  });

  it('removes a root', async () => {
    const photos = path.join(tmp, 'Photos');
    await mkdir(photos);

    const registry = new RootRegistry({ storePath });
    await registry.load();
    const stored = await registry.add(photos);
    await registry.remove(stored);

    expect(registry.list()).toEqual([]);
  });

  it('allows a descendant of a root', async () => {
    const photos = path.join(tmp, 'Photos');
    await mkdir(path.join(photos, 'Rwanda'), { recursive: true });
    const image = path.join(photos, 'Rwanda', 'a.jpg');
    await writeFile(image, 'bytes');

    const registry = new RootRegistry({ storePath });
    await registry.load();
    await registry.add(photos);

    await expect(registry.assertAllowed(image)).resolves.toContain('a.jpg');
  });

  it('rejects a path outside every root', async () => {
    const photos = path.join(tmp, 'Photos');
    const secrets = path.join(tmp, 'Secrets');
    await mkdir(photos);
    await mkdir(secrets);
    const secret = path.join(secrets, 'passwords.txt');
    await writeFile(secret, 'hunter2');

    const registry = new RootRegistry({ storePath });
    await registry.load();
    await registry.add(photos);

    await expect(registry.assertAllowed(secret)).rejects.toThrow(PathNotAllowedError);
  });

  it('rejects traversal out of a root', async () => {
    const photos = path.join(tmp, 'Photos');
    const secrets = path.join(tmp, 'Secrets');
    await mkdir(photos);
    await mkdir(secrets);
    await writeFile(path.join(secrets, 'passwords.txt'), 'hunter2');

    const registry = new RootRegistry({ storePath });
    await registry.load();
    await registry.add(photos);

    const escape = path.join(photos, '..', 'Secrets', 'passwords.txt');
    await expect(registry.assertAllowed(escape)).rejects.toThrow(PathNotAllowedError);
  });

  it('rejects everything when no roots are registered', async () => {
    const registry = new RootRegistry({ storePath });
    await registry.load();
    await expect(registry.assertAllowed(tmp)).rejects.toThrow(PathNotAllowedError);
  });

  it('survives a corrupt store file by starting empty', async () => {
    await writeFile(storePath, 'not json at all');
    const registry = new RootRegistry({ storePath });
    await registry.load();
    expect(registry.list()).toEqual([]);
  });

  it('drops roots that no longer exist on disk when loading', async () => {
    const photos = path.join(tmp, 'Photos');
    await mkdir(photos);

    const first = new RootRegistry({ storePath });
    await first.load();
    await first.add(photos);

    await rm(photos, { recursive: true, force: true });

    const second = new RootRegistry({ storePath });
    await second.load();
    expect(second.list()).toEqual([]);
  });
});
