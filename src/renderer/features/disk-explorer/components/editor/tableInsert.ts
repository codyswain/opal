import type { EditorState, Line } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { Table } from 'lucide-react';
import { insertItems, latestTree } from './extensionPoints';
import { listItemOf } from './formatCommands';
import { setOpenBlock } from './livePreview';

/*
 * Insert > Table: a three-column table with a header row and two empty
 * rows, in the vault's own style ("| Column 1 |" and "|---|"), with a blank
 * line on each side so it parses as a table wherever it lands. It never
 * goes inside another table, code or HTML block, and stays in the caret's
 * quote or list item. Its source opens with the first header selected,
 * ready to type over.
 */

const HEADER = '| Column 1 | Column 2 | Column 3 |';
const DELIMITER = '|---|---|---|';
const ROW = '|  |  |  |';

const hasText = (text: string) => /[^\s>]/.test(text);
const quoteOf = (text: string) => /^(?:[ \t]*>[ \t]?)*/.exec(text)?.[0] ?? '';

// Blocks a new block never goes inside: it goes after their last line.
const WHOLE = new Set(['Table', 'FencedCode', 'CodeBlock', 'HTMLBlock', 'CommentBlock', 'LinkReference', 'SetextHeading1', 'SetextHeading2']);

/** The outermost table, code, HTML block or setext heading that holds `line`. */
function wholeBlockAt(state: EditorState, line: Line): SyntaxNode | null {
  let found: SyntaxNode | null = null;
  const tree = latestTree(state);
  for (const [at, side] of [[line.from + (/^[\s>]*/.exec(line.text)?.[0].length ?? 0), 1], [line.to, -1]] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(at, side); node; node = node.parent) {
      if (!WHOLE.has(node.name)) continue;
      const last = node.to > node.from && state.doc.lineAt(node.to).from === node.to ? node.to - 1 : node.to;
      if (state.doc.lineAt(node.from).number <= line.number && line.number <= state.doc.lineAt(last).number && (!found || node.from <= found.from)) found = node;
    }
  }
  return found;
}

/** What a line starts with to stay in the container `lead` opens: its quote marks, and spaces up to a list item's text. */
function prefixOf(lead: string): { prefix: string; gap: string } {
  const prefix = lead.replace(/[^\s>]/g, ' ');
  return { prefix, gap: quoteOf(prefix).replace(/[ \t]+$/, '') };
}

/** The text before a line's content: quote marks, indent and a list item's marker with the spaces after it. */
function leadOf(state: EditorState, line: Line): string {
  const item = listItemOf(state, line);
  if (!item) return /^[\s>]*/.exec(line.text)?.[0] ?? '';
  const mark = latestTree(state).resolveInner(item.markFrom, 1);
  const end = mark.name === 'ListMark' ? mark.to : item.markFrom;
  const spaces = /^[ \t]*/.exec(state.sliceDoc(end, line.to))?.[0] ?? '';
  return state.sliceDoc(line.from, end) + (spaces.length > 0 && spaces.length <= 4 ? spaces : ' ');
}

/**
 * The change that writes `rows` as a block of its own at the caret: in
 * place of a blank line, after the caret's line, or after the table, code,
 * HTML block or setext heading the caret is in, so no block is split. The
 * rows keep the caret's quote and list item, and a blank line on each side
 * keeps them apart from the text around them. `start` is where the first
 * row starts, `prefix` what each row starts with.
 */
export function blockInsertion(state: EditorState, rows: readonly string[]): { from: number; to: number; insert: string; start: number; end: number; prefix: string } {
  const { doc } = state;
  const caretLine = doc.lineAt(state.selection.main.head);
  const whole = wholeBlockAt(state, caretLine);
  const line = whole ? doc.lineAt(whole.to > whole.from && doc.lineAt(whole.to).from === whole.to ? whole.to - 1 : whole.to) : caretLine;
  const lead = whole ? doc.sliceString(doc.lineAt(whole.from).from, whole.from) : leadOf(state, line);
  const { prefix, gap } = prefixOf(lead);
  const empty = !whole && !hasText(line.text);
  const above = empty ? (line.number > 1 ? doc.line(line.number - 1) : null) : line;
  const below = line.number < doc.lines ? doc.line(line.number + 1) : null;
  const text = rows.map((row) => prefix + row).join('\n');
  const before = above && hasText(above.text) ? `${empty ? '' : '\n'}${gap}\n` : empty ? '' : '\n';
  const after = below && hasText(below.text) ? `\n${gap}` : '';
  const from = empty ? line.from : line.to;
  const start = from + before.length;
  return { from, to: empty ? line.to : from, insert: before + text + after + (below ? '' : '\n'), start, end: start + text.length, prefix };
}

/**
 * The change that puts a new table at the caret, and where the table and
 * its first header start and end.
 */
export function tableInsertion(state: EditorState): { from: number; to: number; insert: string; table: { from: number; to: number }; header: { from: number; to: number } } {
  const { from, to, insert, start, end, prefix } = blockInsertion(state, [HEADER, DELIMITER, ROW, ROW]);
  const headerFrom = start + prefix.length + 2;
  return { from, to, insert, table: { from: start, to: end }, header: { from: headerFrom, to: headerFrom + 'Column 1'.length } };
}

/** Writes a new table at the caret and opens its source on the first header. */
export function insertTable(view: EditorView): void {
  const { from, to, insert, table, header } = tableInsertion(view.state);
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: header.from, head: header.to },
    effects: setOpenBlock.of(table),
    scrollIntoView: true,
    userEvent: 'insert.table',
  });
  view.focus();
}

export const insertTableItem = insertItems.of({ id: 'table', label: 'Table', icon: Table, order: 20, run: insertTable });
