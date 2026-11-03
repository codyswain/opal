import { isolateHistory, undo } from '@codemirror/commands';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { ChangeSet, EditorState, MapMode, Prec, StateEffect, StateField, Transaction, type ChangeSpec, type Extension, type Text, type TransactionSpec } from '@codemirror/state';
import { EditorView, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { latestTree, nodeDecorators, protectedIn } from './extensionPoints';
import { inlineSpans, typingStyle } from './formatCommands';
import { docMode, hiddenRanges } from './livePreview';
import { OBJECT as OBJECT_CHARACTER, visibleLine, visibleOffset, visibleSlice } from './visibleText';

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
      // Text typed before an HTML block or comment's first character makes the line a paragraph.
      if ((node.name === 'HTMLBlock' || node.name === 'CommentBlock') && node.from === at) continue;
      if (RAW_BLOCKS.has(node.name)) return true;
      if (node.name === 'InlineCode') {
        const marks = node.getChildren('CodeMark');
        if (marks.length === 2 && at >= marks[0].to && at <= marks[1].from) return true;
      }
    }
  }
  return false;
}

/** Whether `at` is inside a wiki link or embed, whose text the page shows as written. */
export function inWikiLink(state: EditorState, at: number): boolean {
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(at, 1); node; node = node.parent) {
    if (node.name === 'WikiLink' || node.name === 'Embed') return node.from < at && at < node.to;
  }
  return false;
}

// Characters a document's typing watches: emphasis, strikethrough and code marks, and the backslash.
const DELIMITERS = '*_~`\\';
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;

// The latest typed delimiters kept: a shortcut is finished soon after it starts.
const TYPED_KEPT = 1_000;

