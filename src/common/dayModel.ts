import { parse } from 'yaml';
import type {
  DayChat,
  DayDigest,
  DayDigestGroup,
  DayDigestItem,
  DayFile,
  DayLink,
  DayLogEntry,
  DigestLevel,
} from '@/types/day';

/*
 * Reads the files that make up a vault day: log lines, chat transcripts,
 * recording notes and digests. Pure text in, plain data out; the main process
 * finds the files and resolves vault links.
 */

/** A link as written. The main process resolves vault targets to files. */
export type WrittenLink = Omit<DayLink, 'path'>;

export interface ParsedLogEntry {
  time: string;
  until: string | null;
  text: string;
  kind: string | null;
  links: WrittenLink[];
}

/** `- HH:MM[-HH:MM] <sentence> · <link>, <link> · <kind>`; the links part is optional. */
export const LOG_LINE = /^- (\d\d:\d\d)(?:-(\d\d:\d\d))? (.+?)(?: · (.+?))? · ((?:\d+ )?(?:agent turn|routine run|connector call)s?)$/;
/** A line from before the move, `- HH:MM text`, with no kind. */
export const OLD_LOG_LINE = /^- (\d\d:\d\d) (.+)$/;

const FRONTMATTER = /^\ufeff?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/** The frontmatter's fields and the text after it. Broken YAML reads as no fields. */
export function splitFrontmatter(source: string): { data: Record<string, unknown>; body: string } {
  const match = FRONTMATTER.exec(source);
  if (!match) return { data: {}, body: source };
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = parse(match[1] ?? '');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
  } catch {
    // The note still counts; it just has no readable fields.
  }
  return { data, body: source.slice(match[0].length) };
}

const lines = (body: string): string[] => body.split(/\r?\n/);

const textField = (value: unknown): string | null =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null;

const listField = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const WIKI_LINK = String.raw`!?\[\[([^[\]|]+?)(?:\|([^[\]]*))?\]\]`;
const MARKDOWN_LINK = String.raw`!?\[([^[\]]*)\]\((?:<([^<>]+)>|((?:[^()\s]|\([^()\s]*\))+))(?:\s+"[^"]*")?\)`;
const LINK = new RegExp(`${WIKI_LINK}|${MARKDOWN_LINK}`, 'g');
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function decoded(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

/**
 * Takes the wiki and markdown links out of `source`. The text keeps each
 * link's label in its place. Wiki links are vault files; a markdown link is
 * external when its target has a URL scheme.
 */
export function readLinks(source: string): { text: string; links: WrittenLink[] } {
  const links: WrittenLink[] = [];
  const text = source.replace(LINK, (_whole, wikiTarget?: string, wikiLabel?: string, label?: string, angled?: string, plain?: string) => {
    if (wikiTarget !== undefined) {
      const target = wikiTarget.trim();
      const shown = wikiLabel?.trim() || target.split('#')[0].split('/').pop() || target;
      links.push({ label: shown, target, external: false });
      return shown;
    }
    const href = (angled ?? plain ?? '').trim();
    const external = SCHEME.test(href);
    const target = external ? href : decoded(href);
    const shown = label?.trim() || target;
    links.push({ label: shown, target, external });
    return shown;
  });
  return { text, links };
}

/** One log line in the new or the old format, or null for anything else. */
export function parseLogLine(line: string): ParsedLogEntry | null {
  const trimmed = line.trimEnd();
  const current = LOG_LINE.exec(trimmed);
  if (current) {
    const [, time, until, sentence, linkPart, kind] = current;
    const inline = readLinks(sentence);
    return {
      time,
      until: until ?? null,
      text: inline.text,
      kind,
      links: [...inline.links, ...(linkPart ? readLinks(linkPart).links : [])],
    };
  }
  const old = OLD_LOG_LINE.exec(trimmed);
  if (!old) return null;
  // Lines still under an Inbox/Logs heading keep the dash after the time.
  const { text, links } = readLinks(old[2].replace(/^— /, ''));
  return { time: old[1], until: null, text, kind: null, links };
}

/** Every log line in a file, in file order. */
export function parseLog(source: string): ParsedLogEntry[] {
  return lines(splitFrontmatter(source).body).flatMap((line) => {
    const entry = parseLogLine(line);
    return entry ? [entry] : [];
  });
}

/**
 * Latest time first. Machines append out of order, so the file order only
 * breaks ties, and the later line comes first.
 */
export function newestFirst<T extends { time: string }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => b.item.time.localeCompare(a.item.time) || b.index - a.index)
    .map(({ item }) => item);
}

