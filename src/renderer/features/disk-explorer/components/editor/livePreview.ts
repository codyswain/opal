import { syntaxTree } from '@codemirror/language';
import { Facet, Prec, StateEffect, StateField, type EditorSelection, type EditorState, type Extension, type Range, type Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate, type WidgetType } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { Tag, styleTags } from '@lezer/highlight';
import type { MarkdownConfig } from '@lezer/markdown';
import { classifyFile, pageName } from '@/common/fileKind';
import { normalizeFsPath, parentFsPath } from '@/common/fsPaths';
import { toOpalFileUrl } from '@/common/opalFileUrl';
import { activityLogSection } from './activityLog';
import { blockRenderers, nodeDecorators, type DecorateContext, type Reveal, type TextRange } from './extensionPoints';
import { CalloutIconWidget } from './callouts';
import {
  CalloutTitleWidget,
  CodeBlockWidget,
  EllipsisWidget,
  HorizontalRuleWidget,
  ImageWidget,
  InlineTitleWidget,
  ListMarkerWidget,
  TableWidget,
  fileVersions,
  type BlockContext,
  type CodeLine,
  type InlinePiece,
  type TableCell,
  type TableModel,
} from './previewWidgets';
import { openPathLink, openWikiLink, opensNewTab, pageContext, parseWikiTarget, resolvedLinks } from './wikiLinks';

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
 *
 * A document (.mdo) never reveals its marks: only a table or code block
 * opened with a double-click shows its Markdown, until the caret leaves it.
 */

/** On for a document, which always reads as rendered. */
export const docMode = Facet.define<boolean, boolean>({ combine: (values) => values.some(Boolean) });

const setFocused = StateEffect.define<boolean>();
const setPointerDown = StateEffect.define<boolean>();
/** Puts a cell caret at a position in a table, or with null turns it into the table's source. */
export const setCellCaret = StateEffect.define<number | null>();

/** Where a click in a drawn table put the cell caret, or null. */
export function cellCaretOf(state: EditorState): number | null {
  return state.field(revealState, false)?.cell ?? null;
}
/** In a document, shows the source of the table or code block over these lines, or with null draws it again. */
export const setOpenBlock = StateEffect.define<{ from: number; to: number } | null>();

interface RevealState {
  focused: boolean;
  pointerDown: boolean;
  /** The selection whose marks show, or null while the page reads as rendered. */
  revealed: EditorSelection | null;
  /** Where a click in a table put the caret. That table stays drawn until the caret moves or the text changes. */
  cell: number | null;
  /** A document's table or code block that shows its source, while the caret stays in it. */
  block: { from: number; to: number } | null;
}

/**
 * What the page reveals: the selection while the page has focus. It holds
 * still while the mouse button is down, because revealing the clicked line
 * moves the text, and CodeMirror would otherwise read the moved text under
 * the pointer when the button comes up.
 */
const revealState = StateField.define<RevealState>({
  create: () => ({ focused: false, pointerDown: false, revealed: null, cell: null, block: null }),
  update(value, tr) {
    let { focused, pointerDown, cell, block } = value;
    let cellSet = false;
    let blockSet = false;
    for (const effect of tr.effects) {
      if (effect.is(setPointerDown)) pointerDown = effect.value;
      if (effect.is(setCellCaret)) { cell = effect.value; cellSet = true; }
      if (effect.is(setOpenBlock)) { block = effect.value; blockSet = true; }
      if (effect.is(setFocused)) {
        focused = effect.value;
        if (!focused) { pointerDown = false; cell = null; }
      }
    }
    if (!cellSet && (tr.docChanged || tr.selection)) cell = null;
    if (block && !blockSet) {
      // Typing at either end of the open block grows it.
      if (tr.docChanged) block = { from: tr.changes.mapPos(block.from, -1), to: tr.changes.mapPos(block.to, 1) };
      const { head } = tr.state.selection.main;
      if (head < block.from || head > block.to) block = null;
    }
    const revealed = pointerDown ? value.revealed?.map(tr.changes) ?? null : focused ? tr.state.selection : null;
    const same = revealed === value.revealed || (revealed !== null && value.revealed !== null && revealed.eq(value.revealed));
    const sameBlock = block === value.block || (block !== null && value.block !== null && block.from === value.block.from && block.to === value.block.to);
    if (focused === value.focused && pointerDown === value.pointerDown && cell === value.cell && same && sameBlock) return value;
    return { focused, pointerDown, revealed, cell, block };
  },
});

