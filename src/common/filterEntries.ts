import type { DiskEntry } from '@/types/disk';

/**
 * Case-insensitive substring match on the file name.
 *
 * Deliberately not fuzzy: in a folder of IMG_2041…IMG_2099, fuzzy matching
 * returns almost everything for almost any query, which is worse than useless.
 * Substring is predictable, and predictability is what a filter box is for.
 *
 * The query is used with String.includes, never compiled into a RegExp, so
 * characters like '*' and '(' are literal and cannot throw.
 */
export function filterEntries(entries: DiskEntry[], query: string): DiskEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...entries];
  return entries.filter((entry) => entry.name.toLowerCase().includes(needle));
}
