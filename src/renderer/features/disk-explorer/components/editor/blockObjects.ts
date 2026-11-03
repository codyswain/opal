import { EditorState, Prec, Transaction, type Extension, type Line, type TransactionSpec } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { ensureSyntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { Copy, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { calloutMarker } from './blockGuards';
import { deleteHandlers, latestTree, objectAt, objectKinds, objectOf, objectKind, type ObjectAction, type ObjectKind, type PageObject } from './extensionPoints';
import { docMode, drawnBlockAt, setOpenBlock } from './livePreview';
import { objectFrame, removeObject, setFrame } from './objectFrame';
import './blocks.css';

/*
 * Tables, rules, HTML blocks and drawn code blocks as objects in a
 * document: framed on the first Backspace or Delete beside them, removed on
 * a second press, with Edit, Copy as Markdown and Remove in their bar. Text
 * typed or pasted next to a table or rule starts a paragraph of its own, so
 * it never becomes a table row, a setext underline or part of the block.
 */

/** The line a node ends on; a node that ends at a line break belongs to the line before it. */
function lastLineOf(state: EditorState, node: { from: number; to: number }): Line {
  const line = state.doc.lineAt(node.to);
  return line.from === node.to && node.to > node.from ? state.doc.lineAt(node.to - 1) : line;
}

/** Where a table's first cell's text starts, or the table's start. */
function firstCell(state: EditorState, obj: PageObject): number {
  const line = state.doc.lineAt(obj.from);
  const match = /^[\s>]*\|?[ \t]*/.exec(line.text);
  return line.from + (match?.[0].length ?? 0);
}

/** Shows a table's or code block's Markdown, with the caret in its first cell or line. */
export function openSource(view: EditorView, obj: PageObject): void {
  const at = obj.kind === 'table' ? firstCell(view.state, obj) : view.state.doc.lineAt(obj.from).to;
  view.dispatch({ selection: { anchor: at }, effects: [setFrame.of(null), setOpenBlock.of({ from: obj.from, to: obj.to })], scrollIntoView: true });
  view.focus();
}

function copyMarkdown(view: EditorView, obj: PageObject): void {
  const markdown = view.state.sliceDoc(obj.from, obj.to);
  void navigator.clipboard?.writeText(markdown).then(() => toast('Copied as Markdown'), () => toast.error('Could not copy.'));
}

const remove: ObjectAction = { id: 'remove', label: 'Remove', icon: Trash2, run: (view, obj) => removeObject(view, obj, -1, 'delete.selection') };
const copy: ObjectAction = { id: 'copy', label: 'Copy as Markdown', icon: Copy, run: copyMarkdown };

// A wiki link's alias pipe, unescaped, which splits a table cell in two.
const WIKI_PIPE = /\[\[[^\]\n|]*?(?<!\\)\|[^\]\n]*?\]\]/g;

/** Where the unescaped alias pipes of wiki links in a table are. */
export function splitLinks(state: EditorState, obj: PageObject): number[] {
  const text = state.sliceDoc(obj.from, obj.to);
  return [...text.matchAll(WIKI_PIPE)].map((match) => obj.from + (match.index ?? 0) + match[0].indexOf('|'));
}

/** Writes one backslash before each such pipe, so each link is one cell again. */
function fixLinks(view: EditorView, obj: PageObject): void {
  const pipes = splitLinks(view.state, obj);
  if (pipes.length > 0) view.dispatch({ changes: pipes.map((at) => ({ from: at, insert: '\\' })), userEvent: 'input' });
}

const tableKind: ObjectKind = {
  kind: 'table',
  nodes: ['Table'],
  block: true,
  open: openSource,
  actions: (state, obj) => [
    { id: 'edit', label: 'Edit', run: openSource },
    ...(splitLinks(state, obj).length > 0 ? [{ id: 'fix-links', label: 'Fix links', run: fixLinks }] : []),
    copy,
    remove,
  ],
};

const ruleKind: ObjectKind = {
  kind: 'horizontal rule',
  nodes: ['HorizontalRule'],
  block: true,
  open: () => undefined,
  destination: () => 'Horizontal line',
  actions: () => [remove],
};

const htmlKind: ObjectKind = {
  kind: 'HTML block',
  nodes: ['HTMLBlock'],
  block: true,
  open: () => undefined,
  actions: () => [copy, remove],
};

