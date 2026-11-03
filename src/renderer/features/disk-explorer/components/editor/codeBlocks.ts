import { syntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, Prec, StateEffect, StateField, Transaction, type ChangeSpec, type Extension, type Line, type StateCommand, type Text, type TransactionSpec } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type Command, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { Copy, SquareCode, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { CODE_LANGUAGES, fenceLanguage, onLanguageLoaded, type FenceLanguage } from './codeLanguages';
import { firstMarkAfter, highlightMarks, onHighlightReady } from './codeHighlight';
import {
  blockRenderers,
  deleteHandlers,
  insertItems,
  latestTree,
  nodeDecorators,
  objectKinds,
  outsideProtected,
  protectedRanges,
  type DecorateContext,
  type ObjectAction,
  type PageObject,
  type TextRange,
} from './extensionPoints';
import { DiagramWidget, diagramDocExtension, diagramFence, modeControl, showsDiagram } from './diagrams';
import { inlineCode, inlineCodeDoc } from './inlineCode';
import { docMode, drawnBlockAt } from './livePreview';
import { objectFrame, removeObject } from './objectFrame';
import { blockFrame, type BlockContext } from './previewWidgets';
import './code.css';

/*
 * Code blocks. In a document a fenced block is edited in place: its code
 * lines are the page's own lines, in a grey box, and wrap with a hanging
 * indent. The opening fence draws as a header row with the language and a
 * Copy button, the closing fence as the box's bottom edge, and the caret
 * never stands on either. A click on the header frames the block. In a note
 * a block is drawn as a box that scrolls sideways while no selection is in
 * it, and shows its source while one is.
 *
 * Code is highlighted from each fence's own parse (codeHighlight.ts), never
 * through the page's Markdown tree.
 */

// ---------------------------------------------------------------------------
// Reading fences

const LIST_LEVEL_EM = 1.5;
const LIST_MARKER_EM = 1.5;

function within(node: SyntaxNode, name: string): SyntaxNode | null {
  for (let at = node.parent; at; at = at.parent) if (at.name === name) return at;
  return null;
}

/** The line a node ends on; a node that ends at a line break belongs to the line before it. */
function lastLine(doc: Text, node: SyntaxNode): Line {
  const line = doc.lineAt(node.to);
  return line.from === node.to && node.to > node.from ? doc.lineAt(node.to - 1) : line;
}

/** Length of the "> " marks that open a line inside a quote. */
function quotePrefix(text: string): number {
  return /^(?:[ \t]*>[ \t]?)*/.exec(text)?.[0].length ?? 0;
}

/** How far a list indents a block, in em, as the list's own lines do. */
function listIndent(node: SyntaxNode): number {
  if (!within(node, 'ListItem')) return 0;
  let depth = -1;
  for (let at: SyntaxNode | null = node; at; at = at.parent) if (at.name === 'BulletList' || at.name === 'OrderedList') depth += 1;
  return Math.max(depth, 0) * LIST_LEVEL_EM + LIST_MARKER_EM;
}

export interface CodeLineSpan {
  line: Line;
  /** Where the line's code starts, past its quote marks and the block's indent. */
  from: number;
}

/** A fenced code block, read off the page. */
export interface Fence {
  node: SyntaxNode;
  open: Line;
  /** The closing fence's line, or null when the block runs to the end of its container. */
  close: Line | null;
  lines: CodeLineSpan[];
  /** The info string after the opening marks. */
  info: { from: number; to: number; text: string };
  /** The opening marks, such as "```" or "~~~~". */
  marker: string;
  /** What each new line of the block starts with: its quote marks and the block's indent. */
  prefix: string;
}

/** Where a code line's code starts: past quote marks, then up to `indent` columns of spaces. */
function codeStart(doc: Text, line: Line, quoted: boolean, indent: number): number {
  let from = line.from + (quoted ? quotePrefix(line.text) : 0);
  for (let columns = 0; columns < indent;) {
    const character = doc.sliceString(from, from + 1);
    if (character === ' ') columns += 1;
    else if (character === '\t') columns += 4;
    else break;
    from += 1;
  }
  return from;
}

export function fenceOf(state: EditorState, node: SyntaxNode): Fence {
  const { doc } = state;
  const open = doc.lineAt(node.from);
  const last = lastLine(doc, node);
  const marks = node.getChildren('CodeMark');
  const closed = marks.length > 1 && last.number > open.number;
  const quoted = within(node, 'Blockquote') !== null;
  const container = quoted ? quotePrefix(open.text) : 0;
  const indent = node.from - open.from - container;
  const lines: CodeLineSpan[] = [];
  for (let number = open.number + 1; number <= (closed ? last.number - 1 : last.number); number += 1) {
    const line = doc.line(number);
    lines.push({ line, from: codeStart(doc, line, quoted, indent) });
  }
  const infoNode = node.getChild('CodeInfo');
  const markEnd = marks[0]?.to ?? node.from;
  const info = infoNode ? { from: infoNode.from, to: infoNode.to, text: doc.sliceString(infoNode.from, infoNode.to) } : { from: markEnd, to: markEnd, text: '' };
  const quote = open.text.slice(0, container).replace(/[ \t]+$/, '');
  return {
    node,
    open,
    close: closed ? last : null,
    lines,
    info,
    marker: doc.sliceString(marks[0]?.from ?? node.from, markEnd),
    prefix: (quote ? `${quote} ` : '') + ' '.repeat(indent),
  };
}

/** The code between the fences, without quote marks or the block's indent. */
export function codeText(state: EditorState, fence: Fence): string {
  return fence.lines.map(({ line, from }) => state.sliceDoc(from, line.to)).join('\n');
}

/** The fenced block whose node holds `at`, or null. */
export function fenceAt(state: EditorState, at: number): Fence | null {
  const tree = latestTree(state);
  for (const side of [1, -1] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(at, side); node; node = node.parent) {
      if (node.name === 'FencedCode') return fenceOf(state, node);
    }
  }
  return null;
}

/** The code line of `fence` whose code holds `at`, by index, or -1. */
export function codeLineIndex(fence: Fence, at: number): number {
  return fence.lines.findIndex(({ line, from }) => at >= from && at <= line.to);
}

/** The fence whose code holds `at`: the caret is in its code, not on a fence line. */
function codeAt(state: EditorState, at: number): { fence: Fence; index: number } | null {
  const fence = fenceAt(state, at);
  if (!fence) return null;
  const index = codeLineIndex(fence, at);
  return index === -1 ? null : { fence, index };
}

/** The indented code block holding `at`, or null. */
function indentedAt(state: EditorState, at: number): SyntaxNode | null {
  for (const side of [-1, 1] as const) {
    for (let node: SyntaxNode | null = latestTree(state).resolveInner(at, side); node; node = node.parent) {
      if (node.name === 'CodeBlock') return node;
    }
  }
  return null;
}

/** Whether the selection sits in a code block, fenced or indented, so formatting does not apply. */
export function inCodeBlock(state: EditorState): boolean {
  const { main } = state.selection;
  const fence = fenceAt(state, main.from);
  if (fence) return main.to <= (fence.close ?? lastLine(state.doc, fence.node)).to;
  return indentedAt(state, main.from) !== null && indentedAt(state, main.to) !== null;
}

// ---------------------------------------------------------------------------
// Widgets

const ICONS = {
  copy: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  chevron: '<svg class="cm-code-chevron" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
};

const COPIED_MS = 1500;

/** Puts `text` on the clipboard and shows "Copied" on `button` for 1.5 s. */
function copyWithFeedback(text: string, button: HTMLElement | null): void {
  void navigator.clipboard?.writeText(text).then(() => {
    if (!button) return;
    button.dataset.copied = 'true';
    button.innerHTML = `${ICONS.check}<span>Copied</span>`;
    window.setTimeout(() => {
      delete button.dataset.copied;
      button.innerHTML = `${ICONS.copy}<span>Copy</span>`;
    }, COPIED_MS);
  }, () => toast('Could not copy the code.'));
}

