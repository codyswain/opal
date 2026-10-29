import { syntaxTree } from '@codemirror/language';
import { Facet, Prec, StateEffect, StateField, type EditorSelection, type EditorState, type Extension, type Range, type Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate, type WidgetType } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { Tag, styleTags } from '@lezer/highlight';
import type { MarkdownConfig } from '@lezer/markdown';
import { classifyFile } from '@/common/fileKind';
import { basenameFsPath, normalizeFsPath, parentFsPath } from '@/common/fsPaths';
import { toOpalFileUrl } from '@/common/opalFileUrl';
import { activityLogSection } from './activityLog';
import {
  CalloutIconWidget,
  CalloutTitleWidget,
  CodeBlockWidget,
  EllipsisWidget,
  HorizontalRuleWidget,
  ImageWidget,
  InlineTitleWidget,
  ListMarkerWidget,
  TableWidget,
  type BlockContext,
  type CodeLine,
  type InlinePiece,
  type TableCell,
  type TableModel,
} from './previewWidgets';
import { openPathLink, openWikiLink, pageContext, parseWikiTarget, resolvedLinks } from './wikiLinks';

/*
 * Live preview, as in Obsidian: the document stays the file's text, and
 * decorations hide the Markdown marks and draw what they mean. Marks show as
 * written only while the page has focus and a selection touches them: inline
 * marks (links, emphasis, code) when the selection touches that span,
 * line marks (headings, rules, callout titles) when it touches the line. A
 * page opened to read looks like Obsidian's reading view, and a read-only
 * log always does.
 *
 * Tables and fenced code blocks span lines, so they come from a state field
 * as block widgets. Everything else is drawn per line for the viewport.
 */

const setFocused = StateEffect.define<boolean>();
const setPointerDown = StateEffect.define<boolean>();
/** Puts a cell caret at a position in a table, or with null turns it into the table's source. */
const setCellCaret = StateEffect.define<number | null>();

interface RevealState {
  focused: boolean;
  pointerDown: boolean;
  /** The selection whose marks show, or null while the page reads as rendered. */
  revealed: EditorSelection | null;
  /** Where a click in a table put the caret. That table stays drawn until the caret moves or the text changes. */
  cell: number | null;
}

/**
 * What the page reveals: the selection while the page has focus. It holds
 * still while the mouse button is down, because revealing the clicked line
 * moves the text, and CodeMirror would otherwise read the moved text under
 * the pointer when the button comes up.
 */
const revealState = StateField.define<RevealState>({
  create: () => ({ focused: false, pointerDown: false, revealed: null, cell: null }),
  update(value, tr) {
    let { focused, pointerDown, cell } = value;
    let cellSet = false;
    for (const effect of tr.effects) {
      if (effect.is(setPointerDown)) pointerDown = effect.value;
      if (effect.is(setCellCaret)) { cell = effect.value; cellSet = true; }
      if (effect.is(setFocused)) {
        focused = effect.value;
        if (!focused) { pointerDown = false; cell = null; }
      }
    }
    if (!cellSet && (tr.docChanged || tr.selection)) cell = null;
    const revealed = pointerDown ? value.revealed?.map(tr.changes) ?? null : focused ? tr.state.selection : null;
    const same = revealed === value.revealed || (revealed !== null && value.revealed !== null && revealed.eq(value.revealed));
    if (focused === value.focused && pointerDown === value.pointerDown && cell === value.cell && same) return value;
    return { focused, pointerDown, revealed, cell };
  },
});

const trackFocus = EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing));

/** Which ranges show as source: `lines` when a selection touches one of their lines, `span` only when it touches the range itself. */
interface Reveal {
  lines: (from: number, to?: number) => boolean;
  span: (from: number, to?: number) => boolean;
}

const NOTHING_REVEALED: Reveal = { lines: () => false, span: () => false };

function revealer(state: EditorState): Reveal {
  const { revealed } = state.field(revealState);
  if (!revealed) return NOTHING_REVEALED;
  // Log pages and the old Activity Log section are read-only in Opal, so they always read as rendered.
  const locked = state.field(activityLogSection, false) ?? null;
  const editable = (from: number) => locked === null || from < locked;
  const lines = revealed.ranges.map((range) => [state.doc.lineAt(range.from).from, state.doc.lineAt(range.to).to]);
  return {
    lines: (from, to = from) => editable(from) && lines.some(([start, end]) => start <= to && end >= from),
    span: (from, to = from) => editable(from) && revealed.ranges.some((range) => range.from <= to && range.to >= from),
  };
}

