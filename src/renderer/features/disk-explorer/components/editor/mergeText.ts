import { diffIndices } from 'node-diff3';

/** On a conflict, each side holds every clean change plus its own version of each conflicting one. */
export type MergeResult =
  | { clean: true; text: string; mine?: undefined; disk?: undefined }
  | { clean: false; text?: undefined; mine: string; disk: string };

interface Hunk {
  side: 'mine' | 'disk';
  /** The base lines [from, to) this hunk replaces; from === to for an insertion. */
  from: number;
  to: number;
  lines: string[];
}

/**
 * Lining up more lines than this, after the unchanged start and end, would
 * hold up typing for too long; repeated lines such as blank ones make the
 * cost grow with the square of the count.
 */
const ALIGN_BUDGET = 1_000_000;

/**
 * Three-way merge by line, with the last saved text as the base. Changes from
 * the two sides combine when they touch different base lines, and the same
 * change made on both sides counts once. Changes to the same lines, or two
 * insertions at the same place, conflict. So does a change too large to line
 * up in time, which keeps each side whole.
 */
export function mergeText(base: string, mine: string, disk: string): MergeResult {
  const original = base.split('\n');
  const mineHunks = hunksOf(original, mine, 'mine');
  const diskHunks = hunksOf(original, disk, 'disk');
  if (!mineHunks || !diskHunks) return { clean: false, mine, disk };
  const hunks = [...mineHunks, ...diskHunks];
  const mineLines: string[] = [];
  const diskLines: string[] = [];
  let cursor = 0;
  let clean = true;
  for (const group of collidingGroups(hunks)) {
    const from = Math.min(...group.map((hunk) => hunk.from));
    const to = Math.max(...group.map((hunk) => hunk.to));
    const unchanged = original.slice(cursor, from);
    const mineSide = apply(original, from, to, group.filter((hunk) => hunk.side === 'mine'));
    const diskSide = apply(original, from, to, group.filter((hunk) => hunk.side === 'disk'));
    const oneSided = group.every((hunk) => hunk.side === group[0].side);
    if (!oneSided && mineSide.join('\n') !== diskSide.join('\n')) clean = false;
    const pick = oneSided ? (group[0].side === 'mine' ? mineSide : diskSide) : null;
    mineLines.push(...unchanged, ...(pick ?? mineSide));
    diskLines.push(...unchanged, ...(pick ?? diskSide));
    cursor = to;
  }
  mineLines.push(...original.slice(cursor));
  diskLines.push(...original.slice(cursor));
  return clean ? { clean: true, text: mineLines.join('\n') } : { clean: false, mine: mineLines.join('\n'), disk: diskLines.join('\n') };
}

/** One side's changes to the base, or null when they are too large to line up in time. */
function hunksOf(original: string[], text: string, side: Hunk['side']): Hunk[] | null {
  const lines = text.split('\n');
  // Only the span between the unchanged start and end is aligned; an append costs its own lines.
  let start = 0;
  while (start < original.length && start < lines.length && original[start] === lines[start]) start += 1;
  let end = 0;
  while (end < original.length - start && end < lines.length - start && original[original.length - 1 - end] === lines[lines.length - 1 - end]) end += 1;
  const before = original.slice(start, original.length - end);
  const after = lines.slice(start, lines.length - end);
  if (before.length * after.length > ALIGN_BUDGET) return null;
  return diffIndices(before, after).map((change) => ({
    side,
    from: start + change.buffer1[0],
    to: start + change.buffer1[0] + change.buffer1[1],
    lines: change.buffer2Content,
  }));
}

/**
 * Hunks joined into groups of transitively colliding ones, in base order, in
 * one pass. Hunks of one side never collide. Across sides, overlapping ranges
 * and insertions at the same place do. Sorted by where they start, with an
 * insertion before a change that starts where it inserts, a hunk collides
 * with an earlier one only by starting inside its range, or by inserting
 * where it inserts.
 */
function collidingGroups(hunks: Hunk[]): Hunk[][] {
  const sorted = [...hunks].sort((a, b) => a.from - b.from || a.to - b.to);
  const groups: Hunk[][] = [];
  let reach = -1;
  let insertedAt = -1;
  for (const hunk of sorted) {
    const insertion = hunk.from === hunk.to;
    const joins = groups.length > 0 && (hunk.from < reach || (insertion && hunk.from === insertedAt));
    if (joins) groups[groups.length - 1].push(hunk);
    else { groups.push([hunk]); reach = -1; insertedAt = -1; }
    if (insertion) insertedAt = hunk.from;
    else reach = Math.max(reach, hunk.to);
  }
  return groups;
}

/** The base lines [from, to) with one side's hunks applied. */
function apply(original: string[], from: number, to: number, hunks: Hunk[]): string[] {
  const lines: string[] = [];
  let at = from;
  for (const hunk of [...hunks].sort((a, b) => a.from - b.from)) {
    lines.push(...original.slice(at, hunk.from), ...hunk.lines);
    at = hunk.to;
  }
  lines.push(...original.slice(at, to));
  return lines;
}