/** Each vault file a day's log links to, once per link, at the time of its line. */
export function logMentions(entries: readonly DayLogEntry[]): DayFile[] {
  return entries.flatMap((entry) =>
    entry.links.flatMap((link) =>
      link.external || !link.path ? [] : [{ path: link.path, label: link.label, last: entry.until ?? entry.time }],
    ),
  );
}

/** One row per file, named by its latest mention, the latest first. */
export function latestFirst(mentions: readonly DayFile[]): DayFile[] {
  const files = new Map<string, DayFile>();
  for (const mention of mentions) {
    const known = files.get(mention.path);
    if (!known || mention.last > known.last) files.set(mention.path, mention);
  }
  return [...files.values()].sort((a, b) => b.last.localeCompare(a.last) || a.label.localeCompare(b.label));
}

export interface ThreadCard {
  /** The card's frontmatter says `type: thread`. */
  isThread: boolean;
  title: string | null;
  status: string | null;
  /** "YYYY-MM-DD HH:MM". */
  created: string | null;
}

/** A thread card, `Library/chats/<thread>.md`. */
export function parseThreadCard(source: string): ThreadCard {
  const { data } = splitFrontmatter(source);
  return {
    isThread: data.type === 'thread',
    title: textField(data.title),
    status: textField(data.status),
    created: textField(data.created),
  };
}

export interface ChatSession {
  /** "YYYY-MM-DD HH:MM". */
  started: string | null;
  last: string | null;
  tool: string | null;
  /** For each date with a stamp in the body: the last stamp's HH:MM and how many prompts Cody sent. */
  days: Record<string, { last: string; prompts: number }>;
}

/**
 * A message stamp: `**Cody** · [date ]HH:MM` or `> [!ai] Claude · [date ]HH:MM`.
 * The date appears when it changes, so a stamp without one belongs to the last date seen.
 */
const STAMP = /^(?:(\*\*)[^*\n]+\*\*|> \[!ai\] ?([^·\n]*?)) · (?:(\d{4}-\d\d-\d\d) )?(\d\d:\d\d)[ \t]*$/;

/** A session transcript, `Library/chats/<thread>/<session>.md`. */
export function parseSession(source: string): ChatSession {
  const { data, body } = splitFrontmatter(source);
  const started = textField(data.started);
  const days: ChatSession['days'] = {};
  let date = started?.slice(0, 10) ?? null;
  for (const line of lines(body)) {
    const stamp = STAMP.exec(line);
    if (!stamp) continue;
    const [, prompt, author, stamped, time] = stamp;
    if (stamped) date = stamped;
    // Task notifications and compaction markers are stamped out of order, and
    // the agent's reply to one carries its own stamp.
    if (!date || author === 'Automated message') continue;
    const day = (days[date] ??= { last: time, prompts: 0 });
    if (time > day.last) day.last = time;
    if (prompt) day.prompts += 1;
  }
  return { started, last: textField(data.last), tool: textField(data.tool), days };
}

export interface IndexedCard {
  /** The thread's folder name under Library/chats. */
  thread: string;
  path: string;
  card: ThreadCard;
}

export interface IndexedSession {
  thread: string;
  path: string;
  session: ChatSession;
}

/**
 * The chats of a day: threads whose card was created that day, and threads
 * with a session that ran that day (started on or before it, last active on or
 * after it, with a stamp on it). One row per thread, latest activity first.
 * The card's `updated` field is not used: it holds only the latest activity.
 */
