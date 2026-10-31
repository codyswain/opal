import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';

/**
 * What git keeps in its folder while it rewrites the working tree.
 * `git merge --autostash`, which the vault's vault-pull.sh runs before every
 * agent prompt, writes MERGE_AUTOSTASH before it resets uncommitted files to
 * HEAD and removes it after it has put them back. MERGE_HEAD stands while a
 * merge is in progress, index.lock while git writes the index, and the rebase
 * folders while a rebase runs.
 */
const MARKERS = new Set(['MERGE_AUTOSTASH', 'MERGE_HEAD', 'index.lock', 'rebase-merge', 'rebase-apply']);

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
  const names = await readdir(gitDir).catch(() => [] as string[]);
  return names.some((name) => MARKERS.has(name));
}