/** Code blocks drawn as one block, until code is edited in place and registers its own kind. */
const codeKind: ObjectKind = {
  kind: 'code block',
  nodes: ['FencedCode'],
  block: true,
  open: openSource,
  actions: () => [{ id: 'edit', label: 'Edit', run: openSource }, copy, remove],
};

/** Tables and rules, which typed text must never join. */
const SEPARATED = new Set(['Table', 'HorizontalRule']);

interface Separated {
  node: SyntaxNode;
  first: Line;
  last: Line;
}

/** The table or rule that `line` is the first (`edge` 1) or last (-1) line of, when the page draws it. */
function blockOn(state: EditorState, line: Line, edge: -1 | 1): Separated | null {
  const tree = latestTree(state);
  const at = edge < 0 ? line.to : line.from + (/^[\s>]*/.exec(line.text)?.[0].length ?? 0);
  for (let node: SyntaxNode | null = tree.resolveInner(at, edge < 0 ? -1 : 1); node; node = node.parent) {
    if (!SEPARATED.has(node.name)) continue;
    const first = state.doc.lineAt(node.from);
    const last = lastLineOf(state, node);
    if ((edge < 0 ? last : first).number !== line.number) return null;
    // A table showing its Markdown takes typed rows, as a table being written should.
    if (node.name === 'Table' && !drawnBlockAt(state, node.from)) return null;
    return { node, first, last };
  }
  return null;
}

// Quote marks and spaces, and nothing else.
const blank = (text: string) => /^[\s>]*$/.test(text);
const quoteOf = (text: string) => /^(?:[ \t]*>[ \t]?)*/.exec(text)?.[0] ?? '';

/**
 * What a line next to `block` starts with to stay in the block's container:
 * the block's own quote marks and indent, so text under a table in a list
 * item stays in the item. A line outside the block's quote stays outside
 * it. The blank line between holds the quote marks.
 */
function containerOf(state: EditorState, block: Separated, line: Line): { prefix: string; blank: string } {
  const own = state.doc.sliceString(block.first.from, block.node.from);
  const quote = quoteOf(own);
  if (quote && !/^[ \t]*>/.test(line.text)) return { prefix: '', blank: '' };
  return { prefix: own.replace(/[^\s>]/g, ' '), blank: quote.replace(/[ \t]+$/, '') };
}

/**
 * `tr` with the separators a typed or pasted text needs next to a table or
 * rule: on a blank line under one, the text goes on a new line after a
 * blank line in the same container; on a blank line above a table or a
 * `---` rule it keeps a blank line under it, since the table could join the
 * paragraph above and the rule would underline the text as a heading; and
 * a line holding a pipe right above a table gets a blank line under it.
 * Text typed at a block's first or last character goes on its own line
 * beside it. Null when none is needed.
 */
export function separated(tr: Transaction): TransactionSpec | null {
  if (!tr.docChanged || !tr.isUserEvent('input') || tr.isUserEvent('input.type.compose')) return null;
  // A file insert places its own lines and carries effects that must arrive.
  if (tr.effects.length > 0) return null;
  const state = tr.startState;
  if (!state.facet(docMode)) return null;
  const edits: { from: number; to: number; text: string }[] = [];
  tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => edits.push({ from, to, text: inserted.toString() }));
  // Text that opens with a blank line is already separated.
  if (edits.length !== 1 || !/\S/.test(edits[0].text) || /^\n[ \t>]*\n/.test(edits[0].text)) return null;
  const { from, to, text } = edits[0];
  const { doc } = state;
  const line = doc.lineAt(from);
  if (doc.lineAt(to).number !== line.number) return null;
  const spec = (insertFrom: number, insertTo: number, insert: string, caret: number): TransactionSpec => ({
    changes: { from: insertFrom, to: insertTo, insert },
    selection: { anchor: caret },
    scrollIntoView: true,
    userEvent: tr.annotation(Transaction.userEvent),
  });

  // At a block's own first or last character: a line of its own beside it.
  const starting = blockOn(state, line, 1);
  if (starting && from === to && from === starting.node.from) {
    const { prefix, blank: gap } = containerOf(state, starting, line);
    const insert = `${text}\n${gap}\n${prefix}`;
    return spec(from, to, insert, from + text.length);
  }
  const ending = blockOn(state, line, -1);
  if (ending && from === to && from === line.to) {
    const { prefix, blank: gap } = containerOf(state, ending, line);
    const insert = `\n${gap}\n${prefix}${shownBackslash(text, doc.sliceString(to, Math.min(doc.length, to + 200)))}`;
    return spec(from, to, insert, from + insert.length);
  }

  const empty = blank(line.text);
  const above = empty && line.number > 1 ? blockOn(state, doc.line(line.number - 1), -1) : null;
  const below = line.number < doc.lines ? blockOn(state, doc.line(line.number + 1), 1) : null;
  if (!above && !below) return null;
  const container = containerOf(state, (above ?? below) as Separated, line);
  const typedLine = (doc.sliceString(line.from, from) + text + doc.sliceString(to, line.to)).split('\n').pop() ?? '';
  // A blank line over a table or a "---" rule stays, since text there can take the table into a paragraph or underline itself.
  const belowNeeds = below && (above || empty
    ? below.node.name === 'Table' || /^[\s>]*-/.test(below.first.text) || above
    : below.node.name === 'Table' && typedLine.includes('|'));
  if (!above && !belowNeeds) return null;
  const head = above ? `${container.blank}\n${container.prefix}` : doc.sliceString(line.from, from);
  const gap = `\n${container.blank}`;
  const placed = above && !belowNeeds ? shownBackslash(text, doc.sliceString(to, Math.min(doc.length, line.to + 200))) : text;
  const changes = [
    ...(above ? [{ from: line.from, to: from, insert: head }] : []),
    { from, to, insert: empty && belowNeeds ? placed + gap : placed },
    ...(!empty && belowNeeds ? [{ from: line.to, insert: gap }] : []),
  ];
  return { changes, selection: { anchor: line.from + head.length + placed.length }, scrollIntoView: true, userEvent: tr.annotation(Transaction.userEvent) };
}

