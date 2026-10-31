import { readFile, stat } from 'fs/promises';
import path from 'path';

/**
 * What git keeps in its folder while it rewrites the working tree.
 * `git merge --autostash`, which the vault's vault-pull.sh runs before every
 * agent prompt, writes MERGE_AUTOSTASH before it resets uncommitted files to
 * HEAD and removes it after it has put them back. A rebase with --autostash
 * keeps its stash in its own folder the same way. MERGE_HEAD and the bare
 * rebase folders are left out: they also stay while a merge or rebase that
 * stopped on a conflict waits for a person, and would hold every save in the
 * repo until then.
 */
const MARKERS = ['MERGE_AUTOSTASH', 'rebase-merge/autostash', 'rebase-apply/autostash'];
/** Git holds index.lock while it writes the index, for milliseconds; an older one was left by a git that was killed. */
const LOCK_STALE_MS = 10_000;

/**
 * The git folder of the repo that holds `directory`, or null outside a repo.
 * In a linked worktree or a submodule `.git` is a file whose `gitdir:` line
 * names the folder.
 */
export async function gitDirOf(directory: string): Promise<string | null> {
  for (let current = directory; ; current = path.dirname(current)) {
    const dotGit = path.join(current, '.git');
    const info = await stat(dotGit).catch(() => null);
    if (info?.isDirectory()) return dotGit;
    if (info?.isFile()) {
      const line = /^gitdir:[ \t]*(.+?)[ \t]*$/m.exec(await readFile(dotGit, 'utf8').catch(() => ''));
      return line ? path.resolve(current, line[1]) : null;
    }
    if (path.dirname(current) === current) return null;
  }
}

/** True while git is rewriting the repo that holds `file`; false when it is idle or there is no repo. */
export async function gitBusy(file: string): Promise<boolean> {
  const gitDir = await gitDirOf(path.dirname(file));
  if (!gitDir) return false;
  const found = await Promise.all([
    ...MARKERS.map((marker) => stat(path.join(gitDir, marker)).then(() => true, () => false)),
    stat(path.join(gitDir, 'index.lock')).then((lock) => Date.now() - lock.mtimeMs < LOCK_STALE_MS, () => false),
  ]);
  return found.includes(true);
}
