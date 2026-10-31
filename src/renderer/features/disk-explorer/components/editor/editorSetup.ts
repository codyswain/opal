import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand, markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, indentUnit, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { diff } from '@codemirror/merge';
import { search, searchKeymap } from '@codemirror/search';
import { ChangeSet, EditorSelection, EditorState, Transaction, type ChangeSpec, type Extension, type Line, type SelectionRange, type StateCommand } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { GFM } from '@lezer/markdown';
import { isDailyLog, isLogPage, readOnlyActivityLog, readOnlyLogPage } from './activityLog';
import { linkMarkStyle, livePreview } from './livePreview';
import { pageProperties } from './pageProperties';
import { pageContext, wikiLinkSyntax, wikiLinks, type OpenNote } from './wikiLinks';

/** The edits that turn `current` into `next`, as small as a character diff finds them. */
export function textChanges(current: string, next: string): ChangeSpec[] {
  return diff(current, next, { timeout: 100 }).map((change) => ({
    from: change.fromA,
    to: change.toA,
    insert: next.slice(change.fromB, change.toB),
  }));
}

/**
 * Brings the editor to `text` the way a collaborator's edit would arrive: only
 * the changed ranges move, so the cursor and scroll stay put, and undo never
 * takes the change back. It passes the read-only log guard.
 */
export function replaceText(view: EditorView, text: string): void {
  const current = view.state.doc.toString();
  if (current === text) return;
  view.dispatch({
    changes: textChanges(current, text),
    annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)],
    filter: false,
  });
}

// Marks that open a line before its text: a quote's ">", a list's "-" or "1.", a task's box, a heading's "#".
const LINE_MARKS = new Set(['QuoteMark', 'ListMark', 'TaskMarker', 'HeaderMark']);

/** Where a line's text starts, past the marks that open it. */
function textStart(state: EditorState, line: Line): number {
  const tree = syntaxTree(state);
  let at = line.from;
  for (;;) {
    while (at < line.to && /[ \t]/.test(state.sliceDoc(at, at + 1))) at += 1;
    const node = tree.resolveInner(at, 1);
    if (node.from !== at || node.to > line.to || !LINE_MARKS.has(node.name)) return at;
    at = node.to;
  }
}

/**
 * The parts of a selection to wrap, one per line: the selected text of each
 * line without the marks that open it or the spaces that end it. A selected
 * bullet keeps its "- " outside the bold, and a selection over several lines
 * wraps each, since a mark never closes on another line.
 */
function lineSpans(state: EditorState, range: SelectionRange): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  for (let at = range.from; at <= range.to;) {
    const line = state.doc.lineAt(at);
    const from = Math.max(range.from, textStart(state, line));
    const to = Math.min(range.to, line.from + line.text.trimEnd().length);
    if (to > from) spans.push({ from, to });
    at = line.to + 1;
  }
  return spans;
}

/**
 * Wraps each selection in `marker`, or unwraps it when every line of it is
 * already wrapped. Each end's marker may sit just outside the selection or be
 * its own first or last characters, as when a whole bold line is selected.
 */
function toggleMarker(marker: string): StateCommand {
  return ({ state, dispatch }) => {
    const size = marker.length;
    // One star beside exactly one other is half of a bold's "**", so Cmd+I on bold text adds italic.
    const isMarker = (from: number, to: number) => state.sliceDoc(from, to) === marker
      && !(size === 1 && (state.sliceDoc(from - 1, from) === '*') !== (state.sliceDoc(to, to + 1) === '*'));
    /** Where the opening and closing markers of a span start, or null when it is not wrapped. */
    const markers = (from: number, to: number): [number, number] | null => {
      const open = isMarker(from - size, from) ? from - size : isMarker(from, from + size) ? from : null;
      const close = isMarker(to, to + size) ? to : isMarker(to - size, to) ? to - size : null;
      return open !== null && close !== null && open + size <= close ? [open, close] : null;
    };
    dispatch(state.update(state.changeByRange((range) => {
      if (range.empty) {
        return markers(range.from, range.to)
          ? { changes: { from: range.from - size, to: range.to + size }, range: EditorSelection.cursor(range.from - size) }
          : { changes: { from: range.from, insert: marker + marker }, range: EditorSelection.cursor(range.from + size) };
      }
      const spans = lineSpans(state, range).map((span) => ({ ...span, wrapped: markers(span.from, span.to) }));
      if (spans.length === 0) return { range };
      const unwrap = spans.every((span) => span.wrapped);
      const changes = ChangeSet.of(spans.flatMap(({ from, to, wrapped }): ChangeSpec[] => {
        if (!wrapped) return [{ from, insert: marker }, { from: to, insert: marker }];
        return unwrap ? [{ from: wrapped[0], to: wrapped[0] + size }, { from: wrapped[1], to: wrapped[1] + size }] : [];
      }), state.doc.length);
      const from = changes.mapPos(spans[0].from, 1);
      const to = changes.mapPos(spans[spans.length - 1].to, -1);
      return { changes, range: range.anchor > range.head ? EditorSelection.range(to, from) : EditorSelection.range(from, to) };
    }), { scrollIntoView: true, userEvent: 'input' }));
    return true;
  };
}

