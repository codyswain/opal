// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import type { RunFile } from '@/main/files/FileStore';
import { GitLfsStore, lfsInclude } from '@/main/files/GitLfsStore';
import { localObject, parsePlaceholder } from '@/main/files/lfsPlaceholder';

const BYTES = Buffer.from('the image bytes');
const OID = createHash('sha256').update(BYTES).digest('hex');
const pointer = (oid = OID, size = BYTES.length) => `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${size}\n`;

/** Puts a placeholder's bytes where git lfs fetch would: <git common dir>/lfs/objects/aa/bb/oid. */
async function storeObject(commonDir: string, bytes = BYTES) {
  const object = path.join(commonDir, 'lfs/objects', OID.slice(0, 2), OID.slice(2, 4), OID);
  await mkdir(path.dirname(object), { recursive: true });
  await writeFile(object, bytes);
  return object;
}

describe('placeholders', () => {
  it('reads the oid and size of a Git LFS pointer, and nothing else', () => {
    expect(parsePlaceholder(pointer())).toEqual({ oid: OID, size: BYTES.length });
    expect(parsePlaceholder(pointer().replace(/\n/g, '\r\n'))).toEqual({ oid: OID, size: BYTES.length });
    expect(parsePlaceholder(`# notes\n${pointer()}`)).toBeNull();
    expect(parsePlaceholder(pointer('abc'))).toBeNull();
    expect(parsePlaceholder('version https://git-lfs.github.com/spec/v1\noid sha256:' + OID + '\n')).toBeNull();
  });
});

describe('lfsInclude', () => {
  it('names one file with its wildcards escaped', () => {
    expect(lfsInclude('Library/files/2026-11/nest-frame.a3f9c2e1.jpg')).toBe('Library/files/2026-11/nest-frame.a3f9c2e1.jpg');
    expect(lfsInclude('Library/files/Pasted image [1]*?.png')).toBe('Library/files/Pasted image \\[1\\]\\*\\?.png');
  });

  it('names the folder for a name with a comma, which -I would split', () => {
    expect(lfsInclude('Library/files/Scan 1, page 2.png')).toBe('Library/files/**');
    expect(lfsInclude('Library/a, b [x]/c, d.png')).toBe('Library/**');
    expect(() => lfsInclude('a, b/c.png')).toThrow(/comma/);
  });
});

describe('GitLfsStore', () => {
  let temporary: string, root: string;
  let run: ReturnType<typeof vi.fn<RunFile>>;
  const links = { invalidateDirectories: vi.fn() };
  const store = () => new GitLfsStore({ root, folder: 'Library/files', links, run });
  const file = (name: string) => path.join(root, 'Library/files/2026-11', name);

  beforeEach(async () => {
    temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'opal-lfs-')));
    root = path.join(temporary, 'vault');
    await mkdir(path.join(root, '.git'), { recursive: true });
    await mkdir(path.join(root, 'Library/files/2026-11'), { recursive: true });
    run = vi.fn<RunFile>(async () => ({ stdout: '', stderr: '' }));
  });
  afterEach(async () => { await rm(temporary, { recursive: true, force: true }); });

  it('says a real file is here, a placeholder remote until its object is local, and a gone file missing', async () => {
    await writeFile(file('photo.jpg'), BYTES);
    await writeFile(file('frame.jpg'), pointer());
    await writeFile(file('notes.txt'), 'version 2 of the plan\n');
    expect(await store().status(file('photo.jpg'))).toBe('here');
    expect(await store().status(file('notes.txt'))).toBe('here');
    expect(await store().status(file('frame.jpg'))).toBe('remote');
    expect(await store().status(file('gone.jpg'))).toBe('missing');
    // An object cut short is not the file.
    await storeObject(path.join(root, '.git'), BYTES.subarray(0, 4));
    expect(await store().status(file('frame.jpg'))).toBe('remote');
    await storeObject(path.join(root, '.git'));
    expect(await store().status(file('frame.jpg'))).toBe('here');
  });

  it('finds objects in the common git folder from a linked worktree', async () => {
    const main = path.join(temporary, 'main');
    const gitDir = path.join(main, '.git/worktrees/vault');
    await mkdir(gitDir, { recursive: true });
    await writeFile(path.join(gitDir, 'commondir'), '../..\n');
    await rm(path.join(root, '.git'), { recursive: true });
    await writeFile(path.join(root, '.git'), `gitdir: ${gitDir}\n`);
    await writeFile(file('frame.jpg'), pointer());
    expect(await store().status(file('frame.jpg'))).toBe('remote');
    const object = await storeObject(path.join(main, '.git'));
    expect(await localObject(file('frame.jpg'), { oid: OID, size: BYTES.length })).toBe(object);
    expect(await store().status(file('frame.jpg'))).toBe('here');
  });

  it('fetches one placeholder with git lfs, without a shell or a prompt, and with Homebrew on the PATH', async () => {
    await writeFile(file('Pasted [1].png'), pointer());
    run.mockImplementation(async () => {
      await storeObject(path.join(root, '.git'));
      return { stdout: '', stderr: '' };
    });
    expect(await store().fetch(file('Pasted [1].png'))).toBe('here');
    expect(run).toHaveBeenCalledTimes(1);
    const [program, args, options] = run.mock.calls[0];
    expect(program).toBe('git');
    expect(args).toEqual(['-c', 'lfs.fetchexclude=', '-c', 'lfs.dialtimeout=5', 'lfs', 'fetch', '-I', 'Library/files/2026-11/Pasted \\[1\\].png']);
    expect(options.cwd).toBe(root);
    expect(options.timeout).toBeGreaterThan(0);
    expect(options.env?.GIT_TERMINAL_PROMPT).toBe('0');
    expect(options.env?.PATH?.split(':')[0]).toBe('/opt/homebrew/bin');
    // The working tree keeps its placeholder; Opal shows the object.
    expect(parsePlaceholder(await readFile(file('Pasted [1].png'), 'utf8'))).not.toBeNull();
  });

  it('fetches nothing for a file that is here or gone, and says why a fetch failed', async () => {
    await writeFile(file('photo.jpg'), BYTES);
    expect(await store().fetch(file('photo.jpg'))).toBe('here');
    expect(await store().fetch(file('gone.jpg'))).toBe('missing');
    expect(run).not.toHaveBeenCalled();
    await writeFile(file('frame.jpg'), pointer());
    run.mockRejectedValueOnce(Object.assign(new Error('Command failed'), { stderr: 'fetch: 1 object found\nbatch request: dial tcp 100.125.85.12:8732: i/o timeout\n' }));
    await expect(store().fetch(file('frame.jpg'))).rejects.toThrow('Could not download frame.jpg. batch request: dial tcp 100.125.85.12:8732: i/o timeout');
  });
});