/** Copies the code of the block whose header or line is at `at`. */
export function copyCode(view: EditorView, at: number, button: HTMLElement | null = null): boolean {
  const fence = fenceAt(view.state, at);
  if (!fence) return false;
  copyWithFeedback(codeText(view.state, fence), button);
  return true;
}

function button(className: string, label: string, html: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.setAttribute('aria-label', label);
  element.innerHTML = html;
  element.tabIndex = -1;
  // The caret stays in the text.
  element.addEventListener('mousedown', (event) => event.preventDefault());
  return element;
}

/**
 * A document's code block header, drawn over its opening fence: the
 * language on the left, Copy on the right. A quiet block shows only its
 * label; Copy and a "Plain text" label show on hover or with the caret in
 * the block. A click elsewhere on it frames the block.
 */
class CodeHeaderWidget extends WidgetType {
  constructor(readonly label: string, readonly quiet: boolean, readonly active: boolean, readonly diagram = false) { super(); }

  eq(other: CodeHeaderWidget) {
    return other.label === this.label && other.quiet === this.quiet && other.active === this.active && other.diagram === this.diagram;
  }

  toDOM(view: EditorView) {
    const head = document.createElement('span');
    head.className = 'cm-code-header';
    head.dataset.object = 'code';
    head.setAttribute('role', 'group');
    head.setAttribute('aria-label', this.quiet ? 'Code' : `Code, ${this.label}`);
    if (this.quiet) head.dataset.quiet = 'true';
    if (this.active) head.dataset.active = 'true';
    const label = button('cm-code-label', `Language, ${this.label}`, '');
    label.append(this.label);
    label.insertAdjacentHTML('beforeend', ICONS.chevron);
    label.setAttribute('aria-haspopup', 'listbox');
    label.addEventListener('click', () => openLanguageMenu(view, label, view.posAtDOM(head)));
    const copy = button('cm-code-copy', 'Copy code', `${ICONS.copy}<span>Copy</span>`);
    copy.addEventListener('click', () => { copyCode(view, view.posAtDOM(head), copy); });
    head.append(label);
    // A diagram shown as code can go back to the picture.
    if (this.diagram) head.append(modeControl(view, () => fenceAt(view.state, view.posAtDOM(head))?.open.from ?? view.posAtDOM(head), true));
    head.append(copy);
    // Arrow keys move between the header's buttons; Escape goes back to the code.
    head.addEventListener('keydown', (event) => {
      const buttons = [label, copy];
      const at = buttons.indexOf(event.target as HTMLButtonElement);
      if (at === -1) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        buttons[(at + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length].focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        view.focus();
      }
    });
    return head;
  }

  // Its buttons handle their own clicks and keys; a click anywhere else reaches the editor and frames the block.
  ignoreEvent(event: Event) {
    return event.target instanceof Element && event.target.closest('button') !== null;
  }
}

/** The language menu of a block's header: a search field over the list. Searching writes nothing; a pick writes the info string's first word. */
let openMenu: { close: () => void } | null = null;

function openLanguageMenu(view: EditorView, anchor: HTMLElement, at: number): void {
  openMenu?.close();
  const fence = fenceAt(view.state, at);
  if (!fence) return;
  const current = fenceLanguage(fence.info.text);
  const options = [
    { id: 'text', label: 'Plain text', names: ['text', 'plain'], on: current.quiet },
    ...CODE_LANGUAGES.map((language) => ({ id: language.id, label: language.label, names: language.names, on: current.language?.id === language.id })),
    { id: 'mermaid', label: 'Mermaid diagram', names: ['mermaid', 'diagram'], on: current.word.toLowerCase() === 'mermaid' },
  ];
  const menu = document.createElement('div');
  menu.className = 'opal-code-menu';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', 'Language');
  const search = document.createElement('input');
  search.className = 'opal-code-menu-search';
  search.placeholder = 'Search languages';
  search.setAttribute('aria-label', 'Search languages');
  search.spellcheck = false;
  const list = document.createElement('div');
  list.className = 'opal-code-menu-list';
  list.setAttribute('role', 'listbox');
  menu.append(search, list);
  let shown = options;
  let active = Math.max(0, options.findIndex((option) => option.on));
  const close = () => {
    menu.remove();
    document.removeEventListener('mousedown', outside, true);
    if (openMenu?.close === close) openMenu = null;
  };
  const pick = (id: string) => {
    close();
    setLanguage(view, at, id);
    view.focus();
  };
  const render = () => {
    list.textContent = '';
    shown.forEach((option, index) => {
      const row = document.createElement('div');
      row.className = 'opal-code-menu-item';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === active));
      if (index === active) row.dataset.active = 'true';
      row.textContent = option.label;
      if (option.on) row.insertAdjacentHTML('beforeend', ICONS.check);
      row.addEventListener('mousedown', (event) => event.preventDefault());
      row.addEventListener('click', () => pick(option.id));
      list.append(row);
    });
    if (shown.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'opal-code-menu-empty';
      empty.textContent = 'No language matches';
      list.append(empty);
    }
    list.querySelector('[data-active]')?.scrollIntoView?.({ block: 'nearest' });
  };
  search.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    shown = options.filter((option) => !query || option.label.toLowerCase().includes(query) || option.names.some((name) => name.startsWith(query)));
    active = 0;
    render();
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (shown.length > 0) active = (active + (event.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length;
      render();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (shown[active]) pick(shown[active].id);
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      close();
      view.focus();
    }
  });
  const outside = (event: MouseEvent) => {
    if (!menu.contains(event.target as Node)) close();
  };
  document.addEventListener('mousedown', outside, true);
  render();
  document.body.append(menu);
  const box = anchor.getBoundingClientRect();
  const height = menu.offsetHeight || 280;
  const below = box.bottom + 4 + height <= window.innerHeight - 8;
  menu.style.top = `${Math.max(8, below ? box.bottom + 4 : box.top - 4 - height)}px`;
  menu.style.left = `${Math.max(8, Math.min(box.left - 4, window.innerWidth - 8 - (menu.offsetWidth || 220)))}px`;
  search.focus();
  openMenu = { close };
}

/** Option+F10 or ⌃⌥T with the caret in a block: focus moves to its header's buttons. */
const focusHeader: Command = (view) => {
  const inside = codeAt(view.state, view.state.selection.main.head);
  if (!inside) return false;
  for (const header of view.contentDOM.querySelectorAll<HTMLElement>('.cm-code-header')) {
    let at: number;
    try { at = view.posAtDOM(header); } catch { continue; }
    if (at !== inside.fence.node.from) continue;
    header.querySelector<HTMLElement>('button')?.focus();
    return true;
  }
  return false;
};

/** The muted "Code" in an empty block's one line. */
class PlaceholderWidget extends WidgetType {
  eq() { return true; }

  toDOM() {
    const placeholder = document.createElement('span');
    placeholder.className = 'cm-code-placeholder';
    placeholder.textContent = 'Code';
    return placeholder;
  }

  ignoreEvent() { return false; }
}

/** Under a block with no closing fence: says so, with a button that writes one. */
class OpenEndWidget extends WidgetType {
  eq() { return true; }

  toDOM(view: EditorView) {
    const foot = document.createElement('span');
    foot.className = 'cm-code-open-end';
    foot.setAttribute('contenteditable', 'false');
    const inner = document.createElement('span');
    inner.className = 'cm-code-open-end-text';
    foot.append(inner);
    const note = document.createElement('span');
    note.textContent = 'No closing fence';
    const dot = document.createElement('span');
    dot.textContent = ' · ';
    const end = button('cm-code-end-here', 'End code here', 'End code here');
    end.addEventListener('click', () => { endCodeHere(view, view.posAtDOM(foot)); });
    inner.append(note, dot, end);
    return foot;
  }

  ignoreEvent(event: Event) {
    return event.target instanceof Element && event.target.closest('button') !== null;
  }
}