/** `text` with one more backslash when it ends in a lone one that `after`, a line break and more text, would turn into a hidden hard break. */
function shownBackslash(text: string, after: string): string {
  return /(?:^|[^\\])(?:\\\\)*\\$/.test(text) && /^\n[ \t>]*\S/.test(after) ? `${text}\\` : text;
}

// Blocks that take in a text line next to them: the line would become a row or part of the HTML.
const ABSORBING = new Set(['Table', 'HTMLBlock']);
const RULE = new Set(['HorizontalRule']);
const KIND_OF: Record<string, string> = { Table: 'table', HTMLBlock: 'HTML block', HorizontalRule: 'horizontal rule' };

/** The block of one of `names` whose last (`edge` -1) or first (1) line is `line`. */
function blockEdge(state: EditorState, line: Line, edge: -1 | 1, names: ReadonlySet<string>): SyntaxNode | null {
  const at = edge < 0 ? line.to : line.from + (/^[\s>]*/.exec(line.text)?.[0].length ?? 0);
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(at, edge); node; node = node.parent) {
    if (!names.has(node.name)) continue;
    const reaches = edge < 0 ? lastLineOf(state, node).number === line.number : state.doc.lineAt(node.from).number === line.number;
    return reaches ? node : null;
  }
  return null;
}

/** Whether `line` is paragraph text in the container that holds `rule`, which a "---" under it would underline. */
function paragraphOver(state: EditorState, line: Line, rule: SyntaxNode): boolean {
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(line.to, -1); node; node = node.parent) {
    if (node.name === 'Paragraph') return node.parent?.name === rule.parent?.name && node.parent?.from === rule.parent?.from;
  }
  return false;
}

/**
 * The block that the blank line `gap` keeps apart from the text on its
 * other side: a table or HTML block, which would take the text in, or a
 * "---" rule under a paragraph, which would become its setext underline.
 * Null when taking the blank line out joins nothing.
 */
function guardedGap(state: EditorState, gap: Line): SyntaxNode | null {
  if (gap.number < 2 || gap.number >= state.doc.lines || !blank(gap.text)) return null;
  const above = state.doc.line(gap.number - 1);
  const below = state.doc.line(gap.number + 1);
  if (blank(above.text) || blank(below.text)) return null;
  const absorber = blockEdge(state, above, -1, ABSORBING) ?? blockEdge(state, below, 1, ABSORBING);
  if (absorber) return absorber;
  const rule = /^[\s>]*-/.test(below.text) ? blockEdge(state, below, 1, RULE) : null;
  return rule && paragraphOver(state, above, rule) ? rule : null;
}

