import { ChangeSet, Prec, type ChangeSpec, type EditorState, type Extension, type Line, type StateCommand, type Transaction } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { latestTree, protectedIn } from './extensionPoints';
import { listItemOf, selectedLines } from './formatCommands';

/*
 * Lists by keyboard. Tab and Shift+Tab nest a list item under the one above
 * it or move it out a level, measured in columns with tab stops at 4. The
 * indent goes after the line's own indentation, in the list's own
 * character: a tab where the list already indents with tabs, otherwise
 * spaces to the parent's text. Only the moved item's line changes. In a
 * document Tab does nothing outside lists, since four spaces would turn a
 * paragraph into code, and Enter never renumbers the items below.
 */

const TAB = 4;

/** The column `text` ends at, with tab stops every 4. */
function column(text: string): number {
  let at = 0;
  for (const character of text) at = character === '\t' ? at + TAB - (at % TAB) : at + 1;
  return at;
}

const quoteOf = (text: string) => /^(?:[ \t]*>[ \t]?)*/.exec(text)?.[0] ?? '';

interface Item {
  line: Line;
  node: SyntaxNode;
  mark: SyntaxNode;
  /** Where the indentation after the quote marks starts. */
  indentFrom: number;
}

/** The list item `line` starts, with its marker, or null. */
function itemOn(state: EditorState, line: Line): Item | null {
  const found = listItemOf(state, line);
  if (!found) return null;
  const mark = latestTree(state).resolveInner(found.markFrom, 1);
  if (mark.name !== 'ListMark' || mark.parent?.name !== 'ListItem') return null;
  return { line, node: mark.parent, mark, indentFrom: line.from + quoteOf(line.text).length };
}

/** The item a list item node starts on its first line. */
function itemOf(state: EditorState, node: SyntaxNode): Item | null {
  return itemOn(state, state.doc.lineAt(node.from));
}

/** The column where an item's text starts: after its marker and up to four spaces. */
function textColumn(state: EditorState, item: Item): number {
  const after = state.doc.sliceString(item.mark.to, item.line.to);
  const spaces = /^[ \t]*/.exec(after)?.[0] ?? '';
  const start = column(item.line.text.slice(0, item.mark.to - item.line.from));
  const gap = column(item.line.text.slice(0, item.mark.to - item.line.from) + spaces) - start;
  return start + (gap === 0 || gap > TAB || spaces.length === after.length ? 1 : gap);
}

/** Whether the list `item` is in, or any list around it, indents with tabs. */
function usesTabs(state: EditorState, item: Item): boolean {
  let top: SyntaxNode = item.node;
  for (let node: SyntaxNode | null = item.node.parent; node; node = node.parent) {
    if (node.name === 'BulletList' || node.name === 'OrderedList') top = node;
  }
  const first = state.doc.lineAt(top.from).number;
  const last = state.doc.lineAt(Math.max(top.from, top.to - 1)).number;
  for (let number = first; number <= last; number += 1) {
    const text = state.doc.line(number).text;
    if (/^[ \t]*\t/.test(text.slice(quoteOf(text).length))) return true;
  }
  return false;
}

const number = (state: EditorState, mark: SyntaxNode) => Number.parseInt(state.sliceDoc(mark.from, mark.to), 10);
const ordered = (node: SyntaxNode) => node.parent?.name === 'OrderedList';

/** The change that writes `value` as an ordered item's number, keeping its "." or ")". */
function renumber(state: EditorState, mark: SyntaxNode, value: number): ChangeSpec[] {
  const written = state.sliceDoc(mark.from, mark.to);
  const digits = /^\d+/.exec(written)?.[0] ?? '';
  return String(value) === digits ? [] : [{ from: mark.from, to: mark.from + digits.length, insert: String(value) }];
}

/** Tab: `item` under the item above it, as its last child. */
function nest(state: EditorState, item: Item): ChangeSpec[] {
  let previous = item.node.prevSibling;
  while (previous && previous.name !== 'ListItem') previous = previous.prevSibling;
  const parent = previous && itemOf(state, previous);
  if (!parent) return [];
  const target = textColumn(state, parent);
  const before = item.line.text.slice(0, item.mark.from - item.line.from);
  const now = column(before);
  let indent = '';
  if (usesTabs(state, item)) {
    do indent += '\t'; while (column(before + indent) < target);
  } else {
    indent = ' '.repeat(Math.max(1, target - now));
  }
  const changes: ChangeSpec[] = [{ from: item.mark.from, insert: indent }];
  if (ordered(item.node)) {
    // Joining a numbered list under the parent takes the next number; starting one takes 1.
    let child = parent.node.lastChild;
    while (child && child.name !== 'OrderedList' && child.name !== 'BulletList') child = child.prevSibling;
    const last = child?.name === 'OrderedList' ? child.lastChild : null;
    const lastMark = last?.getChild('ListMark');
    changes.push(...renumber(state, item.mark, lastMark ? number(state, lastMark) + 1 : 1));
  }
  return changes;
}