/** The line a node ends on; a node that ends at a line break belongs to the line before it. */
function lastLine(doc: Text, node: SyntaxNode) {
  const line = doc.lineAt(node.to);
  return line.from === node.to && node.to > node.from ? doc.lineAt(node.to - 1) : line;
}

function within(node: SyntaxNode, name: string): SyntaxNode | null {
  for (let at = node.parent; at; at = at.parent) if (at.name === name) return at;
  return null;
}

/** Length of the "> " marks that open a line inside a quote. */
function quotePrefix(text: string): number {
  return /^(?:[ \t]*>[ \t]?)*/.exec(text)?.[0].length ?? 0;
}

function skipSpaces(doc: Text, from: number, to: number): number {
  let at = from;
  while (at < to && /[ \t]/.test(doc.sliceString(at, at + 1))) at += 1;
  return at;
}

const LIST_LEVEL_EM = 1.5;
const LIST_MARKER_EM = 1.5;

/** How far a list item's text starts from its container's edge, in em. */
function listIndent(depth: number): number {
  return depth * LIST_LEVEL_EM + LIST_MARKER_EM;
}

function listDepth(node: SyntaxNode): number {
  let depth = -1;
  for (let at: SyntaxNode | null = node; at; at = at.parent) {
    if (at.name === 'BulletList' || at.name === 'OrderedList') depth += 1;
  }
  return Math.max(depth, 0);
}

const CALLOUT = /^((?:[ \t]*>[ \t]?)+)\[!([\w-]+)\][+-]?[ \t]*/;

interface Callout {
  type: string;
  /** Where the title text starts on the first line. */
  titleFrom: number;
  title: string;
}

/** Reads "> [!type] Title" off a quote's first line. */
function calloutOf(doc: Text, quote: SyntaxNode): Callout | null {
  const line = doc.lineAt(quote.from);
  const match = CALLOUT.exec(line.text);
  if (!match) return null;
  return { type: match[2].toLowerCase(), titleFrom: line.from + match[0].length, title: line.text.slice(match[0].length).trim() };
}

/** A block inside a callout or quote takes the box's ground; inside a list it lines up with the item's text. */
function blockLayout(doc: Text, node: SyntaxNode, to: number): { context: BlockContext; indent: number } {
  const item = within(node, 'ListItem');
  const indent = item ? listIndent(listDepth(item)) : 0;
  let quote: SyntaxNode | null = within(node, 'Blockquote');
  while (quote && within(quote, 'Blockquote')) quote = within(quote, 'Blockquote');
  if (!quote) return { context: null, indent };
  if (!calloutOf(doc, quote)) return { context: 'quote', indent };
  return { context: lastLine(doc, quote).to === to ? 'callout-last' : 'callout', indent };
}