/** Writes a closing fence after the code line holding the caret, or after the first code line when the caret is elsewhere. */
export function endCodeHere(view: EditorView, at: number): void {
  const { state } = view;
  const fence = fenceAt(state, at);
  if (!fence || fence.close || fence.lines.length === 0) return;
  const index = Math.max(0, codeLineIndex(fence, state.selection.main.head));
  const after = fence.lines[index].line;
  const insert = `\n${fence.prefix}${fence.marker.replace(/[^`~]/g, '')}`;
  view.dispatch({ changes: { from: after.to, insert }, selection: { anchor: after.to }, userEvent: 'input', scrollIntoView: true });
}

/**
 * A note's code block while no selection is in it: a grey box whose lines
 * scroll sideways inside the column. A click puts the caret where it landed.
 */
export class CodeBlockWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly code: string,
    /** Where each line's code starts, from the start of the block. */
    readonly offsets: readonly number[],
    readonly language: FenceLanguage,
    readonly context: BlockContext,
    readonly indent: number,
  ) { super(); }

  eq(other: CodeBlockWidget) {
    return other.source === this.source && other.context === this.context && other.indent === this.indent;
  }

  toDOM() {
    const frame = blockFrame('cm-md-codeblock-widget', this.context, this.indent);
    const box = document.createElement('div');
    box.className = 'cm-md-codeblock-box';
    const lines = document.createElement('div');
    lines.className = 'cm-md-codeblock-lines';
    box.append(lines);
    frame.append(box);
    // A long block shows its first lines until Show all, which writes nothing.
    let limit = this.offsets.length > COLLAPSE_AFTER ? COLLAPSE_AFTER : Infinity;
    this.fill(lines, limit);
    if (limit !== Infinity) {
      const total = this.offsets.length.toLocaleString('en-US');
      const show = button('cm-code-show-all', `Show all ${total} lines`, `Show all ${total} lines`);
      const row = document.createElement('div');
      row.className = 'cm-code-collapsed-box';
      row.append(show);
      box.append(row);
      show.addEventListener('click', () => {
        limit = Infinity;
        row.remove();
        this.fill(lines, limit);
      });
    }
    // A language still loading colours the block once it is ready.
    if (this.language.language && highlightMarks(this.code, this.language.language).length === 0 && this.code.trim()) {
      const stop = onLanguageLoaded(() => {
        stop();
        if (lines.isConnected) this.fill(lines, limit);
      });
    }
    return frame;
  }

  fill(parent: HTMLElement, limit: number) {
    parent.textContent = '';
    const marks = highlightMarks(this.code, this.language.language);
    const diff = this.language.language?.id === 'diff';
    let at = 0;
    let next = 0;
    this.code.split('\n').slice(0, limit).forEach((text, index, shown) => {
      const element = document.createElement('div');
      element.dataset.offset = String(this.offsets[index]);
      if (diff) element.className = diffClass(text);
      if (index === COLLAPSE_AFTER - 1 && shown.length < this.offsets.length) element.classList.add('cm-code-fade');
      const end = at + text.length;
      let written = at;
      for (; next < marks.length && marks[next].from < end; next += 1) {
        const mark = marks[next];
        const from = Math.max(mark.from, at);
        const to = Math.min(mark.to, end);
        if (from > written) element.append(this.code.slice(written, from));
        if (to > from) {
          const span = document.createElement('span');
          span.className = mark.className;
          span.textContent = this.code.slice(from, to);
          element.append(span);
          written = to;
        }
        if (mark.to > end) break;
      }
      if (end > written) element.append(this.code.slice(written, end));
      if (!text) element.textContent = '\u200b';
      // An added line's sign is bold.
      if (diff && element.classList.contains('cm-code-diff-add') && element.firstChild?.textContent?.startsWith('+')) {
        const first = element.firstChild;
        const sign = document.createElement('span');
        sign.className = 'cm-code-diff-sign';
        sign.textContent = '+';
        first.textContent = first.textContent.slice(1);
        element.insertBefore(sign, first);
      }
      parent.append(element);
      at = end + 1;
    });
  }

  get estimatedHeight() { return Math.min(this.offsets.length, COLLAPSE_AFTER + 1) * 21 + 26; }

  // Show all handles its own click; a click anywhere else puts the caret in the code.
  ignoreEvent(event: Event) {
    return event.target instanceof Element && event.target.closest('button') !== null;
  }
}

/** A diff line's look: an added line on a grey fill, a removed one struck through, a hunk header muted. */
function diffClass(text: string): string {
  if (/^(?:\+\+\+|---)(?:\s|$)/.test(text) || text.startsWith('@@')) return 'cm-code-diff-meta';
  if (text.startsWith('+')) return 'cm-code-diff-add';
  if (text.startsWith('-')) return 'cm-code-diff-del';
  return '';
}

// ---------------------------------------------------------------------------
// Long blocks

/** Blocks longer than this show their first lines and "Show all N lines". */
export const COLLAPSE_AFTER = 40;

/** Shows all of the block whose opening fence starts at this position. */
const expandCode = StateEffect.define<number>();

interface CollapsedBlock {
  /** The hidden lines: from the first one past the cut to the last code line's end. */
  from: number;
  to: number;
  /** Where the block's opening fence starts. */
  block: number;
}

interface Collapse {
  expanded: readonly number[];
  blocks: readonly CollapsedBlock[];
  decorations: DecorationSet;
}

/** "Show all N lines" under a long block's first lines. */
class ShowAllWidget extends WidgetType {
  constructor(readonly hidden: number, readonly total: number, readonly block: number, readonly context: BlockContext, readonly indent: number) { super(); }

  eq(other: ShowAllWidget) {
    return other.total === this.total && other.hidden === this.hidden && other.context === this.context && other.indent === this.indent;
  }

  toDOM(view: EditorView) {
    const frame = blockFrame('cm-code-collapsed', this.context, this.indent);
    const box = document.createElement('div');
    box.className = 'cm-code-collapsed-box';
    const show = button('cm-code-show-all', `Show all ${this.total.toLocaleString('en-US')} lines`, `Show all ${this.total.toLocaleString('en-US')} lines`);
    show.addEventListener('click', () => {
      const at = view.posAtDOM(frame);
      const fence = fenceAt(view.state, Math.max(0, at - 1));
      if (fence) view.dispatch({ effects: expandCode.of(fence.open.from) });
    });
    box.append(show);
    frame.append(box);
    return frame;
  }

  get estimatedHeight() { return 36; }

  ignoreEvent(event: Event) {
    return event.target instanceof Element && event.target.closest('button') !== null;
  }
}

const CALLOUT_LINE = /^(?:[ \t]*>[ \t]?)+\[![\w-]+\]/;

/** Where a block sits for a widget drawn in it: a quote or callout, and its list indent. */
function contextOf(state: EditorState, node: SyntaxNode): BlockContext {
  let quote: SyntaxNode | null = null;
  for (let at = node.parent; at; at = at.parent) if (at.name === 'Blockquote') quote = at;
  if (!quote) return null;
  return CALLOUT_LINE.test(state.doc.lineAt(quote.from).text) ? 'callout' : 'quote';
}

function collapseBlocks(state: EditorState, expanded: readonly number[]): Collapse {
  const blocks: CollapsedBlock[] = [];
  const widgets: ReturnType<Decoration['range']>[] = [];
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name !== 'FencedCode') return LEAF.has(ref.name) ? false : undefined;
      const fence = fenceOf(state, ref.node);
      const { lines } = fence;
      // Diagrams draw as pictures, so they never collapse.
      if (lines.length <= COLLAPSE_AFTER || expanded.includes(fence.open.from) || diagramFence(state, fence)) return false;
      const from = lines[COLLAPSE_AFTER].line.from;
      const to = lines[lines.length - 1].line.to;
      blocks.push({ from, to, block: fence.open.from });
      const widget = new ShowAllWidget(lines.length - COLLAPSE_AFTER, lines.length, fence.open.from, contextOf(state, ref.node), listIndent(ref.node));
      widgets.push(Decoration.replace({ widget, block: true }).range(from, to));
      return false;
    },
  });
  return { expanded, blocks, decorations: Decoration.set(widgets) };
}

const LEAF = new Set(['Paragraph', 'ATXHeading1', 'ATXHeading2', 'ATXHeading3', 'ATXHeading4', 'ATXHeading5', 'ATXHeading6', 'SetextHeading1', 'SetextHeading2', 'CodeBlock', 'HTMLBlock', 'CommentBlock', 'LinkReference', 'HorizontalRule', 'Table']);

/** A document's long blocks, collapsed until shown. View-only: nothing is written. */
const collapsedCode = StateField.define<Collapse>({
  create: (state) => collapseBlocks(state, []),
  update(value, tr) {
    let expanded = tr.docChanged ? value.expanded.map((at) => tr.changes.mapPos(at)) : value.expanded;
    let changed = tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state);
    for (const effect of tr.effects) {
      if (effect.is(expandCode)) {
        expanded = [...expanded, effect.value];
        changed = true;
      }
    }
    return changed ? collapseBlocks(tr.state, expanded) : value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/** The collapsed blocks of a document, for tests. */
export function collapsedBlocks(state: EditorState): readonly CollapsedBlock[] {
  return state.field(collapsedCode, false)?.blocks ?? [];
}

/** The collapsed block that `fence` is, if it is one. */
function collapsedOf(state: EditorState, fence: Fence): CollapsedBlock | null {
  return state.field(collapsedCode, false)?.blocks.find((block) => block.block === fence.open.from) ?? null;
}

/** A selection that lands in a collapsed block, as a search match does, shows all of it first. */
function expandForSelection(tr: Transaction): TransactionSpec | readonly TransactionSpec[] | null {
  if (!tr.selection || tr.docChanged) return null;
  const collapse = tr.startState.field(collapsedCode, false);
  if (!collapse || collapse.blocks.length === 0) return null;
  const { main } = tr.selection;
  const hit = collapse.blocks.find((block) => main.to >= block.from && main.from <= block.to);
  return hit ? [tr, { effects: expandCode.of(hit.block) }] : null;
}

// ---------------------------------------------------------------------------
// Drawing

const placeholder = Decoration.widget({ widget: new PlaceholderWidget(), side: 1 });
const diffSign = Decoration.mark({ class: 'cm-code-diff-sign' });
const openEnd = Decoration.widget({ widget: new OpenEndWidget(), side: 1 });

/** Where a block may sit on the page: lines from `from` to `to` that a caret can never stand inside. */
function fenceUnits(doc: Text, fence: Fence): TextRange[] {
  const { open, close, lines } = fence;
  const afterLine = (line: Line) => (line.to < doc.length ? line.to + 1 : line.to);
  const units: TextRange[] = [];
  const openFrom = open.number > 1 ? open.from - 1 : open.from;
  const openTo = lines.length > 0 ? lines[0].line.from : close ? afterLine(close) : open.to;
  units.push({ from: openFrom, to: openTo });
  if (close && lines.length > 0) units.push({ from: lines[lines.length - 1].line.to, to: afterLine(close) });
  return units;
}

/** A document's fenced block, in place. */
function drawInPlace(ctx: DecorateContext, fence: Fence): void {
  const { state } = ctx;
  const { doc } = state;
  const { open, close, lines } = fence;
  const language = fenceLanguage(fence.info.text);
  const { main } = state.selection;
  const end = (close ?? lines[lines.length - 1]?.line ?? open).to;
  const active = main.head >= open.from && main.head <= end;
  // A block that ends the page with the caret after it shows the caret on a line of its own below the box.
  const after = close !== null && close.to === doc.length && main.empty && main.head === doc.length;
  const indent = listIndent(fence.node);
  const style = indent ? `--code-indent: ${indent}em` : undefined;
  const shown = (line: Line) => line.to >= ctx.from && line.from <= ctx.to;
  // A diagram shown as its picture is drawn over the whole fence (diagrams.ts), one step for the caret.
  if (close && showsDiagram(state, fence)) {
    ctx.unit(open.number > 1 ? open.from - 1 : open.from, close.to < doc.length ? close.to + 1 : close.to);
    return;
  }
  for (const unit of fenceUnits(doc, fence)) ctx.unit(unit.from, unit.to);
  // A collapsed block's hidden lines are one step for the caret, together with the closing fence.
  const collapsed = collapsedOf(state, fence);
  if (collapsed) ctx.unit(lines[COLLAPSE_AFTER - 1].line.to, close && close.to < doc.length ? close.to + 1 : (close ?? lines[lines.length - 1].line).to);

  if (shown(open)) {
    ctx.lineClass(open.from, 'cm-code-line cm-code-head', style);
    ctx.hide(open.from, fence.node.from);
    ctx.out.push(Decoration.replace({ widget: new CodeHeaderWidget(language.label, language.quiet, active, diagramFence(state, fence) !== null) }).range(fence.node.from, open.to));
  }
  const diff = language.language?.id === 'diff';
  lines.forEach(({ line, from }, index) => {
    if (!shown(line) || (collapsed && index >= COLLAPSE_AFTER)) return;
    const last = index === lines.length - 1;
    const classes = ['cm-code-line'];
    if (collapsed && index === COLLAPSE_AFTER - 1) classes.push('cm-code-fade');
    if (last && (after || !close)) classes.push('cm-code-bottom');
    if (last && !close) classes.push('cm-code-unclosed');
    if (diff) {
      const kind = diffClass(doc.sliceString(from, line.to));
      classes.push(kind);
      if (kind === 'cm-code-diff-add') ctx.out.push(diffSign.range(from, from + 1));
    }
    ctx.lineClass(line.from, classes.join(' ').trim(), style);
    ctx.hide(line.from, from, true);
    if (lines.length === 1 && from === line.to && close) ctx.out.push(placeholder.range(line.to));
    if (last && !close) ctx.out.push(openEnd.range(line.to));
  });
  if (close && shown(close)) {
    ctx.lineClass(close.from, after ? 'cm-code-after' : 'cm-code-line cm-code-foot', after ? undefined : style);
    ctx.hide(close.from, close.to, true);
  }
}

/** A note's fenced block with a selection in it: its source, in the box. */
function drawSource(ctx: DecorateContext, fence: Fence): void {
  const first = fence.open;
  const last = fence.close ?? fence.lines[fence.lines.length - 1]?.line ?? first;
  for (let number = Math.max(first.number, ctx.state.doc.lineAt(ctx.from).number); number <= Math.min(last.number, ctx.state.doc.lineAt(ctx.to).number); number += 1) {
    const line = ctx.state.doc.line(number);
    ctx.lineClass(line.from, `cm-md-codeblock${number === first.number ? ' cm-md-codeblock-first' : ''}${number === last.number ? ' cm-md-codeblock-last' : ''}`);
  }
}

/** An indented code block: its lines in the box, without their four-space indent while no selection is in it. */
function drawIndented(ctx: DecorateContext, node: SyntaxNode): void {
  const { doc } = ctx.state;
  const first = doc.lineAt(node.from);
  const last = lastLine(doc, node);
  const indented = ctx.docMode || !ctx.reveal.lines(node.from, node.to);
  for (let number = Math.max(first.number, doc.lineAt(ctx.from).number); number <= Math.min(last.number, doc.lineAt(ctx.to).number); number += 1) {
    const line = doc.line(number);
    const edges = `${number === first.number ? ' cm-md-codeblock-first' : ''}${number === last.number ? ' cm-md-codeblock-last' : ''}`;
    ctx.lineClass(line.from, ctx.docMode ? `cm-code-line cm-code-indented${edges}` : `cm-md-codeblock${edges}`);
    if (indented) ctx.hide(line.from, line.from + (/^(?: {1,4}|\t)/.exec(line.text)?.[0].length ?? 0), true);
  }
}

const codeDecorator = nodeDecorators.of({
  nodes: ['FencedCode', 'CodeBlock'],
  decorate(ctx, node) {
    if (ctx.covered(node.from)) return true;
    if (node.name === 'CodeBlock') drawIndented(ctx, node);
    else if (ctx.docMode) drawInPlace(ctx, fenceOf(ctx.state, node));
    else drawSource(ctx, fenceOf(ctx.state, node));
    return true;
  },
});

/** A note draws a fenced block as a box; a document leaves it to the lines above. */
const codeRenderer = blockRenderers.of({
  nodes: ['FencedCode'],
  widget(state, node, from, _to, layout) {
    if (state.facet(docMode)) return null;
    const fence = fenceOf(state, node);
    const kind = diagramFence(state, fence);
    if (kind) return new DiagramWidget(codeText(state, fence), kind, kind === 'mermaid' ? 'Mermaid' : 'Flowchart', layout.context, layout.indent, false);
    return new CodeBlockWidget(
      state.sliceDoc(from, _to),
      codeText(state, fence),
      fence.lines.map((line) => line.from - from),
      fenceLanguage(fence.info.text),
      layout.context,
      layout.indent,
    );
  },
});

/** A language finished loading: highlighting draws again. */
const languageLoaded = StateEffect.define<null>();

/**
 * The colours of code on the page: each fence in view is parsed with its
 * language and its ranges drawn as marks. A note's drawn box colours itself.
 */
const highlightPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  stop: () => void;

  constructor(view: EditorView) {
    this.decorations = this.read(view);
    const redraw = () => {
      if (view.dom.isConnected) view.dispatch({ effects: languageLoaded.of(null) });
    };
    const stopLanguages = onLanguageLoaded(redraw);
    const stopReady = onHighlightReady(redraw);
    this.stop = () => { stopLanguages(); stopReady(); };
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)
      || update.transactions.some((tr) => tr.effects.some((effect) => effect.is(languageLoaded)))
      || (!update.state.facet(docMode) && update.selectionSet)) {
      this.decorations = this.read(update.view);
    }
  }

  read(view: EditorView): DecorationSet {
    const { state } = view;
    const marks: ReturnType<Decoration['range']>[] = [];
    for (const { from, to } of view.visibleRanges) {
      syntaxTree(state).iterate({
        from,
        to,
        enter: (ref) => {
          if (ref.name !== 'FencedCode') return;
          if (drawnBlockAt(state, ref.from)) return false;
          const fence = fenceOf(state, ref.node);
          if (showsDiagram(state, fence)) return false;
          const language = fenceLanguage(fence.info.text).language;
          if (!language || fence.lines.length === 0) return false;
          const code = codeText(state, fence);
          const found = highlightMarks(code, language);
          let offset = 0;
          for (const { line, from: start } of fence.lines) {
            const length = line.to - start;
            if (line.to >= from && line.from <= to) {
              for (let index = firstMarkAfter(found, offset); index < found.length && found[index].from < offset + length; index += 1) {
                const mark = found[index];
                const markFrom = start + Math.max(mark.from, offset) - offset;
                const markTo = start + Math.min(mark.to, offset + length) - offset;
                if (markTo > markFrom) marks.push(Decoration.mark({ class: mark.className }).range(markFrom, markTo));
              }
            }
            offset += length + 1;
          }
          return false;
        },
      });
    }
    return Decoration.set(marks, true);
  }

  destroy() {
    this.stop();
  }
}, { decorations: (plugin) => plugin.decorations });

/** A framed block's look: a ring around its lines. */
const framedLines = EditorView.decorations.compute([objectFrame], (state): DecorationSet => {
  const frame = state.field(objectFrame, false);
  if (!frame || frame.kind !== 'code') return Decoration.none;
  const lines: ReturnType<Decoration['range']>[] = [];
  for (let at = frame.from; at <= frame.to;) {
    const line = state.doc.lineAt(at);
    lines.push(Decoration.line({ class: 'cm-code-framed' }).range(line.from));
    at = line.to + 1;
  }
  return Decoration.set(lines);
});

/** The block's lines while the pointer is over them, so its header shows Copy. */
const hoverHeader = EditorView.domEventObservers({
  mouseover(event, view) {
    const target = event.target instanceof Element ? event.target.closest('.cm-code-line') : null;
    const current = view.contentDOM.querySelector('.cm-code-header[data-hover]');
    let head: Element | null = target;
    while (head && !head.classList.contains('cm-code-head')) {
      head = head.previousElementSibling;
      if (head && !head.classList.contains('cm-code-line')) head = null;
    }
    const header = head?.querySelector('.cm-code-header') ?? null;
    if (current === header) return;
    current?.removeAttribute('data-hover');
    header?.setAttribute('data-hover', 'true');
  },
  mouseleave(_event, view) {
    view.contentDOM.querySelector('.cm-code-header[data-hover]')?.removeAttribute('data-hover');
  },
});

// ---------------------------------------------------------------------------
// Protected ranges: code keeps its bytes under Bold, Clear and the other range commands.

const codeRanges = protectedRanges.of((state, from, to) => {
  const ranges: TextRange[] = [];
  latestTree(state).iterate({
    from,
    to,
    enter: (ref) => {
      if (ref.name === 'FencedCode' || ref.name === 'CodeBlock') {
        ranges.push({ from: state.doc.lineAt(ref.from).from, to: lastLine(state.doc, ref.node).to });
        return false;
      }
      if (ref.name === 'InlineCode') {
        // Inline code alone on its line stays out, so the line can still become a heading or a list item.
        const line = state.doc.lineAt(ref.from);
        if (!(state.sliceDoc(line.from, ref.from).trim() === '' && state.sliceDoc(ref.to, line.to).trim() === '')) ranges.push({ from: ref.from, to: ref.to });
        return false;
      }
      return undefined;
    },
  });
  return ranges;
});

// ---------------------------------------------------------------------------
// The code object: a click on the header frames the block.

/** The language word Opal writes for `id`, over the info string's first word. */
export function setLanguage(view: EditorView, at: number, id: string): void {
  const fence = fenceAt(view.state, at);
  if (!fence) return;
  const word = fenceLanguage(fence.info.text).word;
  const start = fence.info.text.length > 0 ? fence.info.from + fence.info.text.indexOf(word) : fence.info.from;
  const from = word ? start : fence.info.from;
  const to = word ? start + word.length : fence.info.from;
  const insert = word || fence.info.text.length === 0 ? id : `${id} `;
  if (view.state.sliceDoc(from, to) === insert) return;
  view.dispatch({ changes: { from, to, insert }, userEvent: 'input' });
}

function languageActions(state: EditorState, obj: PageObject): ObjectAction[] {
  const fence = fenceAt(state, obj.to);
  const current = fence ? fenceLanguage(fence.info.text) : null;
  const pick = (id: string) => (view: EditorView, target: PageObject) => setLanguage(view, target.to, id);
  const mark = (on: boolean, label: string) => (on ? `${label} ✓` : label);
  return [
    { id: 'text', label: mark(Boolean(current?.quiet), 'Plain text'), run: pick('text') },
    ...CODE_LANGUAGES.map((language) => ({ id: language.id, label: mark(current?.language?.id === language.id, language.label), run: pick(language.id) })),
  ];
}

/** Where a block's code starts: the first code line, or the line after the header. */
function codeStartOf(state: EditorState, obj: PageObject): number {
  const fence = fenceAt(state, obj.to);
  return fence?.lines[0]?.from ?? obj.to;
}

const codeKind = objectKinds.of({
  kind: 'code',
  nodes: ['FencedCode'],
  block: true,
  test: (state, node) => !showsDiagram(state, fenceOf(state, node)),
  open: (view, obj) => view.dispatch({ selection: { anchor: codeStartOf(view.state, obj) }, scrollIntoView: true }),
  actions: (state, obj) => [
    { id: 'copy', label: 'Copy', icon: Copy, run: (view, target) => { copyCode(view, target.to); } },
    { id: 'language', label: 'Language', items: languageActions(state, obj) },
    { id: 'remove', label: 'Remove', icon: Trash2, run: (view, target) => removeObject(view, target, -1, 'delete') },
  ],
  destination: (state, obj) => {
    const fence = fenceAt(state, obj.to);
    return fence ? fenceLanguage(fence.info.text).label : null;
  },
});

// ---------------------------------------------------------------------------
// Typing ``` and Enter

