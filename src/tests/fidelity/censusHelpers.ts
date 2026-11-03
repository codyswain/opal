import { lstat, readdir } from 'fs/promises';
import path from 'path';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { hiddenRanges } from '@/renderer/features/disk-explorer/components/editor/livePreview';

/*
 * Shared pieces of the vault censuses: which files to open, where to put
 * the caret, how to open a page, and what typing may change. Censuses read
 * the vault and never write to it.
 */

/** Folders no census opens: dependencies, git's store, and the saved chats, which are logs of other sessions. */
const SKIPPED = new Set(['node_modules', '.git']);
const SKIPPED_PATHS = [path.join('Library', 'chats')];

export interface VaultFiles {
  /** Files to open, in walk order. */
  found: string[];
  /** Symbolic links to Markdown files, which the censuses skip. */
  links: string[];
  /** Folders left out: node_modules, .git and Library/chats. */
  skipped: string[];
}

/** The files under `root` whose names match `pattern`, skipping node_modules, .git and Library/chats. */
export async function vaultFiles(root: string, pattern = /\.mdo?$/i): Promise<VaultFiles> {
  const files: VaultFiles = { found: [], links: [], skipped: [] };
  const walk = async (dir: string) => {
    for (const name of (await readdir(dir)).sort()) {
      const full = path.join(dir, name);
      const relative = path.relative(root, full);
      const info = await lstat(full);
      if (info.isSymbolicLink()) {
        if (pattern.test(name)) files.links.push(full);
        continue;
      }
      if (info.isDirectory()) {
        if (SKIPPED.has(name) || SKIPPED_PATHS.includes(relative)) files.skipped.push(relative);
        else await walk(full);
      } else if (info.isFile() && pattern.test(name)) {
        files.found.push(full);
      }
    }
  };
  await walk(root);
  return files;
}

/** The census's first line: how many files it opened and what it left out. */
export function openedLine(label: string, opened: number, files: VaultFiles): string {
  const skipped = files.skipped.length > 0 ? `; skipped ${files.skipped.length} folders (node_modules, .git, Library/chats)` : '';
  return `[${label}] opened ${opened} of ${files.found.length} files${skipped}; ${files.links.length} symlinks skipped`;
}

export interface OpenOptions {
  /** Open as a document (.mdo), whatever the file's name. */
  asDocument?: boolean;
  /** Parse the whole page first, as range commands do. Off reads only what the editor parsed on its own. */
  fullParse?: boolean;
}

/** An editor view on `body`, as Opal opens `file`. The caller destroys it. */
export function openPage(file: string, body: string, { asDocument = false, fullParse = true }: OpenOptions = {}): EditorView {
  const page = asDocument ? file.replace(/\.md$/i, '.mdo') : file;
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: body, extensions: markdownEditorExtensions(page) }) });
  if (fullParse) {
    ensureSyntaxTree(view.state, view.state.doc.length, 10_000);
    // A transaction carries the parsed tree into the state that commands read.
    view.dispatch({});
  }
  return view;
}

/** Nodes drawn as one thing, which typing beside them must never reshape. */
export const SHAPED = new Set(['Table', 'FencedCode', 'HorizontalRule', 'InlineMath', 'DisplayMath', 'BlockMath']);
const SPOT_BLOCKS = new Set(['Table', 'FencedCode', 'HorizontalRule', 'BlockMath']);

export interface Spot {
  at: number;
  why: string;
}

const middle = (state: EditorState, number: number) => {
  const line = state.doc.line(number);
  return line.from + Math.floor(line.length / 2);
};

/**
 * Where a census puts the caret: the middle of the lines at the given shares
 * of the page, then targeted spots, the lines just above and below every
 * table, rule, fence and `$$` block and a line inside each fence, up to
 * `limit` targeted spots per page.
 */
