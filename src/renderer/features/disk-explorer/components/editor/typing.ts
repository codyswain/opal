import { isolateHistory, undo } from '@codemirror/commands';
import { ChangeSet, EditorState, MapMode, Prec, StateEffect, StateField, Transaction, type ChangeSpec, type Extension, type Text, type TransactionSpec } from '@codemirror/state';
import { EditorView, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { latestTree, nodeDecorators, protectedIn } from './extensionPoints';
import { inlineSpans, typingStyle } from './formatCommands';
import { docMode, hiddenRanges } from './livePreview';
import { visibleLine, visibleOffset, visibleSlice } from './visibleText';

/*
 * Typing in a document writes what the page shows. A typed character that
 * would turn into Markdown is written escaped, unless it finishes a
 * shortcut typed in this session: "2*3*4" is written `2*3\*4`, "C:\*" is
 * written `C:\\*`, "1984. " at a line start `1984\. `, and "<!--" `\<!--`.
 * `---` or `===` typed under a paragraph get a blank line above, so the
 * paragraph never turns into a heading. Nothing here runs in code, HTML,
 * comments or a protected range, where the bytes are exactly what was typed.
 */

// Blocks and spans whose text is written raw.
const RAW_BLOCKS = new Set(['FencedCode', 'CodeBlock', 'HTMLBlock', 'CommentBlock']);

/** Whether text written at `at` goes in raw: inside code, HTML, a comment or a protected range. */
export function rawAt(state: EditorState, at: number): boolean {
  if (protectedIn(state, at, at).some((range) => range.from < at && at < range.to)) return true;
  const tree = latestTree(state);
  for (const side of [-1, 1] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(at, side); node; node = node.parent) {
      if (RAW_BLOCKS.has(node.name)) return true;
      if (node.name === 'InlineCode') {
        const marks = node.getChildren('CodeMark');
        if (marks.length === 2 && at >= marks[0].to && at <= marks[1].from) return true;
      }
    }
  }
  return false;
}

// Characters a document's typing watches: emphasis, strikethrough and code marks, and the backslash.
const DELIMITERS = '*_~`\\';
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;

/** Positions of the delimiters typed in this editor, so a shortcut typed here is kept and an old mark is not. */
export const typedMarks = StateField.define<readonly number[]>({
  create: () => [],
  update(marks, tr) {
    if (!tr.docChanged) return marks;
    const kept = marks.map((at) => tr.changes.mapPos(at, 1, MapMode.TrackDel)).filter((at): at is number => at !== null);
    if (!tr.isUserEvent('input.type')) return kept;
    tr.changes.iterChanges((_fromA, _toA, fromB, _toB, inserted) => {
      const text = inserted.toString();
      for (let index = 0; index < text.length; index += 1) {
        if (DELIMITERS.includes(text[index])) kept.push(fromB + index);
      }
    });
    return kept;
  },
});

const EMPHASIS_NODES = new Set(['Emphasis', 'StrongEmphasis', 'Strikethrough', 'InlineCode']);
const MARK_OF: Record<string, string> = { Emphasis: 'EmphasisMark', StrongEmphasis: 'EmphasisMark', Strikethrough: 'StrikethroughMark', InlineCode: 'CodeMark' };
const WORD = /[\p{L}\p{N}]/u;

/**
 * The marks of formatting the character at `at` closes as a shortcut typed
 * in this session: its opener was typed here and does not sit inside a
 * word. Null when it closes no such formatting.
 */
function shortcutMarks(state: EditorState, at: number): { open: { from: number; to: number }; close: { from: number; to: number } } | null {
  const typed = state.field(typedMarks, false) ?? [];
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(at, 1); node; node = node.parent) {
    if (!EMPHASIS_NODES.has(node.name)) continue;
    const marks = node.getChildren(MARK_OF[node.name]);
    if (marks.length < 2) return null;
    const open = marks[0];
    const close = marks[marks.length - 1];
    if (!(close.from <= at && at < close.to)) return null;
    const inWord = WORD.test(state.sliceDoc(open.from - 1, open.from)) && WORD.test(state.sliceDoc(open.to, open.to + 1));
    let opened = true;
    for (let mark = open.from; mark < open.to; mark += 1) if (!typed.includes(mark)) opened = false;
    return opened && !inWord ? { open: { from: open.from, to: open.to }, close: { from: close.from, to: close.to } } : null;
  }
  return null;
}

