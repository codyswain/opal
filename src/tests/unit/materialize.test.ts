// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { materialize, sweepCopies } from '@/main/files/materialize';

const BYTES = Buffer.from('PK real 3mf bytes');
const OID = createHash('sha256').update(BYTES).digest('hex');
const POINTER = `version https://git-lfs.github.com/spec/v1\noid sha256:${OID}\nsize ${BYTES.length}\n`;

describe('materialize', () => {
  let temporary: string, root: string, copies: string, object: string;

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'opal-materialize-'));
    root = path.join(temporary, 'vault');
    copies = path.join(temporary, 'app-data/open-copies');
    await mkdir(path.join(root, '.git'), { recursive: true });
    await mkdir(path.join(root, 'Library/files'), { recursive: true });
    object = path.join(root, '.git/lfs/objects', OID.slice(0, 2), OID.slice(2, 4), OID);
  });
  afterEach(async () => { await rm(temporary, { recursive: true, force: true }); });

  it('answers a plain file with itself and copies nothing', async () => {
    const file = path.join(root, 'Library/files/plate.3mf');
    await writeFile(file, BYTES);
    expect(await materialize(file, copies)).toEqual({ path: file, copy: false });
    await expect(readdir(copies)).rejects.toThrow();
  });

  it('copies an LFS object that is here to a read-only file named as the vault file, not a link', async () => {
    const file = path.join(root, 'Library/files/bracket.a1b2c3d4.gcode.3mf');
    await writeFile(file, POINTER);
    await mkdir(path.dirname(object), { recursive: true });
    await writeFile(object, BYTES);
    const result = await materialize(file, copies);
    expect(result).toEqual({ path: path.join(copies, OID, 'bracket.a1b2c3d4.gcode.3mf'), copy: true });
    const copy = result?.path as string;
    expect(await readFile(copy)).toEqual(BYTES);
    const info = await lstat(copy);
    expect(info.isSymbolicLink()).toBe(false);
    expect(info.mode & 0o777).toBe(0o444);
    expect(info.ino).not.toBe((await stat(object)).ino);
    // The working tree and git's object are as they were.
    expect(await readFile(file, 'utf8')).toBe(POINTER);
    expect(await readFile(object)).toEqual(BYTES);
    // A second open reuses the copy.
    expect(await materialize(file, copies)).toEqual(result);
    expect(await readdir(path.join(copies, OID))).toEqual(['bracket.a1b2c3d4.gcode.3mf']);
  });

  it('answers null for an LFS file whose object is not here, and downloads nothing', async () => {
    const file = path.join(root, 'Library/files/deck.pptx');
    await writeFile(file, POINTER);
    expect(await materialize(file, copies)).toBeNull();
    await expect(readdir(path.join(root, '.git/lfs'))).rejects.toThrow();
  });

  it('removes copies older than a day, and all of them on quit', async () => {
    const file = path.join(root, 'Library/files/deck.pptx');
    await writeFile(file, POINTER);
    await mkdir(path.dirname(object), { recursive: true });
    await writeFile(object, BYTES);
    await materialize(file, copies);
    await mkdir(path.join(copies, 'old'));
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await utimes(path.join(copies, 'old'), twoDaysAgo, twoDaysAgo);
    await sweepCopies(copies, 24 * 60 * 60 * 1000);
    expect(await readdir(copies)).toEqual([OID]);
    await sweepCopies(copies, 0);
    expect(await readdir(copies)).toEqual([]);
  });
});