export function sampleSpots(state: EditorState, { shares = [0.25, 0.5, 0.75], limit = 12 }: { shares?: number[]; limit?: number } = {}): Spot[] {
  const { doc } = state;
  const spots: Spot[] = shares.map((share) => {
    const line = doc.lineAt(Math.floor(doc.length * share));
    return { at: line.from + Math.floor(line.length / 2), why: `${share * 100}%` };
  });
  const targeted: Spot[] = [];
  const add = (number: number, why: string) => {
    if (number >= 1 && number <= doc.lines && targeted.length < limit) targeted.push({ at: middle(state, number), why });
  };
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (targeted.length >= limit) return false;
      const isMathBlock = ref.name === 'Paragraph' && /^\s*\$\$/.test(doc.lineAt(ref.from).text);
      if (!SPOT_BLOCKS.has(ref.name) && !isMathBlock) return ref.name !== 'Paragraph';
      const first = doc.lineAt(ref.from).number;
      const last = doc.lineAt(Math.max(ref.from, ref.to - (doc.sliceString(ref.to - 1, ref.to) === '\n' ? 1 : 0))).number;
      const name = isMathBlock ? '$$' : ref.name;
      add(first - 1, `above ${name}`);
      add(last + 1, `below ${name}`);
      if (ref.name === 'FencedCode' && last - first > 1) add(first + 1, 'inside FencedCode');
      return false;
    },
  });
  return [...spots, ...targeted];
}

/** The text the page shows between `from` and `to`: hidden marks left out, each drawn thing as one U+FFFC. */
export function visibleText(state: EditorState, from: number, to: number): { text: string; offsetOf: (at: number) => number } {
  const hidden = hiddenRanges(state, from, to)
    .map((range) => ({ ...range, from: Math.max(range.from, from), to: Math.min(range.to, to) }))
    .filter((range) => range.to > range.from);
  let text = '';
  const marks: { at: number; length: number; shown: number }[] = [];
  let at = from;
  for (const range of hidden) {
    if (range.to <= at) continue;
    const start = Math.max(range.from, at);
    text += state.sliceDoc(at, start);
    marks.push({ at: start, length: range.to - start, shown: range.unit ? 1 : 0 });
    if (range.unit) text += '￼';
    at = range.to;
  }
  text += state.sliceDoc(at, to);
  const offsetOf = (position: number) => {
    let offset = position - from;
    for (const mark of marks) {
      if (mark.at < position) offset -= Math.min(mark.length, position - mark.at);
      if (mark.at + mark.length <= position) offset += mark.shown;
    }
    return offset;
  };
  return { text, offsetOf };
}

/** The shaped nodes of a page as name and text, leaving out any that holds `at`. */
function shapes(state: EditorState, at: number): string[] {
  const found: string[] = [];
  (ensureSyntaxTree(state, state.doc.length, 5_000) ?? syntaxTree(state)).iterate({
    enter: (ref) => {
      if (!SHAPED.has(ref.name)) return;
      if (!(ref.from < at && at < ref.to)) found.push(`${ref.name}:${state.sliceDoc(ref.from, ref.to)}`);
      return false;
    },
  });
  return found.sort();
}

export interface Declared {
  /** Characters typing may add besides the typed text, such as line breaks and quote marks for a separator. */
  separators?: string;
  /** Characters typing may add as escapes, such as `\`. */
  escapes?: string;
}

/** The hidden marks touching `at`, as one range: where typing may write its marks. */
function markWindow(state: EditorState, at: number): { from: number; to: number } {
  const hidden = hiddenRanges(state, state.doc.lineAt(at).from, state.doc.lineAt(at).to).filter((range) => !range.unit);
  let from = at;
  let to = at;
  for (let grew = true; grew;) {
    grew = false;
    for (const range of hidden) {
      if (range.from < from && range.to >= from) { from = range.from; grew = true; }
      if (range.to > to && range.from <= to) { to = range.to; grew = true; }
    }
  }
  return { from, to };
}

const strip = (text: string, characters: string) => [...text].filter((character) => !characters.includes(character)).join('');

/** Whether `got` is `expected` with only characters from `allowed` added: escapes and separators, never a typed character lost. */
export function addsOnly(expected: string, got: string, allowed: string): boolean {
  let at = 0;
  for (const character of got) {
    if (at < expected.length && character === expected[at]) at += 1;
    else if (!allowed.includes(character)) return false;
  }
  return at === expected.length;
}

/**
 * What a typed edit got wrong, or an empty list. Typing `typed` at `caret`
 * in `before`, giving `after`: the visible text of the caret's line gains
 * exactly the typed text at the caret; the raw bytes change only in the
 * hidden marks touching the caret, adding nothing but the typed text and
 * the declared separators and escapes; and no table, fence, rule or math
 * node away from the caret changes.
 */