/*
 * Autoformat is two undo steps: the typed text written literally, then the
 * formatting. A shortcut's last key writes its marks escaped, so the page
 * shows them as typed, and asks for the formatting, which goes in as its own
 * history event right after. The first undo, from ⌘Z or Edit > Undo alike,
 * shows the marks as text again; the next one takes the typing back.
 */

/** The changes that turn the literal marks into formatting, applied right after the typing. */
const formatAfter = StateEffect.define<readonly { from: number; to: number }[]>();

/** Writes a backslash before each of `positions` (in `tr`'s new text), and asks for them to go again as formatting. */
function autoformatSpec(at: number, length: number, positions: readonly number[]): TransactionSpec {
  const sorted = [...new Set(positions)].sort((a, b) => a - b);
  const before = sorted.filter((position) => position <= at).length;
  return {
    changes: sorted.map((from) => ({ from, insert: '\\' })),
    selection: { anchor: at + length + before },
    effects: formatAfter.of(sorted.map((from, index) => ({ from: from + index, to: from + index + 1 }))),
    sequential: true,
  };
}

/** True right after the formatting went in, until the text or the caret changes. */
const justFormatted = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => (tr.isUserEvent('input.autoformat') ? true : tr.docChanged || tr.selection ? false : value),
});

/** Turns the literal marks `removals` point at into formatting, as its own history event, when the text is still `doc`. */
function format(view: EditorView, doc: Text, removals: readonly { from: number; to: number }[]): void {
  if (view.state.doc !== doc) return;
  const changes = ChangeSet.of(removals.map(({ from, to }) => ({ from, to })), doc.length);
  view.dispatch({
    changes,
    selection: { anchor: changes.mapPos(view.state.selection.main.head, 1) },
    annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.autoformat')],
    filter: false,
  });
}

const formatting = (tr: Transaction) => tr.effects.find((effect) => effect.is(formatAfter))?.value as readonly { from: number; to: number }[] | undefined;