/** Right after Enter made a block from a typed fence: the block's span, and the line it was. */
interface MadeFence {
  from: number;
  to: number;
  caret: number;
  text: string;
}

const setMadeFence = StateEffect.define<MadeFence | null>();

const madeFence = StateField.define<MadeFence | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setMadeFence)) return effect.value;
    return tr.docChanged || tr.selection ? null : value;
  },
});

// A line holding a fence typed as text: its container, the escaped marks, then an info string.
const TYPED_FENCE = /^((?:[ \t]*>[ \t]?)*[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?)((?:\\?`){3,}|(?:\\?~){3,})([^`\n]*)$/;

/** The container a line's text starts after: quote marks and a list item's indent. */
function containerOf(state: EditorState, line: Line): string {
  const quote = /^(?:[ \t]*>[ \t]?)*/.exec(line.text)?.[0] ?? '';
  const node = latestTree(state).resolveInner(line.from + quote.length, 1);
  const item = within(node, 'ListItem') ?? (node.name === 'ListItem' ? node : null);
  if (!item) return quote;
  const mark = item.getChild('ListMark');
  if (!mark) return quote;
  const markLine = state.doc.lineAt(mark.from);
  const after = /^[ \t]*/.exec(state.sliceDoc(mark.to, markLine.to))?.[0].length ?? 0;
  const column = mark.to + Math.max(1, Math.min(after, 4)) - markLine.from - quotePrefix(markLine.text);
  return quote + ' '.repeat(Math.max(0, column));
}

/** Enter on a line holding a typed fence: both fences, with the caret on an empty line between them. */
const makeFence: Command = (view) => {
  const { state } = view;
  const { main } = state.selection;
  if (!main.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(main.head);
  if (main.head !== line.to) return false;
  const match = TYPED_FENCE.exec(line.text);
  if (!match || fenceAt(state, line.from)) return false;
  const marker = match[2].replace(/\\/g, '');
  const container = match[1];
  // Lines after a list marker's line line up with the item's text.
  const blank = container.replace(/(?:[-+*]|\d+[.)])[ \t]+$/, (mark) => ' '.repeat(mark.length));
  const text = `${container}${marker}${match[3].trimEnd()}\n${blank}\n${blank}${marker}`;
  const caret = line.from + container.length + marker.length + match[3].trimEnd().length + 1 + blank.length;
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: text },
    selection: { anchor: caret },
    effects: setMadeFence.of({ from: line.from, to: line.from + text.length, caret, text: line.text }),
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
};