/** An image path as written, absolute or relative to the page, as a URL the page can load. */
function imageSource(written: string, page: string): string {
  const raw = written.trim().replace(/^<|>$/g, '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
  let decoded = raw;
  try { decoded = decodeURI(raw); } catch { /* keep it as written */ }
  return toOpalFileUrl(decoded.startsWith('/') ? decoded : normalizeFsPath(`${parentFsPath(page) ?? ''}/${decoded}`));
}

/** Obsidian's size suffix: "alt|300" or "image.png|300x200" sets the width. */
function imageWidth(size: string | undefined): number | null {
  const match = /^\s*(\d+)(?:x\d+)?\s*$/.exec(size ?? '');
  return match ? Number(match[1]) : null;
}

/**
 * Lezer reads any "[text]" as a link. The live preview decides which ones
 * are links and mutes their marks itself, so the brackets around plain text
 * keep the text's color.
 */
/**
 * Whether the page draws its file name as a title above the text. A stack
 * section turns it off and draws the same title in its header.
 */
export const showInlineTitle = Facet.define<boolean, boolean>({ combine: (values) => values.every(Boolean) });

export const linkMarkStyle: MarkdownConfig = { props: [styleTags({ LinkMark: Tag.define() })] };

/** A reference label the way CommonMark matches it: case and runs of spaces do not count. */
function referenceKey(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

const unwrap = (url: string) => url.replace(/^<|>$/g, '');

// "[label]: url", in a quote or not.
const DEFINITION = /^ {0,3}(?:> ?)*\[((?:[^\]\\]|\\.)+)\]:[ \t]*(<[^>]*>|\S+)/;
const LONG_TARGET = 120;
const LONG_TARGET_SHOWN = 48;

interface LinkDefinitions {
  /** Targets by label; the first definition of a label wins. */
  targets: ReadonlyMap<string, string>;
  /** The hidden ends of long targets, such as images pasted as data, and the lines they are on. */
  long: readonly { line: number; from: number; to: number }[];
}

/**
 * Reads definitions off the text rather than the syntax tree: exports put
 * them at the end of long notes, past where the parser has read.
 */
function findDefinitions(doc: Text): LinkDefinitions {
  const targets = new Map<string, string>();
  const long: { line: number; from: number; to: number }[] = [];
  let at = 0;
  for (const line of doc.iterLines()) {
    const match = line.includes(']:') ? DEFINITION.exec(line) : null;
    if (match) {
      const key = referenceKey(match[1]);
      if (!targets.has(key)) targets.set(key, unwrap(match[2]));
      const targetTo = at + match[0].length;
      if (match[2].length > LONG_TARGET) long.push({ line: at, from: targetTo - match[2].length + LONG_TARGET_SHOWN, to: targetTo });
    }
    at += line.length + 1;
  }
  return { targets, long };
}

const linkDefinitions = StateField.define<LinkDefinitions>({
  create: (state) => findDefinitions(state.doc),
  update: (definitions, tr) => (tr.docChanged ? findDefinitions(tr.newDoc) : definitions),
});

const ellipsis = new EllipsisWidget();

// Provided directly rather than per viewport, so the page's height counts a long target as one line before it is drawn.
const shortTargets = EditorView.decorations.compute([linkDefinitions, revealState], (state) => {
  const reveal = revealer(state);
  return Decoration.set(state.field(linkDefinitions).long
    .filter((target) => !reveal.lines(target.line))
    .map((target) => Decoration.replace({ widget: ellipsis }).range(target.from, target.to)));
});

/**
 * Where a link or image points, or null for bracketed text that is no link.
 * An inline link carries its URL (empty when it has none). "[text][label]",
 * "[label][]" and "[label]" point where the page defines the label, and are
 * plain text without a definition. "[^1]" and "[!note]" are footnotes and
 * callouts, never links.
 */
function linkTarget(state: EditorState, node: SyntaxNode): string | null {
  const marks = node.getChildren('LinkMark');
  if (marks.length < 2) return null;
  const url = node.getChild('URL');
  if (marks.length > 2) return url ? unwrap(state.sliceDoc(url.from, url.to)) : '';
  const label = node.getChild('LinkLabel');
  // An image's first mark is "![", so its own "[" sits one before the mark's end.
  const written = label && label.to - label.from > 2 ? state.sliceDoc(label.from, label.to) : state.sliceDoc(marks[0].to - 1, marks[1].to);
  if (/^\[[\^!]/.test(written)) return null;
  return state.field(linkDefinitions).targets.get(referenceKey(written.slice(1, -1))) ?? null;
}

/** A bare web or mail address as a link: "www." gets https, an email address mailto. */
function autolinkHref(written: string): string {
  if (/^www\./i.test(written)) return `https://${written}`;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(written) && /^[^\s@/]+@[^\s@/]+$/.test(written)) return `mailto:${written}`;
  return written;
}

function inlinePieces(state: EditorState, node: SyntaxNode, from: number, to: number): InlinePiece[] {
  const pieces: InlinePiece[] = [];
  let at = from;
  const text = (end: number) => {
    if (end > at) pieces.push({ kind: 'text', text: state.sliceDoc(at, end) });
  };
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.to <= from || child.from >= to) continue;
    text(child.from);
    at = child.to;
    const marks = (name: string) => child.getChildren(name);
    if (child.name === 'StrongEmphasis' || child.name === 'Emphasis' || child.name === 'Strikethrough') {
      const edges = marks(child.name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark');
      const kind = child.name === 'StrongEmphasis' ? 'strong' : child.name === 'Emphasis' ? 'em' : 'strike';
      pieces.push({ kind, children: inlinePieces(state, child, edges[0]?.to ?? child.from, edges[edges.length - 1]?.from ?? child.to) });
    } else if (child.name === 'InlineCode') {
      const edges = marks('CodeMark');
      pieces.push({ kind: 'code', text: state.sliceDoc(edges[0]?.to ?? child.from, edges[edges.length - 1]?.from ?? child.to) });
    } else if (child.name === 'Link') {
      const edges = marks('LinkMark');
      const target = linkTarget(state, child);
      // Bracketed text that is no link keeps its brackets.
      if (target === null) pieces.push(...inlinePieces(state, child, child.from, child.to));
      else pieces.push({ kind: 'link', children: inlinePieces(state, child, edges[0].to, edges[1].from), href: target || null });
    } else if (child.name === 'WikiLink' || child.name === 'Embed') {
      const edges = marks('WikiLinkMark');
      const inner = state.sliceDoc(edges[0]?.to ?? child.from, edges[1]?.from ?? child.to);
      const link = parseWikiTarget(inner);
      pieces.push({ kind: 'wiki', text: link.aliasAt === null ? inner : inner.slice(link.aliasAt), target: link.target });
    } else if (child.name === 'URL') {
      const written = state.sliceDoc(child.from, child.to);
      pieces.push({ kind: 'link', children: [{ kind: 'text', text: written }], href: autolinkHref(written) });
    } else if (child.name === 'Escape') {
      pieces.push({ kind: 'text', text: state.sliceDoc(child.from + 1, child.to) });
    } else {
      pieces.push({ kind: 'text', text: state.sliceDoc(child.from, child.to) });
    }
  }
  text(to);
  return pieces;
}