// Typed text that can finish a shortcut: a space after a line mark, or a closing delimiter.
const SHORTCUT_KEYS = /^[ *_~`]$/;

/** Typed text that finishes a shortcut is written, then formatted, in two dispatches straight away. */
const typeThenFormat = EditorView.inputHandler.of((view, _from, _to, text, insert) => {
  if (!SHORTCUT_KEYS.test(text) || view.composing || !view.state.facet(docMode)) return false;
  const tr = insert();
  const removals = formatting(tr);
  if (!removals) return false;
  view.dispatch(tr);
  format(view, view.state.doc, removals);
  return true;
});

/** Formatting asked for by typing that came another way, such as doc mode's own input handler. */
const applyFormatting = ViewPlugin.fromClass(class {
  constructor(readonly view: EditorView) {}

  update(update: ViewUpdate) {
    for (const tr of update.transactions) {
      const removals = formatting(tr);
      const { doc } = update.state;
      // After this update and before the next key, so the page never shows the literal marks.
      if (removals) queueMicrotask(() => format(this.view, doc, removals));
    }
  }
});

/** Backspace right after an autoformat shows its marks as text again, as the first undo does. */
const undoFormatting = keymap.of([{ key: 'Backspace', run: (view) => (view.state.field(justFormatted, false) ? undo(view) : false) }]);

/**
 * Whether line `lineNumber` is an item of an ordered list, or a later line
 * of one, whose marker starts at `column`: a number typed there continues it.
 */
function inOrderedItem(state: EditorState, lineNumber: number, column: number): boolean {
  if (lineNumber < 1) return false;
  const line = state.doc.line(lineNumber);
  if (!/\S/.test(line.text)) return false;
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(line.to, -1); node; node = node.parent) {
    if (node.name === 'ListItem') {
      if (node.parent?.name !== 'OrderedList') return false;
      if (node.from - state.doc.lineAt(node.from).from === column) return true;
    }
  }
  return false;
}

// A line's container marks: quote marks, indents, and the list markers and boxes before its text.
const CONTAINER = /^(?:[ \t]*>[ \t]?)*(?:[ \t]*(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)*[ \t]*/;
// Marks a line may start with, typed as shortcuts: a bullet, a quote, a heading.
const LINE_SHORTCUTS = new Set(['ListMark', 'QuoteMark', 'HeaderMark']);
// Marks a typed space turns into formatting: a heading, a list item, a task's box.
const LINE_FORMATS = new Set(['HeaderMark', 'ListMark', 'TaskMarker']);

/** The one character typed at a caret by `tr`: where it went in the new text, or null. */
function typedCharacter(tr: Transaction): { at: number; text: string } | null {
  if (!tr.isUserEvent('input.type') || tr.isUserEvent('input.type.compose') || tr.startState.selection.ranges.length > 1) return null;
  const inserts: { at: number; text: string }[] = [];
  let removed = false;
  tr.changes.iterChanges((fromA, toA, fromB, _toB, inserted) => {
    if (toA > fromA) removed = true;
    inserts.push({ at: fromB, text: inserted.toString() });
  });
  if (removed || inserts.length !== 1) return null;
  // Text a typing style wraps in its marks is more than the one character typed, and is left as it is.
  return inserts[0].text.length === 1 ? inserts[0] : null;
}

/** An extra change that keeps a typed character as typed, or null when it shows as typed already. */
function escapeTyped(tr: Transaction): TransactionSpec | null {
  const typed = typedCharacter(tr);
  if (!typed) return null;
  const { startState: before, state: after } = tr;
  const caret = tr.changes.invertedDesc.mapPos(typed.at);
  if (rawAt(before, caret)) return null;
  const { text, at } = typed;
  const line = after.doc.lineAt(at);
  // An extra insertion before the typed character, with the caret after that character again.
  const insertBefore = (from: number, insert: string): TransactionSpec => ({ changes: { from, insert }, selection: { anchor: at + text.length + insert.length }, sequential: true });
  // The container is read before the typing, which may have turned "1984." into a marker.
  const lineBefore = before.doc.lineAt(caret);
  const prefix = CONTAINER.exec(before.sliceDoc(lineBefore.from, caret))?.[0] ?? '';
  const lead = after.sliceDoc(line.from + prefix.length, at);

  // A numbered item other than 1 starts only where it continues an ordered list.
  if ((text === '.' || text === ')' || text === ' ') && /^\d+[.)]?$/.test(lead + (text === ' ' ? '' : text)) && !/^\\/.test(lead)) {
    const marker = text === ' ' ? lead : lead + text;
    const match = /^(\d+)([.)])$/.exec(marker);
    if (match && Number(match[1]) !== 1 && !inOrderedItem(before, lineBefore.number - 1, prefix.length)) {
      return insertBefore(line.from + prefix.length + match[1].length, '\\');
    }
    if (text !== ' ') return null;
  }

  // A space that turns "#", "-", "1." or "[ ]" at the line's text start into formatting is an autoformat.
  if (text === ' ') {
    const mark = latestTree(after).resolveInner(at, -1);
    if (!LINE_FORMATS.has(mark.name) || mark.to !== at || mark.from !== line.from + prefix.length) return null;
    const numbered = mark.name === 'ListMark' && /\d/.test(after.sliceDoc(mark.from, mark.from + 1));
    return autoformatSpec(at, text.length, [numbered ? mark.to - 1 : mark.from]);
  }

  // "<!--" would hide the rest of the page in Obsidian.
  if (text === '-' && after.sliceDoc(at - 3, at + 1) === '<!--' && after.sliceDoc(at - 4, at - 3) !== '\\') {
    return insertBefore(at - 3, '\\');
  }

  // A rule or underline typed under a paragraph: a blank line keeps the paragraph a paragraph.
  const quote = /^(?:[ \t]*>[ \t]?)*/.exec(line.text)?.[0] ?? '';
  if ((text === '-' || text === '=') && /^(?:-{3,}|=+)$/.test(after.sliceDoc(line.from + quote.length, line.to)) && line.number > 1) {
    const mark = latestTree(after).resolveInner(line.from + quote.length, 1);
    if (mark.name === 'HeaderMark' && /^SetextHeading/.test(mark.parent?.name ?? '')) {
      return insertBefore(line.from, `${quote.replace(/[ \t]+$/, '')}\n`);
    }
    return null;
  }

  // Punctuation is checked against what the page shows; letters only where they touch a mark.
  if (!ASCII_PUNCTUATION.test(text)) return otherSide(tr, caret, text);
  // A bullet, quote or heading mark typed at the end of a line is a shortcut; before text it stays text.
  const mark = latestTree(after).resolveInner(at, 1);
  if (LINE_SHORTCUTS.has(mark.name) && mark.from === at && !/\S/.test(after.sliceDoc(at + text.length, line.to))) return null;
  const shown = visibleLine(before, caret);
  const offset = visibleOffset(shown, caret);
  const expected = shown.text.slice(0, offset) + text + shown.text.slice(offset);
  if (visibleLine(after, at).text === expected) return null;
  const marks = shortcutMarks(after, at);
  if (marks) {
    const positions: number[] = [];
    for (const range of [marks.open, marks.close]) for (let index = range.from; index < range.to; index += 1) positions.push(index);
    return autoformatSpec(at, text.length, positions);
  }
  return insertBefore(at, '\\');
}

/**
 * A character typed against a hidden mark can unmake it: "x" typed before
 * `*"quoted"*` leaves the star between a letter and punctuation, where it
 * opens nothing. The character then goes to the mark's other side, when
 * the page shows what was typed from there. Null when it shows as typed, or
 * nothing fixes it.
 */
function otherSide(tr: Transaction, caret: number, text: string): TransactionSpec | null {
  const { startState: before } = tr;
  if (!DELIMITERS.includes(before.sliceDoc(caret - 1, caret)) && !DELIMITERS.includes(before.sliceDoc(caret, caret + 1))) return null;
  const shown = visibleLine(before, caret);
  const offset = visibleOffset(shown, caret);
  const expected = shown.text.slice(0, offset) + text + shown.text.slice(offset);
  if (visibleLine(tr.state, tr.changes.mapPos(caret, 1)).text === expected) return null;
  const line = before.doc.lineAt(caret);
  for (const range of hiddenRanges(before, line.from, line.to)) {
    if (range.unit || (range.from !== caret && range.to !== caret)) continue;
    const at = range.from === caret ? range.to : range.from;
    const trial = before.update({ changes: { from: at, insert: text }, filter: false }).state;
    if (visibleLine(trial, at).text === expected) {
      return { changes: { from: at, insert: text }, selection: { anchor: at + text.length }, scrollIntoView: true, userEvent: 'input.type' };
    }
  }
  return null;
}

// Formatting a line break splits: it closes before the break and opens again after it.
const SPLIT = new Set(['StrongEmphasis', 'Emphasis', 'Strikethrough', 'InlineCode', 'Link']);

/**
 * Enter inside bold, italic, strikethrough, code or a link's text: the
 * formatting closes before the line break and opens again after it, so both
 * paragraphs keep it. Null when the caret is not inside such text.
 */
function splitAtBreak(tr: Transaction): TransactionSpec | null {
  const event = tr.annotation(Transaction.userEvent);
  if (event !== 'input' && event !== 'input.type') return null;
  const state = tr.startState;
  const { main } = state.selection;
  if (!main.empty || state.selection.ranges.length > 1) return null;
  const edits: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => edits.push({ from, to, insert: inserted.toString() }));
  // Enter takes the spaces around the caret with it.
  const [edit] = edits;
  if (edits.length !== 1 || edit.from > main.head || edit.to < main.head || !edit.insert.startsWith('\n') || /\S/.test(state.sliceDoc(edit.from, edit.to))) return null;
  const around = inlineSpans(state, main.head, main.head).filter((span) => SPLIT.has(span.name));
  // At the start of formatting's text, the break goes before its marks, so the formatting moves down whole.
  const starting = around.filter((span) => span.from < edit.from && span.textFrom === edit.from && edit.to === edit.from);
  if (starting.length > 0 && !around.some((span) => span.textFrom < edit.from && edit.from < span.textTo)) {
    const at = Math.min(...starting.map((span) => span.from));
    return { changes: { from: at, insert: edit.insert }, selection: { anchor: at + edit.insert.length + (main.head - at) }, scrollIntoView: true, userEvent: event };
  }
  const spans = around.filter((span) => span.textFrom < edit.from && edit.to < span.textTo);
  if (spans.length === 0) return null;
  // Marks never sit against a space: the spaces on either side of the break go.
  let from = edit.from;
  while (/[ \t]/.test(state.sliceDoc(from - 1, from))) from -= 1;
  let to = edit.to;
  while (/[ \t]/.test(state.sliceDoc(to, to + 1))) to += 1;
  if (spans.some((span) => from <= span.textFrom || to >= span.textTo)) return null;
  // Outer spans come first: they close last and open first.
  const closes = [...spans].reverse().map((span) => state.sliceDoc(span.textTo, span.to)).join('');
  const opens = spans.map((span) => state.sliceDoc(span.from, span.textFrom)).join('');
  const insert = closes + edit.insert + opens;
  return { changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true, userEvent: event };
}

/** The typing filter, after doc mode's own, so it sees where the typed text landed. */
const typingFilter = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.startState.facet(docMode)) return tr;
  const split = splitAtBreak(tr);
  if (split) return split;
  const extra = escapeTyped(tr);
  if (!extra) return tr;
  // An extra change goes after the typing; a whole new edit, as `otherSide` writes, replaces it.
  return extra.sequential ? [tr, extra] : extra;
});

/*
 * Bold, italic and strikethrough marks parse only where Markdown lets them
 * open and close: not between a letter and punctuation. `fitMarks` moves the
 * ends of a selection inward past punctuation, or out to the whole word, so
 * the marks always parse; null when neither works.
 */

const PUNCTUATION = /[\p{S}\p{P}]/u;
const SPACE = /\s/;

function flanking(before: string, after: string) {
  const spaceBefore = before === '' || SPACE.test(before);
  const spaceAfter = after === '' || SPACE.test(after);
  const punctuationBefore = PUNCTUATION.test(before);
  const punctuationAfter = PUNCTUATION.test(after);
  return {
    opens: !spaceAfter && (!punctuationAfter || spaceBefore || punctuationBefore),
    closes: !spaceBefore && (!punctuationBefore || spaceAfter || punctuationAfter),
  };
}

const charBefore = (state: EditorState, at: number) => (at <= 0 ? '' : state.sliceDoc(at - 1, at));
const charAt = (state: EditorState, at: number) => state.sliceDoc(at, at + 1);

/** Whether a mark written at `at` opens formatting there. */
export const opensAt = (state: EditorState, at: number) => flanking(charBefore(state, at), charAt(state, at)).opens;
/** Whether a mark written at `at` closes formatting there. */
export const closesAt = (state: EditorState, at: number) => flanking(charBefore(state, at), charAt(state, at)).closes;

/** Whether marks written at `from` and `to` open and close there. */
export function marksParse(state: EditorState, from: number, to: number): boolean {
  return from < to && flanking(charBefore(state, from), charAt(state, from)).opens && flanking(charBefore(state, to), charAt(state, to)).closes;
}

/** Where to write marks around `from` to `to` so they parse: inward past punctuation, else the whole word; null if neither. */
export function fitMarks(state: EditorState, from: number, to: number): { from: number; to: number } | null {
  if (marksParse(state, from, to)) return { from, to };
  // Inward past the punctuation at both ends, so "(beta)" becomes "(**beta**)" rather than "(**beta)**".
  let start = from;
  let end = to;
  while (start < end && PUNCTUATION.test(charAt(state, start))) start += 1;
  while (end > start && PUNCTUATION.test(charBefore(state, end))) end -= 1;
  if (marksParse(state, start, end)) return { from: start, to: end };
  const line = state.doc.lineAt(from);
  start = from;
  end = to;
  while (start > line.from && !SPACE.test(charBefore(state, start))) start -= 1;
  while (end < line.to && !SPACE.test(charAt(state, end))) end += 1;
  return marksParse(state, start, end) ? { from: start, to: end } : null;
}

/** Whether `tr` leaves the text its changed lines show as it was: formatting only, no mark shown. */
export function keepsVisibleText(tr: Transaction): boolean {
  if (!tr.docChanged) return true;
  let from = tr.startState.doc.length;
  let to = 0;
  tr.changes.iterChangedRanges((fromA, toA) => { from = Math.min(from, fromA); to = Math.max(to, toA); });
  const before = tr.startState.doc;
  const start = before.lineAt(from).from;
  const end = before.lineAt(to).to;
  return visibleSlice(tr.startState, start, end) === visibleSlice(tr.state, tr.changes.mapPos(start, -1), tr.changes.mapPos(end, 1));
}

/*
 * Literal text: what ⌘⇧V, Replace and the link form write. The text goes in
 * as written, and only characters that become Markdown in that spot are
 * escaped: each hidden mark the text would create is written with a
 * backslash. URLs and underscores inside words stay as they are. In code,
 * HTML and protected ranges the text goes in raw.
 */

const CELL_PIPE = /(?<!\\)\|/g;

function escapeAt(text: string, offsets: readonly number[]): string {
  let out = text;
  for (const offset of [...offsets].sort((a, b) => b - a)) out = `${out.slice(0, offset)}\\${out.slice(offset)}`;
  return out;
}

/**
 * `insert` written for `from` to `to` so the page shows it as written. Lines
 * after the first go after `prefix`, the container marks of the line. A
 * table cell takes `\|` for a pipe.
 */
export function literalText(state: EditorState, from: number, to: number, insert: string, { table = false, prefix = '' }: { table?: boolean; prefix?: string } = {}): string {
  if (rawAt(state, from)) return insert;
  let lines = insert.split('\n');
  if (table) lines = lines.map((line) => line.replace(CELL_PIPE, '\\|'));
  // A backslash just before the text would escape its first character.
  if (/^[!-/:-@[-`{-~]/.test(lines[0]) && charBefore(state, from) === '\\' && charBefore(state, from - 1) !== '\\') lines[0] = `\\${lines[0]}`;
  lines = lines.map((line) => line.replace(/<!--/g, '\\<!--'));
  if (!/[!-/:-@[-`{-~]/.test(lines.join(''))) return join(lines, prefix);
  const before = visibleSlice(state, state.doc.lineAt(from).from, from);
  const after = visibleSlice(state, to, state.doc.lineAt(to).to);
  const expected = before + insert.split('\n').join('\n') + after;
  for (let round = 0; round < 6; round += 1) {
    const written = join(lines, prefix);
    const next = state.update({ changes: { from, to, insert: written }, filter: false }).state;
    const end = from + written.length;
    if (table || visibleSlice(next, next.doc.lineAt(from).from, next.doc.lineAt(end).to) === expected) return written;
    // The hidden marks inside the inserted text, as offsets into its lines.
    const starts: number[] = [];
    for (let index = 0, at = from; index < lines.length; index += 1) {
      const lead = index === 0 ? 0 : prefix.length;
      starts.push(at + lead);
      at += lead + lines[index].length + 1;
    }
    const escapes = lines.map((): number[] => []);
    for (const range of hiddenRanges(next, from, end)) {
      for (let index = 0; index < lines.length; index += 1) {
        const lineFrom = starts[index];
        const lineTo = lineFrom + lines[index].length;
        for (let at = Math.max(range.from, lineFrom); at < Math.min(range.to, lineTo); at += 1) {
          const character = lines[index][at - lineFrom];
          if (ASCII_PUNCTUATION.test(character) && lines[index][at - lineFrom - 1] !== '\\') {
            escapes[index].push(at - lineFrom);
            // A mark of several characters needs only its first escaped, except emphasis runs.
            if (!'*_~`'.includes(character)) break;
          }
        }
      }
    }
    if (escapes.every((list) => list.length === 0)) return written;
    lines = lines.map((line, index) => escapeAt(line, [...new Set(escapes[index])]));
  }
  return join(lines, prefix);
}

