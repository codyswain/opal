import { ChangeSet, Prec, type ChangeSpec, type EditorState, type Extension, type Line, type StateCommand, type Transaction } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { deleteHandlers, latestTree } from './extensionPoints';
import { listItemOf, selectedLines } from './formatCommands';
import { docMode } from './livePreview';

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

/** The innermost list item holding `at`. */
function itemAround(state: EditorState, at: number): SyntaxNode | null {
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(at, -1); node; node = node.parent) {
    if (node.name === 'ListItem') return node;
  }
  return null;
}

/** What starts the item after `item`: its indent, its marker or next number, and a box for a task. */
function nextMarker(state: EditorState, item: Item): string {
  const written = state.sliceDoc(item.mark.from, item.mark.to);
  const marker = ordered(item.node) ? `${number(state, item.mark) + 1}${written.slice(-1)}` : written;
  const box = item.node.getChild('Task') ? ' [ ]' : '';
  return `${state.sliceDoc(item.line.from, item.mark.from)}${marker}${box} `;
}

// Blocks a line's text can be in, past the inline formatting around it.
const BLOCKS = new Set(['Paragraph', 'FencedCode', 'CodeBlock', 'Table', 'HTMLBlock', 'CommentBlock', 'LinkReference', 'ListItem', 'Blockquote', 'Document']);

/** The block that holds the text before `at`. */
function blockAt(state: EditorState, at: number): SyntaxNode | null {
  let node: SyntaxNode | null = latestTree(state).resolveInner(at, -1);
  while (node && !BLOCKS.has(node.name)) node = node.parent;
  return node;
}

/**
 * Enter at the end of a list item's later paragraph starts the next item,
 * as it does at the end of the item's first line.
 */
const enterAfterParagraph: StateCommand = ({ state, dispatch }) => {
  const { main } = state.selection;
  if (state.selection.ranges.length > 1 || !main.empty) return false;
  const line = state.doc.lineAt(main.head);
  if (main.head !== line.to || !/[^\s>]/.test(line.text) || itemOn(state, line)) return false;
  // Only a paragraph's line: Enter in code, a table or HTML inside an item stays theirs.
  if (blockAt(state, line.to)?.name !== 'Paragraph') return false;
  const node = itemAround(state, line.to);
  const item = node && itemOf(state, node);
  if (!item || item.line.number === line.number) return false;
  const next = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null;
  if (next && /[^\s>]/.test(next.text) && !itemOn(state, next)) return false;
  const insert = `\n${nextMarker(state, item)}`;
  dispatch(state.update({ changes: { from: line.to, insert }, selection: { anchor: line.to + insert.length }, scrollIntoView: true, userEvent: 'input' }));
  return true;
};

/** Cmd+Enter: checks or unchecks the task on the caret's line. */
const toggleTaskHere: StateCommand = ({ state, dispatch }) => {
  const line = state.doc.lineAt(state.selection.main.head);
  const item = itemOn(state, line);
  const box = item?.node.getChild('Task')?.getChild('TaskMarker');
  if (!box || box.from > line.to) return false;
  const at = box.from + 1;
  dispatch(state.update({ changes: { from: at, to: at + 1, insert: /x/i.test(state.sliceDoc(at, at + 1)) ? ' ' : 'x' }, userEvent: 'input.toggle' }));
  return true;
};

/**
 * Backspace at the start of a numbered list's first item: the line leaves
 * the list, and the item after it takes the removed number, so the list
 * still reads 1, 2. A list that would then start past 1 under the line
 * gets a blank line first, since only a list from 1 can follow text.
 */
const leaveNumberedList = deleteHandlers.of({
  priority: 12,
  run: (view, dir) => {
    const { state } = view;
    const { main } = state.selection;
    if (dir > 0 || !state.facet(docMode) || !main.empty || state.selection.ranges.length > 1) return false;
    const line = state.doc.lineAt(main.head);
    const item = itemOn(state, line);
    const found = item && listItemOf(state, line);
    if (!item || !found || found.textFrom !== main.head || !ordered(item.node) || item.node.getChild('Task')) return false;
    if (item.node.parent?.parent?.name === 'ListItem') return false;
    let previous = item.node.prevSibling;
    while (previous && previous.name !== 'ListItem') previous = previous.prevSibling;
    if (previous) return false;
    let next = item.node.nextSibling;
    while (next && next.name !== 'ListItem') next = next.nextSibling;
    const nextMark = next?.getChild('ListMark');
    const removed = number(state, item.mark);
    const changes: ChangeSpec[] = [{ from: item.mark.from, to: found.textFrom }];
    if (nextMark) {
      changes.push(...renumber(state, nextMark, removed));
      if (removed !== 1) changes.push({ from: state.doc.lineAt(nextMark.from).from, insert: `${quoteOf(line.text).replace(/[ \t]+$/, '')}\n` });
    }
    view.dispatch({ changes, selection: { anchor: item.mark.from }, scrollIntoView: true, userEvent: 'delete.backward' });
    return true;
  },
});

export const docListKeys: Extension = [
  leaveNumberedList,
  Prec.high(keymap.of([
    { key: 'Tab', run: docTab(true), shift: docTab(false) },
    { key: 'Enter', run: enterAfterParagraph },
    { key: 'Mod-Enter', run: toggleTaskHere },
  ])),
];

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
    const at = newLine.from + match[1].length;
    const fixes: ChangeSpec[] = match[2] === want ? [] : [{ from: at, to: at + match[2].length, insert: want }];
    // A numbered task goes on with a box.
    const boxAt = at + match[2].length + match[3].length;
    if (item.node.getChild('Task') && !/^ \[[ xX]\]/.test(after.sliceString(boxAt, boxAt + 4))) fixes.push({ from: boxAt, insert: after.sliceString(boxAt, boxAt + 1) === ' ' ? ' [ ]' : ' [ ] ' });
    if (fixes.length > 0) {
      const fix = ChangeSet.of(fixes, after.length);
      return state.update({ changes: set.compose(fix), selection: { anchor: fix.mapPos(head, 1) }, scrollIntoView: true, userEvent: 'input' });
    }
  }
  return dropped ? state.update({ changes: set, selection: tr.newSelection, scrollIntoView: true, userEvent: 'input' }) : tr;
}