function columnAlignment(cell: string): TableModel['align'][number] {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
}

/** A row's cells by column. A column with no cell node is empty and keeps the spot after its pipe. */
function rowCells(state: EditorState, start: number, row: SyntaxNode): TableCell[] {
  const cells: TableCell[] = [];
  let column = 0;
  let empty = row.from - start;
  for (let child = row.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableDelimiter') {
      if (child.from > row.from || cells.length > 0) {
        cells[column] ??= { offset: empty, content: [] };
        column += 1;
      }
      empty = child.to - start;
    } else if (child.name === 'TableCell') {
      cells[column] = { offset: child.from - start, content: inlinePieces(state, child, child.from, child.to) };
    }
  }
  return cells;
}

function tableModel(state: EditorState, table: SyntaxNode, start: number): TableModel {
  const model: TableModel = { align: [], header: [], rows: [] };
  for (let child = table.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableHeader') {
      model.header = rowCells(state, start, child);
    } else if (child.name === 'TableRow') {
      model.rows.push(rowCells(state, start, child));
    } else if (child.name === 'TableDelimiter') {
      const cells = state.sliceDoc(child.from, child.to).trim().replace(/^\||\|$/g, '').split('|');
      model.align = cells.map((cell) => columnAlignment(cell.trim()));
    }
  }
  if (model.align.length === 0) model.align = model.header.map(() => null);
  return model;
}

/** The code between the fences, without the indentation or quote marks the block sits in. */
function codeLines(state: EditorState, block: SyntaxNode, start: number, inQuote: boolean): CodeLine[] {
  const doc = state.doc;
  const first = doc.lineAt(block.from);
  const last = lastLine(doc, block);
  const closed = block.getChildren('CodeMark').length > 1 && last.number > first.number;
  const container = inQuote ? quotePrefix(first.text) : 0;
  const indent = block.from - first.from - container;
  const lines: CodeLine[] = [];
  for (let number = first.number + 1; number <= (closed ? last.number - 1 : last.number); number += 1) {
    const line = doc.line(number);
    let from = line.from + (inQuote ? quotePrefix(line.text) : 0);
    for (let spaces = 0; spaces < indent && doc.sliceString(from, from + 1) === ' '; spaces += 1) from += 1;
    lines.push({ offset: from - start, text: doc.sliceString(from, line.to) });
  }
  return lines;
}

interface PreviewBlock {
  from: number;
  to: number;
  widget: WidgetType;
}

interface BlockPreview {
  blocks: readonly PreviewBlock[];
  /** Blocks drawn as widgets right now, which the per-line pass leaves alone. */
  shown: readonly PreviewBlock[];
  decorations: DecorationSet;
}

// Inline content holds no tables or code blocks, so the block pass skips it.
const LEAF_BLOCKS = new Set([
  'Paragraph', 'ATXHeading1', 'ATXHeading2', 'ATXHeading3', 'ATXHeading4', 'ATXHeading5', 'ATXHeading6',
  'SetextHeading1', 'SetextHeading2', 'CodeBlock', 'HTMLBlock', 'CommentBlock', 'LinkReference', 'HorizontalRule',
]);

function findBlocks(state: EditorState): PreviewBlock[] {
  const blocks: PreviewBlock[] = [];
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (LEAF_BLOCKS.has(ref.name)) return false;
      if (ref.name !== 'Table' && ref.name !== 'FencedCode') return;
      const node = ref.node;
      const from = state.doc.lineAt(node.from).from;
      const to = lastLine(state.doc, node).to;
      const { context, indent } = blockLayout(state.doc, node, to);
      const source = state.sliceDoc(from, to);
      const inQuote = within(node, 'Blockquote') !== null;
      const widget = ref.name === 'Table'
        ? new TableWidget(source, tableModel(state, node, from), context, indent)
        : new CodeBlockWidget(source, codeLines(state, node, from, inQuote), context, indent);
      blocks.push({ from, to, widget });
      return false;
    },
  });
  return blocks;
}

