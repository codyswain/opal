import { EditorSelection, EditorState, Prec, Transaction, type Extension, type Line, type TransactionSpec } from '@codemirror/state';
import { EditorView, keymap, type Command } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import type { SyntaxNode } from '@lezer/common';
import { latestTree } from './extensionPoints';
import { cellCaretOf, docMode, drawnBlockAt, setCellCaret } from './livePreview';

/*
 * Keys in a table's Markdown, as in a spreadsheet: Tab and Shift+Tab go to
 * the next and previous cell, selecting its text, and Tab in the last cell
 * adds a row. Enter adds an empty row under the caret's row, or under the
 * delimiter row from the header, with the caret in its first cell; Enter on
 * an empty last row leaves the table. New rows are written "|  |  |", one
 * space on each side of where the text goes. Only while the table shows its
 * Markdown: a drawn table takes no keys.
 */

interface Cell {
  /** The cell's text, without the spaces around it. */
  from: number;
  to: number;
  /** Between the pipes. */
  start: number;
  end: number;
}

/** The table node holding `at`, drawn or not. */
function anyTableAt(state: EditorState, at: number): SyntaxNode | null {
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(at, -1); node; node = node.parent) {
    if (node.name === 'Table') return node;
  }
  return null;
}

/** The table node holding `at`, when its Markdown shows. */
function tableAt(state: EditorState, at: number): SyntaxNode | null {
  const table = anyTableAt(state, at);
  return table && !drawnBlockAt(state, table.from) ? table : null;
}

/** The rows of a table: header, delimiter and body rows, in order. */
function rowsOf(table: SyntaxNode): SyntaxNode[] {
  const rows: SyntaxNode[] = [];
  for (let child = table.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableHeader' || child.name === 'TableRow' || child.name === 'TableDelimiter') rows.push(child);
  }
  return rows;
}

/** The cells of a header or body row, the spaces between its pipes included. */
function cellsOf(state: EditorState, row: SyntaxNode): Cell[] {
  const pipes: number[] = [];
  for (let child = row.firstChild; child; child = child.nextSibling) if (child.name === 'TableDelimiter') pipes.push(child.from);
  // A row without an outer pipe has a cell there all the same.
  const edges = [...(pipes[0] === row.from ? [] : [row.from - 1]), ...pipes, ...(pipes[pipes.length - 1] === row.to - 1 ? [] : [row.to])];
  const cells: Cell[] = [];
  for (let index = 0; index + 1 < edges.length; index += 1) {
    const start = edges[index] + 1;
    const end = edges[index + 1];
    const text = state.sliceDoc(start, end);
    const lead = text.length - text.trimStart().length;
    const trail = text.length - text.trimEnd().length;
    cells.push({ start, end, from: start + lead, to: Math.max(start + lead, end - trail) });
  }
  return cells;
}

/** The selection for going into `cell`: its text, or a caret inside its spaces. */
function enter(cell: Cell): EditorSelection {
  if (cell.to > cell.from) return EditorSelection.single(cell.from, cell.to);
  return EditorSelection.single(Math.min(cell.end, cell.start + 1));
}

/** What a new row starts with: the quote marks and indent before the table, a list item's marker as spaces. */
function rowPrefix(state: EditorState, table: SyntaxNode): string {
  return state.sliceDoc(state.doc.lineAt(table.from).from, table.from).replace(/[^\s>]/g, ' ');
}

/** An empty row as wide as the header, with the quote marks or indent the table sits in. */
function emptyRow(state: EditorState, table: SyntaxNode, header: SyntaxNode): string {
  return `${rowPrefix(state, table)}|${'  |'.repeat(Math.max(1, cellsOf(state, header).length))}`;
}

/** Adds an empty row after `line`, with the caret in its first cell. */
function addRow(state: EditorState, table: SyntaxNode, line: Line, dispatch: Parameters<Command>[0]['dispatch']): boolean {
  const header = rowsOf(table).find((row) => row.name === 'TableHeader');
  if (!header) return false;
  const row = emptyRow(state, table, header);
  const caret = line.to + 1 + rowPrefix(state, table).length + 2;
  // The new row is its own undo step, so Cmd+Z takes back what is typed into it first.
  dispatch(state.update({ changes: { from: line.to, insert: `\n${row}` }, selection: { anchor: caret }, scrollIntoView: true, userEvent: 'input', annotations: isolateHistory.of('full') }));
  return true;
}

