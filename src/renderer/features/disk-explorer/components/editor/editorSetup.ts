import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { diff } from '@codemirror/merge';
import { search, searchKeymap } from '@codemirror/search';
import { ChangeSet, EditorSelection, EditorState, Transaction, type ChangeSpec, type Extension, type Line, type SelectionRange, type StateCommand } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { GFM } from '@lezer/markdown';
import { isDailyLog, isLogPage, readOnlyActivityLog, readOnlyLogPage } from './activityLog';
import { linkMarkStyle, livePreview } from './livePreview';
import { pageProperties } from './pageProperties';
import { pageContext, wikiLinkSyntax, wikiLinks } from './wikiLinks';

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
 * gives back the same text. `openNote` follows a wiki link.
 */
export function markdownEditorExtensions(path: string, openNote: (path: string) => void = () => undefined): Extension[] {
  return [
    EditorState.lineSeparator.of('\n'),
    pageContext.of({ path, openNote }),
    history(),
    markdown({ extensions: [GFM, wikiLinkSyntax, linkMarkStyle], completeHTMLTags: false }),
    syntaxHighlighting(highlight),
    wikiLinks,
    livePreview,
    pageProperties,
    search({ top: true }),
    keymap.of([
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