function pageTitle(state: EditorState): string {
  return basenameFsPath(state.facet(pageContext).path).replace(/\.md$/i, '');
}

/**
 * A block shows its source while a selection touches it, except a table
 * holding a cell caret: a click in a table only marks the cell, and the
 * source shows once the caret moves, a key is typed, Enter is pressed or the
 * cell is double-clicked.
 */
function showBlocks(state: EditorState, blocks: readonly PreviewBlock[]): BlockPreview {
  const reveal = revealer(state);
  const { cell } = state.field(revealState);
  const shown = blocks.flatMap(({ from, to, widget }) => {
    if (cell !== null && widget instanceof TableWidget && from <= cell && cell <= to) return [{ from, to, widget: widget.withCellCaret(cell - from) }];
    return reveal.lines(from, to) ? [] : [{ from, to, widget }];
  });
  const title = state.facet(showInlineTitle)
    ? [Decoration.widget({ widget: new InlineTitleWidget(pageTitle(state)), block: true, side: -1 }).range(0)]
    : [];
  const decorations = Decoration.set([
    ...title,
    ...shown.map((block) => Decoration.replace({ widget: block.widget, block: true }).range(block.from, block.to)),
  ], true);
  return { blocks, shown, decorations };
}

const blockPreview = StateField.define<BlockPreview>({
  create: (state) => showBlocks(state, findBlocks(state)),
  update(preview, tr) {
    if (tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return showBlocks(tr.state, findBlocks(tr.state));
    if (tr.startState.field(revealState) !== tr.state.field(revealState)) return showBlocks(tr.state, preview.blocks);
    return preview;
  },
  provide: (field) => EditorView.decorations.from(field, (preview) => preview.decorations),
});

const hidden = Decoration.replace({});
const inlineCode = Decoration.mark({ class: 'cm-md-code' });
const syntax = Decoration.mark({ class: 'cm-md-syntax' });
const taskDone = Decoration.mark({ class: 'cm-md-task-done' });
const calloutTitle = Decoration.mark({ class: 'cm-md-callout-title' });
const horizontalRule = new HorizontalRuleWidget();

/** Decorations for the lines in view: everything but tables and fenced code. */
function lineDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const { doc } = state;
  const { from: top, to: bottom } = view.viewport;
  const reveal = revealer(state);
  const page = state.facet(pageContext).path;
  const links = state.field(resolvedLinks);
  const { shown } = state.field(blockPreview);
  const covered = (at: number) => shown.some((block) => block.from <= at && block.to >= at);
  const out: Range<Decoration>[] = [];
  const hide = (from: number, to: number) => {
    if (to > from && !doc.sliceString(from, to).includes('\n')) out.push(hidden.range(from, to));
  };
  const lineClass = (at: number, className: string, style?: string) => {
    out.push(Decoration.line({ class: className, attributes: style ? { style } : undefined }).range(doc.lineAt(at).from));
  };
  const linesOf = (from: number, to: number, decorate: (line: ReturnType<Text['line']>, first: boolean, last: boolean) => void) => {
    const first = doc.lineAt(from).number;
    const last = doc.lineAt(to).number;
    for (let number = Math.max(first, doc.lineAt(top).number); number <= Math.min(last, doc.lineAt(bottom).number); number += 1) {
      const line = doc.line(number);
      if (!covered(line.from)) decorate(line, number === first, number === last);
    }
  };
  // Lines after an item's first one hang under its text; a nested item's lines take the deeper indent.
  const continued = new Map<number, { indent: number; quoted: boolean }>();
  const markerLines = new Set<number>();
  const calloutHeads = new Set<number>();

  syntaxTree(state).iterate({
    from: top,
    to: bottom,
    enter: (ref) => {
      const node = ref.node;
      switch (ref.name) {
        case 'Table':
        case 'FencedCode':
        case 'CodeBlock': {
          if (covered(ref.from)) return false;
          const kind = ref.name === 'Table' ? 'cm-md-table-source' : 'cm-md-codeblock';
          // An indented code block drops its four-space indent while no selection is in it.
          const indented = ref.name === 'CodeBlock' && !reveal.lines(ref.from, ref.to);
          linesOf(ref.from, lastLine(doc, node).to, (line, first, last) => {
            lineClass(line.from, `${kind}${first ? ` ${kind}-first` : ''}${last ? ` ${kind}-last` : ''}`);
            if (indented) hide(line.from, line.from + (/^(?: {1,4}|\t)/.exec(line.text)?.[0].length ?? 0));
          });
          return false;
        }
        case 'ATXHeading1': case 'ATXHeading2': case 'ATXHeading3':
        case 'ATXHeading4': case 'ATXHeading5': case 'ATXHeading6': {
          const line = doc.lineAt(ref.from);
          lineClass(line.from, `cm-md-heading cm-md-h${ref.name.slice(-1)}`);
          if (!reveal.lines(line.from, line.to)) {
            const [open, close] = node.getChildren('HeaderMark');
            if (open) hide(open.from, skipSpaces(doc, open.to, line.to));
            if (close) hide(doc.sliceString(line.from, close.from).trimEnd().length + line.from, close.to);
          }
          return true;
        }
        case 'SetextHeading1':
        case 'SetextHeading2': {
          const mark = node.getChild('HeaderMark');
          linesOf(ref.from, mark ? mark.from - 1 : ref.to, (line) => lineClass(line.from, `cm-md-heading cm-md-h${ref.name.slice(-1)}`));
          if (mark) lineClass(mark.from, 'cm-md-setext-mark');
          return true;
        }
        case 'EmphasisMark':
        case 'StrikethroughMark':
        case 'CodeMark': {
          const parent = node.parent;
          if (parent && !reveal.span(parent.from, parent.to)) hide(ref.from, ref.to);
          return false;
        }
        case 'InlineCode':
          out.push(inlineCode.range(ref.from, ref.to));
          return true;
        case 'Escape':
          if (!reveal.span(ref.from, ref.to)) hide(ref.from, ref.from + 1);
          return false;
        case 'Link': {
          const target = linkTarget(state, node);
          // Bracketed text that is no link reads as written.
          if (target === null) return true;
          const [open, close] = node.getChildren('LinkMark');
          if (close.from > open.to) {
            out.push(Decoration.mark({ class: 'cm-md-link', attributes: target ? { 'data-href': target } : undefined }).range(open.to, close.from));
          }
          if (!reveal.span(ref.from, ref.to)) {
            hide(open.from, open.to);
            hide(close.from, ref.to);
          } else {
            out.push(syntax.range(open.from, open.to), syntax.range(close.from, ref.to));
          }
          return true;
        }
        case 'Autolink': {
          const shownAsText = !reveal.span(ref.from, ref.to);
          for (const mark of node.getChildren('LinkMark')) {
            if (shownAsText) hide(mark.from, mark.to);
            else out.push(syntax.range(mark.from, mark.to));
          }
          return true;
        }
        case 'URL': {
          const parent = node.parent?.name;
          if (parent === 'Link' || parent === 'Image' || parent === 'LinkReference') return false;
          out.push(Decoration.mark({ class: 'cm-md-link', attributes: { 'data-href': autolinkHref(doc.sliceString(ref.from, ref.to)) } }).range(ref.from, ref.to));
          return false;
        }
        case 'Image': {
          const [open, close] = node.getChildren('LinkMark');
          const target = linkTarget(state, node);
          if (!target) return false;
          const [alt, size] = doc.sliceString(open.to, close.from).split('|');
          const widget = new ImageWidget(imageSource(target, page), alt, imageWidth(size));
          if (reveal.span(ref.from, ref.to)) {
            out.push(Decoration.widget({ widget, side: 1 }).range(ref.to), syntax.range(open.from, open.to), syntax.range(close.from, ref.to));
          } else if (!doc.sliceString(ref.from, ref.to).includes('\n')) {
            out.push(Decoration.replace({ widget }).range(ref.from, ref.to));
          }
          return false;
        }
        case 'LinkReference':
          // Definitions read as muted source; shortTargets shortens long ones.
          out.push(syntax.range(ref.from, ref.to));
          return false;
        case 'WikiLink':
        case 'Embed': {
          const [open, close] = node.getChildren('WikiLinkMark');
          if (!open || !close) return false;
          const inner = doc.sliceString(open.to, close.from);
          const link = parseWikiTarget(inner);
          const file = links.get(link.target);
          const shownAsText = !reveal.span(ref.from, ref.to);
          if (ref.name === 'Embed' && file && classifyFile(file) === 'image') {
            const widget = new ImageWidget(toOpalFileUrl(file), link.target, imageWidth(link.aliasAt === null ? undefined : inner.slice(link.aliasAt)));
            out.push(shownAsText ? Decoration.replace({ widget }).range(ref.from, ref.to) : Decoration.widget({ widget, side: 1 }).range(ref.to));
            return false;
          }
          const textFrom = shownAsText && link.aliasAt !== null ? open.to + link.aliasAt : open.to;
          if (close.from > textFrom) {
            out.push(Decoration.mark({
              class: file === null ? 'cm-md-wikilink cm-md-unresolved' : 'cm-md-wikilink',
              attributes: link.target ? { 'data-wiki-target': link.target } : undefined,
            }).range(textFrom, close.from));
          }
          if (shownAsText) {
            hide(ref.from, textFrom);
            hide(close.from, ref.to);
          }
          return false;
        }
        case 'HorizontalRule':
          if (!reveal.lines(ref.from, ref.to)) out.push(Decoration.replace({ widget: horizontalRule }).range(ref.from, ref.to));
          return false;
        case 'ListMark': {
          const item = node.parent;
          if (!item || item.name !== 'ListItem') return false;
          const line = doc.lineAt(ref.from);
          const quoted = within(node, 'Blockquote') !== null;
          const start = line.from + (quoted ? quotePrefix(line.text) : 0);
          const box = item.getChild('Task')?.getChild('TaskMarker');
          const task = box && box.from <= line.to ? box : null;
          const textFrom = skipSpaces(doc, task ? task.to : ref.to, line.to);
          const indent = listIndent(listDepth(node));
          const checked = task ? /x/i.test(doc.sliceString(task.from, task.to)) : false;
          lineClass(line.from, 'cm-md-list', `--list-indent: ${indent}em`);
          markerLines.add(line.number);
          // The marker shows as written only while the caret is in it.
          if (start <= ref.from && !reveal.span(start, textFrom - 1)) {
            const kind = task ? 'task' : item.parent?.name === 'OrderedList' ? 'number' : 'bullet';
            out.push(Decoration.replace({ widget: new ListMarkerWidget(kind, doc.sliceString(ref.from, ref.to), checked) }).range(start, textFrom));
          }
          if (checked && textFrom < line.to) out.push(taskDone.range(textFrom, line.to));
          const last = lastLine(doc, item).number;
          for (let number = line.number + 1; number <= Math.min(last, doc.lineAt(bottom).number); number += 1) {
            continued.set(number, { indent, quoted });
          }
          return true;
        }
        case 'Blockquote': {
          if (within(node, 'Blockquote')) return true;
          const callout = calloutOf(doc, node);
          const kind = callout ? 'cm-md-callout' : 'cm-md-quote';
          linesOf(ref.from, lastLine(doc, node).to, (line, first, last) => {
            out.push(Decoration.line({
              class: `${kind}${first ? ` ${kind}-first` : ''}${last ? ` ${kind}-last` : ''}`,
              attributes: callout ? { 'data-callout': callout.type } : undefined,
            }).range(line.from));
          });
          if (!callout) return true;
          const head = doc.lineAt(ref.from);
          calloutHeads.add(head.from);
          if (callout.title) out.push(calloutTitle.range(callout.titleFrom, head.to));
          if (!reveal.lines(head.from, head.to)) {
            if (callout.type === 'ai') out.push(Decoration.widget({ widget: new CalloutIconWidget(), side: -1 }).range(callout.title ? callout.titleFrom : head.from));
            if (callout.title) hide(head.from, callout.titleFrom);
            else out.push(Decoration.replace({ widget: new CalloutTitleWidget(callout.type[0].toUpperCase() + callout.type.slice(1)) }).range(head.from, head.to));
          }
          return true;
        }
        case 'QuoteMark': {
          // Like a list marker, "> " shows as written only while the caret is in it, so entering the text moves nothing.
          const line = doc.lineAt(ref.from);
          const end = doc.sliceString(ref.to, ref.to + 1) === ' ' ? ref.to + 1 : ref.to;
          if (calloutHeads.has(line.from) || covered(ref.from) || reveal.span(ref.from, end - 1)) return false;
          hide(ref.from, end);
          return false;
        }
        default:
          return true;
      }
    },
  });

  for (const [number, { indent, quoted }] of continued) {
    const line = doc.line(number);
    if (markerLines.has(number) || !line.text.trim() || covered(line.from)) continue;
    lineClass(line.from, 'cm-md-list-cont', `--list-indent: ${indent}em`);
    const start = line.from + (quoted ? quotePrefix(line.text) : 0);
    const textFrom = skipSpaces(doc, start, line.to);
    if (!reveal.span(start, textFrom - 1)) hide(start, textFrom);
  }
  return Decoration.set(out, true);
}

