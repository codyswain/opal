import { lstat } from 'fs/promises';
import path from 'path';
import { repoOf } from '@/main/fs/gitActivity';
import type { FileStatus } from '@/types/files';
import { FilesError } from './FileStore';
import { FolderStore, untilGitIdle } from './FolderStore';
import { localObject, readPlaceholder } from './lfsPlaceholder';

/** A slow file store still answers in this time. */
const FETCH_TIMEOUT_MS = 5 * 60_000;
/**
 * A store that is asleep or off gives up in seconds, not after git-lfs's
 * eight retries: the settings the vault's own lfs-sync.sh uses.
 */
const SHORT_TIMEOUTS = ['-c', 'lfs.dialtimeout=5', '-c', 'lfs.tlstimeout=5', '-c', 'lfs.activitytimeout=30', '-c', 'lfs.transfer.maxretries=1'];

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

/** Variables that point git at another repo; a git hook sets them for its own. */
const REPO_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX', 'GIT_OBJECT_DIRECTORY'];

/**
 * The environment for git: no password prompt, Homebrew's folder on the
 * PATH, since an app opened from the Dock lacks it and git-lfs lives there,
 * and no variable that would make git answer for some other repo.
 */
export const gitEnvironment = (): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', PATH: ['/opt/homebrew/bin', process.env.PATH].filter(Boolean).join(':') };
  for (const name of REPO_VARIABLES) delete environment[name];
  return environment;
};

/**
 * A folder git sends to Git LFS. A file whose bytes have not been downloaded
 * is a small placeholder in the working tree; its bytes, once fetched, sit
 * in git's object store. Opal never writes LFS files into the working tree:
 * it shows them from the object store (see protocol/opalFile.ts).
 */
export class GitLfsStore extends FolderStore {
  async status(target: string): Promise<FileStatus> {
    if (!(await lstat(target).catch(() => null))?.isFile()) return 'missing';
    const placeholder = await readPlaceholder(target);
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
        ['-c', 'lfs.fetchexclude=', ...SHORT_TIMEOUTS, 'lfs', 'fetch', '-I', lfsInclude(relative)],
        { cwd: repo.top, timeout: FETCH_TIMEOUT_MS, env: gitEnvironment() },
      );
    } catch (error) {
      const { killed, stderr } = error as { killed?: boolean; stderr?: unknown };
      const said = killed ? 'The file store did not answer in time.' : String(stderr ?? '').trim().split('\n').pop();
      throw new FilesError(`Could not download ${path.basename(target)}.${said ? ` ${said}` : ''}`);
    }
    return this.status(target);
  }
}
