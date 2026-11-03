import { isolateHistory } from '@codemirror/commands';
import { Annotation, ChangeSet, EditorSelection, EditorState, Transaction, type ChangeSpec, type Extension, type TransactionSpec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { latestTree, outsideProtected } from './extensionPoints';
import { inlineSpans, linkAt, withoutEdgeMarks, writeLink } from './formatCommands';
import { docMode } from './livePreview';
import { literalText, rawAt } from './typing';

/*
 * The clipboard in a document. Copy, cut and drag write balanced Markdown:
 * a selection that half covers bold or a link takes the marks it needs, so
 * `old and a l` out of `**bold** and a [link](url)` pastes as
 * `**old** and a [l](url)`. With nothing selected, copy and cut do nothing.
 * Paste and Match Style (⌘⇧V) writes the text literally. A URL pasted over
 * a selection links it, or over a link's text changes its address. Lines
 * pasted, dropped or composed into a quote, callout or list item take the
 * container's prefix, so the container stays one.
 */

// Code whose text is copied as it is: a selection inside one code span or block.
const CODE = new Set(['InlineCode', 'FencedCode', 'CodeBlock']);

function codeAround(state: EditorState, from: number, to: number): SyntaxNode | null {
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(from, 1); node; node = node.parent) {
    if (CODE.has(node.name)) return node.from <= from && to <= node.to ? node : null;
  }
  return null;
}

/** The Markdown of `from` to `to` with the marks of formatting it half covers added, so it pastes as it shows. */
export function balancedText(state: EditorState, from: number, to: number): string {
  if (codeAround(state, from, to) && rawAt(state, from) && rawAt(state, to)) return state.sliceDoc(from, to);
  ({ from, to } = outsideProtected(state, from, to));
  ({ from, to } = withoutEdgeMarks(state, from, to));
  let before = '';
  let after = '';
  for (const span of inlineSpans(state, from, to)) {
    const opens = state.sliceDoc(span.from, span.textFrom);
    const closes = state.sliceDoc(span.textTo, span.to);
    const startsBefore = span.from < from && from < span.textTo;
    const endsAfter = span.to > to && to > span.textFrom;
    // Outer spans come first: their opening marks go first, their closing marks last.
    if (startsBefore) before += opens;
    if (endsAfter) after = closes + after;
  }
  return before + state.sliceDoc(from, to) + after;
}

/** Copy and drag output: each selected range balanced. */
const balancedOutput = EditorView.clipboardOutputFilter.of((text, state) => {
  if (!state.facet(docMode)) return text;
  const ranges = state.selection.ranges.filter((range) => !range.empty);
  if (ranges.length > 0 && text === ranges.map((range) => state.sliceDoc(range.from, range.to)).join(state.lineBreak)) {
    return ranges.map((range) => balancedText(state, range.from, range.to)).join(state.lineBreak);
  }
  const { main } = state.selection;
  return text === state.sliceDoc(main.from, main.to) ? balancedText(state, main.from, main.to) : text;
});

/** The marks that carry a line on in the container at `at`: quote marks and a list item's content indent. */
export function containerPrefix(state: EditorState, at: number): string {
  const line = state.doc.lineAt(at);
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(at, -1); node; node = node.parent) {
    if (node.name === 'Blockquote') {
      const quote = /^(?:[ \t]*>[ \t]?)+/.exec(line.text)?.[0] ?? '>';
      return quote.endsWith(' ') || quote.endsWith('\t') ? quote : `${quote} `;
    }
    if (node.name === 'ListItem') {
      const first = state.doc.lineAt(node.from);
      const match = /^((?:[ \t]*>[ \t]?)*)([ \t]*)([-+*]|\d+[.)])([ \t]*)/.exec(first.text);
      if (!match) return '';
      const spaces = match[4].length >= 1 && match[4].length <= 4 ? match[4].length : 1;
      return match[1] + match[2] + ' '.repeat(match[3].length + spaces);
    }
  }
  return '';
}

/**
 * `text` with every line after the first behind `prefix`; a blank line takes
 * the prefix without its spaces. A line that starts with the prefix already,
 * as a file insert writes it, is inside the container and stays as it is.
 */
export function prefixLines(text: string, prefix: string): string {
  if (!prefix) return text;
  const blank = prefix.replace(/[ \t]+$/, '');
  return text.split('\n').map((line, index) => {
    if (index === 0 || line.startsWith(prefix) || (blank && line === blank)) return line;
    return `${line ? prefix : blank}${line}`;
  }).join('\n');
}

/** Marks a transaction whose lines already carry their container's prefix. */
const prefixed = Annotation.define<boolean>();

const SPREAD = ['input.paste', 'input.drop', 'move.drop', 'input.type.compose'];

/**
 * Lines pasted, dropped or composed into a quote, callout or list item take
 * the caret line's container prefix. A drag that moves text keeps the marks
 * around what it moves away, as Backspace does.
 */