export function chatsForDay(date: string, cards: readonly IndexedCard[], sessions: readonly IndexedSession[]): DayChat[] {
  const cardOf = new Map(cards.filter(({ card }) => card.isThread).map((entry) => [entry.thread, entry]));
  const chats = new Map<string, DayChat & { active: string | null }>();
  const chatFor = (thread: string, fallback: string) => {
    let chat = chats.get(thread);
    if (!chat) {
      const card = cardOf.get(thread);
      chat = {
        path: card?.path ?? fallback,
        title: card?.card.title ?? thread,
        status: card?.card.status ?? null,
        tool: null,
        isNew: card?.card.created?.startsWith(date) ?? false,
        created: card?.card.created ?? null,
        last: '',
        prompts: 0,
        active: null,
      };
      chats.set(thread, chat);
    }
    return chat;
  };
  for (const { thread, path, card } of cardOf.values()) {
    if (card.created?.startsWith(date)) chatFor(thread, path);
  }
  for (const { thread, path, session } of sessions) {
    const day = session.days[date];
    if (!day) continue;
    if (session.started && session.started.slice(0, 10) > date) continue;
    if (session.last && session.last.slice(0, 10) < date) continue;
    const chat = chatFor(thread, path);
    chat.prompts += day.prompts;
    if (chat.active === null || day.last > chat.active) {
      chat.active = day.last;
      chat.tool = session.tool;
      if (!cardOf.has(thread)) chat.path = path;
    }
  }
  return [...chats.values()]
    .map(({ active, ...chat }) => ({ ...chat, last: active ?? chat.created?.slice(11, 16) ?? '' }))
    .sort((a, b) => b.last.localeCompare(a.last) || a.title.localeCompare(b.title));
}

/** `<date> HHMM <name>.md`, the way Meet and Pocket notes are named. */
const RECORDING_NAME = /^(\d{4}-\d\d-\d\d) (\d\d)(\d\d) (.+)\.md$/;

/** The date, time and title in a recording note's file name, or null when it is not one. */
export function recordingName(name: string): { date: string; time: string; title: string } | null {
  const match = RECORDING_NAME.exec(name);
  if (!match) return null;
  return { date: match[1], time: `${match[2]}:${match[3]}`, title: match[4].replace(/ \((?:Meet|Pocket)\)$/, '') };
}

export interface ParsedRecording {
  title: string | null;
  source: string | null;
  durationMin: number | null;
  speakers: string[];
  attendees: string[];
  hasSummary: boolean;
  links: WrittenLink[];
  /**
   * A transcript file, which links back to its summary file in a
   * `recording` field. Transcripts live in `transcripts/` below the
   * summaries, so a day lists each recording once, by its summary file.
   */
  isTranscript: boolean;
}