const linePreview = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = lineDecorations(view);
  }

  update(update: ViewUpdate) {
    if (
      update.docChanged || update.viewportChanged ||
      syntaxTree(update.startState) !== syntaxTree(update.state) ||
      update.startState.field(revealState) !== update.state.field(revealState) ||
      update.startState.field(resolvedLinks) !== update.state.field(resolvedLinks)
    ) {
      this.decorations = lineDecorations(update.view);
    }
  }
}, { decorations: (plugin) => plugin.decorations });

/** Writes "[x]" or "[ ]" into the task whose checkbox starts at `at`. */
function toggleTask(view: EditorView, at: number): void {
  const line = view.state.doc.lineAt(at);
  const match = /\[([ xX])\]/.exec(line.text.slice(at - line.from));
  if (!match) return;
  const from = at + match.index + 1;
  view.dispatch({ changes: { from, to: from + 1, insert: match[1] === ' ' ? 'x' : ' ' }, userEvent: 'input.toggle' });
}

/** Where a click in a table or code block puts the caret: the cell's start, or the spot in the code line. */
function blockPosition(view: EditorView, block: HTMLElement, target: Element, event: MouseEvent): number {
  const start = view.posAtDOM(block);
  const spot = target.closest<HTMLElement>('[data-offset]');
  if (!spot || !block.contains(spot)) return start;
  let offset = Number(spot.dataset.offset);
  if (block.classList.contains('cm-md-codeblock-widget')) {
    const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    const length = spot.textContent?.replace('​', '').length ?? 0;
    if (caret && spot.contains(caret.startContainer)) offset += Math.min(caret.startOffset, length);
  }
  return start + offset;
}

