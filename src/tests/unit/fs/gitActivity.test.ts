// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { gitBusy, gitDirOf } from '@/main/fs/gitActivity';

let tmp: string;
let repo: string;
let note: string;

beforeEach(async () => {
  tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'opal-git-activity-')));
  repo = path.join(tmp, 'vault');
  await mkdir(path.join(repo, '.git'), { recursive: true });
  await mkdir(path.join(repo, 'Library', 'daily'), { recursive: true });
  note = path.join(repo, 'Library', 'daily', '2026-10-31.md');
  await writeFile(note, '# Today\n');
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('gitBusy', () => {
  it('is false for a repo where git is idle, and for a folder in no repo', async () => {
    expect(await gitBusy(note)).toBe(false);
    await writeFile(path.join(repo, '.git', 'ORIG_HEAD'), 'abc\n');
    await writeFile(path.join(repo, '.git', 'FETCH_HEAD'), 'abc\n');
    expect(await gitBusy(note)).toBe(false);
    await mkdir(path.join(tmp, 'loose'));
    expect(await gitDirOf(path.join(tmp, 'loose'))).toBeNull();
    expect(await gitBusy(path.join(tmp, 'loose', 'note.md'))).toBe(false);
  });

  it.each([
    ['MERGE_AUTOSTASH', 'file'],
    ['MERGE_HEAD', 'file'],
    ['index.lock', 'file'],
    ['rebase-merge', 'folder'],
    ['rebase-apply', 'folder'],
  ])('is true while %s exists, from a file deep in the repo', async (marker, kind) => {
    const target = path.join(repo, '.git', marker);
    if (kind === 'folder') await mkdir(target);
    else await writeFile(target, 'abc\n');
    expect(await gitBusy(note)).toBe(true);
    await rm(target, { recursive: true });
    expect(await gitBusy(note)).toBe(false);
  });

  it('follows a .git file to a worktree or submodule git folder, relative or absolute', async () => {
    const worktree = path.join(tmp, 'worktree');
    const gitDir = path.join(repo, '.git', 'worktrees', 'worktree');
    await mkdir(gitDir, { recursive: true });
    await mkdir(worktree);
    await writeFile(path.join(worktree, '.git'), `gitdir: ${gitDir}\n`);
    const page = path.join(worktree, 'page.md');
    expect(await gitDirOf(worktree)).toBe(gitDir);
    await writeFile(path.join(gitDir, 'MERGE_AUTOSTASH'), 'abc\n');
    expect(await gitBusy(page)).toBe(true);
    // The main checkout's own folder has no marker, so a page there is free.
    expect(await gitBusy(note)).toBe(false);

    await writeFile(path.join(worktree, '.git'), 'gitdir: ../vault/.git/worktrees/worktree\n');
    expect(await gitDirOf(worktree)).toBe(gitDir);
    expect(await gitBusy(page)).toBe(true);
  });

  it('is false when a .git file names no git folder, or one that is gone', async () => {
    const odd = path.join(tmp, 'odd');
    await mkdir(odd);
    await writeFile(path.join(odd, '.git'), 'not a pointer\n');
    expect(await gitDirOf(odd)).toBeNull();
    expect(await gitBusy(path.join(odd, 'page.md'))).toBe(false);
    await writeFile(path.join(odd, '.git'), 'gitdir: ../missing\n');
    expect(await gitBusy(path.join(odd, 'page.md'))).toBe(false);
  });
});