// Enter on an empty item always moves it out a level. By default an empty
// second item instead gets a blank line above it, which makes a tight list loose.
const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });

/**
 * `tr` with the spaces taken off each line it leaves holding only spaces.
 * The indent before a caret stays when `keepIndent` says so for the line.
 */
function withoutSpaceLines(tr: Transaction, keepIndent: (line: Line) => boolean = () => true): Transaction {
  const { newDoc, newSelection } = tr;
  const cuts = new Map<number, ChangeSpec>();
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    for (let at = fromB; at <= toB;) {
      const line = newDoc.lineAt(at);
      at = line.to + 1;
      if (!/^[ \t]+$/.test(line.text)) continue;
      const caret = newSelection.ranges.find((range) => range.head >= line.from && range.head <= line.to);
      const from = caret && keepIndent(line) ? caret.head : line.from;
      if (from < line.to) cuts.set(line.number, { from, to: line.to });
    }
  });
  if (cuts.size === 0) return tr;
  const cut = ChangeSet.of([...cuts.values()], newDoc.length);
  return tr.startState.update({ changes: tr.changes.compose(cut), selection: newSelection.map(cut), scrollIntoView: true, userEvent: tr.annotation(Transaction.userEvent) });
}

// A list item's line: any indent and quote marks, then a bullet or a number.
const ITEM_LINE = /^[\s>]*(?:[-+*]|\d+[.)])(?:[ \t]|$)/;
const hasText = (line: Line) => /[^\s>]/.test(line.text);

/**
 * `tr` with a blank line between a list and each caret that `tr` left on an
 * empty line by taking an item's marker off. Text typed on the line straight
 * after a list item belongs to that item; after a blank line it starts a
 * paragraph. A list item below gets a blank line too, so it stays a list.
 */
function blankLinesAroundEnd(tr: Transaction): Transaction {
  const { startState, newDoc, newSelection } = tr;
  if (newSelection.ranges.length !== startState.selection.ranges.length) return tr;
  const changes: ChangeSpec[] = [];
  const carets = new Map<number, number>();
  newSelection.ranges.forEach((range, index) => {
    const line = newDoc.lineAt(range.head);
    if (!ITEM_LINE.test(startState.doc.lineAt(startState.selection.ranges[index].head).text) || hasText(line)) return;
    const above = line.number > 1 && hasText(newDoc.line(line.number - 1));
    if (!above) return;
    const below = line.number < newDoc.lines && hasText(newDoc.line(line.number + 1));
    // A quote's blank line keeps its ">".
    const blank = line.text.trimEnd();
    changes.push({ from: line.from, to: line.to, insert: `${blank}\n${line.text}${below ? `\n${blank}` : ''}` });
    carets.set(index, blank.length + 1 + range.head - line.from);
  });
  if (changes.length === 0) return tr;
  const extra = ChangeSet.of(changes, newDoc.length);
  const ranges = newSelection.ranges.map((range, index) => {
    const offset = carets.get(index);
    return offset === undefined ? range.map(extra) : EditorSelection.cursor(extra.mapPos(newDoc.lineAt(range.head).from, -1) + offset);
  });
  return startState.update({
    changes: tr.changes.compose(extra),
    selection: EditorSelection.create(ranges, newSelection.mainIndex),
    scrollIntoView: true,
    userEvent: 'input',
  });
}

/**
 * Enter in a list or quote, as in Obsidian. A non-empty item continues, split
 * at the caret. An empty nested item moves out one level, and an empty
 * top-level item loses its marker, so the list ends and the caret starts a
 * paragraph below a blank line. Numbered lists renumber, and no line is left
 * holding only spaces. Returns false outside lists and quotes, so a plain
 * newline runs.
 */
export const insertNewlineInList: StateCommand = ({ state, dispatch }) => {
  let unchanged = false;
  const handled = continueMarkup({
    state,
    dispatch: (tr) => {
      if (tr.newDoc.eq(state.doc)) unchanged = true;
      else dispatch(blankLinesAroundEnd(withoutSpaceLines(tr)));
    },
  });
  // An item below one indented before its quote's ">" gets its own marker
  // back, a change of nothing. One indent after the ">" comes off instead.
  return unchanged ? indentInQuote(false)({ state, dispatch }) : handled;
};

