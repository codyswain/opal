import { Prec, type EditorState, type Extension, type Line } from '@codemirror/state';
import { keymap, type Command } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { deleteHandlers, latestTree } from './extensionPoints';
import { docMode } from './livePreview';

/*
 * Enter and Backspace around a document's headings, as in Google Docs.
 * Enter at the start of a heading puts an empty line above it, in the
 * middle makes both halves headings, and at the end starts normal text,
 * past any closing "#" marks. A setext heading ("Title" over "===") shows
 * no underline: Enter at its end goes on past the underline, and Backspace
 * on the line under it comes back to the heading's end. Backspace at the
 * start of a heading under a blank line takes only the blank line.
 */

const quoteOf = (text: string) => /^(?:[ \t]*>[ \t]?)*/.exec(text)?.[0] ?? '';
const blankOf = (line: Line) => quoteOf(line.text).replace(/[ \t]+$/, '');
const isBlank = (line: Line) => /^[\s>]*$/.test(line.text);

/** The heading node a line belongs to, ATX or setext. */
function headingNode(state: EditorState, line: Line): SyntaxNode | null {
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(line.to, -1); node; node = node.parent) {
    if (/^(?:ATX|Setext)Heading\d$/.test(node.name)) return node;
    if (node.name === 'Document') return null;
  }
  return null;
}

interface Atx {
  level: number;
  /** Where the heading's text starts and ends, inside its "#" marks. */
  textFrom: number;
  textTo: number;
  /** The marks to write before a heading's text: "## ". */
  marks: string;
}

function atxOf(state: EditorState, line: Line, node: SyntaxNode): Atx | null {
  if (!node.name.startsWith('ATX') || state.doc.lineAt(node.from).number !== line.number) return null;
  const [open, close] = node.getChildren('HeaderMark');
  if (!open) return null;
  let textFrom = open.to;
  while (textFrom < line.to && /[ \t]/.test(state.sliceDoc(textFrom, textFrom + 1))) textFrom += 1;
  const end = close && close.from > open.to ? close.from : line.to;
  const textTo = line.from + state.sliceDoc(line.from, end).trimEnd().length;
  return { level: open.to - open.from, textFrom, textTo: Math.max(textFrom, textTo), marks: `${state.sliceDoc(open.from, open.to)} ` };
}

/** The underline line of a setext heading. */
function underlineOf(state: EditorState, node: SyntaxNode): Line | null {
  const mark = node.name.startsWith('Setext') ? node.getChild('HeaderMark') : null;
  return mark ? state.doc.lineAt(mark.from) : null;
}

/** Enter on a heading in a document. False anywhere else, so the list and plain newline commands run. */
export const headingEnter: Command = (view) => {
  const { state } = view;
  const { main } = state.selection;
  if (!state.facet(docMode) || state.selection.ranges.length > 1 || !main.empty) return false;
  const line = state.doc.lineAt(main.head);
  const node = headingNode(state, line);
  if (!node) return false;
  const quote = quoteOf(line.text);
  const atx = atxOf(state, line, node);
  if (atx) {
    if (main.head <= atx.textFrom) {
      const insert = `${blankOf(line)}\n`;
      view.dispatch({ changes: { from: line.from, insert }, selection: { anchor: atx.textFrom + insert.length }, scrollIntoView: true, userEvent: 'input' });
      return true;
    }
    if (main.head >= atx.textTo) {
      view.dispatch({ changes: { from: line.to, insert: `\n${quote}` }, selection: { anchor: line.to + 1 + quote.length }, scrollIntoView: true, userEvent: 'input' });
      return true;
    }
    // The second half keeps the heading's marks; spaces at the split go.
    let to = main.head;
    while (to < atx.textTo && state.sliceDoc(to, to + 1) === ' ') to += 1;
    const insert = `\n${quote}${atx.marks}`;
    view.dispatch({ changes: { from: main.head, to, insert }, selection: { anchor: main.head + insert.length }, scrollIntoView: true, userEvent: 'input' });
    return true;
  }
  const underline = underlineOf(state, node);
  if (!underline || line.number >= underline.number) return false;
  const first = state.doc.lineAt(node.from);
  const textStart = first.from + quoteOf(first.text).length;
  if (line.number === first.number && main.head <= textStart) {
    const insert = `${blankOf(line)}\n`;
    view.dispatch({ changes: { from: first.from, insert }, selection: { anchor: main.head + insert.length }, scrollIntoView: true, userEvent: 'input' });
    return true;
  }
  if (line.number === underline.number - 1 && main.head >= line.from + line.text.trimEnd().length) {
    const insert = `\n${quoteOf(underline.text)}`;
    view.dispatch({ changes: { from: underline.to, insert }, selection: { anchor: underline.to + insert.length }, scrollIntoView: true, userEvent: 'input' });
    return true;
  }
  return false;
};

/**
 * Backspace at the start of a heading under a blank line takes the blank
 * line; on the line under a setext heading it goes to the heading's end,
 * taking that line when it is empty.
 */
const headingBackspace = deleteHandlers.of({
  priority: 15,
  run: (view, dir) => {
    const { state } = view;
    const { main } = state.selection;
    if (dir > 0 || !state.facet(docMode) || !main.empty || state.selection.ranges.length > 1) return false;
    const line = state.doc.lineAt(main.head);
    if (line.number === 1) return false;
    const above = state.doc.line(line.number - 1);
    const node = headingNode(state, line);
    const atx = node && atxOf(state, line, node);
    if (atx && main.head <= atx.textFrom && isBlank(above)) {
      view.dispatch({ changes: { from: above.from, to: line.from }, selection: { anchor: main.head - (line.from - above.from) }, scrollIntoView: true, userEvent: 'delete.backward' });
      return true;
    }
    if (main.head !== line.from + quoteOf(line.text).length) return false;
    const heading = headingNode(state, above);
    const underline = heading && underlineOf(state, heading);
    if (!underline || underline.number !== above.number) return false;
    const end = state.doc.line(above.number - 1);
    const headingEnd = end.from + end.text.trimEnd().length;
    if (isBlank(line)) {
      view.dispatch({ changes: { from: above.to, to: line.to }, selection: { anchor: headingEnd }, scrollIntoView: true, userEvent: 'delete.backward' });
    } else {
      view.dispatch({ selection: { anchor: headingEnd }, scrollIntoView: true, userEvent: 'select' });
    }
    return true;
  },
});

/** A document's heading keys. */
export const headingKeys: Extension = [headingBackspace, Prec.high(keymap.of([{ key: 'Enter', run: headingEnter }]))];
