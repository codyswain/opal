import { classifyFile, fileTreeLabel } from './fileKind';
import type { TouchedHit, TouchedItem, TouchedKind, TouchedWeek } from '@/types/touched';

/*
 * The "touched" list beside each daily page: what the agent turns of a week's
 * activity logs linked to, and on which days. Pure data in, plain data out;
 * the main process reads the logs and the `.opal` files.
 */

/** Colours the palette has; items past the eighth take them again in turn. */
export const TOUCHED_COLOURS = 8;
/** Rows a day shows at most. */
export const TOUCHED_LIMIT = 8;

/** A log link after resolving: `file` is the vault file's path from the folder's top, with forward slashes, or null. */
export interface TouchedLink {
  label: string;
  target: string;
  external: boolean;
  file: string | null;
}

export interface TouchedEntry {
  /** HH:MM; the end of a folded range when it has one. */
  time: string;
  text: string;
  kind: string | null;
  links: TouchedLink[];
}

/** `.opal/touched.json`, written by hand or by scripts and never by Opal. */
export interface TouchedConfig {
  /** Folder patterns from the folder's top; `*` matches one path segment. A file below a match counts as that folder. */
  groups: string[];
  /** Path prefixes from the folder's top whose files are left out. */
  ignore: string[];
}

export const EMPTY_TOUCHED_CONFIG: TouchedConfig = { groups: [], ignore: [] };

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim()) : [];

/** The config in parsed JSON; anything unreadable is left out. */
export function touchedConfig(json: unknown): TouchedConfig {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return EMPTY_TOUCHED_CONFIG;
  const { groups, ignore } = json as Record<string, unknown>;
  return { groups: strings(groups).map((group) => group.replace(/^\/+|\/+$/g, '')).filter(Boolean), ignore: strings(ignore) };
}

/** `.opal/link-titles.json`: item keys to titles, kept by a script outside Opal. */
export function linkTitles(json: unknown): Record<string, string> {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {};
  const titles: Record<string, string> = {};
  for (const [key, title] of Object.entries(json as Record<string, unknown>)) {
    if (typeof title === 'string' && title.trim()) titles[key] = title.trim();
  }
  return titles;
}

