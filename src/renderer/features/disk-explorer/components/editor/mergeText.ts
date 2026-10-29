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
 * Three-way merge by line, with the last saved text as the base. Changes from
 * the two sides combine when they touch different base lines, and the same
 * change made on both sides counts once. Changes to the same lines, or two
 * insertions at the same place, conflict.
 */
export function mergeText(base: string, mine: string, disk: string): MergeResult {
  const original = base.split('\n');
  const hunks = [...hunksOf(original, mine, 'mine'), ...hunksOf(original, disk, 'disk')];
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

function hunksOf(original: string[], text: string, side: Hunk['side']): Hunk[] {
  return diffIndices(original, text.split('\n')).map((change) => ({
    side,
    from: change.buffer1[0],
    to: change.buffer1[0] + change.buffer1[1],
    lines: change.buffer2Content,
  }));
}

/** Hunks of one side never collide; across sides, overlapping ranges and same-place insertions do. */
function collides(a: Hunk, b: Hunk): boolean {
  if (a.from === a.to && b.from === b.to) return a.from === b.from;
  return a.from < b.to && b.from < a.to;
}

/** Hunks joined into groups of transitively colliding ones, in base order. */
function collidingGroups(hunks: Hunk[]): Hunk[][] {
  let groups: Hunk[][] = [];
  for (const hunk of hunks) {
    const touching = groups.filter((group) => group.some((other) => collides(hunk, other)));
    groups = [...groups.filter((group) => !touching.includes(group)), [hunk, ...touching.flat()]];
  }
  const start = (group: Hunk[]) => Math.min(...group.map((hunk) => hunk.from));
  const end = (group: Hunk[]) => Math.max(...group.map((hunk) => hunk.to));
  // An insertion sorts before a change that starts where it inserts.
  return groups.sort((a, b) => start(a) - start(b) || end(a) - end(b));
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
