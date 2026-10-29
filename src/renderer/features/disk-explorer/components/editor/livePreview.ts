import { syntaxTree } from '@codemirror/language';
import { StateEffect, StateField, type EditorSelection, type EditorState, type Extension, type Range, type Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate, type WidgetType } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { classifyFile } from '@/common/fileKind';
import { basenameFsPath, normalizeFsPath, parentFsPath } from '@/common/fsPaths';
import { toOpalFileUrl } from '@/common/opalFileUrl';
import {
  CalloutIconWidget,
  CalloutTitleWidget,
  CodeBlockWidget,
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
import { openWikiLink, pageContext, parseWikiTarget, resolvedLinks } from './wikiLinks';

/*
 * Live preview, as in Obsidian: the document stays the file's text, and
 * decorations hide the Markdown marks and draw what they mean. A line shows
 * its marks as written only while the page has focus and a selection touches
 * it, so a page opened to read looks like Obsidian's reading view.
 *
 * Tables and fenced code blocks span lines, so they come from a state field
 * as block widgets. Everything else is drawn per line for the viewport.
 */

const setFocused = StateEffect.define<boolean>();
const setPointerDown = StateEffect.define<boolean>();

interface RevealState {
  focused: boolean;
  pointerDown: boolean;
  /** The selection whose lines show their Markdown, or null while the page reads as rendered. */
  revealed: EditorSelection | null;
}

/**
 * What the page reveals: the selection's lines while the page has focus.
 * It holds still while the mouse button is down, because revealing the
 * clicked line moves the text, and CodeMirror would otherwise read the moved
 * text under the pointer when the button comes up.
 */
const revealState = StateField.define<RevealState>({
  create: () => ({ focused: false, pointerDown: false, revealed: null }),
  update(value, tr) {
    let { focused, pointerDown } = value;
    for (const effect of tr.effects) {
      if (effect.is(setPointerDown)) pointerDown = effect.value;
      if (effect.is(setFocused)) {
        focused = effect.value;
        if (!focused) pointerDown = false;
      }
    }
    const revealed = pointerDown ? value.revealed?.map(tr.changes) ?? null : focused ? tr.state.selection : null;
    const same = revealed === value.revealed || (revealed !== null && value.revealed !== null && revealed.eq(value.revealed));
    if (focused === value.focused && pointerDown === value.pointerDown && same) return value;
    return { focused, pointerDown, revealed };
  },
});

const trackFocus = EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing));

/** Whether a range shows as source: true when a selection touches one of its lines while the page has focus. */
type Reveal = (from: number, to?: number) => boolean;