/** The Monday of the week `date` is in. */
export function mondayOf(date: string): string {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

/** The seven dates of the week that starts on `monday`. */
export function weekDates(monday: string): string[] {
  return Array.from({ length: 7 }, (_, offset) => {
    const day = new Date(`${monday}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() + offset);
    return day.toISOString().slice(0, 10);
  });
}

/** 0 for Monday to 6 for Sunday. */
export function weekdayIndex(date: string): number {
  return (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
}

/** A line the list counts: an agent turn, in either number. */
export const countsAsTouch = (kind: string | null) => kind !== null && /\bagent turns?$/.test(kind);

interface LinkItem {
  key: string;
  kind: TouchedKind;
  id: string | null;
  /** The vault file linked, for files and groups. */
  file: string | null;
  url: string | null;
}

const LINEAR = /^https?:\/\/(?:www\.)?linear\.app\/.*?\/issue\/([a-z][a-z0-9]*-\d+)/i;
const GITHUB_PR = /^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)\/pull\/(\d+)/i;
const GOOGLE_DOC = /^https?:\/\/docs\.google\.com\/[a-z]+\/(?:u\/\d+\/)?d\/([a-z0-9_-]+)/i;

/** Whether a folder pattern such as `Projects/*` matches the first segments of `segments`. */
const patternMatches = (pattern: string[], segments: string[]) =>
  pattern.every((part, index) => part === '*' || part === segments[index]);

/** The item a link counts as, or null when the list leaves it out. */
export function linkItem(link: TouchedLink, config: TouchedConfig, skipFile: (file: string) => boolean): LinkItem | null {
  if (link.external) {
    const url = link.target;
    const issue = LINEAR.exec(url);
    if (issue) {
      const id = issue[1].toUpperCase();
      return { key: `linear:${id}`, kind: 'issue', id, file: null, url };
    }
    const pull = GITHUB_PR.exec(url);
    if (pull) {
      return { key: `github:${pull[1]}/${pull[2]}#${pull[3]}`, kind: 'pr', id: `PR ${pull[3]}`, file: null, url };
    }
    const doc = GOOGLE_DOC.exec(url);
    if (doc) return { key: `gdoc:${doc[1]}`, kind: 'doc', id: null, file: null, url };
    return null;
  }
  const file = link.file;
  if (!file || skipFile(file)) return null;
  const segments = file.split('/');
  for (const group of config.groups) {
    const pattern = group.split('/');
    if (segments.length > pattern.length && patternMatches(pattern, segments)) {
      return { key: segments.slice(0, pattern.length).join('/'), kind: 'folder', id: null, file, url: null };
    }
  }
  if (config.ignore.some((prefix) => file.startsWith(prefix))) return null;
  return { key: file, kind: 'file', id: null, file, url: null };
}

/** A folder's name in the list: dashes and underscores as spaces, the first letter capitalised. */
export function folderLabel(folder: string): string {
  const name = (folder.split('/').pop() ?? folder).replace(/[-_]+/g, ' ').trim();
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** A label that only repeats a URL, or names the link's host, such as "docs.google.com". */
function bareLabel(label: string, url: string | null): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(label)) return true;
  let host = '';
  try {
    host = url ? new URL(url).hostname : '';
  } catch {
    // A URL that does not parse has no host to compare with.
  }
  return host !== '' && label.toLowerCase().replace(/^www\.|\/$/g, '') === host.replace(/^www\./, '');
}

/** The most common of `labels`; ties go to the one seen first. */
function mostCommon(labels: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  let best: string | null = null;
  let most = 0;
  for (const [label, count] of counts) {
    if (count > most) [best, most] = [label, count];
  }
  return best;
}

/** The latest first; a folded entry counts at the end of its range. Ties keep the later line first. */
const latestFirst = (entries: readonly TouchedEntry[]) =>
  entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.time.localeCompare(a.entry.time) || b.index - a.index)
    .map(({ entry }) => entry);

interface Tally {
  link: LinkItem;
  days: (TouchedHit | null)[];
  labels: string[];
  /** Links per file, for a group: the one most linked is what a click opens. */
  files: Map<string, number>;
  /** The URL as written in the latest line that linked it. */
  url: string | null;
}

/**
 * The items of a week from its seven days of log entries, Monday first.
 * Only agent turns count, and a line that links one item twice counts once.
 * Multi-day items take palette colours in order of first day touched, then
 * key. Files come back with `path` as their path from the folder's top.
 */
export function touchedItems(
  days: readonly (readonly TouchedEntry[])[],
  config: TouchedConfig,
  titles: Readonly<Record<string, string>>,
  skipFile: (file: string) => boolean,
): TouchedItem[] {
  const tallies = new Map<string, Tally>();
  days.forEach((entries, day) => {
    for (const entry of latestFirst(entries)) {
      if (!countsAsTouch(entry.kind)) continue;
      const seen = new Set<string>();
      for (const link of entry.links) {
        const item = linkItem(link, config, skipFile);
        if (!item) continue;
        let tally = tallies.get(item.key);
        if (!tally) {
          tally = { link: item, days: Array.from({ length: 7 }, () => null), labels: [], files: new Map(), url: item.url };
          tallies.set(item.key, tally);
        }
        tally.labels.push(link.label.trim());
        if (item.file) tally.files.set(item.file, (tally.files.get(item.file) ?? 0) + 1);
        if (seen.has(item.key)) continue;
        seen.add(item.key);
        const hit = tally.days[day];
        // The entries run latest first, so the first line counted on a day is its last.
        if (hit) hit.lines += 1;
        else tally.days[day] = { lines: 1, text: entry.text };
      }
    }
    // The URL to open is the one the week's latest line wrote.
    for (const entry of latestFirst(entries).reverse()) {
      if (!countsAsTouch(entry.kind)) continue;
      for (const link of entry.links) {
        const item = link.external ? linkItem(link, config, skipFile) : null;
        const tally = item ? tallies.get(item.key) : undefined;
        if (tally) tally.url = item?.url ?? null;
      }
    }
  });

  const firstDay = (tally: Tally) => tally.days.findIndex(Boolean);
  const multi = [...tallies.values()]
    .filter((tally) => tally.days.filter(Boolean).length >= 2)
    .sort((a, b) => firstDay(a) - firstDay(b) || a.link.key.localeCompare(b.link.key));
  const colours = new Map(multi.map((tally, index) => [tally.link.key, index % TOUCHED_COLOURS]));

  return [...tallies.values()]
    .sort((a, b) => a.link.key.localeCompare(b.link.key))
    .map(({ link, days: hits, labels, files, url }) => {
      const mostLinked = [...files].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
      return {
        key: link.key,
        kind: link.kind,
        id: link.id,
        name: itemName(link, titles, labels, url),
        path: link.kind === 'folder' ? mostLinked : link.file,
        url: link.file ? null : url,
        days: hits,
        colour: colours.get(link.key) ?? null,
      };
    });
}

function itemName(link: LinkItem, titles: Readonly<Record<string, string>>, labels: readonly string[], url: string | null): string {
  switch (link.kind) {
    case 'file': {
      const name = link.key.split('/').pop() ?? link.key;
      // The name the log gave it, as the day sidebar's Files card shows; a label that only repeats the path is not one.
      const stem = (value: string) => value.replace(/\.[a-z0-9]+$/i, '');
      const plain = new Set([link.key, name, stem(link.key), stem(name)]);
      const label = mostCommon(labels.filter((candidate) => candidate && !plain.has(candidate)));
      return label ?? fileTreeLabel(name, classifyFile(name));
    }
    case 'folder':
      return folderLabel(link.key);
    case 'doc': {
      if (titles[link.key]) return titles[link.key];
      const label = mostCommon(labels.filter((candidate) => candidate && !bareLabel(candidate, url)));
      return label ?? 'Google Doc';
    }
    default:
      return titles[link.key] ?? '';
  }
}

/**
 * The rows one day shows: items it touched twice or more, or also on
 * another day of the week. The day's count first, then items of several
 * days, then by key; at most eight.
 */
export function touchedForDay(week: TouchedWeek, day: number): TouchedItem[] {
  const spread = (item: TouchedItem) => item.days.filter(Boolean).length;
  const lines = (item: TouchedItem) => item.days[day]?.lines ?? 0;
  return week.items
    .filter((item) => {
      const hit = item.days[day];
      return !!hit && (hit.lines >= 2 || spread(item) >= 2);
    })
    .sort(
      (a, b) =>
        lines(b) - lines(a) ||
        Number(spread(b) >= 2) - Number(spread(a) >= 2) ||
        a.key.localeCompare(b.key),
    )
    .slice(0, TOUCHED_LIMIT);
}