/** Backspace right after Enter made a block: the typed line again, with the caret at its end. */
const unmakeFence: Command = (view) => {
  const made = view.state.field(madeFence, false);
  const { main } = view.state.selection;
  if (!made || !main.empty || main.head !== made.caret) return false;
  view.dispatch({
    changes: { from: made.from, to: made.to, insert: made.text },
    selection: { anchor: made.from + made.text.length },
    effects: setMadeFence.of(null),
    scrollIntoView: true,
    userEvent: 'delete.backward',
  });
  return true;
};

// ---------------------------------------------------------------------------
// Keys in code

/** The caret stop after a block: the next line's start, or the page's end when the block ends the page. */
function stopAfter(state: EditorState, fence: Fence): number | null {
  if (!fence.close) return null;
  return fence.close.to < state.doc.length ? fence.close.to + 1 : fence.close.to;
}

const leaveBlock: Command = (view) => {
  const { main } = view.state.selection;
  const inside = codeAt(view.state, main.head);
  if (!inside) return false;
  const stop = stopAfter(view.state, inside.fence);
  if (stop === null) return false;
  view.dispatch({ selection: { anchor: stop }, scrollIntoView: true, userEvent: 'select' });
  return true;
};

/** ArrowDown on a block's last line leaves the block; on a wrapped line it first moves within it. */
const arrowDown: Command = (view) => {
  const { main } = view.state.selection;
  if (!main.empty) return false;
  const inside = codeAt(view.state, main.head);
  if (!inside || inside.index !== inside.fence.lines.length - 1) return false;
  const line = inside.fence.lines[inside.index].line;
  const moved = view.moveVertically(main, true);
  if (moved.head > main.head && moved.head <= line.to) return false;
  return leaveBlock(view);
};