function revealer(state: EditorState): Reveal {
  const { revealed } = state.field(revealState);
  if (!revealed) return () => false;
  const spans = revealed.ranges.map((range) => [state.doc.lineAt(range.from).from, state.doc.lineAt(range.to).to]);
  return (from, to = from) => spans.some(([start, end]) => start <= to && end >= from);
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
      const url = child.getChild('URL');
      pieces.push({
        kind: 'link',
        children: edges.length > 1 ? inlinePieces(state, child, edges[0].to, edges[1].from) : [],
        href: url ? state.sliceDoc(url.from, url.to) : null,
      });
    } else if (child.name === 'WikiLink' || child.name === 'Embed') {
      const edges = marks('WikiLinkMark');
      const inner = state.sliceDoc(edges[0]?.to ?? child.from, edges[1]?.from ?? child.to);
      const link = parseWikiTarget(inner);
      pieces.push({ kind: 'wiki', text: link.aliasAt === null ? inner : inner.slice(link.aliasAt), target: link.target });
    } else if (child.name === 'URL') {
      const href = state.sliceDoc(child.from, child.to);
      pieces.push({ kind: 'link', children: [{ kind: 'text', text: href }], href });
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

function showBlocks(state: EditorState, blocks: readonly PreviewBlock[]): BlockPreview {
  const reveal = revealer(state);
  const shown = blocks.filter((block) => !reveal(block.from, block.to));
  const decorations = Decoration.set([
    Decoration.widget({ widget: new InlineTitleWidget(pageTitle(state)), block: true, side: -1 }).range(0),
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
          const indented = ref.name === 'CodeBlock' && !reveal(ref.from, ref.to);
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
          if (!reveal(line.from, line.to)) {
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
          if (parent && !reveal(parent.from, parent.to)) hide(ref.from, ref.to);
          return false;
        }
        case 'InlineCode':
          out.push(inlineCode.range(ref.from, ref.to));
          return true;
        case 'Escape':
          if (!reveal(ref.from)) hide(ref.from, ref.from + 1);
          return false;
        case 'Link': {
          const [open, close] = node.getChildren('LinkMark');
          if (!open || !close) return true;
          const url = node.getChild('URL');
          const href = url ? doc.sliceString(url.from, url.to).replace(/^<|>$/g, '') : null;
          if (close.from > open.to) {
            out.push(Decoration.mark({ class: 'cm-md-link', attributes: href ? { 'data-href': href } : undefined }).range(open.to, close.from));
          }
          if (!reveal(ref.from, ref.to)) {
            hide(open.from, open.to);
            hide(close.from, ref.to);
          } else if (close.to < ref.to) {
            out.push(syntax.range(close.to, ref.to));
          }
          return true;
        }
        case 'Autolink': {
          if (!reveal(ref.from, ref.to)) {
            for (const mark of node.getChildren('LinkMark')) hide(mark.from, mark.to);
          }
          return true;
        }
        case 'URL': {
          const parent = node.parent?.name;
          if (parent === 'Link' || parent === 'Image' || parent === 'LinkReference') return false;
          out.push(Decoration.mark({ class: 'cm-md-link', attributes: { 'data-href': doc.sliceString(ref.from, ref.to) } }).range(ref.from, ref.to));
          return false;
        }
        case 'Image': {
          const [open, close] = node.getChildren('LinkMark');
          const url = node.getChild('URL');
          if (!open || !close || !url) return false;
          const [alt, size] = doc.sliceString(open.to, close.from).split('|');
          const widget = new ImageWidget(imageSource(doc.sliceString(url.from, url.to), page), alt, imageWidth(size));
          if (reveal(ref.from, ref.to)) out.push(Decoration.widget({ widget, side: 1 }).range(ref.to));
          else if (!doc.sliceString(ref.from, ref.to).includes('\n')) out.push(Decoration.replace({ widget }).range(ref.from, ref.to));
          return false;
        }
        case 'WikiLink':
        case 'Embed': {
          const [open, close] = node.getChildren('WikiLinkMark');
          if (!open || !close) return false;
          const inner = doc.sliceString(open.to, close.from);
          const link = parseWikiTarget(inner);
          const file = links.get(link.target);
          const shownAsText = !reveal(ref.from, ref.to);
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
          if (!reveal(ref.from, ref.to)) out.push(Decoration.replace({ widget: horizontalRule }).range(ref.from, ref.to));
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
          const { revealed } = state.field(revealState);
          const inMarker = revealed?.ranges.some((range) => range.from < textFrom && range.to >= start) ?? false;
          if (start <= ref.from && !inMarker) {
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
          if (!reveal(head.from, head.to)) {
            if (callout.type === 'ai') out.push(Decoration.widget({ widget: new CalloutIconWidget(), side: -1 }).range(callout.title ? callout.titleFrom : head.from));
            if (callout.title) hide(head.from, callout.titleFrom);
            else out.push(Decoration.replace({ widget: new CalloutTitleWidget(callout.type[0].toUpperCase() + callout.type.slice(1)) }).range(head.from, head.to));
          }
          return true;
        }
        case 'QuoteMark': {
          const line = doc.lineAt(ref.from);
          if (calloutHeads.has(line.from) || covered(ref.from) || reveal(line.from, line.to)) return false;
          hide(ref.from, doc.sliceString(ref.to, ref.to + 1) === ' ' ? ref.to + 1 : ref.to);
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
    if (!reveal(line.from, line.to)) {
      const start = line.from + (quoted ? quotePrefix(line.text) : 0);
      hide(start, skipSpaces(doc, start, line.to));
    }
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
    const wiki = target.closest<HTMLElement>('[data-wiki-target]');
    if (wiki?.dataset.wikiTarget && (event.metaKey || !revealer(view.state)(view.posAtDOM(wiki)))) {
      event.preventDefault();
      void openWikiLink(view, wiki.dataset.wikiTarget);
      return true;
    }
    const link = target.closest<HTMLElement>('[data-href]');
    if (link?.dataset.href && event.metaKey) {
      event.preventDefault();
      window.open(link.dataset.href, '_blank');
      return true;
    }
    const block = target.closest<HTMLElement>('.cm-md-block');
    if (block) {
      event.preventDefault();
      view.dispatch({ selection: { anchor: blockPosition(view, block, target, event) } });
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
});

export const livePreview: Extension = [revealState, trackFocus, blockPreview, linePreview, previewClicks];
