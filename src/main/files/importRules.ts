import { constants } from 'fs';
import { lstat, open, realpath } from 'fs/promises';
import path from 'path';
import { repoOf } from '@/main/fs/gitActivity';
import { isInsideRoot } from '@/main/fs/paths';
import { FILE_IMPORT_LIMIT } from '@/types/files';
import { FilesError, runFile, type RunFile } from './FileStore';
import { gitEnvironment } from './GitLfsStore';

const GIT_TIMEOUT_MS = 5000;
const PLUTIL = '/usr/bin/plutil';
/** A .webloc or .url holds one address; a larger file is not one. */
const SHORTCUT_LIMIT = 64 * 1024;

/** What a dropped file already in the vault becomes: a link to it where it is. */
export interface LinkedInPlace {
  path: string;
  vaultPath: string;
  warning?: string;
}

/**
 * A dropped file that is already in the vault is linked where it is, so
 * notes and files are never copied into the files folder a second time.
 * Not when git ignores its folder (`.trash/`, `.claude/state/`), since its
 * link would break on the other Macs. A file git ignores by its own name
 * (`.env`) is linked where it is, since a copy would land where git tracks
 * it. git's own files are refused. A file over 100 MB that git will not
 * send to LFS gets a warning, since GitHub refuses blobs that large.
 */
export async function linkInPlace(root: string, file: string, git: RunFile = runFile): Promise<LinkedInPlace | null> {
  const real = await realpath(file).catch(() => null);
  if (!real || real === root || !isInsideRoot(root, real)) return null;
  const segments = path.relative(root, real).split(path.sep);
  // .git/config can hold a remote address with a token in it.
  if (segments.includes('.git')) throw new FilesError("Files inside .git can't be added.");
  const info = await lstat(real);
  if (!info.isFile()) return null;
  const folder = path.dirname(real);
  const repo = await repoOf(folder);
  if (repo && folder !== repo.top && (await askGit(git, repo.top, ['check-ignore', '-q', '--', folder])) === 0) return null;
  const linked: LinkedInPlace = { path: real, vaultPath: segments.join('/') };
  if (repo && info.size > FILE_IMPORT_LIMIT) {
    const attributes = await gitOutput(git, repo.top, ['check-attr', 'filter', '--', real]);
    if (!/: filter: lfs\s*$/m.test(attributes)) {
      linked.warning = `"${path.basename(real)}" is larger than 100 MB and is not in Git LFS, so GitHub will refuse it.`;
    }
  }
  return linked;
}

/** Git's exit code: 0 or 1 for check-ignore's answer; anything else (no git, a timeout) as -1. */
async function askGit(git: RunFile, top: string, args: string[]): Promise<number> {
  try {
    await git('git', args, { cwd: top, timeout: GIT_TIMEOUT_MS, env: gitEnvironment() });
    return 0;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'number' ? code : -1;
  }
}

async function gitOutput(git: RunFile, top: string, args: string[]): Promise<string> {
  try {
    return (await git('git', args, { cwd: top, timeout: GIT_TIMEOUT_MS, env: gitEnvironment() })).stdout;
  } catch {
    return '';
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * The address a Safari or Chrome `.webloc` (an XML or binary property list)
 * or a Windows `.url` holds. Only web and mail addresses: a shortcut to a
 * file or an app's URL scheme is refused.
 */
export async function shortcutUrl(file: string, run: RunFile = runFile): Promise<string> {
  const name = path.basename(file);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null);
  if (!handle) throw new FilesError(`Could not read "${name}".`);
  let text: string;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > SHORTCUT_LIMIT) throw new FilesError(`"${name}" is not a link Opal can read.`);
    text = await handle.readFile('latin1');
  } finally {
    await handle.close();
  }
  let url: string | undefined;
  if (text.startsWith('bplist00')) {
    url = (await run(PLUTIL, ['-extract', 'URL', 'raw', '-o', '-', '--', file], { timeout: GIT_TIMEOUT_MS }).catch(() => ({ stdout: '' }))).stdout.trim();
  } else if (/<plist\b/.test(text)) {
    url = /<key>\s*URL\s*<\/key>\s*<string>([^<]*)<\/string>/.exec(Buffer.from(text, 'latin1').toString('utf8'))?.[1]
      ?.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity: string) => ENTITIES[entity]).trim();
  } else {
    url = /^\s*URL\s*=\s*(\S+)\s*$/im.exec(Buffer.from(text, 'latin1').toString('utf8'))?.[1];
  }
  let parsed: URL | null = null;
  try {
    parsed = url ? new URL(url) : null;
  } catch {
    parsed = null;
  }
  if (!parsed || !['http:', 'https:', 'mailto:'].includes(parsed.protocol)) throw new FilesError(`"${name}" does not hold a web address.`);
  return parsed.href;
}
