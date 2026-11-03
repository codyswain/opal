import { indentLess, indentMore } from '@codemirror/commands';
import { indentUnit, syntaxTree } from '@codemirror/language';
import { ChangeSet, EditorSelection, type ChangeSpec, type EditorState, type Line, type SelectionRange, type StateCommand, type TransactionSpec } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { linkTarget } from './livePreview';
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

/** Where a line's text starts, past spaces and the `marks` that open it. */
function textStart(state: EditorState, line: Line, marks: ReadonlySet<string> = LINE_MARKS): number {
  const tree = syntaxTree(state);
  let at = line.from;
  for (;;) {
    while (at < line.to && /[ \t]/.test(state.sliceDoc(at, at + 1))) at += 1;
    const node = tree.resolveInner(at, 1);
    if (node.from !== at || node.to > line.to || !marks.has(node.name)) return at;
    at = node.to;
  }
}

/** The lines the selection touches. A selection that ends at the start of a line leaves that line out. */
export function selectedLines(state: EditorState): Line[] {
  const lines = new Map<number, Line>();
  for (const range of state.selection.ranges) {
    const last = state.doc.lineAt(range.to);
    const end = !range.empty && range.to === last.from && last.from > range.from ? last.number - 1 : last.number;
    for (let number = state.doc.lineAt(range.from).number; number <= end; number += 1) lines.set(number, state.doc.line(number));
  }
  return [...lines.values()].sort((a, b) => a.number - b.number);
}

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
  syntaxTree(state).iterate({
    from,
    to,
    enter: (ref) => {
      const span = inlineSpan(state, ref.node);
      if (span) spans.push(span);
    },
  });
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
    const bounds = textBounds(state, spans, line.from, line.to);
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

/** Formats the text with `marker`, joining the spans it touches into one. */
function addStyle(state: EditorState, text: SelectedText, name: string, marker: string): Change[] {
  const { from, to } = outOf(text.spans.filter((span) => span.name !== name), text.from, text.to);
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
    const size = span.to - span.from;
    return [
      textBounds(state, text.spans, span.textFrom, from)
        ? { from: closeAt, to: closeAt, insert: state.sliceDoc(span.textTo, span.to), nesting: size }
        : { from: span.from, to: span.textFrom, insert: '' },
      textBounds(state, text.spans, to, span.textTo)
        ? { from: openAt, to: openAt, insert: state.sliceDoc(span.from, span.textFrom), nesting: -size }
        : { from: span.textTo, to: span.to, insert: '' },
    ];
  });
}

const STYLES: Record<string, string> = { '**': 'StrongEmphasis', '*': 'Emphasis', '~~': 'Strikethrough' };

/**
 * Bold (`**`), italic (`*`) or strikethrough (`~~`) on the selection, by
 * Google Docs' rule: unless every selected character already has it, all of
 * them get it; otherwise it comes off the selected characters only. `_` and
 * `__` count as the marks they are. With nothing selected the caret gets an
 * empty pair, or loses the empty pair it sits in.
 */
export function toggleMarker(marker: string): StateCommand {
  const name = STYLES[marker];
  return ({ state, dispatch }) => {
    const size = marker.length;
    // One star beside exactly one other is half of a bold's "**".
    const isMarker = (from: number, to: number) => state.sliceDoc(from, to) === marker
      && !(size === 1 && (state.sliceDoc(from - 1, from) === '*') !== (state.sliceDoc(to, to + 1) === '*'));
    const texts = state.selection.ranges.flatMap((range) => selectedText(state, range));
    const unstyle = texts.length > 0 && texts.every((text) => allStyled(state, text, name));
    dispatch(state.update(state.changeByRange((range) => {
      if (range.empty) {
        return isMarker(range.from - size, range.from) && isMarker(range.from, range.from + size)
          ? { changes: { from: range.from - size, to: range.from + size }, range: EditorSelection.cursor(range.from - size) }
          : { changes: { from: range.from, insert: marker + marker }, range: EditorSelection.cursor(range.from + size) };
      }
      const parts = selectedText(state, range);
      if (parts.length === 0) return { range };
      const changes = ChangeSet.of(ordered(parts.flatMap((text) => (unstyle ? removeStyle(state, text, name) : addStyle(state, text, name, marker)))), state.doc.length);
      const from = changes.mapPos(parts[0].from, 1);
      const to = changes.mapPos(parts[parts.length - 1].to, -1);
      return { changes, range: range.anchor > range.head ? EditorSelection.range(to, from) : EditorSelection.range(from, to) };
    }), { scrollIntoView: true, userEvent: 'input' }));
    return true;
  };
}

const CLEARED = ['StrongEmphasis', 'Emphasis', 'Strikethrough', 'InlineCode'];