function containedLines(replace: (state: EditorState, from: number, to: number, insert: string) => { changes: ChangeSpec[] }) {
  return EditorState.transactionFilter.of((tr) => {
    const state = tr.startState;
    if (!tr.docChanged || !state.facet(docMode) || tr.annotation(prefixed) || !SPREAD.some((event) => tr.isUserEvent(event))) return tr;
    const edits: { from: number; to: number; insert: string }[] = [];
    tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => edits.push({ from, to, insert: inserted.toString() }));
    const moved = tr.isUserEvent('move.drop');
    if (!moved && !edits.some((edit) => edit.insert.includes('\n'))) return tr;
    const specs: ChangeSpec[] = [];
    const inserts: { at: number; length: number }[] = [];
    let changed = false;
    for (const edit of edits) {
      if (moved && edit.to > edit.from && !edit.insert) {
        specs.push(...replace(state, edit.from, edit.to, '').changes);
        changed = true;
        continue;
      }
      const insert = prefixLines(edit.insert, containerPrefix(state, edit.from));
      if (insert !== edit.insert) changed = true;
      specs.push({ from: edit.from, to: edit.to, insert });
      inserts.push({ at: edit.from, length: insert.length });
    }
    if (!changed) return tr;
    const changes = ChangeSet.of(specs, state.doc.length);
    // The caret or the dropped text's selection, as CodeMirror would put it.
    const last = inserts[inserts.length - 1];
    const selection = last && tr.selection
      ? (tr.newSelection.main.empty
        ? EditorSelection.cursor(changes.mapPos(last.at, 1))
        : EditorSelection.range(changes.mapPos(last.at, -1), changes.mapPos(last.at, 1)))
      : undefined;
    const history = tr.annotation(isolateHistory);
    return {
      changes,
      selection,
      effects: tr.effects,
      scrollIntoView: true,
      userEvent: tr.annotation(Transaction.userEvent),
      annotations: history ? [prefixed.of(true), isolateHistory.of(history)] : prefixed.of(true),
    };
  });
}

const URL_TEXT = /^(?:https?:\/\/|mailto:|obsidian:\/\/|opal:\/\/)\S+$/i;

/**
 * What a paste of `text` writes in a document, or null to leave it to
 * CodeMirror: a URL over a selection links it, or changes the address of
 * the link whose text holds the selection; `literal` text is escaped where
 * it would read as Markdown. Lines after the first take the container's
 * prefix.
 */
export function pasteSpec(state: EditorState, text: string, literal: boolean): TransactionSpec | null {
  if (state.selection.ranges.length > 1) return null;
  const range = state.selection.main;
  const pasted = text.replace(/\r\n?/g, '\n');
  const url = pasted.trim();
  // Paste and Match Style pastes a URL as text, so both stay a key away.
  if (!literal && !range.empty && URL_TEXT.test(url) && !rawAt(state, range.from)) {
    const link = linkAt(state, range.from);
    // Written as a link edit, not a paste, so doc mode's mark keeping leaves the address it replaces alone.
    if (link?.kind === 'link' && range.from >= link.textFrom && range.to <= link.textTo) {
      return writeLink(state, link, state.sliceDoc(link.textFrom, link.textTo), url, link);
    }
    return writeLink(state, range, state.sliceDoc(range.from, range.to), url, null);
  }
  if (!literal) return null;
  const prefix = containerPrefix(state, range.from);
  const insert = literalText(state, range.from, range.to, pasted, { prefix, table: inTable(state, range.from) });
  return {
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from + insert.length },
    scrollIntoView: true,
    userEvent: 'input.paste',
    annotations: prefixed.of(true),
  };
}

function inTable(state: EditorState, at: number): boolean {
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(at, 1); node; node = node.parent) {
    if (node.name === 'Table') return true;
  }
  return false;
}

// When ⌘⇧V was pressed: the paste event that follows it is Paste and Match Style.
const literalPresses = new WeakMap<EditorView, number>();
const LITERAL_MS = 1_000;

/** The next paste in `view` is literal, as Paste and Match Style. */
export function pasteLiterallyNext(view: EditorView): void {
  literalPresses.set(view, Date.now());
}

function takeLiteral(view: EditorView): boolean {
  const at = literalPresses.get(view);
  literalPresses.delete(view);
  return at !== undefined && Date.now() - at < LITERAL_MS;
}

const clipboardEvents = EditorView.domEventHandlers({
  copy(event, view) {
    if (!view.state.facet(docMode) || view.state.selection.ranges.some((range) => !range.empty)) return false;
    event.preventDefault();
    return true;
  },
  cut(event, view) {
    if (!view.state.facet(docMode) || view.state.selection.ranges.some((range) => !range.empty)) return false;
    event.preventDefault();
    return true;
  },
  paste(event, view) {
    const literal = takeLiteral(view);
    if (!view.state.facet(docMode) || view.state.readOnly) return false;
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!text) return false;
    const spec = pasteSpec(view.state, text, literal);
    if (!spec) return false;
    event.preventDefault();
    view.dispatch(spec);
    return true;
  },
});

/** Doc mode's clipboard. `replace` is doc mode's `replaceVisible`. */
export function clipboard(replace: (state: EditorState, from: number, to: number, insert: string) => { changes: ChangeSpec[] }): Extension {
  return [
    balancedOutput,
    clipboardEvents,
    containedLines(replace),
    // ⌘⇧V reaches the menu's Paste and Match Style, whose paste event comes next.
    keymap.of([{ key: 'Mod-Shift-v', run: (view) => { pasteLiterallyNext(view); return false; } }]),
  ];
}
