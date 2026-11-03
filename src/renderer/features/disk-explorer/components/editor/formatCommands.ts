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
    const last = state.doc.lineAt(range.to);
    const end = !range.empty && range.to === last.from && last.from > range.from ? last.number - 1 : last.number;
    for (let number = state.doc.lineAt(range.from).number; number <= end; number += 1) lines.set(number, state.doc.line(number));
  }
  return [...lines.values()].sort((a, b) => a.number - b.number);
}

/** The lines the selection touches, less those a protected range covers whole, such as a table's. */
export function selectedLines(state: EditorState): Line[] {
  return touchedLines(state).filter((line) => !protectedIn(state, line.from, line.to).some((range) => range.from <= line.from && range.to >= line.to));
}

/**
 * `text` kept out of protected ranges: its ends move out of one inside its
 * line, so formatting goes around a formula, and it is cut short of one
 * that spans lines or covers its lines whole, such as a table or a rule.
 * Null when nothing is left.
 */
function unprotected(state: EditorState, text: { from: number; to: number }): { from: number; to: number } | null {
  let { from, to } = text;
  for (const range of protectedIn(state, from, to)) {
    const first = state.doc.lineAt(range.from);
    const last = state.doc.lineAt(range.to);
    if (first.number === last.number && !(range.from === first.from && range.to === last.to)) {
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
 * the syntax tree reads as formatting. Code whose text would turn into
 * Markdown stays code, and a document refuses a change that would show a mark.
 */
export const clearFormatting: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  if (!treeFor(state, selectionEnd(state))) return true;
  const changes = state.selection.ranges.flatMap((range) => selectedText(state, range))
    .map((text) => ({ ...text, spans: text.spans.filter((span) => span.name !== 'InlineCode' || !MARKDOWN_IN_CODE.test(state.sliceDoc(span.textFrom, span.textTo))) }))
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

/**
 * Normal text (0) or a heading level on each selected line: adds, changes or
 * removes the "#" marks. Normal also removes a closing "##". A blank line
 * becomes a heading only when it is the one line selected, ready to type in.
 */
export function setHeading(level: number): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    if (!treeFor(state, selectionEnd(state))) return true;
    // A callout's title line takes no heading.
    const lines = selectedLines(state).filter((line) => !calloutMarker(state, line) && !setextLater(state, line));
    const changes = lines.flatMap((line): ChangeSpec[] => {
      const heading = headingOf(state, line);
      if (heading?.node.name.startsWith('Setext')) return heading.level === level ? [] : rewriteSetext(state, line, heading.node, level);
      if (!heading) {
        const blank = !/[^\s>]/.test(line.text);
        return level > 0 && (!blank || lines.length === 1) ? [{ from: textStart(state, line, BLOCK_MARKS), insert: `${'#'.repeat(level)} ` }] : [];
      }
      const [open, close] = heading.node.getChildren('HeaderMark');
      if (level > 0) return heading.level === level ? [] : [{ from: open.from, to: open.to, insert: '#'.repeat(level) }];
      const marks: ChangeSpec[] = [{ from: open.from, to: skipSpaces(state, open.to, line.to) }];
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
  textFrom: number;
  number: number;
}

export function listItemOf(state: EditorState, line: Line): ListLine | null {
  const mark = latestTree(state).resolveInner(textStart(state, line, QUOTE_MARK), 1);
  const item = mark.parent;
  if (mark.name !== 'ListMark' || mark.to > line.to || item?.name !== 'ListItem') return null;
  const box = item.getChild('Task')?.getChild('TaskMarker');
  const task = box && box.from <= line.to ? box : null;
  return {
    kind: task ? 'task' : item.parent?.name === 'OrderedList' ? 'number' : 'bullet',
    markFrom: mark.from,
    textFrom: skipSpaces(state, task ? task.to : mark.to, line.to),
    number: Number.parseInt(state.sliceDoc(mark.from, mark.to), 10) || 1,
  };
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
        const mark = kind === 'bullet' ? '- ' : kind === 'task' ? '- [ ] ' : `${number++}. `;
        if (item) changes.push({ from: item.markFrom, to: item.textFrom, insert: mark });
        else changes.push({ from: textStart(state, line, QUOTE_MARK), insert: mark });
      });
      if (!items[items.length - 1] && below && /[^\s>]/.test(below.text) && !listItemOf(state, below)) {
        changes.push({ from: last.to, insert: `\n${blankFor(last)}` });
      }
    }
    dispatch(state.update({ changes, scrollIntoView: true, userEvent: 'input' }));
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
/** Brackets in Markdown that is already written, escaped unless they are already. */
const writtenLinkText = (text: string) => text.replace(/(?<!\\)[[\]]/g, '\\$&');
const destination = (url: string) => (/[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, encodeURIComponent)}>` : url);

/** Text typed into the link form, written so it shows as typed: stars, underscores and backticks escaped. */
export const typedLinkText = (text: string) => text.replace(/[\\*_`]/g, (character) => (character === '\\' ? '\\\\' : `\\${character}`));

/**
 * A new link over `from` to `to` that keeps the formatting it half covers
 * balanced: a span that starts before the link closes before it and opens
 * again inside, and one that runs on past the link closes inside it and
 * opens again after. `**bold** t` with "old t" linked is
 * `**b**[**old** t](url)`. Formatting the link holds whole moves inside it
 * with its marks.
 */
function linkOver(state: EditorState, from: number, to: number, url: string): Change {
  const spans = inlineSpans(state, from, to).filter((span) => EMPHASIS.has(span.name) || span.name === 'InlineCode');
  for (const span of spans) {
    if (span.textFrom >= from && span.textTo <= to) {
      from = Math.min(from, span.from);
      to = Math.max(to, span.to);
    }
  }
  let before = '';
  let open = '';
  let close = '';
  let after = '';
  for (const span of spans) {
    const opens = state.sliceDoc(span.from, span.textFrom);
    const closes = state.sliceDoc(span.textTo, span.to);
    const startsBefore = span.from < from && from < span.textTo;
    const endsAfter = span.to > to && to > span.textFrom;
    if (startsBefore && endsAfter) continue;
    if (startsBefore) { before = closes + before; open += opens; }
    if (endsAfter) { close = closes + close; after += opens; }
  }
  return { from, to, insert: `${before}[${open}${writtenLinkText(state.sliceDoc(from, to))}${close}](${destination(url)})${after}` };
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