/** Enter in code: a new code line that keeps the container's quote marks and indent and the line's own indent. */
const codeEnter: Command = (view) => {
  const { state } = view;
  const inside = codeAt(state, state.selection.main.from);
  if (!inside || state.selection.ranges.length > 1) return false;
  const { line, from } = inside.fence.lines[inside.index];
  const own = /^[ \t]*/.exec(state.sliceDoc(from, line.to))?.[0] ?? '';
  // A blank line may have lost its container's indent; the new line takes the block's.
  const container = state.sliceDoc(line.from, from);
  const insert = `\n${container.length >= inside.fence.prefix.length ? container : inside.fence.prefix}${own}`;
  view.dispatch(state.replaceSelection(insert), { scrollIntoView: true, userEvent: 'input' });
  return true;
};

/** The block's own indent: a tab when its lines use tabs, else the smallest run of 2 or 4 spaces. */
function indentUnitOf(state: EditorState, fence: Fence): string {
  let smallest = 0;
  for (const { line, from } of fence.lines) {
    const own = /^[ \t]*/.exec(state.sliceDoc(from, line.to))?.[0] ?? '';
    if (own.startsWith('\t')) return '\t';
    if (own.length > 0 && (smallest === 0 || own.length < smallest)) smallest = own.length;
  }
  return smallest === 2 || smallest === 3 ? '  ' : '    ';
}

/** Tab and Shift+Tab in code: at a caret one indent; over lines, indent or outdent each. */
function codeIndent(more: boolean): Command {
  return (view) => {
    const { state } = view;
    const { main } = state.selection;
    const start = codeAt(state, main.from);
    const end = codeAt(state, main.to);
    if (!start || !end || start.fence.node.from !== end.fence.node.from) return false;
    const { fence } = start;
    const unit = indentUnitOf(state, fence);
    if (main.empty && more) {
      view.dispatch(state.replaceSelection(unit), { scrollIntoView: true, userEvent: 'input.indent' });
      return true;
    }
    const changes: ChangeSpec[] = [];
    for (let index = start.index; index <= end.index; index += 1) {
      const { line, from } = fence.lines[index];
      if (more) {
        if (line.to > from) changes.push({ from, insert: unit });
        continue;
      }
      const own = /^[ \t]*/.exec(state.sliceDoc(from, line.to))?.[0] ?? '';
      const take = own.startsWith('\t') ? 1 : Math.min(own.length, unit === '\t' ? 4 : unit.length);
      if (take > 0) changes.push({ from, to: from + take });
    }
    if (changes.length > 0) view.dispatch({ changes, scrollIntoView: true, userEvent: more ? 'input.indent' : 'delete.dedent' });
    return true;
  };
}

/** Cmd+A in code: first the code, then the page. */
const selectCode: Command = (view) => {
  const { state } = view;
  const { main } = state.selection;
  const inside = codeAt(state, main.from);
  if (!inside) return false;
  const { lines } = inside.fence;
  const from = lines[0].from;
  const to = lines[lines.length - 1].line.to;
  if (main.from === from && main.to === to) return false;
  if (codeAt(state, main.to)?.fence.node.from !== inside.fence.node.from) return false;
  view.dispatch({ selection: EditorSelection.range(from, to), userEvent: 'select' });
  return true;
};