/** Tab (1) or Shift+Tab (-1) with a cell caret in a drawn table: the outline moves to the next or previous cell. */
function moveCellCaret(view: EditorView, dir: 1 | -1): boolean {
  const { state } = view;
  const caret = cellCaretOf(state);
  const table = caret === null ? null : anyTableAt(state, caret);
  if (caret === null || !table) return false;
  const cells = rowsOf(table).filter((row) => row.name !== 'TableDelimiter').flatMap((row) => cellsOf(state, row));
  const at = cells.findIndex((cell) => cell.start <= caret && caret <= cell.end);
  const target = cells[at + dir];
  if (at === -1 || !target) return true;
  const anchor = target.to > target.from ? target.from : Math.min(target.end, target.start + 1);
  view.dispatch({ selection: { anchor }, effects: setCellCaret.of(anchor), scrollIntoView: true });
  return true;
}

/**
 * Home (-1) or End (1) in a table's cell goes to the start or end of the
 * cell's text, as in Docs: in a drawn table's cell, and in a document's
 * table source. Pressed again at that edge, it goes on to the row's edge.
 */
function cellEdge(dir: 1 | -1): Command {
  return (view) => {
    const { state } = view;
    const caret = cellCaretOf(state);
    const at = caret ?? state.selection.main.head;
    const table = caret !== null ? anyTableAt(state, caret) : state.facet(docMode) && state.selection.ranges.length === 1 && state.selection.main.empty ? tableAt(state, at) : null;
    if (!table) return false;
    const cell = rowsOf(table).filter((row) => row.name !== 'TableDelimiter').flatMap((row) => cellsOf(state, row)).find((one) => one.start <= at && at <= one.end);
    if (!cell) return false;
    const anchor = cell.to > cell.from ? (dir > 0 ? cell.to : cell.from) : Math.min(cell.end, cell.start + 1);
    if (caret === null && anchor === at) return false;
    view.dispatch({ selection: { anchor }, effects: caret === null ? [] : setCellCaret.of(anchor), scrollIntoView: true, userEvent: 'select' });
    return true;
  };
}

/** Tab (1) or Shift+Tab (-1) in a table's Markdown. */
function moveCell(dir: 1 | -1): Command {
  return (view) => {
    if (moveCellCaret(view, dir)) return true;
    const { state } = view;
    const { main } = state.selection;
    const table = tableAt(state, main.head);
    if (!table || state.selection.ranges.length > 1) return false;
    const cells = rowsOf(table).filter((row) => row.name !== 'TableDelimiter').flatMap((row) => cellsOf(state, row));
    const at = cells.findIndex((cell) => cell.start <= main.head && main.head <= cell.end);
    if (at === -1) {
      // On the delimiter row: on to the first body cell, or back to the header.
      const next = dir > 0 ? cells.find((cell) => cell.start > main.head) : [...cells].reverse().find((cell) => cell.end < main.head);
      if (next) view.dispatch({ selection: enter(next), scrollIntoView: true, userEvent: 'select' });
      return true;
    }
    const target = cells[at + dir];
    if (target) {
      view.dispatch({ selection: enter(target), scrollIntoView: true, userEvent: 'select' });
      return true;
    }
    if (dir < 0) return true;
    return addRow(state, table, state.doc.lineAt(main.head), view.dispatch);
  };
}

/** Enter in a table's Markdown: an empty row under the caret's row, or under the delimiter row from the header. */
const newRow: Command = (view) => {
  const { state } = view;
  const { main } = state.selection;
  const table = main.empty && state.selection.ranges.length === 1 ? tableAt(state, main.head) : null;
  if (!table) return false;
  const rows = rowsOf(table);
  const line = state.doc.lineAt(main.head);
  const row = rows.find((each) => state.doc.lineAt(each.from).number === line.number);
  if (!row) return false;
  const delimiter = rows.find((each) => each.name === 'TableDelimiter');
  // Enter on an empty last row leaves the table: the row becomes the blank line under it.
  if (row.name === 'TableRow' && row === rows[rows.length - 1] && cellsOf(state, row).every((cell) => cell.to === cell.from) && line.number > 1) {
    const above = state.doc.line(line.number - 1);
    const quote = /^(?:[ \t]*>[ \t]?)*/.exec(line.text)?.[0].replace(/[ \t]+$/, '') ?? '';
    const insert = `\n${quote}\n${quote ? `${quote} ` : ''}`;
    view.dispatch({ changes: { from: above.to, to: line.to, insert }, selection: { anchor: above.to + insert.length }, scrollIntoView: true, userEvent: 'input' });
    return true;
  }
  const under = row.name === 'TableRow' || !delimiter ? line : state.doc.lineAt(delimiter.from);
  return addRow(state, table, under, view.dispatch);
};

