import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { Table } from 'lucide-react';
import { insertItems } from './extensionPoints';
import { setOpenBlock } from './livePreview';

/*
 * Insert > Table: a three-column table with a header row and two empty
 * rows, in the vault's own style ("| Column 1 |" and "|---|"), with a blank
 * line on each side so it parses as a table wherever it lands. Its source
 * opens with the first header selected, ready to type over.
 */

const HEADER = '| Column 1 | Column 2 | Column 3 |';
const DELIMITER = '|---|---|---|';
const ROW = '|  |  |  |';

const hasText = (text: string) => /[^\s>]/.test(text);
const quoteOf = (text: string) => /^(?:[ \t]*>[ \t]?)*/.exec(text)?.[0] ?? '';

/**
 * The change that puts a new table at the caret's line: in place of a blank
 * line, or after a line with text, in the line's quote. The table's lines,
 * and where its first header starts and ends.
 */
export function tableInsertion(state: EditorState): { from: number; to: number; insert: string; table: { from: number; to: number }; header: { from: number; to: number } } {
  const { doc } = state;
  const line = doc.lineAt(state.selection.main.head);
  const quote = quoteOf(line.text);
  const blank = quote.replace(/[ \t]+$/, '');
  const prefix = quote && !quote.endsWith(' ') ? `${quote} ` : quote;
  const rows = [HEADER, DELIMITER, ROW, ROW].map((row) => prefix + row).join('\n');
  const empty = !hasText(line.text);
  const above = empty ? (line.number > 1 ? doc.line(line.number - 1) : null) : line;
  const below = line.number < doc.lines ? doc.line(line.number + 1) : null;
  const before = above && hasText(above.text) ? `${empty ? '' : '\n'}${blank}\n` : empty ? '' : '\n';
  const after = below && hasText(below.text) ? `\n${blank}` : '';
  const from = empty ? line.from : line.to;
  const insert = before + rows + after + (below ? '' : '\n');
  const tableFrom = from + before.length;
  const tableTo = tableFrom + rows.length;
  const headerFrom = tableFrom + prefix.length + 2;
  return { from, to: empty ? line.to : from, insert, table: { from: tableFrom, to: tableTo }, header: { from: headerFrom, to: headerFrom + 'Column 1'.length } };
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
