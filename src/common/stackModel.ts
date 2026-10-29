import { STACK_KINDS, type StackKind } from '@/types/stack';
import { splitFrontmatter } from './dayModel';
import { validDate } from './vaultModel';

/*
 * Which files a stack shows and in what order. Pure: the main process reads
 * the folders and hands the names in; the renderer uses the path rules.
 */

const DAILY_PAGE = /(?:^|\/)Library\/daily\/(\d{4}-\d{2}-\d{2})\.md$/;
const DAILY_NAME = /^(\d{4}-\d{2}-\d{2})\.md$/;

/** At most this many daily pages are listed in one stream. */
export const DAILY_STREAM_LIMIT = 1000;
/** Past daily pages are read only this far to tell whether their body is empty. */
export const DAILY_PEEK_BYTES = 64 * 1024;

export function isStackKind(value: unknown): value is StackKind {
  return typeof value === 'string' && (STACK_KINDS as readonly string[]).includes(value);
}

/** The date of a page directly in `Library/daily`, or null for any other path. */
export function dailyHeadDate(path: string): string | null {
  const match = DAILY_PAGE.exec(path);
  return match && validDate(match[1]) ? match[1] : null;
}

/**
 * The kind of stack a plain open of `path` becomes, or null when the file
 * opens alone. Daily pages are never upgraded by path: only Today opens the
 * stream, so a daily page opened from anywhere else opens alone.
 */
export function stackKindForPath(path: string): StackKind | null {
  void path;
  return null;
}

/** Whether `path` can head a stack of `kind`. */
export function isStackHead(kind: StackKind, path: string): boolean {
  switch (kind) {
    case 'daily':
      return dailyHeadDate(path) !== null;
    default:
      return stackKindForPath(path) === kind;
  }
}

/**
 * The names in a daily folder that a stream headed by `headDate` shows after
 * the head, newest first: valid dated names, none dated after the head, the
 * head itself left out. At most `limit` names.
 */
export function dailyStreamNames(names: readonly string[], headDate: string, limit = DAILY_STREAM_LIMIT): string[] {
  const dates = new Set<string>();
  for (const name of names) {
    const match = DAILY_NAME.exec(name);
    if (match && validDate(match[1]) && match[1] < headDate) dates.add(match[1]);
  }
  return [...dates].sort().reverse().slice(0, limit).map((date) => `${date}.md`);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function noon(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date, 12);
}

/** "Today", "Yesterday", or the weekday: the muted text after a daily section's date. */
export function dailyDetail(date: string, today: string): string {
  if (date === today) return 'Today';
  const yesterday = noon(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const at = noon(date);
  if (at.getFullYear() === yesterday.getFullYear() && at.getMonth() === yesterday.getMonth() && at.getDate() === yesterday.getDate()) {
    return 'Yesterday';
  }
  return WEEKDAYS[at.getDay()];
}

/** Whether a page has nothing but whitespace after its frontmatter. */
export function isBlankPage(source: string): boolean {
  return splitFrontmatter(source).body.trim().length === 0;
}

const LOG_PAGE = /(^|\/)Library\/logs\/[^/]+\.md$/;

/**
 * Whether Opal shows a page read-only, alone and in a stack. Logs in
 * `Library/logs` are written only by the vault's scripts.
 */
export function readOnlyRule(path: string): boolean {
  return LOG_PAGE.test(path);
}
