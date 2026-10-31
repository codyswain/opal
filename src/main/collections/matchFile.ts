/**
 * How well a file matches what was typed in the file switcher, best first.
 * The first four compare the query with the file name; the last two look for
 * every query word on its own.
 */
export const MatchTier = {
  Exact: 0,
  Prefix: 1,
  WordStart: 2,
  Substring: 3,
  /** Every word is in the name, or every word is in the frontmatter title. */
  NameWords: 4,
  /** Every word is somewhere in the path from the top of the opened folder, or the title. */
  PathWords: 5,
} as const;
export type MatchTier = (typeof MatchTier)[keyof typeof MatchTier];

export interface MatchTarget {
  name: string;
  /** From the top of the opened folder, so the folder's own location never matches. */
  relativePath: string;
  title: string | null;
}

// A trailing ".ext" with no space in it; "v1.2 notes" keeps its dot.
const EXTENSION = /\.[^.\s/]{1,8}$/;
const SEPARATORS = /[\s_-]+/g;
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/** Lower case, one Unicode form, and '-', '_' and runs of spaces as one space. */
export function matchText(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(SEPARATORS, ' ').trim();
}

function startsWord(text: string, query: string): boolean {
  for (let at = text.indexOf(query); at !== -1; at = text.indexOf(query, at + 1)) {
    if (at === 0 || !WORD_CHARACTER.test(text[at - 1])) return true;
  }
  return false;
}

/**
 * The tier a file matches the query at, or null when it does not match.
 * Without a '.' in the query the extension is left out, so "md" does not
 * match every note and "plan" is the exact name of plan.md.
 */
export function matchTier(query: string, target: MatchTarget): MatchTier | null {
  const wanted = matchText(query);
  if (!wanted) return null;
  const withExtension = wanted.includes('.');
  const name = matchText(withExtension ? target.name : target.name.replace(EXTENSION, ''));
  if (name === wanted) return MatchTier.Exact;
  if (name.startsWith(wanted)) return MatchTier.Prefix;
  if (startsWord(name, wanted)) return MatchTier.WordStart;
  if (name.includes(wanted)) return MatchTier.Substring;
  const words = wanted.split(' ');
  const hasEvery = (text: string) => words.every((word) => text.includes(word));
  const title = target.title === null ? '' : matchText(target.title);
  if (hasEvery(name) || (title && hasEvery(title))) return MatchTier.NameWords;
  const where = matchText(withExtension ? target.relativePath : target.relativePath.replace(EXTENSION, ''));
  if (hasEvery(`${where} ${title}`)) return MatchTier.PathWords;
  return null;
}