/** Backspace at the start of indented code: a later line joins the line above, and the first line stays. */
const indentedBackspace: Command = (view) => {
  const { state } = view;
  const { main } = state.selection;
  if (!main.empty) return false;
  const block = indentedAt(state, main.head);
  if (!block) return false;
  const line = state.doc.lineAt(main.head);
  if (!/^[ \t]*$/.test(state.sliceDoc(line.from, main.head))) return false;
  if (state.doc.lineAt(block.from).number === line.number) return true;
  view.dispatch({ changes: { from: line.from - 1, to: main.head }, scrollIntoView: true, userEvent: 'delete.backward' });
  return true;
};

/** Formatting keys do nothing in a code block. */
const inCode: Command = (view) => inCodeBlock(view.state);

// ---------------------------------------------------------------------------
// Backspace and Delete next to code

/** The fenced block whose last line is `line`, when it is closed. */
function fenceEndingOn(state: EditorState, line: Line): Fence | null {
  const fence = fenceAt(state, line.to);
  return fence?.close && fence.close.number === line.number ? fence : null;
}

/** The fenced block whose opening line is `line`. */
function fenceOpeningOn(state: EditorState, line: Line): Fence | null {
  const fence = fenceAt(state, line.from + quotePrefix(line.text));
  return fence && fence.open.number === line.number ? fence : null;
}

const blankText = (line: Line) => /^[\s>]*$/.test(line.text);

/** Takes an empty block out, both fences and its one line, leaving an empty line of its container. */
function removeEmptyBlock(view: EditorView, fence: Fence): boolean {
  const { open, close } = fence;
  if (!close) return false;
  const blank = fence.prefix.trimEnd();
  view.dispatch({ changes: { from: open.from, to: close.to, insert: blank }, selection: { anchor: open.from + blank.length }, scrollIntoView: true, userEvent: 'delete' });
  return true;
}

function codeDelete(view: EditorView, dir: -1 | 1): boolean {
  const { state } = view;
  if (!state.facet(docMode) || state.selection.ranges.length > 1) return false;
  const { main } = state.selection;
  if (!main.empty) return false;
  const at = main.head;
  const line = state.doc.lineAt(at);
  const inside = codeAt(state, at);
  if (inside) {
    const { fence, index } = inside;
    const empty = fence.lines.length === 1 && fence.lines[0].from === fence.lines[0].line.to;
    if (dir < 0 && index === 0 && at === fence.lines[0].from) return empty ? removeEmptyBlock(view, fence) : true;
    const last = fence.lines[fence.lines.length - 1];
    if (dir > 0 && index === fence.lines.length - 1 && at === last.line.to) return empty ? removeEmptyBlock(view, fence) : true;
    return false;
  }
  const indented = indentedAt(state, at);
  if (indented && dir < 0 && state.doc.lineAt(indented.from).number === line.number && /^[ \t]*$/.test(state.sliceDoc(line.from, at))) return true;
  // Backspace at the start of the line after a block: an empty line goes, a text line's caret moves into the code.
  if (dir < 0 && line.number > 1 && /^[\s>]*$/.test(state.sliceDoc(line.from, at))) {
    const fence = fenceEndingOn(state, state.doc.line(line.number - 1));
    if (fence && !showsDiagram(state, fence)) {
      const end = fence.lines.length > 0 ? fence.lines[fence.lines.length - 1].line.to : null;
      if (blankText(line)) {
        view.dispatch({ changes: { from: fence.close?.to ?? line.from - 1, to: line.to }, selection: { anchor: end ?? fence.open.from }, scrollIntoView: true, userEvent: 'delete.backward' });
      } else if (end !== null) {
        view.dispatch({ selection: { anchor: end }, scrollIntoView: true, userEvent: 'select' });
      }
      return true;
    }
  }
  // Delete at the end of the line before a block: an empty line goes, a text line's caret moves into the code.
  if (dir > 0 && at === line.to && line.number < state.doc.lines) {
    const fence = fenceOpeningOn(state, state.doc.line(line.number + 1));
    if (fence && !showsDiagram(state, fence)) {
      const start = fence.lines[0]?.from ?? null;
      if (blankText(line)) {
        view.dispatch({ changes: { from: line.from, to: line.to + 1 }, selection: { anchor: start === null ? line.from : start - (line.length + 1) }, scrollIntoView: true, userEvent: 'delete.forward' });
      } else if (start !== null) {
        view.dispatch({ selection: { anchor: start }, scrollIntoView: true, userEvent: 'select' });
      }
      return true;
    }
  }
  return false;
}

const codeDeletes = deleteHandlers.of({ priority: 20, run: (view, dir) => codeDelete(view, dir) });

// ---------------------------------------------------------------------------
// Edits next to fences

/** The fence lines of blocks a range touches but does not hold whole: what a deletion keeps. */
function keptFenceSpans(state: EditorState, from: number, to: number): TextRange[] {
  const spans: TextRange[] = [];
  latestTree(state).iterate({
    from,
    to,
    enter: (ref) => {
      if (ref.name !== 'FencedCode') return undefined;
      const fence = fenceOf(state, ref.node);
      const blockFrom = fence.open.from;
      const blockTo = (fence.close ?? lastLine(state.doc, ref.node)).to;
      if (from <= blockFrom && to >= blockTo) return false;
      spans.push({ from: fence.open.from, to: Math.min(state.doc.length, fence.open.to + 1) });
      if (fence.close) spans.push({ from: Math.max(0, fence.close.from - 1), to: fence.close.to });
      return false;
    },
  });
  return spans;
}

/** `from` to `to` without `spans`, as the pieces left. */
function without(from: number, to: number, spans: readonly TextRange[]): TextRange[] {
  let pieces = [{ from, to }];
  for (const span of spans) {
    pieces = pieces.flatMap((piece) => {
      if (span.to <= piece.from || span.from >= piece.to) return [piece];
      return [{ from: piece.from, to: Math.max(piece.from, span.from) }, { from: Math.min(piece.to, span.to), to: piece.to }].filter((part) => part.to > part.from);
    });
  }
  return pieces;
}

/**
 * A user's edit in a document rewritten so fences stay whole: a deletion
 * over part of a block keeps its fence lines; text typed before a block
 * that starts the page, or after one that ends it, brings a line break; and
 * a typed third backtick at a line's start is written escaped, so the page
 * below never turns into code before Enter makes the block.
 */
// The user's own edits; Opal's commands that rewrite a fence on purpose use plain "input" or "delete".
const GUARDED = ['input.type', 'input.paste', 'input.drop', 'delete.backward', 'delete.forward', 'delete.selection', 'delete.cut'];