/** Positions of the delimiters typed in this editor, so a shortcut typed here is kept and an old mark is not. */
export const typedMarks = StateField.define<readonly number[]>({
  create: () => [],
  update(marks, tr) {
    if (!tr.docChanged) return marks;
    const kept = marks.slice(-TYPED_KEPT).map((at) => tr.changes.mapPos(at, 1, MapMode.TrackDel)).filter((at): at is number => at !== null);
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

function formatting(tr: Transaction): readonly { from: number; to: number }[] | undefined {
  for (const effect of tr.effects) if (effect.is(formatAfter)) return effect.value;
  return undefined;
}

// Typed text that can finish a shortcut: a closing delimiter, or a space after a line mark.
const SHORTCUT_KEYS = /^[*_~`]$/;
const LINE_MARK_BEFORE = /(?:^|[ \t>])(?:[-+*]|\d+[.)]|#{1,6}|\[[ xX]\])$/;

/** Typed text that finishes a shortcut is written, then formatted, in two dispatches straight away. */
const typeThenFormat = EditorView.inputHandler.of((view, from, _to, text, insert) => {
  if (view.composing || !view.state.facet(docMode)) return false;
  const spaceAfterMark = text === ' ' && LINE_MARK_BEFORE.test(view.state.sliceDoc(view.state.doc.lineAt(from).from, from));
  if (!spaceAfterMark && !SHORTCUT_KEYS.test(text)) return false;
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

/**
 * The one character typed by `tr`, at a caret or over a selection on one
 * line: where it went in the new text, and the old text it replaced. Null
 * for anything else.
 */
function typedCharacter(tr: Transaction): { at: number; text: string; from: number; to: number } | null {
  if (!tr.isUserEvent('input.type') || tr.isUserEvent('input.type.compose') || tr.startState.selection.ranges.length > 1) return null;
  const inserts: { at: number; text: string; from: number; to: number }[] = [];
  tr.changes.iterChanges((fromA, toA, fromB, _toB, inserted) => inserts.push({ at: fromB, text: inserted.toString(), from: fromA, to: toA }));
  if (inserts.length !== 1) return null;
  const [typed] = inserts;
  if (typed.to > typed.from && tr.startState.doc.lineAt(typed.from).number !== tr.startState.doc.lineAt(typed.to).number) return null;
  // Text a typing style wraps in its marks is more than the one character typed, and is left as it is.
  return typed.text.length === 1 ? typed : null;
}

/** The backslash written before "N." at a line start, taken out again when the next key is not a space. */
const numberEscape = StateEffect.define<number | null>();
/** The blank line written above `---` or `===` under a paragraph, taken out again when the line stops being one. */
const ruleBlank = StateEffect.define<{ from: number; to: number }>();

const provisional = StateField.define<{ number: number | null; blank: { from: number; to: number } | null }>({
  create: () => ({ number: null, blank: null }),
  update(value, tr) {
    let { number, blank } = value;
    if (tr.docChanged) {
      number = number === null ? null : tr.changes.mapPos(number, 1, MapMode.TrackDel);
      if (blank) {
        const from = tr.changes.mapPos(blank.from, 1, MapMode.TrackDel);
        const to = tr.changes.mapPos(blank.to, -1, MapMode.TrackDel);
        blank = from === null || to === null || to - from !== blank.to - blank.from ? null : { from, to };
      }
    }
    for (const effect of tr.effects) {
      if (effect.is(numberEscape)) number = effect.value;
      if (effect.is(ruleBlank)) blank = effect.value;
    }
    return number === value.number && blank === value.blank ? value : { number, blank };
  },
});

// A line that is a rule or a heading's underline.
const RULE_LINE = /^(?:-+|=+)[ \t]*$/;

/** The links a typed `]`, `)` or `>` finishes: a Markdown link or image, a wiki link or embed, an autolink. */
const TYPED_LINKS = new Set(['Link', 'Image', 'WikiLink', 'Embed', 'Autolink']);

function finishesLink(state: EditorState, at: number): boolean {
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(at + 1, -1); node; node = node.parent) {
    if (TYPED_LINKS.has(node.name)) return node.to === at + 1;
  }
  return false;
}

/** An extra change that keeps a typed character as typed, or null when it shows as typed already. */
function escapeTyped(tr: Transaction): TransactionSpec | null {
  const typed = typedCharacter(tr);
  if (!typed) return null;
  const { startState: before, state: after } = tr;
  const caret = typed.from;
  const { text, at } = typed;
  const line = after.doc.lineAt(at);
  // While the parser has not reached the line, what the page shows there is not known: nothing is escaped.
  if (syntaxTree(before).length < before.doc.lineAt(caret).to || syntaxTree(after).length < line.to) return null;
  if (rawAt(before, caret)) return null;
  // An extra insertion before the typed character, with the caret after that character again.
  const insertBefore = (from: number, insert: string): TransactionSpec => ({ changes: { from, insert }, selection: { anchor: at + text.length + insert.length }, sequential: true });
  // The container is read before the typing, which may have turned "1984." into a marker.
  const lineBefore = before.doc.lineAt(caret);
  const prefix = CONTAINER.exec(before.sliceDoc(lineBefore.from, caret))?.[0] ?? '';
  const lead = after.sliceDoc(line.from + prefix.length, at);
  const { number, blank } = before.field(provisional, false) ?? { number: null, blank: null };

  // "3\." followed by anything but a space never reads as a list item: the backslash goes again.
  if (number !== null && caret === number + 2 && caret === typed.to && text !== ' ' && before.sliceDoc(number, number + 1) === '\\') {
    return { changes: { from: number, to: number + 1 }, selection: { anchor: at + text.length - 1 }, effects: numberEscape.of(null), sequential: true };
  }

  // A line under the blank line written above a rule that stops being a rule or underline: the blank line goes again.
  if (blank && blank.to === lineBefore.from) {
    const quoted = /^(?:[ \t]*>[ \t]?)*/.exec(line.text)?.[0] ?? '';
    if (!RULE_LINE.test(line.text.slice(quoted.length))) {
      const length = blank.to - blank.from;
      return { changes: { from: blank.from, to: blank.to }, selection: { anchor: at + text.length - length }, sequential: true };
    }
  }

  // A numbered item other than 1 starts only where it continues an ordered list.
  if ((text === '.' || text === ')' || text === ' ') && /^\d+[.)]?$/.test(lead + (text === ' ' ? '' : text)) && !/^\\/.test(lead)) {
    const marker = text === ' ' ? lead : lead + text;
    const match = /^(\d+)([.)])$/.exec(marker);
    if (match && Number(match[1]) !== 1 && !inOrderedItem(before, lineBefore.number - 1, prefix.length)) {
      const from = line.from + prefix.length + match[1].length;
      return { ...insertBefore(from, '\\'), effects: numberEscape.of(from) };
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

  // "<!--" would hide the rest of the page in Obsidian. In a wiki link or a URL the backslash would show, and nothing is hidden there.
  if (text === '-' && after.sliceDoc(at - 3, at + 1) === '<!--' && after.sliceDoc(at - 4, at - 3) !== '\\') {
    return hidesBackslash(after, at - 3) ? insertBefore(at - 3, '\\') : null;
  }

  // A rule or underline typed under a paragraph: a blank line keeps the paragraph a paragraph.
  const quote = /^(?:[ \t]*>[ \t]?)*/.exec(line.text)?.[0] ?? '';
  if ((text === '-' || text === '=') && /^(?:-{3,}|=+)$/.test(after.sliceDoc(line.from + quote.length, line.to)) && line.number > 1) {
    const mark = latestTree(after).resolveInner(line.from + quote.length, 1);
    if (mark.name === 'HeaderMark' && /^SetextHeading/.test(mark.parent?.name ?? '')) {
      const insert = `${quote.replace(/[ \t]+$/, '')}\n`;
      return { ...insertBefore(line.from, insert), effects: ruleBlank.of({ from: line.from, to: line.from + insert.length }) };
    }
    return null;
  }

  // Punctuation is checked against what the page shows; letters only where they touch a mark.
  if (!ASCII_PUNCTUATION.test(text)) return typed.to === typed.from ? otherSide(tr, caret, text) : null;
  // A bullet, quote or heading mark typed at the end of a line is a shortcut; before text it stays text.
  const mark = latestTree(after).resolveInner(at, 1);
  if (LINE_SHORTCUTS.has(mark.name) && mark.from === at && !/\S/.test(after.sliceDoc(at + text.length, line.to))) return null;
  // The last bracket of a link or wiki link, or the ">" of an autolink, finishes a link typed by hand.
  if ((text === ']' || text === ')' || text === '>') && finishesLink(after, at)) return null;
  const shown = visibleLine(before, caret);
  const expected = shown.text.slice(0, visibleOffset(shown, caret)) + text + shown.text.slice(visibleOffset(shown, typed.to));
  if (visibleLine(after, at).text === expected) return null;
  const marks = shortcutMarks(after, at);
  if (marks) {
    const positions: number[] = [];
    for (const range of [marks.open, marks.close]) for (let index = range.from; index < range.to; index += 1) positions.push(index);
    return autoformatSpec(at, text.length, positions);
  }
  // A backslash before the typed character, or where that does nothing (in a bare URL), before the opener it closes.
  for (const from of [at, openerClosedAt(after, at)]) {
    if (from !== null && visibleLine(withBackslash(after, from), at + 1).text === expected) return insertBefore(from, '\\');
  }
  return null;
}

/** `state` with a backslash written at `from`, parsed to the end of that line. */
function withBackslash(state: EditorState, from: number): EditorState {
  const trial = state.update({ changes: { from, insert: '\\' }, filter: false }).state;
  ensureSyntaxTree(trial, trial.doc.lineAt(from).to, 50);
  return trial;
}

/** Whether a backslash written at `from` hides as an escape, rather than showing as one more character. */
function hidesBackslash(state: EditorState, from: number): boolean {
  const trial = visibleLine(withBackslash(state, from), from);
  return !trial.starts.some((start, index) => start === from && trial.text[index] === '\\');
}

/** Where the opening mark of the emphasis whose closing mark holds `at` starts, or null. */
function openerClosedAt(state: EditorState, at: number): number | null {
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(at, 1); node; node = node.parent) {
    if (!EMPHASIS_NODES.has(node.name)) continue;
    const marks = node.getChildren(MARK_OF[node.name]);
    if (marks.length < 2) return null;
    const close = marks[marks.length - 1];
    return close.from <= at && at < close.to ? marks[0].from : null;
  }
  return null;
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
/**
 * Enter right after a backslash would make it a hard break once the next
 * line has text, and a document hides hard breaks: the backslash is written
 * `\\` so it stays on the page.
 */
function keepBackslash(tr: Transaction): TransactionSpec | null {
  const event = tr.annotation(Transaction.userEvent);
  if (event !== 'input' && event !== 'input.type') return null;
  let found: TransactionSpec | null = null;
  tr.changes.iterChanges((fromA, _toA, fromB, _toB, inserted) => {
    if (found || !inserted.toString().startsWith('\n')) return;
    const before = tr.startState;
    if (before.sliceDoc(fromA - 1, fromA) !== '\\' || before.sliceDoc(fromA - 2, fromA - 1) === '\\' || rawAt(before, fromA)) return;
    found = { changes: { from: fromB - 1, insert: '\\' }, sequential: true };
  });
  return found;
}

/**
 * Backspace or Delete that joins a line ending in a hard break takes the
 * hidden break with the line break, so the backslash or spaces never show.
 */
function joinAcrossBreak(tr: Transaction): TransactionSpec | null {
  if (!tr.isUserEvent('delete')) return null;
  const edits: { from: number; to: number; inserted: number }[] = [];
  tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => edits.push({ from, to, inserted: inserted.length }));
  if (edits.length !== 1 || edits[0].inserted > 0 || edits[0].to - edits[0].from !== 1) return null;
  const state = tr.startState;
  const { from } = edits[0];
  if (state.sliceDoc(from, from + 1) !== '\n' || rawAt(state, from)) return null;
  let start: number | null = null;
  latestTree(state).iterate({ from: state.doc.lineAt(from).from, to: from + 1, enter: (ref) => { if (ref.name === 'HardBreak' && ref.to === from + 1) start = ref.from; } });
  if (start === null) return null;
  return { changes: { from: start, to: from + 1 }, selection: { anchor: start }, scrollIntoView: true, userEvent: tr.annotation(Transaction.userEvent) };
}

const typingFilter = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.startState.facet(docMode)) return tr;
  const joined = joinAcrossBreak(tr);
  if (joined) return joined;
  const split = splitAtBreak(tr);
  if (split) return split;
  const backslash = keepBackslash(tr);
  if (backslash) return [tr, backslash];
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
 * HTML, wiki links and protected ranges the text goes in raw.
 */

const CELL_PIPE = /(?<!\\)\|/g;
const PUNCTUATION_IN = /[!-/:-@[-`{-~]/;

/** One piece of literal text: `insert` written for `from` to `to`. */
export interface LiteralEdit {
  from: number;
  to: number;
  insert: string;
  /** A table cell, which takes `\|` for a pipe. */
  table?: boolean;
  /** The container marks lines after the first go after. */
  prefix?: string;
}

/** A line of literal text, with the backslashes this escaper wrote in it. */
interface Written {
  text: string;
  ours: boolean[];
}

function escapeIn(line: Written, offset: number): void {
  line.text = `${line.text.slice(0, offset)}\\${line.text.slice(offset)}`;
  line.ours.splice(offset, 0, true);
}

/** `pattern`'s matches in `line` each get a backslash before them. */
function escapeAll(line: Written, pattern: RegExp): void {
  const offsets = [...line.text.matchAll(pattern)].map((match) => match.index ?? 0);
  for (const offset of offsets.reverse()) escapeIn(line, offset);
}

/**
 * `insert` written for `from` to `to` so the page shows it as written. Lines
 * after the first go after `prefix`, the container marks of the line. A
 * table cell takes `\|` for a pipe.
 */
export function literalText(state: EditorState, from: number, to: number, insert: string, { table = false, prefix = '' }: { table?: boolean; prefix?: string } = {}): string {
  return literalTexts(state, [{ from, to, insert, table, prefix }])[0];
}

/**
 * `literalText` for several edits at once, in order and not overlapping, as
 * Replace All writes them. Every round writes all of them and parses the
 * page once, so the cost does not grow with the number of edits.
 */
export function literalTexts(state: EditorState, edits: readonly LiteralEdit[]): string[] {
  const lines: Written[][] = edits.map((edit) => {
    const written = edit.insert.split('\n').map((text) => ({ text, ours: [...text].map(() => false) }));
    if (rawAt(state, edit.from) || inWikiLink(state, edit.from)) return written;
    if (edit.table) for (const line of written) escapeAll(line, CELL_PIPE);
    // A backslash just before the text would escape its first character.
    if (PUNCTUATION_IN.test(written[0].text[0] ?? '') && charBefore(state, edit.from) === '\\' && charBefore(state, edit.from - 1) !== '\\') escapeIn(written[0], 0);
    for (const line of written) escapeAll(line, /<!--/g);
    return written;
  });
  const texts = () => edits.map((edit, index) => join(lines[index].map((line) => line.text), edit.prefix ?? ''));
  // Edits that can still read as Markdown, grouped by the lines they touch, since edits on one line affect each other.
  const open = edits.map((edit, index) => !rawAt(state, edit.from) && !inWikiLink(state, edit.from) && lines[index].some((line) => PUNCTUATION_IN.test(line.text)));
  const groups: { from: number; to: number; members: number[] }[] = [];
  edits.forEach((edit, index) => {
    const from = state.doc.lineAt(edit.from).from;
    const to = state.doc.lineAt(edit.to).to;
    const last = groups[groups.length - 1];
    if (last && from <= last.to) { last.to = Math.max(last.to, to); last.members.push(index); } else groups.push({ from, to, members: [index] });
  });
  let pending = groups.filter((group) => group.members.some((index) => open[index]));
  if (pending.length === 0) return texts();
  const expected = new Map(pending.map((group) => {
    let shown = '';
    let at = group.from;
    for (const index of group.members) {
      shown += visibleSlice(state, at, edits[index].from) + edits[index].insert;
      at = edits[index].to;
    }
    return [group, shown + visibleSlice(state, at, group.to)];
  }));
  for (let round = 0; round < 6 && pending.length > 0; round += 1) {
    const written = texts();
    const changes = ChangeSet.of(edits.map((edit, index) => ({ from: edit.from, to: edit.to, insert: written[index] })), state.doc.length);
    const next = state.update({ changes, filter: false }).state;
    const last = pending[pending.length - 1];
    ensureSyntaxTree(next, changes.mapPos(last.to, 1), 2_000);
    pending = pending.filter((group) => {
      if (visibleSlice(next, changes.mapPos(group.from, -1), changes.mapPos(group.to, 1)) === expected.get(group)) return false;
      let escaped = false;
      for (const index of group.members) {
        if (!open[index]) continue;
        const prefix = edits[index].prefix ?? '';
        let at = changes.mapPos(edits[index].from, -1);
        lines[index].forEach((line, number) => {
          if (number > 0) at += prefix.length;
          escaped = escapeHidden(next, at, line) || escaped;
          at += line.text.length + 1;
        });
      }
      // Nothing written is hidden, yet the line shows differently: brackets in the text can unmake a link around it.
      if (!escaped) {
        for (const index of group.members) if (open[index]) for (const line of lines[index]) escaped = escapeBrackets(line) || escaped;
      }
      return escaped;
    });
  }
  return texts();
}

/** Escapes the brackets of `line` that are not escaped yet; false when there were none. */
function escapeBrackets(line: Written): boolean {
  const offsets = [...line.text.matchAll(/[[\]]/g)].map((match) => match.index ?? 0).filter((offset) => line.text[offset - 1] !== '\\');
  for (const offset of offsets.reverse()) escapeIn(line, offset);
  return offsets.length > 0;
}

/**
 * Escapes the characters of `line`, written at `at` in `state`, that the page
 * hides: the first of each hidden run, or all of a run of emphasis marks.
 * Backslashes this escaper wrote are left alone. False when none needed it.
 */
function escapeHidden(state: EditorState, at: number, line: Written): boolean {
  if (!line.text) return false;
  const visible = visibleLine(state, at);
  const shown = new Set<number>();
  visible.starts.forEach((start, index) => { if (visible.text[index] !== OBJECT_CHARACTER) shown.add(start); });
  const offsets: number[] = [];
  let run = false;
  let done = false;
  for (let offset = 0; offset < line.text.length; offset += 1) {
    if (shown.has(at + offset)) { run = false; continue; }
    if (!run) { run = true; done = false; }
    const character = line.text[offset];
    if (done || line.ours[offset] || !PUNCTUATION_IN.test(character) || line.text[offset - 1] === '\\') continue;
    offsets.push(offset);
    // A mark of several characters needs only its first escaped, except emphasis runs.
    if (!'*_~`'.includes(character)) done = true;
  }
  for (const offset of offsets.reverse()) escapeIn(line, offset);
  return offsets.length > 0;
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
  return [typedMarks, provisional, justFormatted, typeThenFormat, applyFormatting, Prec.high(undoFormatting), Prec.high(typingFilter), hardBreaks, compositionHooks(replace)];
}
