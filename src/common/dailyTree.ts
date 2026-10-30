import { basenameFsPath, parentFsPath } from './fsPaths';
import { validDate } from './vaultModel';

/*
 * How the sidebar tree shows a vault's daily pages. On disk they stay
 * `Library/daily/YYYY-MM-DD.md`; the tree groups them under a folder row per
 * year, newest first, and names each one "10-30 Fri". A year row is not a
 * folder on disk: it cannot be renamed, moved or dropped on.
 */

const DAILY_FOLDER = 'Library/daily';
const DAILY_NAME = /^(\d{4}-\d\d-\d\d)\.md$/;
const YEAR = /^\d{4}$/;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface NamedEntry {
  path: string;
  name: string;
  isDirectory: boolean;
}

/** Whether `path` is the daily pages folder of one of the opened folders. */
export function isDailyFolder(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path === `${root}/${DAILY_FOLDER}`);
}

/** The date of a daily page's file name, `YYYY-MM-DD.md`, or null. */
export function dailyFileDate(name: string): string | null {
  const match = DAILY_NAME.exec(name);
  return match && validDate(match[1]) ? match[1] : null;
}

/** "10-30 Fri" for 2026-10-30. */
export function dailyTreeLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${date.slice(5)} ${WEEKDAYS[new Date(year, month - 1, day).getDay()]}`;
}

export interface YearGroup<T> {
  /** The row's path: the daily folder and the year, which is not a folder on disk. */
  path: string;
  year: string;
  /** The year's pages, newest first. */
  pages: T[];
}

/**
 * Splits a listing of the daily folder into year groups, newest year first,
 * and the entries that stay as they are. A year that a real folder already
 * has the name of is left ungrouped, so nothing is hidden behind it.
 */
export function dailyYearGroups<T extends NamedEntry>(
  folder: string,
  entries: readonly T[]
): { groups: YearGroup<T>[]; rest: T[] } {
  const taken = new Set(entries.filter((entry) => entry.isDirectory).map((entry) => entry.name));
  const byYear = new Map<string, T[]>();
  const rest: T[] = [];
  for (const entry of entries) {
    const date = entry.isDirectory ? null : dailyFileDate(entry.name);
    const year = date?.slice(0, 4);
    if (!date || !year || taken.has(year)) {
      rest.push(entry);
      continue;
    }
    const pages = byYear.get(year) ?? [];
    pages.push(entry);
    byYear.set(year, pages);
  }
  const groups = [...byYear.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([year, pages]) => ({
      path: `${folder}/${year}`,
      year,
      pages: pages.sort((a, b) => b.name.localeCompare(a.name)),
    }));
  return { groups, rest };
}

/**
 * Whether `path` is a year row: a year below a daily folder that the
 * folder's listing does not hold as a real folder.
 */
export function isYearGroup(
  path: string,
  roots: readonly string[],
  listings: Readonly<Record<string, readonly NamedEntry[] | undefined>>
): boolean {
  const folder = parentFsPath(path);
  if (!folder || !isDailyFolder(folder, roots) || !YEAR.test(basenameFsPath(path))) return false;
  return !(listings[folder] ?? []).some((entry) => entry.isDirectory && entry.path === path);
}

/** The year row a daily page shows under, or null for any other path. */
export function yearGroupOf(
  path: string,
  roots: readonly string[],
  listings: Readonly<Record<string, readonly NamedEntry[] | undefined>>
): string | null {
  const folder = parentFsPath(path);
  const date = dailyFileDate(basenameFsPath(path));
  if (!folder || !date || !isDailyFolder(folder, roots)) return null;
  const group = `${folder}/${date.slice(0, 4)}`;
  return isYearGroup(group, roots, listings) ? group : null;
}