function guardFences(tr: Transaction): TransactionSpec | null {
  if (!tr.docChanged || !GUARDED.some((event) => tr.isUserEvent(event)) || tr.isUserEvent('input.type.compose')) return null;
  const state = tr.startState;
  const edits: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => edits.push({ from: fromA, to: toA, insert: inserted.toString() }));
  if (edits.length !== 1) return null;
  const { from, to, insert } = edits[0];
  const userEvent = tr.annotation(Transaction.userEvent);

  if (to > from) {
    const spans = keptFenceSpans(state, from, to);
    if (spans.length === 0) return null;
    const pieces = without(from, to, spans);
    if (pieces.length === 1 && pieces[0].from === from && pieces[0].to === to) return null;
    const changes: ChangeSpec[] = pieces.map((piece, index) => ({ ...piece, insert: index === 0 ? insert : '' }));
    if (pieces.length === 0) changes.push({ from: spans[0].to, insert });
    const caret = (pieces[0]?.from ?? spans[0].to) + insert.length;
    const next = state.update({ changes, filter: false });
    return { changes, selection: { anchor: next.changes.mapPos(caret, -1) }, scrollIntoView: true, userEvent };
  }
  if (!insert || insert === '\n') return null;
  const line = state.doc.lineAt(from);
  // A blank line in a list item's code often has no indent; typed text brings it, so the item and its code go on.
  const inside = codeAt(state, from);
  if (inside && !insert.startsWith('\n')) {
    const have = state.sliceDoc(line.from, from);
    const { prefix } = inside.fence;
    if (from === line.to && have.length < prefix.length && prefix.startsWith(have) && /^[\s>]*$/.test(line.text)) {
      const extra = prefix.slice(have.length);
      return { changes: { from, insert: extra + insert }, selection: { anchor: from + extra.length + insert.length }, scrollIntoView: true, userEvent };
    }
  }
  // Before a block that starts the page.
  if (from === 0 && fenceOpeningOn(state, line)) {
    return { changes: { from: 0, insert: `${insert}\n` }, selection: { anchor: insert.length }, scrollIntoView: true, userEvent };
  }
  // After a block that ends the page.
  if (from === state.doc.length && fenceEndingOn(state, line)) {
    return { changes: { from, insert: `\n${insert}` }, selection: { anchor: from + 1 + insert.length }, scrollIntoView: true, userEvent };
  }
  // A third backtick or tilde at a line's start, outside code.
  if (tr.isUserEvent('input.type') && /^[`~]+$/.test(insert)) {
    const after = tr.newDoc.lineAt(from + insert.length);
    const match = /^((?:[ \t]*>[ \t]?)*[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?)(`{3,}|~{3,})/.exec(after.text);
    if (match && !fenceAt(state, from) && !indentedAt(state, from)) {
      const runFrom = after.from + match[1].length;
      if (from + insert.length > runFrom && from <= runFrom + match[2].length) {
        const start = state.doc.lineAt(from).from + match[1].length;
        return {
          changes: [{ from: start, insert: '\\' }, { from, insert }],
          selection: { anchor: from + insert.length + 1 },
          scrollIntoView: true,
          userEvent,
        };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Copy inside code

/** The selected code without quote marks or the block's indent, when the selection is inside one block's code. */
export function copiedCode(state: EditorState): string | null {
  const { main } = state.selection;
  if (main.empty || state.selection.ranges.length > 1) return null;
  const start = codeAt(state, main.from);
  const end = codeAt(state, main.to);
  if (!start || !end || start.fence.node.from !== end.fence.node.from) return null;
  const { fence } = start;
  // Without quote marks or an indent, the page's own copy gives the same text.
  if (fence.prefix === '') return null;
  const parts: string[] = [];
  for (let index = start.index; index <= end.index; index += 1) {
    const { line, from } = fence.lines[index];
    parts.push(state.sliceDoc(Math.max(from, index === start.index ? main.from : from), index === end.index ? main.to : line.to));
  }
  return parts.join('\n');
}

const copyEvents = EditorView.domEventHandlers({
  copy(event, view) {
    const text = copiedCode(view.state);
    if (text === null || !event.clipboardData) return false;
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
    return true;
  },
  cut(event, view) {
    const text = copiedCode(view.state);
    if (text === null || !event.clipboardData || view.state.readOnly) return false;
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
    view.dispatch(view.state.replaceSelection(''), { userEvent: 'delete.cut', scrollIntoView: true });
    return true;
  },
});

// ---------------------------------------------------------------------------
// Making code blocks

/** The longest run of `character` at the start of any of `lines`, after their container. */
function longestFence(lines: readonly string[], character: string): number {
  let longest = 0;
  for (const text of lines) {
    const run = new RegExp(`^[\\s>]*(\\${character}+)`).exec(text)?.[1].length ?? 0;
    longest = Math.max(longest, run);
  }
  return longest;
}

/**
 * Cmd+Option+C, Style > Code block and Insert > Code block: the selected
 * lines become a code block, or stop being one when the caret is in a block.
 * An empty line gets an empty block with the caret in it.
 */
export const toggleCodeBlock: Command = (view) => {
  const { state } = view;
  if (state.readOnly) return false;
  const { main } = state.selection;
  const inside = fenceAt(state, main.from);
  if (inside && inside.close) {
    const { open, close, lines } = inside;
    // Unwrap: the fences go and the code lines stay as they are.
    const changes: ChangeSpec[] = [{ from: open.from, to: Math.min(state.doc.length, open.to + 1) }, { from: Math.max(0, close.from - 1), to: close.to }];
    if (lines.length === 0) changes.splice(1, 1, { from: close.from, to: close.to });
    view.dispatch({ changes, scrollIntoView: true, userEvent: 'input' });
    return true;
  }
  const first = state.doc.lineAt(main.from);
  const last = state.doc.lineAt(main.empty || main.to > state.doc.lineAt(main.to).from ? main.to : Math.max(main.from, main.to - 1));
  const container = containerOf(state, first);
  const texts: string[] = [];
  for (let number = first.number; number <= last.number; number += 1) texts.push(state.doc.line(number).text);
  const marker = '`'.repeat(Math.max(3, longestFence(texts, '`') + 1));
  const empty = first.number === last.number && blankText(first);
  if (empty) {
    const insert = `${container}${marker}\n${container}\n${container}${marker}`;
    view.dispatch({ changes: { from: first.from, to: first.to, insert }, selection: { anchor: first.from + container.length + marker.length + 1 + container.length }, scrollIntoView: true, userEvent: 'input' });
    return true;
  }
  const changes: ChangeSpec[] = [{ from: first.from, insert: `${container}${marker}\n` }, { from: last.to, insert: `\n${container}${marker}` }];
  view.dispatch({ changes, scrollIntoView: true, userEvent: 'input' });
  return true;
};

const insertCodeBlock = insertItems.of({ id: 'code-block', label: 'Code block', icon: SquareCode, shortcut: '⌥⌘C', order: 30, run: (view) => { toggleCodeBlock(view); view.focus(); } });

// ---------------------------------------------------------------------------
// Extensions

/** Code in every page: drawing, colours and protection. */
export const codeBlocks: Extension = [codeDecorator, codeRenderer, codeRanges, highlightPlugin, copyEvents, inlineCode];

/** Cmd+K or the Link button on inline code: the link goes around the whole span, so the selection takes it in first. True in a code block, where links do not apply. */
export function linkAroundCode(view: EditorView): boolean {
  const { state } = view;
  if (inCodeBlock(state)) return true;
  const { main } = state.selection;
  const { from, to } = outsideProtected(state, main.from, main.to);
  if (from !== main.from || to !== main.to) view.dispatch({ selection: EditorSelection.range(from, to) });
  return false;
}

/** A document's code: the object, its keys and the guards around fences. */
export function codeDocExtension({ toggleInline, editLink }: { toggleInline: StateCommand; editLink: Command }): Extension {
  return [
    codeKind,
    diagramDocExtension,
    codeDeletes,
    insertCodeBlock,
    madeFence,
    framedLines,
    hoverHeader,
    collapsedCode,
    inlineCodeDoc,
    // Filters run lowest precedence first, so these run before doc mode settles the caret.
    Prec.low(EditorState.transactionFilter.of((tr) => guardFences(tr) ?? expandForSelection(tr) ?? tr)),
    Prec.highest(keymap.of([
      { key: 'Enter', run: (view) => makeFence(view) || codeEnter(view) },
      { key: 'Backspace', run: (view) => unmakeFence(view) || indentedBackspace(view) },
      { key: 'Tab', run: codeIndent(true) },
      { key: 'Shift-Tab', run: codeIndent(false) },
      { key: 'Mod-a', run: selectCode },
      { key: 'Escape', run: leaveBlock },
      { key: 'ArrowDown', run: arrowDown },
      { key: 'Mod-Enter', run: leaveBlock },
      { key: 'Mod-e', run: (view) => inCode(view) || toggleInline(view) },
      { key: 'Mod-k', run: (view) => linkAroundCode(view) || editLink(view) },
      { key: 'Mod-Alt-c', run: toggleCodeBlock },
      { key: 'Alt-F10', run: focusHeader },
      { key: 'Ctrl-Alt-t', run: focusHeader },
      ...['Mod-b', 'Mod-i', 'Mod-Shift-x', 'Mod-Shift-7', 'Mod-Shift-8', 'Mod-Shift-9', ...[0, 1, 2, 3, 4, 5, 6].map((level) => `Mod-Alt-${level}`)]
        .map((key) => ({ key, run: inCode })),
    ])),
  ];
}
