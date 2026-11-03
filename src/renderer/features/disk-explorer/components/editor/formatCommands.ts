import { indentUnit } from '@codemirror/language';
import {
  ChangeSet,
  EditorSelection,
  StateEffect,
  StateField,
  type ChangeSpec,
  type EditorState,
  type Line,
  type SelectionRange,
  type StateCommand,
  type TransactionSpec,
} from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { calloutMarker } from './blockGuards';
import { toast } from 'sonner';
import { latestTree, protectedIn, treeFor } from './extensionPoints';
import { nestListItems } from './listKeys';
import { docMode, linkTarget } from './livePreview';
import { closesAt, fitMarks, keepsVisibleText, opensAt } from './typing';
import { parseWikiTarget } from './wikiLinks';

/*
 * The formatting commands of the page and of a document's toolbar. Each finds
 * the formatting it changes in the syntax tree and writes only the marks it
 * needs, so the rest of the text keeps its bytes. Bold, italic and
 * strikethrough follow Google Docs: a selection that is partly bold becomes
 * all bold, and one that is all bold loses it, around the selection only.
 */

// Marks that open a line before its text: a quote's ">", a list's "-" or "1.", a task's box, a heading's "#".
const LINE_MARKS = new Set(['QuoteMark', 'ListMark', 'TaskMarker', 'HeaderMark']);
const BLOCK_MARKS = new Set(['QuoteMark', 'ListMark', 'TaskMarker']);
const QUOTE_MARK = new Set(['QuoteMark']);

/** Where a line's text starts, past spaces, the `marks` that open it and a callout's "[!type]". */
function textStart(state: EditorState, line: Line, marks: ReadonlySet<string> = LINE_MARKS): number {
  const tree = latestTree(state);
  const callout = calloutMarker(state, line);
  let at = line.from;
  for (;;) {
    while (at < line.to && /[ \t]/.test(state.sliceDoc(at, at + 1))) at += 1;
    if (callout && at === callout.from) {
      at = callout.to;
      continue;
    }
    const node = tree.resolveInner(at, 1);
    if (node.from !== at || node.to > line.to || !marks.has(node.name)) return at;
    at = node.to;
  }
}

/** The lines the selection touches. A selection that ends at the start of a line leaves that line out. */
function touchedLines(state: EditorState): Line[] {
  const lines = new Map<number, Line>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from);
    const last = state.doc.lineAt(range.to);
    const end = !range.empty && range.to === last.from && last.from > range.from ? last.number - 1 : last.number;
    // A selection that starts at the end of a line, as one past a formula's line break does, leaves that line out too.
    const start = !range.empty && range.from === first.to && range.to > first.to ? first.number + 1 : first.number;
    for (let number = start; number <= end; number += 1) lines.set(number, state.doc.line(number));
  }
  return [...lines.values()].sort((a, b) => a.number - b.number);
}

/** The lines the selection touches, less those a protected range covers whole, such as a table's. */
export function selectedLines(state: EditorState): Line[] {
  return touchedLines(state).filter((line) => !protectedIn(state, line.from, line.to).some((range) => !range.inline && range.from <= line.from && range.to >= line.to));
}

/**
 * `text` kept out of protected ranges: its ends move out of one inside its
 * line, so formatting goes around a formula or inline code even when it
 * fills its line, and it is cut short of one that spans lines or covers its
 * lines whole, such as a table or a rule.
 * Null when nothing is left.
 */
function unprotected(state: EditorState, text: { from: number; to: number }): { from: number; to: number } | null {
  let { from, to } = text;
  for (const range of protectedIn(state, from, to)) {
    const first = state.doc.lineAt(range.from);
    const last = state.doc.lineAt(range.to);
    if (!range.lines && first.number === last.number && (range.inline || !(range.from === first.from && range.to === last.to))) {
      if (range.from < from && from < range.to) from = range.from;
      if (range.from < to && to < range.to) to = range.to;
    } else {
      if (range.from <= from && range.to >= to) return null;
      if (range.from <= from && range.to > from) from = range.to;
      if (range.from < to && range.to >= to) to = range.from;
    }
  }
  return to > from ? { from, to } : null;
}

/** The end of the selection, for `treeFor`. */
const selectionEnd = (state: EditorState) => Math.max(...state.selection.ranges.map((range) => range.to));

/**
 * The parts of a selection to format, one per line: the selected text of
 * each line without the marks that open it or the spaces that end it. A
 * selected bullet keeps its "- " outside the bold, and a selection over
 * several lines formats each, since a mark never closes on another line.
 */
function lineSpans(state: EditorState, range: SelectionRange): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  for (let at = range.from; at <= range.to;) {
    const line = state.doc.lineAt(at);
    const from = Math.max(range.from, textStart(state, line));
    const to = Math.min(range.to, line.from + line.text.trimEnd().length);
    if (to > from) spans.push({ from, to });
    at = line.to + 1;
  }
  return spans;
}

/** A piece of inline formatting: the marks that open and close it, which a document hides, around its text. */
export interface InlineSpan {
  name: string;
  from: number;
  to: number;
  textFrom: number;
  textTo: number;
}

const SPAN_MARKS: Record<string, string> = {
  StrongEmphasis: 'EmphasisMark',
  Emphasis: 'EmphasisMark',
  Strikethrough: 'StrikethroughMark',
  InlineCode: 'CodeMark',
  Autolink: 'LinkMark',
};

function inlineSpan(state: EditorState, node: SyntaxNode): InlineSpan | null {
  const { name, from, to } = node;
  if (name === 'Escape') return { name, from, to, textFrom: from + 1, textTo: to };
  if (name === 'Link') {
    const [open, close] = node.getChildren('LinkMark');
    return close && linkTarget(state, node) !== null ? { name, from, to, textFrom: open.to, textTo: close.from } : null;
  }
  if (name === 'WikiLink' || name === 'Embed') {
    const [open, close] = node.getChildren('WikiLinkMark');
    if (!open || !close) return null;
    const { aliasAt } = parseWikiTarget(state.sliceDoc(open.to, close.from));
    return { name, from, to, textFrom: aliasAt === null ? open.to : open.to + aliasAt, textTo: close.from };
  }
  const marks = SPAN_MARKS[name] ? node.getChildren(SPAN_MARKS[name]) : [];
  return marks.length < 2 ? null : { name, from, to, textFrom: marks[0].to, textTo: marks[marks.length - 1].from };
}

/** The inline formatting that touches `from` to `to`, outer spans before the ones inside them. */
export function inlineSpans(state: EditorState, from: number, to: number): InlineSpan[] {
  const spans: InlineSpan[] = [];
  latestTree(state).iterate({
    from,
    to,
    enter: (ref) => {
      const span = inlineSpan(state, ref.node);
      if (span) spans.push(span);
    },
  });
  return spans;
}