/** Takes bold, italic, strikethrough and code off the selection: only marks the syntax tree reads as formatting. */
export const clearFormatting: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const changes = state.selection.ranges.flatMap((range) => selectedText(state, range))
    .flatMap((text) => CLEARED.flatMap((name) => removeStyle(state, text, name, CLEARED)));
  if (changes.length > 0) dispatch(state.update({ changes: ordered(changes), scrollIntoView: true, userEvent: 'input' }));
  return true;
};

const skipSpaces = (state: EditorState, from: number, to: number) => {
  let at = from;
  while (at < to && /[ \t]/.test(state.sliceDoc(at, at + 1))) at += 1;
  return at;
};

/** The heading a line is: its level and its "#" marks, or null for any other line. */
export function headingOf(state: EditorState, line: Line): { level: number; node: SyntaxNode } | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(textStart(state, line, BLOCK_MARKS), 1); node; node = node.parent) {
    const level = /^ATXHeading(\d)$/.exec(node.name)?.[1];
    if (level) return node.from >= line.from && node.from <= line.to ? { level: Number(level), node } : null;
  }
  return null;
}

/**
 * Normal text (0) or a heading level on each selected line: adds, changes or
 * removes the "#" marks. Normal also removes a closing "##". A blank line
 * becomes a heading only when it is the one line selected, ready to type in.
 */
export function setHeading(level: number): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const lines = selectedLines(state);
    const changes = lines.flatMap((line): ChangeSpec[] => {
      const heading = headingOf(state, line);
      if (!heading) {
        const blank = !/[^\s>]/.test(line.text);
        return level > 0 && (!blank || lines.length === 1) ? [{ from: textStart(state, line, BLOCK_MARKS), insert: `${'#'.repeat(level)} ` }] : [];
      }
      const [open, close] = heading.node.getChildren('HeaderMark');
      if (level > 0) return heading.level === level ? [] : [{ from: open.from, to: open.to, insert: '#'.repeat(level) }];
      const marks: ChangeSpec[] = [{ from: open.from, to: skipSpaces(state, open.to, line.to) }];
      if (close) marks.push({ from: line.from + state.sliceDoc(line.from, close.from).trimEnd().length, to: close.to });
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
  const mark = syntaxTree(state).resolveInner(textStart(state, line, QUOTE_MARK), 1);
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
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(line.to, -1); node; node = node.parent) {
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
    const touched = selectedLines(state);
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
      const previous = above && listItemOf(state, above);
      let number = previous?.kind === 'number' ? previous.number + 1 : 1;
      lines.forEach((line, index) => {
        const item = items[index];
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
    const quoted = selectedLines(state).map((line) => ({ line, quote: QUOTE_MARKS.exec(line.text)?.[0] ?? '' }));
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
    if (!selectedLines(state).some((line) => listItemOf(state, line))) return false;
    return indentInQuote(more)(target) || (more ? indentMore : indentLess)(target);
  };
}

/** A link and where its text sits: a Markdown link, a wiki link or a bare web address. */
export interface LinkAt {
  kind: 'link' | 'wiki' | 'url';
  from: number;
  to: number;
  textFrom: number;
  textTo: number;
  /** The URL, or a wiki link's target. */
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
    return span && { kind: 'wiki', from, to, textFrom: span.textFrom, textTo: span.textTo, target: parseWikiTarget(state.sliceDoc(open.to, close.from)).target };
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
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, 1); node && node.from === from && node.to <= to; node = node.parent) {
    const link = node.to === to ? linkOf(state, node) : null;
    if (link) return link;
  }
  return null;
}

/** The link whose text holds `at`, at either end included. */
export function linkAt(state: EditorState, at: number): LinkAt | null {
  for (const side of [1, -1] as const) {
    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(at, side); node; node = node.parent) {
      const link = linkOf(state, node);
      if (link && link.textFrom <= at && at <= link.textTo) return link;
    }
  }
  return null;
}

const linkText = (text: string) => text.replace(/[[\]]/g, '\\$&');
const destination = (url: string) => (/[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, encodeURIComponent)}>` : url);

/**
 * Writes a link to `url` with `text`: over `range` for a new one, or in place
 * of `link`. A Markdown link whose text is unchanged keeps its text as
 * written, formatting and all, and only its URL changes.
 */
export function writeLink(state: EditorState, range: { from: number; to: number }, text: string, url: string, link: LinkAt | null): TransactionSpec {
  const shown = text || url;
  let change: Change;
  if (link?.kind === 'wiki') {
    change = { from: link.from, to: link.to, insert: `[[${url}${shown === url ? '' : `|${shown}`}]]` };
  } else if (link?.kind === 'link' && text === state.sliceDoc(link.textFrom, link.textTo)) {
    const written = syntaxTree(state).resolveInner(link.from, 1);
    const node = written.name === 'Link' ? written : written.parent;
    const at = node?.getChild('URL');
    change = at ? { from: at.from, to: at.to, insert: destination(url) } : { from: link.textTo, to: link.to, insert: `](${destination(url)})` };
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