const trackFocus = EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing));

const NOTHING_REVEALED: Reveal = { lines: () => false, span: () => false };

function revealer(state: EditorState): Reveal {
  const { revealed, block } = state.field(revealState);
  // A document's open table or code block shows its source with or without focus, as a menu takes it.
  if (state.facet(docMode)) {
    if (!block) return NOTHING_REVEALED;
    const open = (from: number, to = from) => from <= block.to && to >= block.from;
    return { lines: open, span: open };
  }
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

/**
 * A document's number for an ordered item: the list's first number plus
 * the item's place in it, so "1.", "1.", "1." and a list with an item
 * deleted read 1, 2, 3. The file keeps the numbers as written.
 */
function shownNumber(state: EditorState, item: SyntaxNode, mark: SyntaxNode): string {
  const list = item.parent;
  const written = state.sliceDoc(mark.from, mark.to);
  const first = list?.getChild('ListItem')?.getChild('ListMark');
  if (!list || !first) return written;
  let place = 0;
  for (let child = list.firstChild; child && child.from < item.from; child = child.nextSibling) if (child.name === 'ListItem') place += 1;
  const start = Number.parseInt(state.sliceDoc(first.from, first.to), 10) || 0;
  return `${start + place}${written.slice(-1)}`;
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
export function linkTarget(state: EditorState, node: SyntaxNode): string | null {
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
export function autolinkHref(written: string): string {
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
      // In a table cell a pipe in code is written "\|", and reads as a plain pipe.
      pieces.push({ kind: 'code', text: state.sliceDoc(edges[0]?.to ?? child.from, edges[edges.length - 1]?.from ?? child.to).replace(/\\\|/g, '|') });
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
    } else if (child.name === 'HTMLTag' && /^<br\s*\/?>$/i.test(state.sliceDoc(child.from, child.to))) {
      pieces.push({ kind: 'break' });
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

/**
 * A row's cells by column. A column with no cell node is empty and keeps the
 * spot after its pipe and one space, so text typed there has a space on
 * each side.
 */
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
      empty = child.to - start + (state.sliceDoc(child.to, child.to + 2) === '  ' ? 1 : 0);
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
      // A row short of cells takes them at its end, where typing adds them.
      const cells = rowCells(state, start, child);
      while (cells.length < model.header.length) cells.push({ offset: child.to - start, content: [] });
      model.rows.push(cells);
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
  const renderers = state.facet(blockRenderers);
  syntaxTree(state).iterate({
    enter: (ref) => {
      const registered = renderers.get(ref.name);
      if (registered) {
        const node = ref.node;
        const from = state.doc.lineAt(node.from).from;
        const to = lastLine(state.doc, node).to;
        for (const renderer of registered) {
          const widget = renderer.widget(state, node, from, to, blockLayout(state.doc, node, to));
          if (widget === undefined) continue;
          if (widget) blocks.push({ from, to, widget });
          return false;
        }
      }
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
  return pageName(state.facet(pageContext).path);
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

/*
 * Hidden marks. In a document the caret never stops inside them, and where
 * several positions show as one place it rests before a mark, so typed text
 * takes the formatting of the text before it, or after one marked
 * `caretAfter`: the marks that open a line, and those that close a link or
 * code, after which typing is plain.
 */
const hidden = Decoration.replace({});
const hiddenCaretAfter = Decoration.replace({ caretAfter: true });
const inlineCode = Decoration.mark({ class: 'cm-md-code' });
const syntax = Decoration.mark({ class: 'cm-md-syntax' });
const taskDone = Decoration.mark({ class: 'cm-md-task-done' });
const calloutTitle = Decoration.mark({ class: 'cm-md-callout-title' });
const horizontalRule = new HorizontalRuleWidget();

/**
 * Decorations for the lines from `top` to `bottom`: everything but tables and
 * fenced code. Ranges node decorators mark as units go into `units`.
 */
function lineDecorations(state: EditorState, top: number, bottom: number, units?: TextRange[]): DecorationSet {
  const { doc } = state;
  const reveal = revealer(state);
  const page = state.facet(pageContext).path;
  const links = state.field(resolvedLinks);
  const versions = state.field(fileVersions);
  // A document frames the image the selection covers.
  const picked = state.facet(docMode) ? state.selection.main : null;
  const image = (src: string, alt: string, width: number | null, from: number, to: number) =>
    new ImageWidget(src, alt, width, versions.get(src), picked?.from === from && picked.to === to);
  const { shown } = state.field(blockPreview);
  const covered = (at: number) => shown.some((block) => block.from <= at && block.to >= at);
  const out: Range<Decoration>[] = [];
  const hide = (from: number, to: number, caretAfter = false) => {
    if (to > from && !doc.sliceString(from, to).includes('\n')) out.push((caretAfter ? hiddenCaretAfter : hidden).range(from, to));
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
  const decorators = state.facet(nodeDecorators);
  const ctx: DecorateContext = {
    state, reveal, docMode: state.facet(docMode), page, links, versions, picked, out, hide, lineClass, covered,
    unit: (from, to) => { if (to > from) units?.push({ from, to }); },
  };

  syntaxTree(state).iterate({
    from: top,
    to: bottom,
    enter: (ref) => {
      const node = ref.node;
      if (decorators.get(ref.name)?.some((decorator) => decorator.decorate(ctx, node) === true)) return false;
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
            if (indented) hide(line.from, line.from + (/^(?: {1,4}|\t)/.exec(line.text)?.[0].length ?? 0), true);
          });
          return false;
        }
        case 'ATXHeading1': case 'ATXHeading2': case 'ATXHeading3':
        case 'ATXHeading4': case 'ATXHeading5': case 'ATXHeading6': {
          const line = doc.lineAt(ref.from);
          lineClass(line.from, `cm-md-heading cm-md-h${ref.name.slice(-1)}`);
          if (!reveal.lines(line.from, line.to)) {
            const [open, close] = node.getChildren('HeaderMark');
            // A document shows a "#" just typed until a space makes it a heading.
            if (open && (open.to < line.to || !state.facet(docMode))) hide(open.from, skipSpaces(doc, open.to, line.to), true);
            if (close) hide(doc.sliceString(line.from, close.from).trimEnd().length + line.from, close.to);
          }
          return true;
        }
        case 'SetextHeading1':
        case 'SetextHeading2': {
          const mark = node.getChild('HeaderMark');
          linesOf(ref.from, mark ? mark.from - 1 : ref.to, (line) => lineClass(line.from, `cm-md-heading cm-md-h${ref.name.slice(-1)}`));
          if (mark) lineClass(mark.from, 'cm-md-setext-mark');
          // A document never shows the underline: the caret steps from the heading's end past it.
          if (mark && state.facet(docMode)) {
            const underline = doc.lineAt(mark.from);
            hide(underline.from, underline.to);
            lineClass(underline.from, 'cm-md-setext-hidden');
            units?.push({ from: underline.from - 1, to: Math.min(doc.length, underline.to + 1) });
          }
          return true;
        }
        case 'EmphasisMark':
        case 'StrikethroughMark':
        case 'CodeMark': {
          const parent = node.parent;
          if (parent && !reveal.span(parent.from, parent.to)) hide(ref.from, ref.to, ref.name === 'CodeMark' && ref.to === parent.to);
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
            hide(close.from, ref.to, true);
          } else {
            out.push(syntax.range(open.from, open.to), syntax.range(close.from, ref.to));
          }
          return true;
        }
        case 'Autolink': {
          const shownAsText = !reveal.span(ref.from, ref.to);
          for (const mark of node.getChildren('LinkMark')) {
            if (shownAsText) hide(mark.from, mark.to, mark.to === ref.to);
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
          const widget = image(imageSource(target, page), alt, imageWidth(size), ref.from, ref.to);
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
            const widget = image(toOpalFileUrl(file), link.target, imageWidth(link.aliasAt === null ? undefined : inner.slice(link.aliasAt)), ref.from, ref.to);
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
            hide(close.from, ref.to, true);
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
          const depth = listDepth(node);
          const indent = listIndent(depth);
          const checked = task ? /x/i.test(doc.sliceString(task.from, task.to)) : false;
          const ordered = item.parent?.name === 'OrderedList';
          const docs = state.facet(docMode);
          // A document shows a lone "-" or "*" as typed until a space makes it a bullet.
          if (docs && !ordered && ref.to === line.to) return true;
          lineClass(line.from, 'cm-md-list', `--list-indent: ${indent}em`);
          markerLines.add(line.number);
          // The marker shows as written only while the caret is in it.
          if (start <= ref.from && !reveal.span(start, textFrom - 1)) {
            const kind = task ? 'task' : ordered ? 'number' : 'bullet';
            const label = ordered && docs ? shownNumber(state, item, node) : doc.sliceString(ref.from, ref.to);
            out.push(Decoration.replace({ widget: new ListMarkerWidget(kind, label, checked, depth, task && ordered ? label : null), caretAfter: true }).range(start, textFrom));
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
            // A nested quote draws one rule per level.
            const depth = callout ? 1 : (/^(?:[ \t]*>[ \t]?)*/.exec(line.text)?.[0].match(/>/g)?.length ?? 1);
            out.push(Decoration.line({
              class: `${kind}${first ? ` ${kind}-first` : ''}${last ? ` ${kind}-last` : ''}`,
              attributes: callout ? { 'data-callout': callout.type } : depth > 1 ? { style: `--quote-depth: ${depth}` } : undefined,
            }).range(line.from));
          });
          if (!callout) return true;
          const head = doc.lineAt(ref.from);
          calloutHeads.add(head.from);
          if (callout.title) out.push(calloutTitle.range(callout.titleFrom, head.to));
          if (!reveal.lines(head.from, head.to)) {
            out.push(Decoration.widget({ widget: new CalloutIconWidget(callout.type), side: -1 }).range(callout.title ? callout.titleFrom : head.from));
            if (callout.title) hide(head.from, callout.titleFrom, true);
            else out.push(Decoration.replace({ widget: new CalloutTitleWidget(callout.type[0].toUpperCase() + callout.type.slice(1)), caretAfter: true }).range(head.from, head.to));
          }
          return true;
        }
        case 'QuoteMark': {
          // Like a list marker, "> " shows as written only while the caret is in it, so entering the text moves nothing.
          const line = doc.lineAt(ref.from);
          const end = doc.sliceString(ref.to, ref.to + 1) === ' ' ? ref.to + 1 : ref.to;
          if (calloutHeads.has(line.from) || covered(ref.from) || reveal.span(ref.from, end - 1)) return false;
          hide(ref.from, end, true);
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
    if (!reveal.span(start, textFrom - 1)) hide(start, textFrom, true);
  }
  return Decoration.set(out, true);
}

const linePreview = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = lineDecorations(view.state, view.viewport.from, view.viewport.to);
  }

  update(update: ViewUpdate) {
    if (
      update.docChanged || update.viewportChanged ||
      syntaxTree(update.startState) !== syntaxTree(update.state) ||
      update.startState.field(revealState) !== update.state.field(revealState) ||
      update.startState.field(resolvedLinks) !== update.state.field(resolvedLinks) ||
      update.startState.field(fileVersions) !== update.state.field(fileVersions)
    ) {
      this.decorations = lineDecorations(update.state, update.view.viewport.from, update.view.viewport.to);
    }
  }
}, { decorations: (plugin) => plugin.decorations });

/** Text the page hides, as a document's caret sees it. */
export interface HiddenRange {
  from: number;
  to: number;
  /** Where several positions show as one place, the caret rests after this range rather than before it. */
  caretAfter: boolean;
  /** It draws something, a picture, a rule or a block, so its two sides are two places. */
  unit: boolean;
}

/**
 * What the page hides on the lines from `from` to `to`, in order. A drawn
 * table or code block takes the line breaks around it too, so the caret
 * stops on the lines beside it and never on its own lines, where typed text
 * would vanish into the hidden source.
 */
export function hiddenRanges(state: EditorState, from: number, to: number): HiddenRange[] {
  // A list item's later lines learn their indent from its first line.
  let start = state.doc.lineAt(from).from;
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(start, 1); node; node = node.parent) {
    if (node.name === 'ListItem') start = Math.min(start, node.from);
  }
  const found: HiddenRange[] = [];
  const units: TextRange[] = [];
  lineDecorations(state, start, to, units).between(from, to, (rangeFrom, rangeTo, decoration) => {
    if (!decoration.point || rangeTo <= rangeFrom) return;
    const caretAfter = Boolean(decoration.spec.caretAfter);
    found.push({ from: rangeFrom, to: rangeTo, caretAfter, unit: Boolean(decoration.spec.widget) && !caretAfter });
  });
  for (const unit of units) {
    if (unit.to >= from && unit.from <= to) found.push({ ...unit, caretAfter: false, unit: true });
  }
  const reveal = revealer(state);
  for (const target of state.field(linkDefinitions).long) {
    if (target.to >= from && target.from <= to && !reveal.lines(target.line)) found.push({ from: target.from, to: target.to, caretAfter: false, unit: true });
  }
  // A table holding a cell caret keeps the caret in its cell until a key shows its source.
  const { cell } = state.field(revealState);
  for (const block of state.field(blockPreview).shown) {
    if (block.to < from || block.from > to) continue;
    if (cell !== null && block.from <= cell && cell <= block.to) continue;
    found.push({ from: Math.max(0, block.from - 1), to: Math.min(state.doc.length, block.to + 1), caretAfter: false, unit: true });
  }
  return found.sort((a, b) => a.from - b.from || a.to - b.to);
}

/** The lines of the table or fenced code block drawn over `at`, if one is. */
export function drawnBlockAt(state: EditorState, at: number): { from: number; to: number } | null {
  const block = state.field(blockPreview).shown.find((shown) => shown.from <= at && at <= shown.to);
  return block ? { from: block.from, to: block.to } : null;
}

/** Writes "[x]" or "[ ]" into the task whose checkbox starts at `at`. */
function toggleTask(view: EditorView, at: number): void {
  const line = view.state.doc.lineAt(at);
  const match = /\[([ xX])\]/.exec(line.text.slice(at - line.from));
  if (!match) return;
  const from = at + match.index + 1;
  view.dispatch({ changes: { from, to: from + 1, insert: match[1] === ' ' ? 'x' : ' ' }, userEvent: 'input.toggle' });
}

/** Where a click in a table or code block puts the caret: the cell's start, or the spot in the code line. */
export function blockPosition(view: EditorView, block: HTMLElement, target: Element, event: MouseEvent): number {
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
export function openLink(view: EditorView, href: string, newTab: boolean): void {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) window.open(href, '_blank');
  else void openPathLink(view, href, newTab);
}

/**
 * With a cell caret, Enter and the first typed key show the table's source;
 * a typed character then lands in it. A document opens the table's source
 * for as long as the caret stays in it.
 */
function revealCell(event: KeyboardEvent, view: EditorView): boolean {
  const { cell } = view.state.field(revealState);
  if (cell === null || event.metaKey || event.ctrlKey || event.altKey) return false;
  const typing = event.key.length === 1;
  if (!typing && !['Enter', 'Backspace', 'Delete'].includes(event.key)) return false;
  const table = view.state.facet(docMode) ? drawnBlockAt(view.state, cell) : null;
  view.dispatch({ effects: table ? [setCellCaret.of(null), setOpenBlock.of(table)] : setCellCaret.of(null) });
  if (typing) return false;
  event.preventDefault();
  return true;
}

const previewClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button > 1 || !(event.target instanceof Element)) return false;
    const target = event.target;
    const box = event.button === 0 && target.closest('.cm-md-task');
    if (box) {
      event.preventDefault();
      toggleTask(view, view.posAtDOM(box));
      return true;
    }
    // Links drawn as links open on a click, as in Obsidian. Cmd+click and
    // middle-click open them in a new tab, and open them while they show as written too.
    const newTab = opensNewTab(event);
    const wiki = target.closest<HTMLElement>('[data-wiki-target]');
    if (wiki?.dataset.wikiTarget && (newTab || !linkRevealed(view.state, view.posAtDOM(wiki)))) {
      event.preventDefault();
      void openWikiLink(view, wiki.dataset.wikiTarget, newTab);
      return true;
    }
    const link = target.closest<HTMLElement>('[data-href]');
    if (link?.dataset.href && (newTab || !linkRevealed(view.state, view.posAtDOM(link)))) {
      event.preventDefault();
      openLink(view, link.dataset.href, newTab);
      return true;
    }
    // The middle button only follows links.
    if (event.button !== 0) return false;
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

export const livePreview: Extension = [revealState, trackFocus, fileVersions, linkDefinitions, shortTargets, blockPreview, linePreview, Prec.high(previewClicks)];