/** Whether text typed at `at` takes the formatting `name`, as the text just before it has it. */
export function styledAt(state: EditorState, at: number, name: string): boolean {
  return inlineSpans(state, at, at).some((span) => span.name === name && span.textFrom <= at && at <= span.textTo);
}

// Formatting whose closing marks Markdown reads only right after text, never after a space or a line break.
export const EMPHASIS: ReadonlySet<string> = new Set(['StrongEmphasis', 'Emphasis', 'Strikethrough']);

const closingSpan = (state: EditorState, at: number) =>
  inlineSpans(state, at, at).find((span) => EMPHASIS.has(span.name) && span.textTo === at);

/** The bold, italic and strikethrough whose text ends at `at`, inner first: only their closing marks follow it. */
export function closingAt(state: EditorState, at: number): InlineSpan[] {
  const spans: InlineSpan[] = [];
  for (let span = closingSpan(state, at); span; span = closingSpan(state, span.to)) spans.push(span);
  return spans;
}

const inMark = (spans: readonly InlineSpan[], at: number) =>
  spans.some((span) => (at >= span.from && at < span.textFrom) || (at >= span.textTo && at < span.to));

const isSpace = (state: EditorState, at: number) => /\s/.test(state.sliceDoc(at, at + 1));

/** Where the text from `from` to `to` starts and ends, past marks and spaces, or null when it has none. */
function textBounds(state: EditorState, spans: readonly InlineSpan[], from: number, to: number): { from: number; to: number } | null {
  let start = from;
  while (start < to && (inMark(spans, start) || isSpace(state, start))) start += 1;
  let end = to;
  while (end > start && (inMark(spans, end - 1) || isSpace(state, end - 1))) end -= 1;
  return end > start ? { from: start, to: end } : null;
}

/** One line's part of a selection: its text, past marks and spaces, and the formatting around it. */
export interface SelectedText {
  from: number;
  to: number;
  spans: InlineSpan[];
}

/** The selected text of each line of `range`. */
export function selectedText(state: EditorState, range: SelectionRange): SelectedText[] {
  return lineSpans(state, range).flatMap((line) => {
    const spans = inlineSpans(state, line.from, line.to);
    const found = textBounds(state, spans, line.from, line.to);
    const bounds = found && unprotected(state, found);
    return bounds ? [{ ...bounds, spans }] : [];
  });
}

/** Whether every character of the text holds the formatting `name`. */
export function allStyled(state: EditorState, text: SelectedText, name: string): boolean {
  for (let at = text.from; at < text.to; at += 1) {
    if (inMark(text.spans, at) || isSpace(state, at)) continue;
    if (!text.spans.some((span) => span.name === name && at >= span.textFrom && at < span.textTo)) return false;
  }
  return true;
}

/**
 * Moves the ends of `from` to `to` out of each of `spans` that holds one of
 * them and not the other, or with `either` that holds any, so marks written
 * at the ends never cross a span's own marks.
 */
function outOf(spans: readonly InlineSpan[], from: number, to: number, either = false) {
  for (let moved = true; moved;) {
    moved = false;
    for (const span of spans) {
      const holdsFrom = from >= span.textFrom && from < span.textTo;
      const holdsTo = to > span.textFrom && to <= span.textTo;
      if (holdsFrom && (either || !holdsTo) && from !== span.from) { from = span.from; moved = true; }
      if (holdsTo && (either || !holdsFrom) && to !== span.to) { to = span.to; moved = true; }
    }
  }
  return { from, to };
}

interface Change {
  from: number;
  to: number;
  insert: string;
  /** Among marks written at one place: closing ones inner first, opening ones outer first. */
  nesting?: number;
}

/** Changes in order, an insertion before a deletion at the same place, so one ChangeSet holds them all. */
function ordered(changes: Change[]): Change[] {
  return changes.map((change, index) => ({ change, index }))
    .sort((a, b) => a.change.from - b.change.from || (a.change.to - a.change.from) - (b.change.to - b.change.from)
      || (a.change.nesting ?? 0) - (b.change.nesting ?? 0) || a.index - b.index)
    .map(({ change }) => change);
}

/**
 * Formats the text with `marker`, joining the spans it touches into one. The
 * marks go where Markdown reads them, inward past punctuation or out to the
 * word (`fitMarks`); null when they parse nowhere.
 */
function addStyle(state: EditorState, text: SelectedText, name: string, marker: string): Change[] | null {
  const fitted = fitMarks(state, text.from, text.to);
  if (!fitted) return null;
  const { from, to } = outOf(text.spans.filter((span) => span.name !== name), fitted.from, fitted.to);
  const touching = text.spans.filter((span) => span.name === name && span.to >= from && span.from <= to);
  const left = touching.filter((span) => span.textFrom < from).sort((a, b) => a.from - b.from)[0];
  const right = touching.filter((span) => span.textTo > to).sort((a, b) => b.to - a.to)[0];
  const changes: Change[] = [];
  // Kept marks are written as `marker` too, so "__" never pairs with "**".
  if (!left) changes.push({ from, to: from, insert: marker });
  else if (state.sliceDoc(left.from, left.textFrom) !== marker) changes.push({ from: left.from, to: left.textFrom, insert: marker });
  if (!right) changes.push({ from: to, to, insert: marker });
  else if (state.sliceDoc(right.textTo, right.to) !== marker) changes.push({ from: right.textTo, to: right.to, insert: marker });
  for (const span of touching) {
    if (span !== left) changes.push({ from: span.from, to: span.textFrom, insert: '' });
    if (span !== right) changes.push({ from: span.textTo, to: span.to, insert: '' });
  }
  return changes;
}

/**
 * Takes the formatting `name` off the text, along with the rest of
 * `removing`. A span with text left before or after the selection is split:
 * it closes before the selection and opens again after it, next to the text
 * rather than a space or a mark that goes too.
 */