/** Whether a Summary section holds more than a placeholder such as "_Gemini has not written notes for this meeting yet._". */
function summaryHasText(body: string[]): boolean {
  const start = body.findIndex((line) => /^## +Summary\s*$/.test(line));
  if (start < 0) return false;
  for (const line of body.slice(start + 1)) {
    if (/^## /.test(line)) break;
    const value = line.trim();
    if (!value || /^_.+_$/.test(value)) continue;
    // Gemini writes this notice in place of a summary.
    return !value.startsWith("A summary wasn't produced");
  }
  return false;
}

/**
 * A recording note, `Library/recordings/<date> HHMM <name>.md`: since the
 * split, the summary file with the links and action items, whose transcript
 * is `transcripts/<name> transcript.md`; before it, one file holding both.
 */
export function parseRecording(source: string): ParsedRecording {
  const { data, body } = splitFrontmatter(source);
  const bodyLines = lines(body);
  const firstSection = bodyLines.findIndex((line) => /^## /.test(line));
  const header = (firstSection < 0 ? bodyLines : bodyLines.slice(0, firstSection)).filter((line) => !/^# /.test(line));
  const duration = typeof data.duration_min === 'number' ? data.duration_min : Number.parseFloat(textField(data.duration_min) ?? '');
  return {
    title: textField(data.title),
    source: textField(data.source),
    durationMin: Number.isFinite(duration) ? duration : null,
    speakers: listField(data.speakers),
    attendees: listField(data.attendees),
    hasSummary: summaryHasText(bodyLines),
    links: readLinks(header.join('\n')).links.filter((link) => link.external),
    isTranscript: textField(data.recording) !== null,
  };
}

const PRIORITY_EMOJI: Record<string, DigestLevel> = {
  '🔴': 'high',
  '🟠': 'medium',
  '🟡': 'medium',
  '🟢': 'low',
  '⚪': 'low',
  '⚫': 'low',
};
const PRIORITY_WORD: Record<string, DigestLevel> = { urgent: 'high', high: 'high', medium: 'medium', low: 'low' };
const EMOJI_ITEM = new RegExp(`^[-*] (${Object.keys(PRIORITY_EMOJI).join('|')})\\uFE0F?\\s*(.+)$`, 'u');
const LIST_ITEM = /^(?:[-*+]|\d+[.)]) +(.+)$/;
/** A checkbox item at column 0, `- [ ] title`. The skill writes `- `; other markers still read. */
export const DIGEST_CHECKBOX = /^(?:[-*+]|\d+[.)]) \[([ xX])\] (.+)$/;
/** A line under a checkbox item: indented by two or more spaces or a tab. */
const DETAIL_LINE = /^(?: {2,}|\t)\S/;
/** The priority word an Also worth doing item starts with, then a colon or a period: "High:" or "High.". */
const PRIORITY_LEAD = /^(urgent|high|medium|low)\s*[:.]\s*/i;
/** A title that starts with a bold run and goes on after it: `**Send Tom the offer.** He asked today.` */
const BOLD_LEAD = /^(\*\*|__)(.+?)\1\s*(.*)$/;
const SECTION = /^## +(.+?)(?: +#+)?\s*$/;
const FOLDED_CALLOUT = /^> ?\[![^\]]+\][-+] *(.*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const REPLY_DRAFTED = /\s*\(reply drafted\)\s*$/i;

/** Text without links, bold or code marks, on one line. */
function plainText(value: string): string {
  return readLinks(value).text.replace(/\*\*|__/g, '').replace(/`([^`]*)`/g, '$1').replace(/\s+/g, ' ').trim();
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function digestItem(value: string, capitalize = false): DayDigestItem {
  const replyDrafted = REPLY_DRAFTED.test(value);
  const text = plainText(value.replace(REPLY_DRAFTED, ''));
  return { text: capitalize ? capitalized(text) : text, detail: null, replyDrafted, checked: null, at: null };
}

/**
 * The priority word an Also worth doing item starts with, inside its bold
 * run or before it, and the item without it. `**High.** Ask Jack` leaves an
 * empty bold run, which goes too.
 */
function priorityLead(raw: string): { level: DigestLevel; rest: string } | null {
  const bold = /^(\*\*|__)/.exec(raw)?.[1] ?? '';
  const word = PRIORITY_LEAD.exec(raw.slice(bold.length));
  if (!word) return null;
  const rest = (bold + raw.slice(bold.length + word[0].length)).replace(/^(\*\*|__)\1\s*/, '');
  return { level: PRIORITY_WORD[word[1].toLowerCase()], rest };
}

/** A folded callout's title: its bold lead, or the whole title without one. */
function calloutTitle(title: string): string {
  return (/^\*\*(.+?)\*\*/.exec(title)?.[1] ?? title).trim();
}

interface OpenCheckbox {
  item: DayDigestItem;
  /** The title as written, after the checkbox. */
  title: string;
  details: string[];
  /** Set for Also worth doing, which sorts by the priority word. */
  also: boolean;
}

/**
 * A checkbox item with its detail. "(reply drafted)" is read from the end of
 * the item's last line, the title's or the detail's. In Also worth doing the
 * title starts with a priority word, which sets the group. An item written
 * on one line, a bold run and then more text, takes the bold run as its
 * title and the rest as its detail.
 */
function closeCheckbox(open: OpenCheckbox): { item: DayDigestItem; level: DigestLevel } {
  const lastIsTitle = open.details.length === 0;
  const last = lastIsTitle ? open.title : open.details[open.details.length - 1];
  const replyDrafted = REPLY_DRAFTED.test(last);
  if (replyDrafted) {
    if (lastIsTitle) open.title = open.title.replace(REPLY_DRAFTED, '');
    else open.details[open.details.length - 1] = last.replace(REPLY_DRAFTED, '');
  }
  let title = open.title;
  let details = open.details;
  let level: DigestLevel = 'medium';
  const lead = open.also ? priorityLead(title) : null;
  if (lead) {
    level = lead.level;
    title = lead.rest;
  }
  const bold = details.length === 0 ? BOLD_LEAD.exec(title) : null;
  if (bold && bold[3].trim()) {
    title = bold[2].replace(/[.:]\s*$/, '');
    details = [bold[3]];
  }
  const text = lead ? capitalized(plainText(title)) : plainText(title);
  const detail = plainText(details.join(' '));
  return { item: { ...open.item, text, detail: detail || null, replyDrafted }, level };
}

/**
 * A morning digest, `Library/digests/<date> digest.md`. With a Top 3 section,
 * the top group is the Top 3 and "Also worth doing" fills the other groups by
 * its priority word (Urgent counts as high). Items there are checkboxes, each
 * a title line with its detail indented below; a checkbox records its line,
 * so a tick can be written back to that line alone. Older digests number
 * their items, or mark each one with a priority emoji instead, and have no
 * checkboxes. The emoji never reaches the output.
 */
export function parseDigest(source: string): Omit<DayDigest, 'path'> {
  let title = '';
  let section: string | null = null;
  let fence: string | null = null;
  let open: OpenCheckbox | null = null;
  const sections: string[] = [];
  const top: DayDigestItem[] = [];
  const also: Record<DigestLevel, DayDigestItem[]> = { high: [], medium: [], low: [] };
  const marked: Record<DigestLevel, DayDigestItem[]> = { high: [], medium: [], low: [] };
  let hasTop = false;
  let afterBlank = false;
  const close = () => {
    if (!open) return;
    const { item, level } = closeCheckbox(open);
    if (open.also) also[level].push(item);
    else top.push(item);
    open = null;
  };
  for (const [index, line] of lines(splitFrontmatter(source).body).entries()) {
    const marker = FENCE.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
      continue;
    }
    if (fence) continue;
    const blank = !line.trim();
    const follows = !afterBlank;
    afterBlank = blank;
    // Blank lines inside the list do not end an item; indented lines are its detail.
    if (open && blank) continue;
    // So is a line right under it at the margin, which Markdown reads as part of the item.
    if (open && (DETAIL_LINE.test(line) || (follows && !LIST_ITEM.test(line) && !/^(?:#|>)/.test(line)))) {
      (open as OpenCheckbox).details.push(line.trim());
      continue;
    }
    close();
    if (!title && line.startsWith('# ')) {
      title = line.slice(2).trim();
      continue;
    }
    const heading = SECTION.exec(line);
    if (heading) {
      section = heading[1].trim().toLowerCase();
      sections.push(heading[1].trim());
      if (section === 'top 3') hasTop = true;
      continue;
    }
    const callout = FOLDED_CALLOUT.exec(line);
    if (callout) {
      const name = calloutTitle(callout[1]);
      if (name) sections.push(name);
      continue;
    }
    const emoji = EMOJI_ITEM.exec(line);
    if (emoji) {
      marked[PRIORITY_EMOJI[emoji[1]]].push(digestItem(emoji[2]));
      continue;
    }
    if (section !== 'top 3' && section !== 'also worth doing') continue;
    const checkbox = DIGEST_CHECKBOX.exec(line);
    if (checkbox) {
      open = {
        item: { text: '', detail: null, replyDrafted: false, checked: /x/i.test(checkbox[1]), at: { line: index, raw: line } },
        title: checkbox[2],
        details: [],
        also: section === 'also worth doing',
      };
      continue;
    }
    const item = LIST_ITEM.exec(line)?.[1];
    if (!item) continue;
    if (section === 'top 3') top.push(digestItem(item));
    else {
      const lead = priorityLead(item);
      // An item without a priority word is neither raised nor dropped.
      also[lead?.level ?? 'medium'].push(digestItem(lead ? lead.rest : item, Boolean(lead)));
    }
  }
  close();
  const levels = hasTop ? also : marked;
  const groups: DayDigestGroup[] = [];
  if (hasTop && top.length) groups.push({ level: 'top', items: top });
  for (const level of ['high', 'medium', 'low'] as const) {
    if (levels[level].length) groups.push({ level, items: levels[level] });
  }
  return { title, groups, sections };
}

/**
 * The checkbox line `raw` ticked or cleared: only the character between the
 * brackets changes. Null when `raw` is not a digest checkbox line.
 */
export function digestCheckboxLine(raw: string, checked: boolean): string | null {
  const match = DIGEST_CHECKBOX.exec(raw);
  if (!match) return null;
  const at = raw.indexOf('[') + 1;
  return `${raw.slice(0, at)}${checked ? 'x' : ' '}${raw.slice(at + 1)}`;
}