export function expectTyped(before: EditorState, after: EditorState, typed: string, caret: number, declared: Declared = {}): string[] {
  const problems: string[] = [];
  const allowed = (declared.separators ?? '') + (declared.escapes ?? '');
  const raw = before.doc.toString();
  const now = after.doc.toString();
  const window = markWindow(before, caret);
  const tail = raw.length - window.to;
  const middleBefore = raw.slice(window.from, window.to);
  const middleAfter = now.slice(window.from, now.length - tail);
  if (!now.startsWith(raw.slice(0, window.from)) || !now.endsWith(raw.slice(window.to)) || now.length - tail < window.from) {
    problems.push('bytes changed away from the caret');
  } else {
    // The typed text may sit anywhere among the marks, with only separators and escapes added around or inside it.
    let fits = false;
    for (let at = 0; at <= middleBefore.length && !fits; at += 1) {
      fits = addsOnly(middleBefore.slice(0, at) + typed + middleBefore.slice(at), middleAfter, allowed);
    }
    if (!fits) problems.push(`bytes at the caret: ${JSON.stringify(middleBefore)} became ${JSON.stringify(middleAfter)}`);
  }
  // The visible text of the caret's line, which typing may split into lines with a separator.
  const line = before.doc.lineAt(caret);
  const shown = visibleText(before, line.from, line.to);
  const offset = shown.offsetOf(caret);
  const expected = shown.text.slice(0, offset) + typed + shown.text.slice(offset);
  const afterTo = Math.min(after.doc.length, line.to + (now.length - raw.length));
  const got = visibleText(after, line.from, Math.max(line.from, afterTo)).text;
  // A list item's indent shows on a blank line and hides once it holds text. Escapes never show.
  const visible = (text: string) => strip(text, declared.separators ?? '').trimStart();
  if (visible(got) !== visible(expected)) {
    const around = (text: string) => JSON.stringify(text.slice(Math.max(0, offset - 30), offset + 30));
    problems.push(`visible text ${around(expected)} became ${around(got)}`);
  }
  const shapesBefore = shapes(before, caret);
  const shapesAfter = shapes(after, caret + typed.length);
  if (shapesBefore.join('\u0000') !== shapesAfter.join('\u0000')) {
    const lost = shapesBefore.filter((shape) => !shapesAfter.includes(shape));
    const gained = shapesAfter.filter((shape) => !shapesBefore.includes(shape));
    problems.push(`blocks changed: ${[...lost.map((shape) => `-${shape.slice(0, 40)}`), ...gained.map((shape) => `+${shape.slice(0, 40)}`)].join(' ')}`);
  }
  return problems;
}

const SEPARATED = new Set(['Table', 'HorizontalRule']);

/**
 * What typing at `caret` may add as a separator: a line break, quote marks
 * and an indent when the caret's line is a table's or rule's line or right
 * next to one, since typed text starts a paragraph of its own there.
 */
export function blockSeparators(state: EditorState, caret: number): string {
  const { doc } = state;
  const line = doc.lineAt(caret);
  const from = doc.line(Math.max(1, line.number - 1)).from;
  const to = doc.line(Math.min(doc.lines, line.number + 1)).to;
  let near = false;
  (ensureSyntaxTree(state, to, 5_000) ?? syntaxTree(state)).iterate({
    from,
    to,
    enter: (ref) => {
      if (SEPARATED.has(ref.name)) near = true;
      return !near;
    },
  });
  return near ? '\n> \t' : '';
}

const BLOCKS = new Set(['FencedCode']);

/**
 * The later work that fixes a failed typing check, for the bugs known when
 * `expectTyped` came in: typing beside a fence joins or reshapes it
 * (PR 3), and text typed into a long link definition's target hides with
 * it (Later, step 3). Null for anything else, which is a new failure. Each
 * PR deletes its rule when its fix lands.
 */
export function pendingOwner(before: EditorState, after: EditorState, typed: string, caret: number): string | null {
  const { doc } = before;
  const line = doc.lineAt(caret);
  const from = doc.line(Math.max(1, line.number - 1)).from;
  const to = doc.line(Math.min(doc.lines, line.number + 1)).to;
  let nearBlock = false;
  (ensureSyntaxTree(before, to, 5_000) ?? syntaxTree(before)).iterate({
    from,
    to,
    enter: (ref) => {
      if (BLOCKS.has(ref.name)) nearBlock = true;
      return !nearBlock;
    },
  });
  if (nearBlock) return 'PR 3: typing beside a fence';
  if (/^ {0,3}(?:> ?)*\[(?:[^\]\\]|\\.)+\]:/.test(line.text)) return 'Later, step 3: typing in a link definition\'s shortened target';
  return null;
}