function removeStyle(state: EditorState, text: SelectedText, name: string, removing: readonly string[] = [name]): Change[] {
  return text.spans.filter((span) => span.name === name && span.textFrom < text.to && span.textTo > text.from).flatMap((span) => {
    // The split never goes inside formatting nested in the span that stays.
    const nested = text.spans.filter((other) => other !== span && other.from >= span.textFrom && other.to <= span.textTo && !removing.includes(other.name));
    const { from, to } = outOf(nested, Math.max(text.from, span.textFrom), Math.min(text.to, span.textTo), true);
    const gone = text.spans.filter((other) => removing.includes(other.name) && other.textFrom >= from && other.textTo <= to);
    const skip = (at: number) => isSpace(state, at) || inMark(gone, at);
    let closeAt = from;
    while (closeAt > span.textFrom && skip(closeAt - 1)) closeAt -= 1;
    let openAt = to;
    while (openAt < span.textTo && skip(openAt)) openAt += 1;
    // Marks go where Markdown reads them: punctuation they would touch is left without the style.
    if (span.name !== 'InlineCode') {
      while (closeAt > span.textFrom && !closesAt(state, closeAt)) closeAt -= 1;
      while (openAt < span.textTo && !opensAt(state, openAt)) openAt += 1;
    }
    const size = span.to - span.from;
    return [
      closeAt > span.textFrom && textBounds(state, text.spans, span.textFrom, closeAt)
        ? { from: closeAt, to: closeAt, insert: state.sliceDoc(span.textTo, span.to), nesting: size }
        : { from: span.from, to: span.textFrom, insert: '' },
      openAt < span.textTo && textBounds(state, text.spans, openAt, span.textTo)
        ? { from: openAt, to: openAt, insert: state.sliceDoc(span.from, span.textFrom), nesting: -size }
        : { from: span.textTo, to: span.to, insert: '' },
    ];
  });
}

export const STYLES: Record<string, string> = { '**': 'StrongEmphasis', '*': 'Emphasis', '~~': 'Strikethrough' };
const STYLE_LABELS: Record<string, string> = { StrongEmphasis: 'Bold', Emphasis: 'Italic', Strikethrough: 'Strikethrough' };

/**
 * In a document, the styles Cmd+B, Cmd+I or ⇧⌘X with nothing selected turned
 * on or off for the next text typed at `at`, as their marks, since a document
 * shows no empty pair of marks. Gone once the caret moves or the text changes.
 */
export interface TypingStyle {
  at: number;
  markers: readonly string[];
}

export const setTypingStyle = StateEffect.define<TypingStyle | null>();

export const typingStyle = StateField.define<TypingStyle | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setTypingStyle)) return effect.value;
    return tr.docChanged || tr.selection ? null : value;
  },
});

/** The word `at` is inside, not at either end of. */
function wordAround(state: EditorState, at: number): SelectionRange | null {
  const word = state.wordAt(at);
  return word && word.from < at && at < word.to ? word : null;
}

/**
 * A document's caret outside a word: the style goes on or off for the text
 * typed next. Off only where the style's text ends, since typed text can
 * leave formatting only past its closing marks.
 */
function toggleTyping(state: EditorState, marker: string): TransactionSpec | null {
  const { head } = state.selection.main;
  const style = state.field(typingStyle, false);
  const markers = style?.at === head ? style.markers : [];
  if (markers.includes(marker)) {
    const rest = markers.filter((other) => other !== marker);
    return { effects: setTypingStyle.of(rest.length > 0 ? { at: head, markers: rest } : null) };
  }
  const name = STYLES[marker];
  if (styledAt(state, head, name) && !closingAt(state, head).some((span) => span.name === name)) return null;
  return { effects: setTypingStyle.of({ at: head, markers: [...markers, marker] }) };
}

/**
 * Bold (`**`), italic (`*`) or strikethrough (`~~`) on the selection, by
 * Google Docs' rule: unless every selected character already has it, all of
 * them get it; otherwise it comes off the selected characters only. `_` and
 * `__` count as the marks they are. With nothing selected the caret gets an
 * empty pair, or loses the empty pair it sits in. A document instead formats
 * the word the caret is in, or the text typed next, as Google Docs does.
 */
export function toggleMarker(marker: string): StateCommand {
  const name = STYLES[marker];
  return ({ state, dispatch }) => {
    if (!treeFor(state, selectionEnd(state))) return true;
    const doc = state.facet(docMode);
    const target = (range: SelectionRange) => (doc && range.empty ? wordAround(state, range.head) ?? range : range);
    if (doc && state.selection.ranges.every((range) => target(range).empty)) {
      const typing = toggleTyping(state, marker);
      if (typing) dispatch(state.update(typing));
      return true;
    }
    const size = marker.length;
    // One star beside exactly one other is half of a bold's "**".
    const isMarker = (from: number, to: number) => state.sliceDoc(from, to) === marker
      && !(size === 1 && (state.sliceDoc(from - 1, from) === '*') !== (state.sliceDoc(to, to + 1) === '*'));
    const texts = state.selection.ranges.flatMap((range) => selectedText(state, target(range)));
    const unstyle = texts.length > 0 && texts.every((text) => allStyled(state, text, name));
    let refused = false;
    const tr = state.update(state.changeByRange((range) => {
      const span = target(range);
      if (span.empty) {
        if (doc) return { range };
        return isMarker(range.from - size, range.from) && isMarker(range.from, range.from + size)
          ? { changes: { from: range.from - size, to: range.from + size }, range: EditorSelection.cursor(range.from - size) }
          : { changes: { from: range.from, insert: marker + marker }, range: EditorSelection.cursor(range.from + size) };
      }
      const parts = selectedText(state, span);
      if (parts.length === 0) return { range };
      const written = parts.map((text) => (unstyle ? removeStyle(state, text, name) : addStyle(state, text, name, marker)));
      if (written.some((part) => part === null)) refused = true;
      const changes = ChangeSet.of(ordered(written.flatMap((part) => part ?? [])), state.doc.length);
      // The caret stays in its word.
      if (span !== range) return { changes, range: EditorSelection.cursor(changes.mapPos(range.head)) };
      const from = changes.mapPos(parts[0].from, 1);
      const to = changes.mapPos(parts[parts.length - 1].to, -1);
      return { changes, range: range.anchor > range.head ? EditorSelection.range(to, from) : EditorSelection.range(from, to) };
    }), { scrollIntoView: true, userEvent: 'input' });
    // A document never shows a mark: formatting that would leave one is refused.
    if (refused || (doc && !keepsVisibleText(tr))) toast(`${STYLE_LABELS[name]} can't start or end next to that punctuation.`);
    else dispatch(tr);
    return true;
  };
}

