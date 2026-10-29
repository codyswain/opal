import { STACK_KINDS, type StackKind, type StackSection } from '@/types/stack';
import { recordingName, splitFrontmatter } from './dayModel';
import { validDate } from './vaultModel';

/*
 * Which files a stack shows and in what order. Pure: the main process reads
 * the folders and hands the names in; the renderer uses the path rules.
 */

const DAILY_PAGE = /(?:^|\/)Library\/daily\/(\d{4}-\d{2}-\d{2})\.md$/;
const DAILY_NAME = /^(\d{4}-\d{2}-\d{2})\.md$/;

const RECORDING_HEAD = /(?:^|\/)Library\/recordings\/([^/]+\.md)$/;
const CHAT_HEAD = /(?:^|\/)Library\/chats\/[^/]+\.md$/;

/** At most this many daily pages are listed in one stream. */
export const DAILY_STREAM_LIMIT = 1000;
/** A section's file is read only this far to tell whether its body is empty and how it starts. */
export const PEEK_BYTES = 64 * 1024;
/** A recording's transcript is in this folder beside its summary file. */
export const TRANSCRIPTS_FOLDER = 'transcripts';

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
 * opens alone. A recording's summary file (`Library/recordings/<date> HHMM
 * <title>.md`) opens its recording page and a thread card
 * (`Library/chats/<thread>.md`) its chat page. Daily pages are never
 * upgraded by path: only Today opens the stream, so a daily page opened from
 * anywhere else opens alone. Transcripts and sessions are one folder down,
 * so they open alone too.
 */
export function stackKindForPath(path: string): StackKind | null {
  const recording = RECORDING_HEAD.exec(path);
  if (recording && recordingName(recording[1])) return 'recording';
  if (CHAT_HEAD.test(path)) return 'chat';
  return null;
}

/**
 * The transcript file's name for a summary file's name: `<stem>.md` has its
 * transcript at `transcripts/<stem> transcript.md`. The name rule is the
 * contract with the vault's syncs; the `transcript` field is for Obsidian.
 */
export function transcriptName(summaryName: string): string {
  return `${summaryName.replace(/\.md$/i, '')} transcript.md`;
}

const ATX_HEADING = /^ {0,3}(#{1,6})[ \t]+\S/;

/** The heading a page's text starts with, after at most two blank lines, or null. */
export function leadingHeading(source: string): StackSection['textHeading'] {
  const lines = splitFrontmatter(source).body.split(/\r?\n/, 3);
  for (const [line, text] of lines.entries()) {
    const match = ATX_HEADING.exec(text);
    if (match) return { level: match[1].length, line };
    if (text.trim()) return null;
  }
  return null;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' ? String(value) : null;

const TOOLS: Record<string, string> = { claude: 'Claude', codex: 'Codex' };

/** When a session started, from its `started` field or else the date its file name starts with. Sorts as text. */
export function sessionStarted(fields: Record<string, unknown>, name: string): string {
  return text(fields.started) ?? /^\d{4}-\d\d-\d\d/.exec(name)?.[0] ?? '';
}

/** "2026-10-21 · Claude", as the thread card lists a session. The file name when its fields say neither. */
export function sessionLabel(fields: Record<string, unknown>, name: string): string {
  const date = sessionStarted(fields, name).slice(0, 10);
  const tool = text(fields.tool);
  const shown = tool ? TOOLS[tool.toLowerCase()] ?? tool : null;
  if (!date || !shown) return name.replace(/\.md$/i, '');
  return `${date} · ${shown}`;
}

/** "62 prompts · last active 2026-10-28 13:14", as the thread card has it, or null. */
export function sessionDetail(fields: Record<string, unknown>): string | null {
  const prompts = typeof fields.prompts === 'number' && Number.isInteger(fields.prompts) && fields.prompts >= 0 ? fields.prompts : null;
  const last = text(fields.last);
  const parts = [
    prompts === null ? null : `${prompts} ${prompts === 1 ? 'prompt' : 'prompts'}`,
    last ? `last active ${last}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
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
