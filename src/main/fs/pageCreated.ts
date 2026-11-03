import { execFile } from 'child_process';
import { lstat } from 'fs/promises';
import path from 'path';
import { DAY_LAYOUT, LEGACY_DAY_LAYOUT } from '@/main/vault/vaultPaths';
import type { PageCreated, PageProperty } from '@/types/markdown';

/*
 * When a page was created, for its properties block. The file's birth time
 * cannot say: every save replaces the file, and a pull or checkout on another
 * Mac writes it anew.
 */

/** Daily pages and logs are named for their day, so their `date` is the day they began. */
const DAY_FOLDERS: readonly string[] = [DAY_LAYOUT.daily, DAY_LAYOUT.logs, LEGACY_DAY_LAYOUT.logs];

/** A lookup slower than this leaves the row out. */
const GIT_TIMEOUT_MS = 3000;
/** A file with no commit yet is asked about again after this long. */
const UNCOMMITTED_RETRY_MS = 30_000;

const STATED_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * A frontmatter time: "2026-10-28" as that day, "2026-10-28 09:12" in local
 * time, or an ISO time with its offset. Null for anything else.
 */
export function parseStatedTime(value: string | undefined): PageCreated | null {
  const text = value?.trim();
  if (!text) return null;
  const match = STATED_TIME.exec(text);
  if (!match) {
    const ms = /^\d{4}-\d{2}-\d{2}T/.test(text) ? Date.parse(text) : NaN;
    return Number.isFinite(ms) ? { ms, dayOnly: false } : null;
  }
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map((part) => Number(part ?? 0));
  const at = new Date(year, month - 1, day, hour, minute, second);
  // Date rolls 2026-02-30 over into March; such a value is not a date.
  if (at.getMonth() !== month - 1 || at.getDate() !== day || hour > 23 || minute > 59 || second > 59) return null;
  return { ms: at.getTime(), dayOnly: match[4] === undefined };
}

/**
 * When files were first committed, from the git history of the opened folder
 * that holds them. Only a folder with its own `.git` is asked, so opening a
 * folder that is not a repository never starts git.
 */
export class PageHistory {
  private readonly known = new Map<string, { ms: number | null; at: number }>();

  async addedAt(root: string, relativePath: string): Promise<number | null> {
    const key = path.join(root, relativePath);
    const cached = this.known.get(key);
    if (cached && (cached.ms !== null || Date.now() - cached.at < UNCOMMITTED_RETRY_MS)) return cached.ms;
    const ms = await firstCommit(root, relativePath);
    this.known.set(key, { ms, at: Date.now() });
    return ms;
  }
}

async function firstCommit(root: string, relativePath: string): Promise<number | null> {
  try {
    await lstat(path.join(root, '.git'));
  } catch {
    return null;
  }
  return new Promise((resolve) => {
    execFile(
      'git',
      // --follow follows copies as well as renames. A daily page the hook
      // started from the template shows as a copy of it, and the template's
      // older history is not the page's, so the newest add or copy is where
      // the page began.
      ['--literal-pathspecs', '-c', 'core.fsmonitor=false', 'log', '--follow', '--diff-filter=AC', '-1', '--format=%at', '--', relativePath],
      { cwd: root, timeout: GIT_TIMEOUT_MS, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } },
      (error, stdout) => {
        const seconds = Number(stdout.trim());
        resolve(!error && stdout.trim() !== '' && Number.isFinite(seconds) ? seconds * 1000 : null);
      },
    );
  });
}

/**
 * In order: the frontmatter's `created`; the `date` of a daily page or log;
 * the commit that added the file, following renames. Null when none says.
 */
export async function pageCreated(
  frontmatter: readonly PageProperty[],
  root: string | null,
  relativePath: string,
  history: Pick<PageHistory, 'addedAt'> | undefined,
): Promise<PageCreated | null> {
  const field = (key: string) => frontmatter.find((property) => property.key === key)?.values[0];
  const stated = parseStatedTime(field('created'));
  if (stated) return stated;
  if (DAY_FOLDERS.includes(path.posix.dirname(relativePath))) {
    const day = parseStatedTime(field('date'));
    if (day) return day;
  }
  if (!root || !history) return null;
  const ms = await history.addedAt(root, relativePath);
  return ms === null ? null : { ms, dayOnly: false };
}
