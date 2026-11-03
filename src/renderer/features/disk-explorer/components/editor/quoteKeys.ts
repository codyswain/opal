import { syntaxTree } from '@codemirror/language';
import { EditorState, Prec, Transaction, type Extension, type TransactionSpec } from '@codemirror/state';
import { keymap, type Command, type EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { Minus, MessageSquareQuote } from 'lucide-react';
import { calloutMarker } from './blockGuards';
import { deleteHandlers, insertItems } from './extensionPoints';
import { docMode } from './livePreview';

/*
 * Quotes and callouts in a document. Enter on an empty quote line leaves
 * the quote, one level at a time. Backspace at the start of a callout's
 * title takes off its "[!type]" only, so it reads as a plain quote and the
 * text keeps its place. Text typed into a callout with no title gets a space
 * after "[!type]". Insert > Callout and Insert > Horizontal line write them
 * on a line of their own.
 */

const QUOTE = /^((?:[ \t]*>[ \t]?)+)/;

/** Enter on a quote line holding only its marks: one level out, or out of the quote after a blank line. */
const leaveQuote: Command = (view) => {
  const { state } = view;
  const { main } = state.selection;
  if (!state.facet(docMode) || !main.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(main.head);
  const marks = QUOTE.exec(line.text)?.[1];
  if (!marks || marks.length !== line.length || line.number === 1) return false;
  // An empty line of code in a quote is code.
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(line.to, -1); node; node = node.parent) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return false;
  }
  const levels = marks.match(/>/g)?.length ?? 0;
  const outer = levels > 1 ? `${'> '.repeat(levels - 1)}` : '';
  const insert = `${outer.trimEnd()}\n${outer}`;
  view.dispatch({ changes: { from: line.from, to: line.to, insert }, selection: { anchor: line.from + insert.length }, scrollIntoView: true, userEvent: 'input' });
  return true;
};

/** Backspace at the start of a callout's title: "[!type]" and its fold sign go, and the line stays in the quote. */
const plainQuote = deleteHandlers.of({
  priority: 14,
  run: (view, dir) => {
    const { state } = view;
    const { main } = state.selection;
    if (dir > 0 || !state.facet(docMode) || !main.empty || state.selection.ranges.length > 1) return false;
    const line = state.doc.lineAt(main.head);
    const marker = calloutMarker(state, line);
    if (!marker || (main.head !== marker.to && !(main.head === line.to && marker.to >= line.to))) return false;
    view.dispatch({ changes: { from: marker.from, to: marker.to }, selection: { anchor: marker.from }, scrollIntoView: true, userEvent: 'delete.backward' });
    return true;
  },
});

/** Text typed right after a title-less callout's "[!type]" starts with a space, so it reads as the title. */
export function spacedTitle(tr: Transaction): TransactionSpec | null {
  if (!tr.isUserEvent('input.type') || !tr.docChanged || !tr.startState.facet(docMode)) return null;
  const state = tr.startState;
  const { main } = state.selection;
  if (!main.empty) return null;
  const line = state.doc.lineAt(main.head);
  const marker = calloutMarker(state, line);
  if (!marker || main.head !== line.to || marker.to !== line.to || /[ \t]$/.test(line.text)) return null;
  let typed = '';
  let single = true;
  tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    if (from !== main.head || to !== from) single = false;
    typed += inserted.toString();
  });
  if (!single || !/^\S/.test(typed)) return null;
  return { changes: { from: main.head, insert: ` ${typed}` }, selection: { anchor: main.head + typed.length + 1 }, scrollIntoView: true, userEvent: 'input.type' };
}

/** Writes `lines` on a line of their own at the caret, with blank lines around them, and puts the caret at `caret` in them. */
function insertBlock(view: EditorView, lines: string, caret: number): void {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const empty = !/[^\s]/.test(line.text);
  const from = empty ? line.from : line.to;
  const before = empty ? (line.number > 1 && /\S/.test(state.doc.line(line.number - 1).text) ? '\n' : '') : '\n\n';
  const next = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null;
  const after = next && /\S/.test(next.text) ? '\n' : '';
  view.dispatch({
    changes: { from, to: empty ? line.to : from, insert: before + lines + after + (next ? '' : '\n') },
    selection: { anchor: from + before.length + caret },
    scrollIntoView: true,
    userEvent: 'insert.block',
  });
  view.focus();
}

export const insertCalloutItem = insertItems.of({
  id: 'callout',
  label: 'Callout',
  icon: MessageSquareQuote,
  order: 30,
  run: (view) => insertBlock(view, '> [!note] Note\n> ', '> [!note] Note\n> '.length),
});

export const insertRuleItem = insertItems.of({
  id: 'rule',
  label: 'Horizontal line',
  icon: Minus,
  order: 40,
  run: (view) => insertBlock(view, '***\n', '***\n'.length),
});

/** A document's quote and callout keys, and its Insert items for them. */
export const quoteKeys: Extension = [
  plainQuote,
  insertCalloutItem,
  insertRuleItem,
  EditorState.transactionFilter.of((tr) => spacedTitle(tr) ?? tr),
  Prec.high(keymap.of([{ key: 'Enter', run: leaveQuote }])),
];
