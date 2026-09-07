import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { RootRegistry } from '@/main/fs/RootRegistry';
import { listChildren, scanRootsFor, walkRoot } from '@/main/fs/rootTraversal';

let tmp: string;
let root: string;
let registry: RootRegistry;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-walk-'));
  root = path.join(tmp, 'root');
  await mkdir(path.join(root, 'Sub', 'Deep'), { recursive: true });
  await mkdir(path.join(root, '.hidden'), { recursive: true });
  await writeFile(path.join(root, 'a.md'), '# a');
  await writeFile(path.join(root, '.secret.md'), 'x');
  await writeFile(path.join(root, 'photo.jpg'), 'jpg');
  await writeFile(path.join(root, 'photo.jpg.opal.yaml'), 'schema: 1\nid: 11111111-1111-4111-8111-111111111111\n');
  await writeFile(path.join(root, 'orphan.opal.yaml'), 'schema: 1\n');
  await writeFile(path.join(root, 'Sub', 'Deep', 'b.txt'), 'b');
  await symlink(path.join(tmp, 'elsewhere'), path.join(root, 'link'));
  registry = new RootRegistry({ storePath: path.join(tmp, 'roots.json') });
  root = await registry.add(root);
});
afterEach(async () => {
  await chmod(path.join(root, 'Sub'), 0o755).catch(() => undefined);
  await rm(tmp, { recursive: true, force: true });
});

describe('rootTraversal', () => {
  it('lists one level with hidden entries, symlinks and valid carriers folded', async () => {
    const children = await listChildren(registry, root);
    expect(children.directories.map((p) => path.basename(p)).sort()).toEqual(['Sub']);
    expect(children.files.map((p) => path.basename(p)).sort()).toEqual(['a.md', 'orphan.opal.yaml', 'photo.jpg']);
  });

  it('walks every visible directory and file and reports errors without aborting', async () => {
    const seen: string[] = [];
    const errors: string[] = [];
    await chmod(path.join(root, 'Sub'), 0o000);
    await walkRoot(registry, root, {
      onDirectory: (directory) => { seen.push(`D:${path.relative(root, directory) || '.'}`); },
      onFile: (file) => { seen.push(`F:${path.relative(root, file)}`); },
      onError: (target) => { errors.push(path.relative(root, target)); },
    });
    expect(seen.sort()).toEqual(['D:.', 'F:a.md', 'F:orphan.opal.yaml', 'F:photo.jpg']);
    expect(errors).toEqual(['Sub']);
  });

  it('walks nested directories in order', async () => {
    const seen: string[] = [];
    await walkRoot(registry, root, {
      onDirectory: (directory) => { seen.push(path.relative(root, directory) || '.'); },
      onFile: () => undefined,
      onError: () => undefined,
    });
    expect(seen).toEqual(['.', 'Sub', 'Sub/Deep']);
  });

  it('deduplicates overlapping roots except explicitly opened hidden descendants', () => {
    expect(scanRootsFor(['/V', '/V/Sub', '/V/.hidden/x', '/Other'])).toEqual(['/V', '/V/.hidden/x', '/Other']);
  });
});