/**
 * In a document, text typed into an empty cell is written with one space
 * on each side, like the rest of the row, and text typed past a row's last
 * pipe, where a cell is missing, gets its spaces and closing pipe too.
 */
export function spacedCell(tr: Transaction): TransactionSpec | null {
  const state = tr.startState;
  // An input method's text moves nothing while it composes; compositionend spaces it.
  if (!tr.isUserEvent('input.type') || tr.isUserEvent('input.type.compose') || !state.facet(docMode)) return null;
  const { main } = state.selection;
  if (!main.empty || state.selection.ranges.length > 1) return null;
  let typed = '';
  let single = true;
  tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    if (from !== main.head || to !== from) single = false;
    typed += inserted.toString();
  });
  if (!single || !/^[^\s|]/.test(typed) || typed.includes('\n')) return null;
  const table = tableAt(state, main.head);
  const row = table && rowsOf(table).find((each) => each.name !== 'TableDelimiter' && each.from <= main.head && main.head <= each.to + 1);
  if (!row) return null;
  const line = state.doc.lineAt(main.head);
  const cell = cellsOf(state, row).find((each) => each.start <= main.head && main.head <= each.end);
  const userEvent = tr.annotation(Transaction.userEvent);
  // The caret keeps its place in the typed text, such as inside the marks bold wrapped around it.
  const offset = Math.min(typed.length, Math.max(0, tr.newSelection.main.head - main.head));
  if (cell && cell.to === cell.from) {
    const insert = ` ${typed} `;
    return { changes: { from: cell.start, to: cell.end, insert }, selection: { anchor: cell.start + 1 + offset }, scrollIntoView: true, userEvent };
  }
  if (!cell && main.head === line.to && state.sliceDoc(line.to - 1, line.to) === '|') {
    return { changes: { from: main.head, insert: ` ${typed} |` }, selection: { anchor: main.head + 1 + offset }, scrollIntoView: true, userEvent };
  }
  return null;
}

/** Once an input method has written into a cell, the cell's text gets its space on each side. */
function spaceComposedCell(view: EditorView): void {
  const { state } = view;
  const head = state.selection.main.head;
  const table = state.facet(docMode) ? tableAt(state, head) : null;
  const row = table && rowsOf(table).find((each) => each.name !== 'TableDelimiter' && each.from <= head && head <= each.to);
  const cell = row && cellsOf(state, row).find((each) => each.start <= head && head <= each.end);
  if (!cell || cell.to === cell.from || (cell.from > cell.start && cell.to < cell.end)) return;
  const insert = ` ${state.sliceDoc(cell.from, cell.to)} `;
  view.dispatch({ changes: { from: cell.start, to: cell.end, insert }, selection: { anchor: cell.start + 1 + (head - cell.from) }, userEvent: 'input' });
}

const composedCells = EditorView.domEventObservers({
  compositionend: (_event, view) => {
    setTimeout(() => { if (view.dom.isConnected && !view.composing) spaceComposedCell(view); }, 0);
  },
});

/** A table's keys, for notes and documents, and a document's cell spacing. */
export const tableKeys: Extension = [
  Prec.high(keymap.of([
    { key: 'Tab', run: moveCell(1), shift: moveCell(-1) },
    { key: 'Enter', run: newRow },
    { key: 'Home', run: cellEdge(-1) },
    { key: 'End', run: cellEdge(1) },
    { mac: 'Mod-ArrowLeft', run: cellEdge(-1) },
    { mac: 'Mod-ArrowRight', run: cellEdge(1) },
  ])),
  EditorState.transactionFilter.of((tr) => spacedCell(tr) ?? tr),
  composedCells,
];