/**
 * Backspace just after a list or quote marker takes one level of markup off.
 * On a top-level item that leaves an empty line, not the spaces that would
 * carry on the item above.
 */
export const deleteMarkupInList: StateCommand = ({ state, dispatch }) =>
  deleteMarkupBackward({
    state,
    dispatch: (tr) => dispatch(withoutSpaceLines(tr, (line) => {
      const before = tr.startState.doc.lineAt(tr.changes.invertedDesc.mapPos(line.from));
      return !/^(?:[-+*]|\d+[.)])/.test(before.text);
    })),
  });

// A quote's ">" marks, and the space after each, at the start of a line.
const QUOTE_MARKS = /^ {0,3}(?:> ?)+/;

/**
 * Tab and Shift+Tab when every selected line is in a quote: the indent goes
 * after the ">" marks, so a list in a callout nests. Returns false otherwise,
 * and for Shift+Tab when no line has an indent there, so lines indent as usual.
 */
function indentInQuote(more: boolean): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const lines = new Map<number, Line>();
    for (const range of state.selection.ranges) {
      const last = state.doc.lineAt(range.to);
      // A selection that ends at the start of a line leaves that line alone.
      const end = !range.empty && range.to === last.from && last.from > range.from ? last.number - 1 : last.number;
      for (let number = state.doc.lineAt(range.from).number; number <= end; number += 1) lines.set(number, state.doc.line(number));
    }
    const quoted = [...lines.values()].map((line) => ({ line, quote: QUOTE_MARKS.exec(line.text)?.[0] ?? '' }));
    if (quoted.some(({ quote }) => !quote)) return false;
    const unit = state.facet(indentUnit);
    const changes = quoted.flatMap(({ line, quote }): ChangeSpec[] => {
      const from = line.from + quote.length;
      if (more) return [{ from, insert: unit }];
      const indent = /^(?:\t| {1,4})/.exec(line.text.slice(quote.length))?.[0] ?? '';
      return indent ? [{ from, to: from + Math.min(indent.length, unit.length) }] : [];
    });
    if (changes.length === 0) return false;
    dispatch(state.update({ changes, scrollIntoView: true, userEvent: more ? 'input.indent' : 'delete.dedent' }));
    return true;
  };
}

// Inline styles as classes for editor.css. Marks still showing on an edited line are muted.
const highlight = HighlightStyle.define([
  { tag: tags.strong, class: 'cm-md-strong' },
  { tag: tags.emphasis, class: 'cm-md-em' },
  { tag: tags.strikethrough, class: 'cm-md-strike' },
  { tag: tags.heading, class: 'cm-md-strong' },
  { tag: [tags.processingInstruction, tags.labelName, tags.comment, tags.contentSeparator], class: 'cm-md-syntax' },
]);

// Cmd+[ and Cmd+] are Back and Forward in the app menu, as in Safari, and
// Cmd+Shift+\ toggles the right sidebar; a key the editor takes never reaches
// the menu. Tab and Shift+Tab still indent. Cmd+Option+Up and Down would add
// a cursor, which a page with one selection only turns into a caret move; a
// stack's sections take them for the next and previous section instead.
const MENU_KEYS = new Set(['Mod-[', 'Mod-]', 'Shift-Mod-\\', 'Mod-Alt-ArrowUp', 'Mod-Alt-ArrowDown']);
const editingKeymap = defaultKeymap.filter((binding) => !MENU_KEYS.has(binding.key ?? ''));

/**
 * The page editor's setup. The document is the Markdown body exactly as read:
 * only "\n" splits lines, so a stray "\r" stays a character and `toString()`
 * gives back the same text. `openNote` follows a link.
 */
export function markdownEditorExtensions(path: string, openNote: OpenNote = () => undefined): Extension[] {
  return [
    EditorState.lineSeparator.of('\n'),
    pageContext.of({ path, openNote }),
    history(),
    markdown({ extensions: [GFM, wikiLinkSyntax, linkMarkStyle], completeHTMLTags: false, addKeymap: false }),
    syntaxHighlighting(highlight),
    wikiLinks,
    livePreview,
    pageProperties,
    search({ top: true }),
    keymap.of([
      { key: 'Enter', run: insertNewlineInList },
      { key: 'Backspace', run: deleteMarkupInList },
      { key: 'Tab', run: indentInQuote(true), shift: indentInQuote(false) },
      { key: 'Mod-b', run: toggleMarker('**') },
      { key: 'Mod-i', run: toggleMarker('*') },
      ...searchKeymap,
      ...historyKeymap,
      indentWithTab,
      ...editingKeymap,
    ]),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ spellcheck: 'false', 'data-testid': 'markdown-editor' }),
    placeholder('Start writing…'),
    isLogPage(path) ? readOnlyLogPage() : isDailyLog(path) ? readOnlyActivityLog() : [],
  ];
}
