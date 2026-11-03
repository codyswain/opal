import { lstat } from 'fs/promises';
import path from 'path';
import { repoOf } from '@/main/fs/gitActivity';
import type { FileStatus } from '@/types/files';
import { FilesError } from './FileStore';
import { FolderStore, untilGitIdle } from './FolderStore';
import { PLACEHOLDER_LIMIT, localObject, readPlaceholder } from './lfsPlaceholder';

/** A slow file store still answers in this time; the connect itself gives up after 5 s. */
const FETCH_TIMEOUT_MS = 5 * 60_000;

/**
 * The `-I` pattern that names one file to git lfs fetch, from the repo's
 * top. Names from Obsidian can hold brackets, so wildcards are escaped. `-I`
 * splits its value at commas, so for a name with one the whole folder is
 * fetched instead.
 */
export function lfsInclude(relative: string): string {
  const escape = (value: string) => value.replace(/[[\]*?]/g, '\\$&');
  if (!relative.includes(',')) return escape(relative);
  let folder = path.posix.dirname(relative);
  while (folder.includes(',')) folder = path.posix.dirname(folder);
  if (folder === '.') throw new FilesError('Opal cannot download a file whose folder name has a comma.');
  return `${escape(folder)}/**`;
}

/**
 * The environment for git: no password prompt, and Homebrew's folder on the
 * PATH, since an app opened from the Dock lacks it and git-lfs lives there.
 */
const gitEnvironment = (): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  PATH: ['/opt/homebrew/bin', process.env.PATH].filter(Boolean).join(':'),
});

/**
 * A folder git sends to Git LFS. A file whose bytes have not been downloaded
 * is a small placeholder in the working tree; its bytes, once fetched, sit
 * in git's object store. Opal never writes LFS files into the working tree:
 * it shows them from the object store (see protocol/opalFile.ts).
 */
export class GitLfsStore extends FolderStore {
  async status(target: string): Promise<FileStatus> {
    const info = await lstat(target).catch(() => null);
    if (!info?.isFile()) return 'missing';
    const placeholder = info.size < PLACEHOLDER_LIMIT ? await readPlaceholder(target) : null;
    if (!placeholder) return 'here';
    return (await localObject(target, placeholder)) ? 'here' : 'remote';
  }

  /** Runs git lfs fetch for one file, which writes only inside git's object store. */
  async fetch(target: string): Promise<FileStatus> {
    const status = await this.status(target);
    if (status !== 'remote') return status;
    const repo = await repoOf(path.dirname(target));
    if (!repo) throw new FilesError('This folder is not in a git repository.');
    await untilGitIdle(target);
    const relative = path.relative(repo.top, target).split(path.sep).join('/');
    try {
      await this.run(
        'git',
        ['-c', 'lfs.fetchexclude=', '-c', 'lfs.dialtimeout=5', 'lfs', 'fetch', '-I', lfsInclude(relative)],
        { cwd: repo.top, timeout: FETCH_TIMEOUT_MS, env: gitEnvironment() },
      );
    } catch (error) {
      const said = String((error as { stderr?: unknown }).stderr ?? '').trim().split('\n').pop();
      throw new FilesError(`Could not download ${path.basename(target)}.${said ? ` ${said}` : ''}`);
    }
    return this.status(target);
  }
}