// Where a line's text starts for Backspace: past quote marks and a heading's hidden "#" marks.
const textStarts = (line: Line) => [
  line.from + quoteOf(line.text).length,
  line.from + (/^(?:[ \t]*>[ \t]?)*#{1,6}(?:[ \t]+|$)/.exec(line.text)?.[0].length ?? -1),
];

/** The block object that ends on the line before `line`, or starts on the line after it past its quote marks. */
function blockAcross(state: EditorState, line: Line, dir: -1 | 1): PageObject | null {
  if (dir < 0 ? line.number === 1 : line.number === state.doc.lines) return null;
  const other = state.doc.line(line.number + dir);
  // A block object's lines run whole, quote marks included.
  const obj = dir < 0 ? objectAt(state, other.to, -1) : objectAt(state, other.from + (/^[\s>]*/.exec(other.text)?.[0].length ?? 0), 0);
  return obj && objectKind(state, obj.kind)?.block && (dir < 0 || obj.from === other.from) ? obj : null;
}

/**
 * Backspace and Delete next to blocks in a document, where the page hides
 * markup the key would otherwise reach:
 *
 * - Taking out the only blank line between text and a table, an HTML block
 *   or a "---" rule frames the block instead: on the blank line itself, at
 *   the start of the text under it, or at the end of the text above it.
 * - Backspace at the start of a quoted line or a heading's text, and Delete
 *   at the end of a line, frame a block object on the line before or after,
 *   past the hidden quote marks and "#" marks.
 * - Delete at the end of a line above a callout leaves the callout's
 *   "[!type]" alone, and Delete on a blank line takes that line, never the
 *   hidden marks at the start of the next one.
 */
const deleteBesideBlocks = deleteHandlers.of({
  priority: 20,
  run: (view, dir) => {
    const { state } = view;
    const { main } = state.selection;
    if (!main.empty || state.selection.ranges.length > 1 || !state.facet(docMode)) return false;
    const line = state.doc.lineAt(main.head);
    const empty = blank(line.text);
    const atStart = dir < 0 && textStarts(line).includes(main.head);
    const atEnd = dir > 0 && main.head === line.to;
    let gap: Line | null = null;
    if (empty) gap = line;
    else if (atStart && line.number > 1) gap = state.doc.line(line.number - 1);
    else if (atEnd && line.number < state.doc.lines) gap = state.doc.line(line.number + 1);
    const node = gap && guardedGap(state, gap);
    const kind = node && objectKind(state, KIND_OF[node.name]);
    const framed = node && kind ? objectOf(state, kind, node) : !node && (atStart || atEnd) ? blockAcross(state, line, dir) : null;
    if (framed) {
      view.dispatch({ effects: setFrame.of(framed), scrollIntoView: true });
      return true;
    }
    if (!atEnd || node || line.number === state.doc.lines) return false;
    const next = state.doc.line(line.number + 1);
    if (empty) {
      view.dispatch({ changes: { from: line.from, to: next.from }, selection: { anchor: line.from }, scrollIntoView: true, userEvent: 'delete.forward' });
      return true;
    }
    return Boolean(calloutMarker(state, next));
  },
});

// A "---" rule, which paragraph text right above it would take as its setext underline.
const DASH_RULE = /^(?:[ \t]*>[ \t]?)*[ \t]{0,3}(?:-[ \t]*){3,}$/;
// A line of paragraph text: not blank, a heading, a list item, a table row or a fence.
const textLine = (text: string) => /[^\s>]/.test(text) && !/^(?:[ \t]*>[ \t]?)*[ \t]{0,3}(?:#{1,6}(?:[ \t]|$)|[-+*][ \t]|\d{1,9}[.)](?:[ \t]|$)|\||```|~~~|<)/.test(text);
const RULE_OR_TABLE = new Set(['HorizontalRule', 'Table']);

/**
 * An edit that leaves paragraph text right above a "---" rule or a table
 * that had a blank line, a heading or other non-text line above it, such as
 * Delete joining a heading to the paragraph before it, keeps a blank line
 * between them in the same step, so the rule never becomes an underline and
 * the table never takes the text in.
 */
export function keptApart(tr: Transaction): TransactionSpec | null {
  if (!tr.docChanged || !(tr.isUserEvent('delete') || tr.isUserEvent('input')) || tr.isUserEvent('input.type.compose') || !tr.startState.facet(docMode)) return null;
  const old = tr.startState;
  const inserts: { from: number; insert: string }[] = [];
  tr.changes.iterChangedRanges((_fromA, toA, _fromB, toB) => {
    const oldLine = old.doc.lineAt(toA);
    if (oldLine.number >= old.doc.lines) return;
    const block = old.doc.line(oldLine.number + 1);
    const node = blockEdge(old, block, 1, RULE_OR_TABLE);
    if (!node || (node.name === 'HorizontalRule' && !DASH_RULE.test(block.text)) || textLine(oldLine.text)) return;
    const joined = tr.newDoc.lineAt(toB);
    if (joined.number >= tr.newDoc.lines || tr.newDoc.line(joined.number + 1).text !== block.text || !textLine(joined.text)) return;
    // The new parse still starts the rule or table on its line, as under a list item's lazy line: nothing joined it.
    if (parsedBlockAt(tr.state, tr.newDoc.line(joined.number + 1), node.name)) return;
    inserts.push({ from: joined.to, insert: `\n${quoteOf(joined.text).replace(/[ \t]+$/, '')}` });
  });
  return inserts.length > 0 ? { changes: inserts, sequential: true } : null;
}

/** Whether the parse of `state`, when it reaches `line` quickly, has a `name` block starting on that line. */
function parsedBlockAt(state: EditorState, line: Line, name: string): boolean {
  const tree = ensureSyntaxTree(state, line.to, 50);
  if (!tree) return false;
  const at = line.from + (/^[\s>]*/.exec(line.text)?.[0].length ?? 0);
  for (let node: SyntaxNode | null = tree.resolveInner(at, 1); node; node = node.parent) {
    if (node.name === name) return state.doc.lineAt(node.from).number === line.number;
  }
  return false;
}

const framedRule = Decoration.line({ class: 'cm-md-hr-framed' });

/** A rule's frame on its line, since the rule draws as a widget a mark never reaches. */
const ruleFrame = EditorView.decorations.compute([objectFrame], (state) => {
  const frame = state.field(objectFrame);
  return frame?.kind === 'horizontal rule' ? Decoration.set(framedRule.range(state.doc.lineAt(frame.from).from)) : Decoration.none;
});

/**
 * An input method writes on the blank line under a table without the
 * separator, since nothing may move while it composes. When it ends, the
 * composed text gets its blank line above, as typed text does.
 */
function separateComposed(view: EditorView, line: number): void {
  const { state } = view;
  if (line < 2 || line > state.doc.lines) return;
  const composed = state.doc.line(line);
  if (blank(composed.text)) return;
  // The table above took the composed line in as a row.
  let node: SyntaxNode | null = latestTree(state).resolveInner(composed.from + quoteOf(composed.text).length, 1);
  while (node && node.name !== 'Table') node = node.parent;
  if (!node || state.doc.lineAt(node.from).number >= line) return;
  const { prefix, blank: gap } = containerOf(state, { node, first: state.doc.lineAt(node.from), last: composed }, composed);
  const lead = /^[\s>]*/.exec(composed.text)?.[0].length ?? 0;
  view.dispatch({ changes: { from: composed.from, to: composed.from + lead, insert: `${gap}\n${prefix}` }, userEvent: 'input' });
}

const composedLines = new WeakMap<EditorView, number>();

const compositionSeparators = EditorView.domEventObservers({
  compositionstart: (_event, view) => {
    const { state } = view;
    const line = state.doc.lineAt(state.selection.main.head);
    const under = line.number > 1 && blank(line.text) ? blockOn(state, state.doc.line(line.number - 1), -1) : null;
    if (under?.node.name === 'Table') composedLines.set(view, line.number);
    else composedLines.delete(view);
  },
  compositionend: (_event, view) => {
    const line = composedLines.get(view);
    composedLines.delete(view);
    if (line !== undefined) setTimeout(() => { if (view.dom.isConnected && !view.composing) separateComposed(view, line); }, 0);
  },
});

/** The block objects, their separators and the Backspace rule under a table. Documents only. */
export const blockObjects: Extension = [
  ruleFrame,
  compositionSeparators,
  objectKinds.of(tableKind),
  objectKinds.of(ruleKind),
  objectKinds.of(htmlKind),
  objectKinds.of(codeKind),
  deleteBesideBlocks,
  EditorState.transactionFilter.of((tr) => {
    const fixed = separated(tr);
    return fixed ? [fixed] : tr;
  }),
  // Highest, so it runs after the other filters and sees what they wrote.
  Prec.highest(EditorState.transactionFilter.of((tr) => {
    const apart = keptApart(tr);
    return apart ? [tr, apart] : tr;
  })),
];