const CLEARED = ['StrongEmphasis', 'Emphasis', 'Strikethrough', 'InlineCode'];
// Characters that would read as Markdown once code around them is gone.
const MARKDOWN_IN_CODE = /[*_~`[\]<\\]/;

/**
 * Takes bold, italic, strikethrough and code off the selection: only marks
 * the syntax tree reads as formatting. In a document, code whose text would
 * turn into Markdown stays code, and a change that would show a mark is refused.
 */
export const clearFormatting: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  if (!treeFor(state, selectionEnd(state))) return true;
  const changes = state.selection.ranges.flatMap((range) => selectedText(state, range))
    .map((text) => ({ ...text, spans: text.spans.filter((span) => span.name !== 'InlineCode' || !state.facet(docMode) || !MARKDOWN_IN_CODE.test(state.sliceDoc(span.textFrom, span.textTo))) }))
    .flatMap((text) => CLEARED.flatMap((name) => removeStyle(state, text, name, CLEARED)));
  if (changes.length === 0) return true;
  const tr = state.update({ changes: ordered(changes), scrollIntoView: true, userEvent: 'input' });
  if (state.facet(docMode) && !keepsVisibleText(tr)) toast('Clear formatting would leave marks showing here, so nothing changed.');
  else dispatch(tr);
  return true;
};

const skipSpaces = (state: EditorState, from: number, to: number) => {
  let at = from;
  while (at < to && /[ \t]/.test(state.sliceDoc(at, at + 1))) at += 1;
  return at;
};

/** The heading a line starts, "#" marks or a setext underline: its level and node, or null for any other line. */
export function headingOf(state: EditorState, line: Line): { level: number; node: SyntaxNode } | null {
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(textStart(state, line, BLOCK_MARKS), 1); node; node = node.parent) {
    const level = /^(?:ATX|Setext)Heading(\d)$/.exec(node.name)?.[1];
    if (level) return node.from >= line.from && node.from <= line.to ? { level: Number(level), node } : null;
  }
  return null;
}

/** Whether a line is a setext heading's second or later text line, which its first line speaks for. */
function setextLater(state: EditorState, line: Line): boolean {
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(line.to, -1); node; node = node.parent) {
    if (node.name === 'SetextHeading1' || node.name === 'SetextHeading2') return node.from < line.from;
  }
  return false;
}

/**
 * A setext heading ("Title" over "===") at another level: written in "#"
 * form, its lines joined and the underline gone, or as normal text with a
 * blank line where the underline was when text follows it.
 */
export function rewriteSetext(state: EditorState, line: Line, node: SyntaxNode, level: number): ChangeSpec[] {
  const mark = node.getChild('HeaderMark');
  if (!mark) return [];
  const underline = state.doc.lineAt(mark.from);
  const lastText = state.doc.line(underline.number - 1);
  const next = underline.number < state.doc.lines ? state.doc.line(underline.number + 1) : null;
  const changes: ChangeSpec[] = [];
  if (level > 0) changes.push({ from: textStart(state, line, BLOCK_MARKS), insert: `${'#'.repeat(level)} ` });
  for (let number = line.number + 1; number < underline.number; number += 1) {
    const later = state.doc.line(number);
    changes.push({ from: state.doc.line(number - 1).to, to: textStart(state, later, BLOCK_MARKS), insert: ' ' });
  }
  if (level === 0 && next && /[^\s>]/.test(next.text)) changes.push({ from: underline.from, to: underline.to, insert: blankFor(underline) });
  else changes.push({ from: lastText.to, to: underline.to });
  return changes;
}

/** Whether a block ending on `above` would take `line`, as plain text, in as one of its own lines. */
function takesLine(state: EditorState, above: Line, line: Line): boolean {
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(above.to, -1); node; node = node.parent) {
    if (['ListItem', 'Table', 'HTMLBlock', 'FencedCode'].includes(node.name)) return true;
    if (node.name === 'Blockquote') return quoteOf(above).length > quoteOf(line).length;
  }
  return false;
}

/** Whether `next` would join the plain text line above it: an underline, a table's first row, or a list from 2. */
function joinsBelow(state: EditorState, next: Line): boolean {
  if (/^[\s>]*(?:=+|-+)[ \t]*$/.test(next.text) || /^[\s>]*(?:[2-9]|\d{2,})[.)][ \t]/.test(next.text)) return true;
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(next.from + quoteOf(next).length, 1); node; node = node.parent) {
    if (node.name === 'Table') return state.doc.lineAt(node.from).number === next.number;
  }
  return false;
}

// Formatting that may run over a line break inside a paragraph.
const SPLIT = new Set(['StrongEmphasis', 'Emphasis', 'Strikethrough']);

/** Whether `line` carries on a paragraph that starts on an earlier line. */
function continuesParagraph(state: EditorState, line: Line): boolean {
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(textStart(state, line, QUOTE_MARK), 1); node; node = node.parent) {
    if (node.name === 'Paragraph') return state.doc.lineAt(node.from).number < line.number;
    if (node.name === 'ListItem' || node.name === 'Blockquote' || node.name === 'Document') return false;
  }
  return false;
}

/**
 * The marks that keep inline formatting whole when `line` leaves its
 * paragraph as a heading or a list item: a span that runs onto the line
 * from the line above closes at that line's end and opens again at `at`,
 * where the line's text will start; with `below`, a span that runs on past
 * the line closes at its end and opens again on the next line.
 */
function splitSpans(state: EditorState, line: Line, at: number, below: boolean): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  const end = (other: Line) => other.from + other.text.trimEnd().length;
  for (const span of inlineSpans(state, line.from, line.to)) {
    if (!SPLIT.has(span.name)) continue;
    const open = state.sliceDoc(span.from, span.textFrom);
    const close = state.sliceDoc(span.textTo, span.to);
    if (span.from < line.from && span.to > line.from && line.number > 1) changes.push({ from: end(state.doc.line(line.number - 1)), insert: close }, { from: at, insert: open });
    if (below && span.from < line.to && span.to > line.to && line.number < state.doc.lines) {
      const next = state.doc.line(line.number + 1);
      changes.push({ from: end(line), insert: close }, { from: textStart(state, next, QUOTE_MARK), insert: open });
    }
  }
  return changes;
}

/**
 * The indent a paragraph's later line gets when it becomes a heading or a
 * list item, or none outside a list: a heading stays in the item it is in,
 * at the item's content column, and an item becomes that item's sibling. A
 * deep indent, which a paragraph's line never shows, would keep the marks
 * from reading as a heading or a list.
 */
function leadOf(state: EditorState, line: Line, sibling: boolean): { from: number; to: number; insert: string } | null {
  if (!continuesParagraph(state, line)) return null;
  const from = line.from + quoteOf(line).length;
  const to = skipSpaces(state, from, line.to);
  let indent = '';
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(to, 1); node; node = node.parent) {
    if (node.name !== 'ListItem') continue;
    const first = state.doc.lineAt(node.from);
    const item = listItemOf(state, first);
    if (item) indent = sibling ? first.text.slice(quoteOf(first).length, item.markFrom - first.from) : first.text.slice(quoteOf(first).length, item.contentFrom - first.from).replace(/[^\t]/g, ' ');
    break;
  }
  return state.sliceDoc(from, to) === indent ? null : { from, to, insert: indent };
}

/**
 * Normal text (0) or a heading level on each selected line: adds, changes or
 * removes the "#" marks. Normal also removes a closing "##". A blank line
 * becomes a heading only when it is the one line selected, ready to type in.
 */
export function setHeading(level: number): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    if (!treeFor(state, selectionEnd(state))) return true;
    // A callout's title line and a task take no heading: the box holds one line of text.
    const lines = selectedLines(state).filter((line) => !calloutMarker(state, line) && !setextLater(state, line) && listItemOf(state, line)?.kind !== 'task');
    const changes = lines.flatMap((line): ChangeSpec[] => {
      const heading = headingOf(state, line);
      if (heading?.node.name.startsWith('Setext')) return heading.level === level ? [] : rewriteSetext(state, line, heading.node, level);
      if (!heading) {
        const blank = !/[^\s>]/.test(line.text);
        if (level === 0 || (blank && lines.length > 1)) return [];
        const at = textStart(state, line, BLOCK_MARKS);
        const lead = leadOf(state, line, false);
        const selected = (other: number) => lines.some((each) => each.number === other);
        return [...(lead ? [lead] : []), { from: at, insert: `${'#'.repeat(level)} ` }, ...splitSpans(state, line, at, !selected(line.number + 1))];
      }
      const [open, close] = heading.node.getChildren('HeaderMark');
      if (level > 0) return heading.level === level ? [] : [{ from: open.from, to: open.to, insert: '#'.repeat(level) }];
      const textFrom = skipSpaces(state, open.to, line.to);
      // "## 5. Notes" as normal text stays text: the number's dot or a leading "-" is escaped, so no list starts.
      const listy = /^(?:\d{1,9}(?=[.)][ \t]|[.)]$)|[-+*](?=[ \t]|$))/.exec(state.sliceDoc(textFrom, line.to));
      const marks: ChangeSpec[] = [{ from: open.from, to: textFrom }];
      if (listy) marks.push({ from: textFrom + listy[0].length - (/\d/.test(listy[0]) ? 0 : 1), insert: '\\' });
      if (close) marks.push({ from: line.from + state.sliceDoc(line.from, close.from).trimEnd().length, to: close.to });
      // Normal text sits on its own line, as Enter leaves it, unless that joins it to a block:
      // a list item, quote, table or HTML above takes it in, and a "---" or "===" below
      // underlines it, a table below loses its header and a list from 2 below joins it.
      const previous = line.number > 1 ? state.doc.line(line.number - 1) : null;
      const next = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null;
      const converted = (other: Line) => lines.some((each) => each.number === other.number) && headingOf(state, other) !== null;
      if (previous && /[^\s>]/.test(previous.text) && !converted(previous) && takesLine(state, previous, line)) marks.unshift({ from: line.from, insert: `${blankFor(line)}\n` });
      if (next && /[^\s>]/.test(next.text) && joinsBelow(state, next)) marks.push({ from: line.to, insert: `\n${blankFor(line)}` });
      return marks;
    });
    dispatch(state.update({ changes, scrollIntoView: true, userEvent: 'input' }));
    return true;
  };
}

export type ListKind = 'bullet' | 'number' | 'task';

/** The list item a line starts: its kind, where its marker and text start, and its number. */
interface ListLine {
  kind: ListKind;
  markFrom: number;
  /** Where the item's content column starts on its first line. */
  contentFrom: number;
  textFrom: number;
  number: number;
}

export function listItemOf(state: EditorState, line: Line): ListLine | null {
  const mark = latestTree(state).resolveInner(textStart(state, line, QUOTE_MARK), 1);
  const item = mark.parent;
  if (mark.name !== 'ListMark' || mark.to > line.to || item?.name !== 'ListItem') return null;
  const box = item.getChild('Task')?.getChild('TaskMarker');
  const task = box && box.from <= line.to ? box : null;
  // The content column: past the marker and the spaces after it, or one space when more than four follow.
  const after = /^ */.exec(state.sliceDoc(mark.to, line.to))?.[0].length ?? 0;
  const spaces = after > 4 ? 1 : after;
  return {
    kind: task ? 'task' : item.parent?.name === 'OrderedList' ? 'number' : 'bullet',
    markFrom: mark.from,
    contentFrom: mark.to + spaces,
    textFrom: skipSpaces(state, task ? task.to : mark.to, line.to),
    number: Number.parseInt(state.sliceDoc(mark.from, mark.to), 10) || 1,
  };
}

/** Whether the list item that `line` starts goes on past that line with more text, which reads from its content column. */
function carriesOn(state: EditorState, line: Line): boolean {
  if (line.number >= state.doc.lines) return false;
  const next = state.doc.line(line.number + 1);
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(textStart(state, line, QUOTE_MARK), 1); node; node = node.parent) {
    if (node.name !== 'ListItem') continue;
    const end = node.to > node.from && state.doc.lineAt(node.to).from === node.to ? node.to - 1 : node.to;
    return end >= next.from;
  }
  return false;
}

/** Whether a line belongs to a list item: its first line, or one the item carries on to. */
function inListItem(state: EditorState, line: Line): boolean {
  if (!/[^\s>]/.test(line.text)) return false;
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(line.to, -1); node; node = node.parent) {
    if (node.name === 'ListItem') return true;
  }
  return false;
}

/** The quote marks that open a line, with the space after each. */
const quoteOf = (line: Line) => /^(?:[ \t]*>[ \t]?)*/.exec(line.text)?.[0] ?? '';
/** The blank line to write next to `line`: its quote's ">" marks, if any. */
const blankFor = (line: Line) => quoteOf(line).replace(/[ \t]+$/, '');

/**
 * A bulleted, numbered or check list on the selected lines, or plain text
 * again when every one already is that list. Numbers carry on from a
 * numbered item above. Text right below a list item would belong to it, so a
 * blank line keeps the paragraph next to a list a paragraph.
 */
export function toggleList(kind: ListKind): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    if (!treeFor(state, selectionEnd(state))) return true;
    // A callout's title line never becomes a list item.
    const touched = selectedLines(state).filter((line) => !calloutMarker(state, line));
    const lines = touched.length === 1 ? touched : touched.filter((line) => /[^\s>]/.test(line.text));
    if (lines.length === 0) return false;
    const items = lines.map((line) => listItemOf(state, line));
    const first = lines[0];
    const last = lines[lines.length - 1];
    const above = first.number > 1 ? state.doc.line(first.number - 1) : null;
    const below = last.number < state.doc.lines ? state.doc.line(last.number + 1) : null;
    const changes: ChangeSpec[] = [];
    if (items.every((item) => item?.kind === kind)) {
      lines.forEach((line, index) => changes.push({ from: line.from + quoteOf(line).length, to: (items[index] as ListLine).textFrom }));
      if (above && inListItem(state, above)) changes.push({ from: above.to, insert: `\n${blankFor(first)}` });
      if (below && listItemOf(state, below)) changes.push({ from: last.to, insert: `\n${blankFor(last)}` });
    } else {
      let number = 1;
      lines.forEach((line, index) => {
        const item = items[index];
        // Numbers carry on from the item above and over blank lines, and start again at 1 after other text, so a list never starts at 2.
        const gap = index > 0 ? state.doc.sliceString(lines[index - 1].to, line.from) : null;
        if (gap === null || /[^\s>]/.test(gap)) {
          const previous = line.number > 1 ? listItemOf(state, state.doc.line(line.number - 1)) : null;
          number = previous?.kind === 'number' ? previous.number + 1 : 1;
        }
        let mark = kind === 'bullet' ? '- ' : kind === 'task' ? '- [ ] ' : `${number++}. `;
        if (item) {
          // An item whose later lines hold text keeps its content column, so a formula or code in it reads the same.
          const column = item.contentFrom - item.markFrom;
          const width = mark.indexOf(' ') + 1;
          if (width < column && carriesOn(state, line)) mark = `${mark.slice(0, width - 1)}${' '.repeat(column - width + 1)}${mark.slice(width)}`;
          changes.push({ from: item.markFrom, to: item.textFrom, insert: mark });
          return;
        }
        // A task's box holds one line of text, so a heading becomes the task's text.
        const heading = kind === 'task' ? headingOf(state, line) : null;
        const open = heading?.node.name.startsWith('ATX') ? heading.node.getChild('HeaderMark') : null;
        const from = textStart(state, line, QUOTE_MARK);
        const lead = leadOf(state, line, true);
        if (lead) changes.push(lead);
        // Text that starts like a list marker stays text inside the new item.
        const literal = !open && /^(?:[-+*]|\d{1,9}[.)])(?=[ \t]|$)/.exec(state.sliceDoc(from, line.to));
        const escape = literal ? [{ from: from + literal[0].length - 1, insert: '\\' }] : [];
        changes.push(open && open.from === from ? { from, to: skipSpaces(state, open.to, line.to), insert: mark } : { from, insert: mark }, ...escape);
        const selected = (other: number) => lines.some((each) => each.number === other);
        changes.push(...splitSpans(state, line, from, !selected(line.number + 1)));
      });
      if (!items[items.length - 1] && below && /[^\s>]/.test(below.text) && !listItemOf(state, below)) {
        changes.push({ from: last.to, insert: `\n${blankFor(last)}` });
      }
    }
    const changeSet = state.changes(changes);
    // A caret where a marker went in goes after it, ready to type.
    const { head } = state.selection.main;
    const marked = state.selection.main.empty ? changes.find((change) => (change as { from: number }).from === head && (change as { insert?: string }).insert?.trim()) as { insert: string } | undefined : undefined;
    const selection = marked ? { anchor: changeSet.mapPos(head, -1) + marked.insert.length } : undefined;
    dispatch(state.update({ changes: changeSet, selection, scrollIntoView: true, userEvent: 'input' }));
    return true;
  };
}

// A quote's ">" marks, and the space after each, at the start of a line.
const QUOTE_MARKS = /^ {0,3}(?:> ?)+/;

/**
 * Tab and Shift+Tab when every selected line is in a quote: the indent goes
 * after the ">" marks, so a list in a callout nests. Returns false otherwise,
 * and for Shift+Tab when no line has an indent there, so lines indent as usual.
 */
export function indentInQuote(more: boolean): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    // Every touched line, code and HTML included: a note's Tab indents them after the quote marks.
    const quoted = touchedLines(state).map((line) => ({ line, quote: QUOTE_MARKS.exec(line.text)?.[0] ?? '' }));
    if (quoted.some(({ quote }) => !quote)) return false;
    const unit = state.facet(indentUnit);
    const changes = quoted.flatMap(({ line, quote }): ChangeSpec[] => {
      const from = line.from + quote.length;
      if (more) return [{ from, insert: unit }];
      const indent = /^(?:\t| {1,4})/.exec(line.text.slice(quote.length))?.[0] ?? '';
      return indent ? [{ from, to: from + Math.min(indent.length, unit.length) }] : [];
    });
    if (changes.length === 0) return false;
    dispatch(state.update({ changes, scrollIntoView: true, userEvent: more ? 'input.indent' : 'delete.dedent' }));
    return true;
  };
}

/** The toolbar's indent and outdent: one list level, as Tab and Shift+Tab move a list item. Nothing outside lists. */
export function indentList(more: boolean): StateCommand {
  return (target) => {
    const { state } = target;
    if (!treeFor(state, selectionEnd(state))) return true;
    return nestListItems(more)(target);
  };
}

/** A link and where its text sits: a Markdown link, a wiki link or a bare web address. */
export interface LinkAt {
  kind: 'link' | 'wiki' | 'url';
  from: number;
  to: number;
  textFrom: number;
  textTo: number;
  /** The URL, or a wiki link's target with its "#heading". */
  target: string;
}

function linkOf(state: EditorState, node: SyntaxNode): LinkAt | null {
  const { from, to } = node;
  if (node.name === 'Link') {
    const span = inlineSpan(state, node);
    return span && { kind: 'link', from, to, textFrom: span.textFrom, textTo: span.textTo, target: linkTarget(state, node) ?? '' };
  }
  if (node.name === 'WikiLink') {
    const span = inlineSpan(state, node);
    const [open, close] = node.getChildren('WikiLinkMark');
    const { aliasAt } = parseWikiTarget(state.sliceDoc(open.to, close.from));
    return span && { kind: 'wiki', from, to, textFrom: span.textFrom, textTo: span.textTo, target: state.sliceDoc(open.to, aliasAt === null ? close.from : open.to + aliasAt - 1) };
  }
  if (node.name === 'Autolink') {
    const span = inlineSpan(state, node);
    return span && { kind: 'url', from, to, textFrom: span.textFrom, textTo: span.textTo, target: state.sliceDoc(span.textFrom, span.textTo) };
  }
  if (node.name === 'URL' && !['Link', 'Image', 'Autolink', 'LinkReference'].includes(node.parent?.name ?? '')) {
    return { kind: 'url', from, to, textFrom: from, textTo: to, target: state.sliceDoc(from, to) };
  }
  return null;
}

/** The link that runs from `from` to `to`, if one does. */
export function linkBetween(state: EditorState, from: number, to: number): LinkAt | null {
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(from, 1); node && node.from === from && node.to <= to; node = node.parent) {
    const link = node.to === to ? linkOf(state, node) : null;
    if (link) return link;
  }
  return null;
}

/** The link whose text holds `at`, at either end included. */
export function linkAt(state: EditorState, at: number): LinkAt | null {
  for (const side of [1, -1] as const) {
    for (let node: SyntaxNode | null = latestTree(state).resolveInner(at, side); node; node = node.parent) {
      const link = linkOf(state, node);
      if (link && link.textFrom <= at && at <= link.textTo) return link;
    }
  }
  return null;
}

const linkText = (text: string) => text.replace(/[[\]]/g, '\\$&');
const destination = (url: string) => (/[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, encodeURIComponent)}>` : url);

