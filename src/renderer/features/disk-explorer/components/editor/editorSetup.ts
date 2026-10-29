import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { diff } from '@codemirror/merge';
import { search, searchKeymap } from '@codemirror/search';
import { EditorSelection, EditorState, Transaction, type ChangeSpec, type Extension, type StateCommand } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { GFM } from '@lezer/markdown';
import { isDailyLog, isLogPage, readOnlyActivityLog, readOnlyLogPage } from './activityLog';
import { linkMarkStyle, livePreview } from './livePreview';
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

/** Wraps each selection in `marker`, or unwraps it when the marker is already around it. */
function toggleMarker(marker: string): StateCommand {
  return ({ state, dispatch }) => {
    const size = marker.length;
    dispatch(state.update(state.changeByRange((range) => {
      const wrapped = state.sliceDoc(range.from - size, range.from) === marker && state.sliceDoc(range.to, range.to + size) === marker;
      return wrapped
        ? {
          changes: [{ from: range.from - size, to: range.from }, { from: range.to, to: range.to + size }],
          range: EditorSelection.range(range.anchor - size, range.head - size),
        }
        : {
          changes: [{ from: range.from, insert: marker }, { from: range.to, insert: marker }],
          range: EditorSelection.range(range.anchor + size, range.head + size),
        };
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

// Cmd+[ and Cmd+] are Back and Forward in the app menu, as in Safari; a key
// the editor takes never reaches the menu. Tab and Shift+Tab still indent.
const editingKeymap = defaultKeymap.filter((binding) => binding.key !== 'Mod-[' && binding.key !== 'Mod-]');

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
