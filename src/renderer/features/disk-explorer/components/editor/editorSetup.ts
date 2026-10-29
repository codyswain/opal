import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { diff } from '@codemirror/merge';
import { search, searchKeymap } from '@codemirror/search';
import { EditorSelection, EditorState, Transaction, type ChangeSpec, type Extension, type StateCommand } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { GFM } from '@lezer/markdown';
import { isDailyLog, readOnlyActivityLog } from './activityLog';

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
 * takes the change back. It passes the read-only Activity Log guard.
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

// Plain source styling until the live preview lands: markup is muted, text keeps its weight.
const highlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '700' },
  { tag: tags.heading1, fontSize: '1.5em' },
  { tag: tags.heading2, fontSize: '1.3em' },
  { tag: tags.heading3, fontSize: '1.15em' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'hsl(var(--focus))' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.9em' },
  { tag: [tags.processingInstruction, tags.url, tags.contentSeparator, tags.quote], color: 'hsl(var(--text-tertiary))' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: 'hsl(var(--foreground))' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'var(--editor-line)' },
  '.cm-content': {
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: 'calc(var(--editor-measure) + 4rem)',
    margin: '0 auto',
    padding: '2.5rem 2rem 6rem',
    caretColor: 'hsl(var(--focus))',
  },
  '.cm-line': { padding: '0' },
  '.cm-placeholder': { color: 'hsl(var(--text-tertiary))' },
  '.cm-activity-log': { opacity: '0.65' },
});

/**
 * The page editor's setup. The document is the Markdown body exactly as read:
 * only "\n" splits lines, so a stray "\r" stays a character and `toString()`
 * gives back the same text.
 */
export function markdownEditorExtensions(path: string): Extension[] {
  return [
    EditorState.lineSeparator.of('\n'),
    history(),
    markdown({ extensions: GFM, completeHTMLTags: false }),
    syntaxHighlighting(highlight),
    search({ top: true }),
    keymap.of([
      { key: 'Mod-b', run: toggleMarker('**') },
      { key: 'Mod-i', run: toggleMarker('*') },
      ...searchKeymap,
      ...historyKeymap,
      indentWithTab,
      ...defaultKeymap,
    ]),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ spellcheck: 'false', 'data-testid': 'markdown-editor' }),
    placeholder('Start writing…'),
    theme,
    isDailyLog(path) ? readOnlyActivityLog() : [],
  ];
}