/** Text typed into the link form, written so it shows as typed: stars, underscores and backticks escaped. */
export const typedLinkText = (text: string) => text.replace(/[\\*_`]/g, (character) => (character === '\\' ? '\\\\' : `\\${character}`));

/**
 * `from` to `to` without the marks it only touches: a range that starts at
 * or inside a span's closing marks starts after them, and one that ends at
 * or inside its opening marks ends before them. The caret after a bold word
 * rests before its hidden closing marks, so a selection from there holds
 * them. Unchanged when nothing would be left.
 */
export function withoutEdgeMarks(state: EditorState, from: number, to: number): { from: number; to: number } {
  let start = from;
  let end = to;
  for (const span of inlineSpans(state, from, to)) {
    if (span.textTo <= start && start < span.to && span.textTo > span.textFrom) start = span.to;
    if (span.from < end && end <= span.textFrom && span.textTo > span.textFrom) end = span.from;
  }
  return start < end ? { from: start, to: end } : { from, to };
}

// Links whose marks a new link over them takes out: a link can't hold another.
const LINKS = new Set(['Link', 'WikiLink']);
// Text whose brackets stay as written inside link text: code, autolinks, HTML, images and embeds bind tighter than its brackets.
const RAW_IN_LINK = new Set(['InlineCode', 'Autolink', 'HTMLTag', 'Comment', 'Image', 'Embed']);

/**
 * A new link over `from` to `to` that keeps the formatting it half covers
 * balanced: a span that starts before the link closes before it and opens
 * again inside, and one that runs on past the link closes inside it and
 * opens again after. `**bold** t` with "old t" linked is
 * `**b**[**old** t](url)`. Formatting the link holds whole moves inside it
 * with its marks. A link it covers keeps only its text, and one it half
 * covers keeps its address on the part outside: `[li](a)[nk mo](b)re`. A
 * wiki link is one piece, so a selection that reaches into one takes it all.
 */
function linkOver(state: EditorState, from: number, to: number, url: string): Change {
  for (const span of inlineSpans(state, from, to)) {
    if (span.name === 'WikiLink' && span.from < to && span.to > from) {
      from = Math.min(from, span.from);
      to = Math.max(to, span.to);
    }
  }
  ({ from, to } = withoutEdgeMarks(state, from, to));
  for (const span of inlineSpans(state, from, to)) {
    if ((EMPHASIS.has(span.name) || span.name === 'InlineCode') && span.textFrom >= from && span.textTo <= to) {
      from = Math.min(from, span.from);
      to = Math.max(to, span.to);
    }
  }
  let before = '';
  let open = '';
  let close = '';
  let after = '';
  const dropped: { from: number; to: number }[] = [];
  for (const span of inlineSpans(state, from, to)) {
    const opens = state.sliceDoc(span.from, span.textFrom);
    const closes = state.sliceDoc(span.textTo, span.to);
    const startsBefore = span.from < from && from < span.textTo;
    const endsAfter = span.to > to && to > span.textFrom;
    if (LINKS.has(span.name)) {
      if (startsBefore) before = closes + before;
      else if (span.from >= from) dropped.push({ from: span.from, to: span.textFrom });
      if (endsAfter) after += opens;
      else if (span.to <= to) dropped.push({ from: span.textTo, to: span.to });
      continue;
    }
    if (!EMPHASIS.has(span.name) && span.name !== 'InlineCode') continue;
    if (startsBefore && endsAfter) continue;
    if (startsBefore) { before = closes + before; open += opens; }
    if (endsAfter) { close = closes + close; after += opens; }
  }
  const raw: { from: number; to: number }[] = [];
  latestTree(state).iterate({ from, to, enter: (ref) => { if (RAW_IN_LINK.has(ref.name)) { raw.push({ from: ref.from, to: ref.to }); return false; } return undefined; } });
  const source = state.sliceDoc(from, to);
  let text = '';
  for (let index = 0; index < source.length; index += 1) {
    const at = from + index;
    if (dropped.some((range) => range.from <= at && at < range.to)) continue;
    const character = source[index];
    // Brackets in Markdown that is already written, escaped unless they are already.
    if ((character === '[' || character === ']') && state.sliceDoc(at - 1, at) !== '\\' && !raw.some((range) => range.from <= at && at < range.to)) text += '\\';
    text += character;
  }
  return { from, to, insert: `${before}[${open}${text}${close}](${destination(url)})${after}` };
}

/**
 * Writes a link to `url` with `text`: over `range` for a new one, or in place
 * of `link`. A Markdown link whose text is unchanged keeps its text as
 * written, formatting and all, and only its URL changes. A link with neither
 * changed is left as written.
 */
export function writeLink(state: EditorState, range: { from: number; to: number }, text: string, url: string, link: LinkAt | null): TransactionSpec {
  if (link && url === link.target && text === state.sliceDoc(link.textFrom, link.textTo)) return { selection: { anchor: link.to }, scrollIntoView: true };
  const shown = text || url;
  let change: Change;
  if (link?.kind === 'wiki') {
    change = { from: link.from, to: link.to, insert: `[[${url}${shown === url ? '' : `|${shown}`}]]` };
  } else if (link?.kind === 'link' && text === state.sliceDoc(link.textFrom, link.textTo)) {
    const written = latestTree(state).resolveInner(link.from, 1);
    const node = written.name === 'Link' ? written : written.parent;
    const at = node?.getChild('URL');
    change = at ? { from: at.from, to: at.to, insert: destination(url) } : { from: link.textTo, to: link.to, insert: `](${destination(url)})` };
  } else if (!link && text && text === state.sliceDoc(range.from, range.to)) {
    change = linkOver(state, range.from, range.to, url);
  } else {
    const { from, to } = link ?? range;
    change = { from, to, insert: `[${linkText(shown)}](${destination(url)})` };
  }
  const end = change.from + change.insert.length + (link && change.to < link.to ? link.to - change.to : 0);
  return { changes: change, selection: { anchor: end }, scrollIntoView: true, userEvent: 'input' };
}

/** Takes a link off its text. A bare address has nothing else to keep, so it stays. */
export function removeLink(state: EditorState, link: LinkAt): TransactionSpec | null {
  if (link.kind === 'url') return null;
  const text = state.sliceDoc(link.textFrom, link.textTo);
  return { changes: { from: link.from, to: link.to, insert: text }, selection: { anchor: link.from + text.length }, userEvent: 'input' };
}

/** The inline code that holds `from` to `to`, its marks included. */
export function inlineCodeAt(state: EditorState, from: number, to = from): InlineSpan | null {
  return inlineSpans(state, from, to).find((span) => span.name === 'InlineCode' && span.from <= from && to <= span.to) ?? null;
}

/** Inline code's text as it shows: one space of padding on both sides comes off, as CommonMark reads it. */
export function codeContent(raw: string): string {
  return raw.length >= 2 && raw.startsWith(' ') && raw.endsWith(' ') && raw.trim() !== '' ? raw.slice(1, -1) : raw;
}

/**
 * `text` as inline code: fenced by one backtick more than its longest run of
 * backticks, with a space inside when it starts or ends with a backtick or
 * has a space at both ends, so it reads back as written.
 */
export function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') || (text.startsWith(' ') && text.endsWith(' ') && text.trim() !== '') ? ' ' : '';
  return `${ticks}${pad}${text}${pad}${ticks}`;
}

/** Text that came out of code, escaped where it would otherwise read as Markdown, such as two backticks that would pair. */
export function literalText(text: string): string {
  return text.replace(/[\\`*_[\]<]/g, '\\$&').replace(/~~/g, '\\~\\~');
}

