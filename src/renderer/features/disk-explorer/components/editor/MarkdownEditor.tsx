import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getChunks, unifiedMergeView } from '@codemirror/merge';
import { Compartment, EditorState, Transaction, type Text } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { recordOpened } from '../../activity/recordActivity';
import { fileLocation } from '../../navigation/filesLocation';
import { togglePageProperties, usePagePropertiesStore } from '../../store/pagePropertiesStore';
import { useTabsStore } from '../../store/tabsStore';
import { isLogPage } from './activityLog';
import { EditorStatus } from './EditorStatus';
import { markdownEditorExtensions, replaceText, textChanges } from './editorSetup';
import { setPageProperties } from './pageProperties';
import { useMarkdownDocument, type MarkdownDocumentActions, type MarkdownDocumentState } from './useMarkdownDocument';
import { usePageProperties } from './usePageProperties';
import './editor.css';

interface MarkdownEditorProps {
  path: string;
}

/** A followed link replaces the page in its tab, as a plain open from the tree does. */
function openNote(path: string): void {
  recordOpened(path);
  useTabsStore.getState().open(fileLocation(path));
}

/** Words are runs of text with a letter or digit, so list markers, `#` and `|` do not count. */
function countWords(doc: Text): number {
  return doc.toString().match(/\S*[\p{L}\p{N}]\S*/gu)?.length ?? 0;
}

/**
 * While a conflict is open, the page shows the disk's side of each
 * conflicting change above its own, with a button to keep either.
 */
function conflictView(disk: string) {
  return [
    unifiedMergeView({ original: disk, gutter: false, syntaxHighlightDeletions: false }),
    EditorState.phrases.of({ Accept: 'Keep mine', Reject: 'Keep disk version' }),
  ];
}

/**
 * The focused-file editor for Markdown. The document hook owns disk state;
 * the surface below mounts once the text is loaded and creates one
 * CodeMirror view for the life of the page.
 */
export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({ path }) => {
  const document = useMarkdownDocument(path);

  if (document.status === 'unavailable') {
    return (
      <div role="alert" className="flex flex-1 items-center justify-center p-6 text-sm font-medium text-foreground">
        {document.error ?? 'This note could not be opened.'}
      </div>
    );
  }
  if (document.status !== 'ready' || document.body === null) {
    return <div role="status" className="p-8 text-sm text-muted-foreground">Opening note…</div>;
  }
  return <MarkdownEditorSurface path={path} document={document} initialBody={document.body} />;
};

interface MarkdownEditorSurfaceProps {
  path: string;
  document: MarkdownDocumentState & MarkdownDocumentActions;
  initialBody: string;
}

const MarkdownEditorSurface: React.FC<MarkdownEditorSurfaceProps> = ({ path, document, initialBody }) => {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const conflict = useMemo(() => new Compartment(), []);
  const [words, setWords] = useState(0);
  // The hook's state changes identity across renders; the editor reads the latest.
  const actions = useRef(document);
  actions.current = document;
  const propertiesOpen = usePagePropertiesStore((state) => state.open);
  const facts = usePageProperties(path, propertiesOpen, document.saveState);
  const wasOpen = useRef(propertiesOpen);

  useEffect(() => {
    const created = new EditorView({
      parent: host.current as HTMLDivElement,
      state: EditorState.create({
        doc: initialBody,
        extensions: [
          markdownEditorExtensions(path, openNote),
          keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { void actions.current.flush(); return true; } }]),
          conflict.of([]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              setWords(countWords(update.state.doc));
              if (update.transactions.some((tr) => tr.docChanged && !tr.annotation(Transaction.remote))) {
                actions.current.onChange(update.state.doc.toString());
              }
            }
            // Every conflicting change has a pick once the merge view has no chunks left.
            if (getChunks(update.state)?.chunks.length === 0) actions.current.resolveConflict();
            if (update.focusChanged && !update.view.hasFocus) void actions.current.flush();
          }),
        ],
      }),
    });
    view.current = created;
    setWords(countWords(created.state.doc));
    // A page opens at the top without taking focus; an empty one gets the caret.
    if (created.state.doc.length === 0) created.focus();
    const detach = actions.current.attach({
      getText: () => created.state.doc.toString(),
      setText: (text) => replaceText(created, text),
    });
    return () => {
      detach();
      created.destroy();
      view.current = null;
    };
    // One view per page: later text arrives through the document's handle.
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: conflict.reconfigure(document.conflict ? conflictView(document.conflict.disk) : []) });
  }, [conflict, document.conflict]);

  useEffect(() => {
    view.current?.dispatch({ effects: setPageProperties.of(facts) });
  }, [facts]);

  // The block opens under the title, so the page scrolls up to show it. Closing keeps the scroll.
  useEffect(() => {
    if (propertiesOpen && !wasOpen.current && view.current) view.current.scrollDOM.scrollTop = 0;
    wasOpen.current = propertiesOpen;
  }, [propertiesOpen]);

  // Escape closes the block only while focus is in it or on its toggle. In
  // the text, Escape belongs to the editor, so there the menu item closes it.
  const closePropertiesOnEscape = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape' || !propertiesOpen || !(event.target instanceof Element)) return;
    const onToggle = event.target.closest('[data-properties-toggle]') !== null;
    if (!onToggle && !event.target.closest('[data-page-properties]')) return;
    event.preventDefault();
    usePagePropertiesStore.getState().setOpen(false);
    // Focus in the block would go with it.
    if (!onToggle) view.current?.focus();
  };

  const keepDiskVersion = () => {
    const current = view.current;
    if (!current || !document.conflict) return;
    // An ordinary, undoable edit, so Cmd+Z brings the page's side back.
    current.dispatch({ changes: textChanges(current.state.doc.toString(), document.conflict.disk), userEvent: 'revert', filter: false });
    document.resolveConflict();
  };

  return (
    <div className="opal-editor flex h-full min-h-0 flex-col" onKeyDown={closePropertiesOnEscape}>
      <div ref={host} className="relative min-h-0 flex-1" />
      <EditorStatus
        saveState={document.saveState}
        error={document.error}
        properties={document.properties}
        words={words}
        readOnly={isLogPage(path)}
        propertiesOpen={propertiesOpen}
        onToggleProperties={togglePageProperties}
        onKeepMine={document.resolveConflict}
        onKeepDisk={keepDiskVersion}
        onRetry={() => void document.flush()}
      />
    </div>
  );
};
