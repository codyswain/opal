import type { EditorState, Line } from '@codemirror/state';
import { latestTree } from './extensionPoints';
import { drawnBlockAt, hiddenRanges, type HiddenRange } from './livePreview';

/*
 * The text a document shows, line by line, with the raw position of each
 * character it shows. Hidden marks are left out and each drawn thing (a
 * picture, a rule) is one U+FFFC. Lines of a drawn table or code block show
 * their raw text, with a table's pipes and fence lines as U+FFFC, so search
 * finds what the drawn block shows. Word motion, Find and Replace, typing
 * escapes and the word count all read the page through this.
 */

/** Stands for a drawn thing in visible text. Search never matches it. */
export const OBJECT = '￼';

export interface VisibleLine {
  line: Line;
  text: string;
  /** Where each shown character starts in the raw text. */
  starts: readonly number[];
  /** Where each shown character ends in the raw text. */
  ends: readonly number[];
}

// Hidden ranges and visible lines per state, since a key press asks for the same lines several times.
const hiddenCache = new WeakMap<EditorState, Map<string, HiddenRange[]>>();
const lineCache = new WeakMap<EditorState, Map<number, VisibleLine>>();

function cacheFor<T>(cache: WeakMap<EditorState, Map<string | number, T>>, state: EditorState): Map<string | number, T> {
  let map = cache.get(state);
  if (!map) {
    map = new Map();
    cache.set(state, map);
  }
  return map;
}

/** `hiddenRanges(state, from, to)`, computed once per state for the same lines. */
export function hiddenOn(state: EditorState, from: number, to: number): HiddenRange[] {
  const map = cacheFor(hiddenCache as WeakMap<EditorState, Map<string | number, HiddenRange[]>>, state);
  const key = `${from}:${to}`;
  let found = map.get(key);
  if (!found) {
    found = hiddenRanges(state, from, to);
    map.set(key, found);
  }
  return found;
}

const FENCE = /^[ \t>]*(?:```|~~~)/;
// Marks a drawn table's cells do not show.
const CELL_MARKS = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark', 'LinkMark', 'LinkTitle', 'WikiLinkMark']);

/**
 * A line of a drawn table or code block: a table row shows its cells' text
 * with each pipe as an object and no inline marks; a code line shows as
 * written, and a fence line as objects.
 */
function blockLine(state: EditorState, line: Line): { text: string; starts: number[]; ends: number[] } {
  const marks: { from: number; to: number; object: boolean }[] = [];
  if (FENCE.test(line.text)) marks.push({ from: line.from, to: line.to, object: true });
  else {
    latestTree(state).iterate({
      from: line.from,
      to: line.to,
      enter: (ref) => {
        if (ref.name === 'FencedCode' || ref.name === 'CodeBlock') return false;
        if (ref.name === 'TableDelimiter') marks.push({ from: ref.from, to: ref.to, object: !state.sliceDoc(ref.from, ref.to).includes('-') });
        else if (CELL_MARKS.has(ref.name)) marks.push({ from: ref.from, to: ref.to, object: false });
        else if (ref.name === 'URL' && (ref.node.parent?.name === 'Link' || ref.node.parent?.name === 'Image')) marks.push({ from: ref.from, to: ref.to, object: false });
        else if (ref.name === 'Escape') marks.push({ from: ref.from, to: ref.from + 1, object: false });
        return undefined;
      },
    });
  }
  marks.sort((a, b) => a.from - b.from);
  let text = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let at = line.from;
  for (const mark of marks) {
    for (; at < Math.min(mark.from, line.to); at += 1) {
      text += state.doc.sliceString(at, at + 1);
      starts.push(at);
      ends.push(at + 1);
    }
    if (mark.to <= at) continue;
    if (mark.object) {
      text += OBJECT;
      starts.push(Math.max(at, mark.from));
      ends.push(Math.min(mark.to, line.to));
    }
    at = Math.min(Math.max(at, mark.to), line.to);
  }
  for (; at < line.to; at += 1) {
    text += state.doc.sliceString(at, at + 1);
    starts.push(at);
    ends.push(at + 1);
  }
  return { text, starts, ends };
}

function buildLine(state: EditorState, line: Line, hidden: readonly HiddenRange[]): VisibleLine {
  if (drawnBlockAt(state, line.from) && drawnBlockAt(state, line.to)) return { line, ...blockLine(state, line) };
  let text = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let at = line.from;
  const shown = (to: number) => {
    for (; at < to; at += 1) {
      text += state.doc.sliceString(at, at + 1);
      starts.push(at);
      ends.push(at + 1);
    }
  };
  for (const range of hidden) {
    const from = Math.max(range.from, line.from);
    const to = Math.min(range.to, line.to);
    if (to <= from || to <= at) continue;
    shown(from);
    if (range.unit) {
      text += OBJECT;
      starts.push(Math.max(from, at));
      ends.push(to);
    }
    at = to;
  }
  shown(line.to);
  return { line, text, starts, ends };
}

/** The visible text of the lines from `from` to `to`, reading the hidden ranges once for all of them. */
export function visibleLines(state: EditorState, from: number, to: number): VisibleLine[] {
  const map = cacheFor(lineCache as WeakMap<EditorState, Map<string | number, VisibleLine>>, state);
  const first = state.doc.lineAt(from);
  const last = state.doc.lineAt(to);
  const lines: VisibleLine[] = [];
  let hidden: HiddenRange[] | null = null;
  for (let number = first.number; number <= last.number; number += 1) {
    const line = state.doc.line(number);
    let visible = map.get(line.from);
    if (!visible) {
      hidden ??= hiddenRanges(state, first.from, last.to);
      visible = buildLine(state, line, hidden.filter((range) => range.to >= line.from && range.from <= line.to));
      map.set(line.from, visible);
    }
    lines.push(visible);
  }
  return lines;
}

/** The visible text of the line holding `at`. */
export function visibleLine(state: EditorState, at: number): VisibleLine {
  return visibleLines(state, at, at)[0];
}

/** How many shown characters of `visible` come before the raw position `at`. */
export function visibleOffset(visible: VisibleLine, at: number): number {
  let low = 0;
  let high = visible.ends.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (visible.ends[mid] <= at) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** The raw range of the shown characters `from` to `to` (exclusive), or the place between them when empty. */
export function rawRange(visible: VisibleLine, from: number, to: number): { from: number; to: number } {
  if (to <= from) {
    const at = from >= visible.starts.length ? visible.line.to : visible.starts[from];
    return { from: at, to: at };
  }
  return { from: visible.starts[from], to: visible.ends[to - 1] };
}

/** The raw position just after shown character `offset - 1`, or the line's start for 0. */
export function rawAfter(visible: VisibleLine, offset: number): number {
  if (offset <= 0) return visible.starts[0] ?? visible.line.to;
  return visible.ends[Math.min(offset, visible.ends.length) - 1];
}

/** The text the page shows from `from` to `to`, lines joined with "\n". */
export function visibleSlice(state: EditorState, from: number, to: number): string {
  return visibleLines(state, from, to).map((visible) => {
    const start = visibleOffset(visible, Math.max(from, visible.line.from));
    const end = visibleOffset(visible, Math.min(to, visible.line.to));
    return visible.text.slice(start, end);
  }).join('\n');
}
