import { EditorState, Prec, StateEffect, StateField, Transaction, type Extension, type Line, type Text } from '@codemirror/state';
import { keymap, type Command } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { isMap, parseDocument } from 'yaml';
import { latestTree } from './extensionPoints';

/*
 * A document's first line never turns into properties by accident. A file
 * whose body starts with a "---" line, a YAML map or nothing, and a "---"
 * line opens with that block as its properties, so an edit that would leave
 * the body starting that way writes the first rule as "***" in the same
 * step. Agents' writes come in as remote changes and keep their bytes.
 * Option+Up and Option+Down move lines, but never into a table, code or
 * HTML block, nor a list item away from the items nested under it.
 */

// The main process reads at most this much frontmatter.
const LIMIT = 64 * 1024;

/** Whether a body starting this way would open with its first block as properties, as the main process splits a file. */
export function opensAsProperties(doc: Text): boolean {
  if (doc.lines < 2 || doc.line(1).text !== '---') return false;
  const raw: string[] = [];
  let size = 0;
  for (let number = 2; number <= doc.lines; number += 1) {
    const text = doc.line(number).text;
    if (text === '---' || text === '...') {
      const yaml = raw.join('\n');
      return !yaml.trim() || isMap(parseDocument(yaml).contents);
    }
    raw.push(text);
    size += text.length + 1;
    if (size > LIMIT) return false;
  }
  return false;
}

/** Says whether the file has properties above its body, which the editor does not hold. */
export const setFileProperties = StateEffect.define<boolean>();

/** Whether the file has properties, so a "---" opening its body can never become them. */
const fileProperties = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => tr.effects.reduce((found, effect) => (effect.is(setFileProperties) ? effect.value : found), value),
});

/**
 * The user's edit as it is, or with the "---" that now opens the body
 * written "***", when the edit would make the body open as properties. A
 * body that already did, and undo and redo, are left alone.
 */
export function keepFirstLine(tr: Transaction): Transaction | readonly [Transaction, { changes: { from: number; to: number; insert: string }; sequential: true }] {
  if (!tr.docChanged || tr.annotation(Transaction.remote) || tr.isUserEvent('undo') || tr.isUserEvent('redo') || tr.startState.field(fileProperties, false)) return tr;
  if (tr.newDoc.line(1).text !== '---' || !opensAsProperties(tr.newDoc) || opensAsProperties(tr.startState.doc)) return tr;
  return [tr, { changes: { from: 0, to: 3, insert: '***' }, sequential: true }];
}

// Blocks a moved line must not go into, or out of.
const BLOCKS = new Set(['Table', 'FencedCode', 'CodeBlock', 'HTMLBlock', 'CommentBlock']);

/** The table, code or HTML block a line is in, or null. */
function blockOf(state: EditorState, line: Line): SyntaxNode | null {
  const at = line.from + (/^[\s>]*/.exec(line.text)?.[0].length ?? 0);
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(Math.min(at, line.to), 1); node; node = node.parent) {
    if (BLOCKS.has(node.name)) return node;
  }
  return null;
}

/** Whether `line` holds the frame of `block`: a table's delimiter row, or a code block's opening or closing fence. */
function structural(state: EditorState, block: SyntaxNode, line: Line): boolean {
  if (block.name === 'Table') return /^[\s>]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/.test(line.text);
  if (block.name !== 'FencedCode') return false;
  const last = block.to > block.from && state.doc.lineAt(block.to).from === block.to ? block.to - 1 : block.to;
  return line.number === state.doc.lineAt(block.from).number || (line.number === state.doc.lineAt(last).number && block.lastChild?.name === 'CodeMark');
}

const sameBlock = (a: SyntaxNode | null, b: SyntaxNode | null) => (a === null && b === null) || (a !== null && b !== null && a.from === b.from && a.to === b.to);

/** Whether the lines `first` to `last` carry a list item without the items nested under it. */
function leavesChildren(state: EditorState, first: Line, last: Line): boolean {
  for (let number = first.number; number <= last.number; number += 1) {
    const line = state.doc.line(number);
    for (let node: SyntaxNode | null = latestTree(state).resolveInner(line.to, -1); node; node = node.parent) {
      if (node.name !== 'ListItem') continue;
      const nested = node.getChild('BulletList') ?? node.getChild('OrderedList');
      if (state.doc.lineAt(node.from).number === number && nested && state.doc.lineAt(nested.from).number > last.number) return true;
      break;
    }
  }
  return false;
}

/** Option+Up (-1) or Option+Down (1): true, doing nothing, when the move would break a block or a list. */
function refuseMove(dir: -1 | 1): Command {
  return (view) => {
    const { state } = view;
    const { main } = state.selection;
    const first = state.doc.lineAt(main.from);
    const last = state.doc.lineAt(main.to > main.from && state.doc.lineAt(main.to).from === main.to ? main.to - 1 : main.to);
    const neighbour = dir < 0 ? first.number - 1 : last.number + 1;
    if (neighbour < 1 || neighbour > state.doc.lines) return false;
    const moving = blockOf(state, first);
    const other = state.doc.line(neighbour);
    if (!sameBlock(moving, blockOf(state, last)) || !sameBlock(moving, blockOf(state, other))) return true;
    // Inside a block, a table's delimiter row and a code block's fences stay where they are, and no line passes them.
    if (moving && [first, last, other].some((line) => structural(state, moving, line))) return true;
    return leavesChildren(state, first, last);
  };
}

/** Line moves that keep blocks and lists whole, for every page. */
export const guardedLineMoves: Extension = Prec.high(keymap.of([
  { key: 'Alt-ArrowUp', run: refuseMove(-1) },
  { key: 'Alt-ArrowDown', run: refuseMove(1) },
]));

/** A document's first-line rule. */
export const firstLine: Extension = [fileProperties, EditorState.transactionFilter.of(keepFirstLine)];