const LINK_NODES = new Set(['Link', 'Autolink', 'URL', 'WikiLink', 'Embed']);

/** Whether the link drawn at `at` shows as written, so a plain click there edits it rather than following it. */
function linkRevealed(state: EditorState, at: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(at, 1); node; node = node.parent) {
    if (LINK_NODES.has(node.name)) return revealer(state).span(node.from, node.to);
  }
  return false;
}

/** Opens a Markdown link: one with a scheme in the default app, which the main process allows for web and mail, and a path in Opal. */
function openLink(view: EditorView, href: string): void {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) window.open(href, '_blank');
  else void openPathLink(view, href);
}

/** With a cell caret, Enter and the first typed key show the table's source; a typed character then lands in it. */
function revealCell(event: KeyboardEvent, view: EditorView): boolean {
  if (view.state.field(revealState).cell === null || event.metaKey || event.ctrlKey || event.altKey) return false;
  const typing = event.key.length === 1;
  if (!typing && !['Enter', 'Backspace', 'Delete'].includes(event.key)) return false;
  view.dispatch({ effects: setCellCaret.of(null) });
  if (typing) return false;
  event.preventDefault();
  return true;
}

const previewClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !(event.target instanceof Element)) return false;
    const target = event.target;
    const box = target.closest('.cm-md-task');
    if (box) {
      event.preventDefault();
      toggleTask(view, view.posAtDOM(box));
      return true;
    }
    // Links drawn as links open on a click, as in Obsidian; Cmd+click opens them while they show as written too.
    const wiki = target.closest<HTMLElement>('[data-wiki-target]');
    if (wiki?.dataset.wikiTarget && (event.metaKey || !linkRevealed(view.state, view.posAtDOM(wiki)))) {
      event.preventDefault();
      void openWikiLink(view, wiki.dataset.wikiTarget);
      return true;
    }
    const link = target.closest<HTMLElement>('[data-href]');
    if (link?.dataset.href && (event.metaKey || !linkRevealed(view.state, view.posAtDOM(link)))) {
      event.preventDefault();
      openLink(view, link.dataset.href);
      return true;
    }
    const block = target.closest<HTMLElement>('.cm-md-block');
    if (block) {
      event.preventDefault();
      const anchor = blockPosition(view, block, target, event);
      // One click in a table marks the cell; a double-click shows the source to edit.
      const cell = block.classList.contains('cm-md-table') && event.detail < 2 ? anchor : null;
      view.dispatch({ selection: { anchor }, effects: setCellCaret.of(cell) });
      view.focus();
      return true;
    }
    // CodeMirror selects as usual; the reveal catches up once the button is up.
    view.dispatch({ effects: setPointerDown.of(true) });
    window.addEventListener('mouseup', () => {
      if (view.dom.isConnected) view.dispatch({ effects: setPointerDown.of(false) });
    }, { once: true });
    return false;
  },
  keydown: revealCell,
});

export const livePreview: Extension = [revealState, trackFocus, linkDefinitions, shortTargets, blockPreview, linePreview, Prec.high(previewClicks)];