// What a line can open with, past its quote marks and list markers.
const LINE_CONTAINER = /^(?:[ \t]*>[ \t]?)*[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)*$/;

/** The text of inline code `span` once its marks come off, escaped so it reads as it showed, including a heading, list or quote mark at its line's start. */
function uncodedText(state: EditorState, span: InlineSpan): string {
  const text = literalText(codeContent(state.sliceDoc(span.textFrom, span.textTo)));
  const line = state.doc.lineAt(span.from);
  if (!LINE_CONTAINER.test(state.sliceDoc(line.from, span.from))) return text;
  return text
    .replace(/^(#{1,6}(?=[ \t]|$)|[-+](?=[ \t]|$)|>|-{3,}[ \t]*$|=+[ \t]*$)/, '\\$1')
    .replace(/^(\d{1,9})([.)])(?=[ \t]|$)/, '$1\\$2');
}

// Links and embeds keep their targets when the text around them becomes code.
const KEPT_IN_CODE = new Set(['Link', 'WikiLink', 'Embed', 'Autolink']);

/** The text of `from` to `to` as the page shows it: without the marks of the formatting inside `within`, which holds it. */
function shownText(state: EditorState, from: number, to: number, within: { from: number; to: number } = { from, to }): string {
  const marks = inlineSpans(state, within.from, within.to)
    .filter((span) => span.from >= within.from && span.to <= within.to && !KEPT_IN_CODE.has(span.name))
    .flatMap((span) => [[span.from, span.textFrom], [span.textTo, span.to]])
    .map(([markFrom, markTo]) => [Math.max(markFrom, from), Math.min(markTo, to)])
    .filter(([markFrom, markTo]) => markTo > markFrom)
    .sort((a, b) => a[0] - b[0]);
  let text = '';
  let at = from;
  for (const [markFrom, markTo] of marks) {
    if (markFrom > at) text += state.sliceDoc(at, markFrom);
    at = Math.max(at, markTo);
  }
  return text + state.sliceDoc(at, to);
}

/**
 * `from` to `to` as inline code. Links and embeds in it stay as they are,
 * with code on either side: a link's text becomes code inside the link,
 * as in [`docs`](url), so no address is lost.
 */
function codedText(state: EditorState, from: number, to: number): string {
  const within = { from, to };
  const code = (a: number, b: number) => {
    const text = shownText(state, a, b, within);
    return text.trim() ? codeSpan(text) : text;
  };
  const kept = inlineSpans(state, from, to).filter((span) => KEPT_IN_CODE.has(span.name) && span.from >= from && span.to <= to).sort((a, b) => a.from - b.from);
  let out = '';
  let at = from;
  for (const span of kept) {
    if (span.from < at) continue;
    out += code(at, span.from);
    out += span.name === 'Link' ? state.sliceDoc(span.from, span.textFrom) + code(span.textFrom, span.textTo) + state.sliceDoc(span.textTo, span.to) : state.sliceDoc(span.from, span.to);
    at = span.to;
  }
  return out + code(at, to);
}

/**
 * The Code button and Cmd+E: the selection becomes inline code, keeping what
 * the page shows, or stops being code when it is in inline code. With
 * nothing selected in a document, the word the caret is in.
 */
export const toggleInlineCode: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  if (!treeFor(state, selectionEnd(state))) return true;
  const range = state.selection.main;
  const inside = inlineCodeAt(state, range.from, range.to);
  if (inside) {
    const insert = uncodedText(state, inside);
    dispatch(state.update({ changes: { from: inside.from, to: inside.to, insert }, selection: { anchor: inside.from + insert.length }, scrollIntoView: true, userEvent: 'input' }));
    return true;
  }
  const target = range.empty ? (state.facet(docMode) ? wordAround(state, range.head) : null) : range;
  if (!target) return true;
  const parts = selectedText(state, target);
  if (parts.length === 0) return true;
  const changes = ChangeSet.of(parts.map((part) => ({ from: part.from, to: part.to, insert: codedText(state, part.from, part.to) })), state.doc.length);
  const selection = range.empty
    ? EditorSelection.cursor(changes.mapPos(range.head))
    : EditorSelection.range(changes.mapPos(parts[0].from, 1), changes.mapPos(parts[parts.length - 1].to, -1));
  dispatch(state.update({ changes, selection, scrollIntoView: true, userEvent: 'input' }));
  return true;
};

/**
 * Clear formatting, taking inline code off as well, with its text written
 * so it reads as it showed: padding gone, and backticks and marks that
 * would now pair escaped.
 */
export const clearFormattingAndCode: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  if (!treeFor(state, selectionEnd(state))) return true;
  const spans = state.selection.ranges.flatMap((range) => selectedText(state, range))
    .flatMap((text) => text.spans.filter((span) => span.name === 'InlineCode' && span.from >= text.from && span.to <= text.to));
  if (spans.length === 0) return clearFormatting({ state, dispatch });
  const unwrapped = state.update({
    changes: spans.map((span) => ({ from: span.from, to: span.to, insert: uncodedText(state, span) })),
    filter: false,
  });
  let cleared: ChangeSet | null = null;
  clearFormatting({ state: unwrapped.state, dispatch: (tr) => { cleared = tr.changes; } });
  const changes = cleared ? unwrapped.changes.compose(cleared) : unwrapped.changes;
  dispatch(state.update({ changes, selection: state.selection.map(changes), scrollIntoView: true, userEvent: 'input' }));
  return true;
};
