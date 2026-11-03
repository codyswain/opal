import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand, markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { diff } from '@codemirror/merge';
import { search, searchKeymap } from '@codemirror/search';
import { ChangeSet, EditorSelection, EditorState, Transaction, type ChangeSpec, type Extension, type Line, type StateCommand } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { GFM } from '@lezer/markdown';
import { isDocFile } from '@/common/fileKind';
import { isDailyLog, isLogPage, readOnlyActivityLog, readOnlyLogPage } from './activityLog';
import { blockGuards } from './blockGuards';
import { callouts } from './callouts';
import { guardedLineMoves } from './firstLine';
import { codeBlocks } from './codeBlocks';
import { docModeExtensions } from './docMode';
import { indentInQuote, toggleMarker } from './formatCommands';
import { nestListItems, withoutRenumbering } from './listKeys';
import { fileInserts } from './imageInsert';
import { docMode, linkMarkStyle, livePreview } from './livePreview';
import { mathReparse as math, mathSyntax } from './math';
import { pageProperties } from './pageProperties';
import { tableKeys } from './tableKeys';
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
  });
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
      else if (state.facet(docMode)) dispatch(withoutRenumbering(blankLinesAroundEnd(withoutSpaceLines(tr))));
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
 * gives back the same text. `openNote` follows a link. A document (.mdo)
 * also gets doc mode.
 */
export function markdownEditorExtensions(path: string, openNote: OpenNote = () => undefined): Extension[] {
  return [
    EditorState.lineSeparator.of('\n'),
    pageContext.of({ path, openNote }),
    history(),
    markdown({ extensions: [GFM, wikiLinkSyntax, linkMarkStyle, mathSyntax], completeHTMLTags: false, addKeymap: false }),
    syntaxHighlighting(highlight),
    wikiLinks,
    fileInserts,
    livePreview,
    blockGuards,
    guardedLineMoves,
    tableKeys,
    callouts,
    // Before code blocks, so a math fence draws as a formula.
    math,
    codeBlocks,
    pageProperties,
    search({ top: true }),
    keymap.of([
      { key: 'Enter', run: insertNewlineInList },
      { key: 'Backspace', run: deleteMarkupInList },
      { key: 'Tab', run: (view) => nestListItems(true)(view) || indentInQuote(true)(view), shift: (view) => nestListItems(false)(view) || indentInQuote(false)(view) },
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
    isDocFile(path) ? docModeExtensions() : [],
  ];
}