const join = (lines: readonly string[], prefix: string) => lines.map((line, index) => (index === 0 ? line : prefix + line)).join('\n');

/**
 * A hard break, a backslash or two spaces ending a line, is hidden in a
 * document. The caret rests before it, so text typed at the line's end
 * lands before the break and never after its spaces.
 */
const hardBreaks = nodeDecorators.of({
  nodes: ['HardBreak'],
  decorate(ctx, node) {
    if (!ctx.docMode) return false;
    ctx.hide(node.from, Math.min(node.to, ctx.state.doc.lineAt(node.from).to));
    return true;
  },
});

/*
 * Input methods. A composition over a selection would leave half of a mark
 * behind, so the selection goes first, as Backspace takes it, keeping the
 * marks around it. A style turned on with Cmd+B for the next text still
 * applies when that text comes from an input method: the composed text is
 * wrapped in its marks in one change once the composition ends.
 */

interface Composing {
  from: number;
  length: number;
  markers: readonly string[];
}

const composing = new WeakMap<EditorView, Composing>();

function compositionHooks(replace: (state: EditorState, from: number, to: number, insert: string) => { changes: ChangeSpec[] }): Extension {
  return EditorView.domEventObservers({
    compositionstart(_event, view) {
      let { state } = view;
      if (!state.facet(docMode) || state.readOnly || state.selection.ranges.length > 1) return;
      const { main } = state.selection;
      if (!main.empty && !rawAt(state, main.from)) {
        const { changes } = replace(state, main.from, main.to, '');
        const set = ChangeSet.of(changes, state.doc.length);
        view.dispatch({ changes: set, selection: { anchor: set.mapPos(main.from, 1) }, userEvent: 'delete.selection' });
        state = view.state;
      }
      const style = state.field(typingStyle, false);
      const at = state.selection.main.head;
      if (style && style.at === at && style.markers.length > 0) composing.set(view, { from: at, length: state.doc.length, markers: style.markers });
      else composing.delete(view);
    },
    compositionend(_event, view) {
      const started = composing.get(view);
      composing.delete(view);
      if (!started) return;
      // CodeMirror reads the composed text from the page just after the event.
      setTimeout(() => {
        if (view.composing) return;
        const { state } = view;
        const to = state.selection.main.head;
        if (to <= started.from || state.doc.length - started.length !== to - started.from) return;
        const open = started.markers.join('');
        const close = [...started.markers].reverse().join('');
        view.dispatch({ changes: [{ from: started.from, insert: open }, { from: to, insert: close }], selection: { anchor: to + open.length + close.length }, userEvent: 'input' });
      }, 30);
    },
  });
}

/** Doc mode's typing: the session's typed marks, the escapes, Enter in formatting, hidden hard breaks and input methods. */
export function typingExtension(replace: (state: EditorState, from: number, to: number, insert: string) => { changes: ChangeSpec[] }): Extension {
  return [typedMarks, justFormatted, typeThenFormat, applyFormatting, Prec.high(undoFormatting), Prec.high(typingFilter), hardBreaks, compositionHooks(replace)];
}