/** Shift+Tab: `item` out to its parent's level, as the item after it. */
function outdent(state: EditorState, item: Item): ChangeSpec[] {
  const list = item.node.parent;
  const parent = list?.parent?.name === 'ListItem' ? itemOf(state, list.parent) : null;
  if (!parent) return [];
  const target = column(parent.line.text.slice(0, parent.mark.from - parent.line.from));
  const indent = state.doc.sliceString(item.indentFrom, item.mark.from);
  const quote = state.doc.sliceString(item.line.from, item.indentFrom);
  let keep = indent.length;
  while (keep > 0 && column(quote + indent.slice(0, keep)) > target) keep -= 1;
  const changes: ChangeSpec[] = [{ from: item.indentFrom + keep, to: item.mark.from }];
  if (ordered(item.node) && ordered(parent.node)) changes.push(...renumber(state, item.mark, number(state, parent.mark) + 1));
  return changes;
}

/**
 * Tab (`more`) or Shift+Tab on each selected list item: one level in or
 * out. False when no selected item can move, so a note's Tab can indent
 * the line as before.
 */
export function nestListItems(more: boolean): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const items = selectedLines(state)
      .filter((line) => protectedIn(state, line.from, line.to).length === 0)
      .map((line) => itemOn(state, line))
      .filter((item): item is Item => item !== null);
    const changes = items.flatMap((item) => (more ? nest(state, item) : outdent(state, item)));
    if (changes.length === 0) return false;
    dispatch(state.update({ changes, scrollIntoView: true, userEvent: more ? 'input.indent' : 'delete.dedent' }));
    return true;
  };
}

/** Whether the selection is in a table's lines, where Tab will move between cells. */
function inTable(state: EditorState): boolean {
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(state.selection.main.head, -1); node; node = node.parent) {
    if (node.name === 'Table') return true;
  }
  return false;
}

/** A document's Tab and Shift+Tab: list levels, and nothing at all elsewhere. */
const docTab = (more: boolean): StateCommand => (target) => nestListItems(more)(target) || inTable(target.state) || true;

export const docListKeys: Extension = Prec.high(keymap.of([{ key: 'Tab', run: docTab(true), shift: docTab(false) }]));

const ITEM = /^([\s>]*)(\d+)([.)])/;

/**
 * Enter in a document's numbered list, from the transaction the list
 * command made: its new line stays, and its renumbering of the items below
 * goes, so no other line changes. The new item takes the number after the
 * one above it, or the same number in a list numbered "1.", "1.", "1.".
 */
export function withoutRenumbering(tr: Transaction): Transaction {
  const state = tr.startState;
  const line = state.doc.lineAt(state.selection.main.head);
  const kept: { from: number; to: number; insert: string }[] = [];
  let dropped = false;
  tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    const text = inserted.toString();
    if (from > line.to && /^\d*$/.test(state.sliceDoc(from, to)) && /^\d*$/.test(text)) dropped = true;
    else kept.push({ from, to, insert: text });
  });
  const item = itemOn(state, line);
  if (!item || !ordered(item.node)) return dropped ? state.update({ changes: kept, selection: tr.newSelection, scrollIntoView: true, userEvent: 'input' }) : tr;
  // A lazily numbered list repeats its number.
  let previous = item.node.prevSibling;
  while (previous && previous.name !== 'ListItem') previous = previous.prevSibling;
  let next = item.node.nextSibling;
  while (next && next.name !== 'ListItem') next = next.nextSibling;
  const own = number(state, item.mark);
  const neighbour = previous ?? next;
  const neighbourMark = neighbour?.getChild('ListMark');
  const lazy = neighbourMark !== null && neighbourMark !== undefined && number(state, neighbourMark) === own;
  const set = ChangeSet.of(kept, state.doc.length);
  const after = set.apply(state.doc);
  const head = tr.newSelection.main.head;
  const newLine = after.lineAt(Math.min(head, after.length));
  const match = ITEM.exec(newLine.text);
  if (match && newLine.number !== after.lineAt(set.mapPos(line.from)).number) {
    const want = String(lazy ? own : own + 1);
    if (match[2] !== want) {
      const at = newLine.from + match[1].length;
      const fix = ChangeSet.of([{ from: at, to: at + match[2].length, insert: want }], after.length);
      return state.update({ changes: set.compose(fix), selection: tr.newSelection.map(fix), scrollIntoView: true, userEvent: 'input' });
    }
  }
  return dropped ? state.update({ changes: set, selection: tr.newSelection, scrollIntoView: true, userEvent: 'input' }) : tr;
}
