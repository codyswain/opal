import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getChunks, unifiedMergeView } from '@codemirror/merge';
import { Compartment, EditorState, Transaction, type Extension, type Text } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { recordOpened } from '../../activity/recordActivity';
import { fileLocation } from '../../navigation/filesLocation';
import { togglePageProperties, usePagePropertiesStore } from '../../store/pagePropertiesStore';
import { useTabsStore } from '../../store/tabsStore';
import { isLogPage } from './activityLog';
import { EditorStatus } from './EditorStatus';
import { markdownEditorExtensions, replaceText, textChanges } from './editorSetup';
import { showInlineTitle } from './livePreview';
import { setPageProperties } from './pageProperties';
import { useMarkdownDocument, type MarkdownDocumentActions, type MarkdownDocumentState } from './useMarkdownDocument';
import { usePageProperties } from './usePageProperties';
import './editor.css';

export type EditorLayout = 'page' | 'section';

interface MarkdownEditorProps {
  path: string;
  /**
   * 'page' fills the pane and scrolls itself. 'section' is one file in a
   * stack: it grows with its text inside the stack's scroll, and the stack
   * draws its title.
   */
  layout?: EditorLayout;
  /** Section layout: an empty file takes the caret when it mounts. Pages always do. */
  autoFocusEmpty?: boolean;
  /** How a followed link opens. By default it replaces the page in its tab. */
  openNote?: (path: string) => void;
  /** Section layout: whether this section shows the properties block. Pages follow the global flag. */
  propertiesShown?: boolean;
  /** Section layout: the footer line's click. Pages toggle the global flag. */
  onToggleProperties?: () => void;
  /** The editor's view once it exists, and null once it is gone. */
  onView?: (view: EditorView | null) => void;
  /** Called once the file has been read, or could not be. */
  onLoaded?: () => void;
  /** More extensions for this editor, such as a stack's keys. Read once, when the view is created. */
  extensions?: Extension;
  /** Section layout: the height to hold while the file is read. */
  loadingHeight?: number;
}

/** A followed link replaces the page in its tab, as a plain open from the tree does. */
function openNoteInTab(path: string): void {
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
export const MarkdownEditor: React.FC<MarkdownEditorProps> = (props) => {
  const { path, layout = 'page', onLoaded, loadingHeight } = props;
  const document = useMarkdownDocument(path);
  const loaded = document.status !== 'loading';
  const reported = useRef(false);
  useEffect(() => {
    if (!loaded || reported.current) return;
    reported.current = true;
    onLoaded?.();
  }, [loaded, onLoaded]);

  if (document.status === 'unavailable') {
    return (
      <div role="alert" className={layout === 'page' ? 'flex flex-1 items-center justify-center p-6 text-sm font-medium text-foreground' : 'opal-section-message text-sm font-medium text-foreground'}>
        {document.error ?? 'This note could not be opened.'}
      </div>
    );
  }
  if (document.status !== 'ready' || document.body === null) {
    return layout === 'page'
      ? <div role="status" className="p-8 text-sm text-muted-foreground">Opening note…</div>
      : <div role="status" aria-busy aria-label="Opening note" style={{ height: loadingHeight }} />;
  }
  return <MarkdownEditorSurface {...props} layout={layout} document={document} initialBody={document.body} />;
};

interface MarkdownEditorSurfaceProps extends MarkdownEditorProps {
  layout: EditorLayout;
  document: MarkdownDocumentState & MarkdownDocumentActions;
  initialBody: string;
}

const MarkdownEditorSurface: React.FC<MarkdownEditorSurfaceProps> = ({
  path, layout, document, initialBody, autoFocusEmpty = false, openNote = openNoteInTab, propertiesShown, onToggleProperties, onView, extensions,
}) => {
  const section = layout === 'section';
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const conflict = useMemo(() => new Compartment(), []);
  const [words, setWords] = useState(0);
  // The hook's state changes identity across renders; the editor reads the latest.
  const actions = useRef(document);
  actions.current = document;
  const globalPropertiesOpen = usePagePropertiesStore((state) => state.open);
  const propertiesOpen = section ? !!propertiesShown : globalPropertiesOpen;
  const facts = usePageProperties(path, propertiesOpen, document.saveState);
  const onViewRef = useRef(onView);
  onViewRef.current = onView;
  const wasOpen = useRef(propertiesOpen);

  useEffect(() => {
    const created = new EditorView({
      parent: host.current as HTMLDivElement,
      state: EditorState.create({
        doc: initialBody,
        extensions: [
          markdownEditorExtensions(path, openNote),
          section ? showInlineTitle.of(false) : [],
          extensions ?? [],
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
    // In a stack only the section that asks for it does, so scrolling never moves the caret.
    if (created.state.doc.length === 0 && (!section || autoFocusEmpty)) created.focus();
    const detach = actions.current.attach({
      getText: () => created.state.doc.toString(),
      setText: (text) => replaceText(created, text),
    });
    onViewRef.current?.(created);
    return () => {
      onViewRef.current?.(null);
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
  // In a stack the stack brings the section's top into view.
  useEffect(() => {
    if (!section && propertiesOpen && !wasOpen.current && view.current) view.current.scrollDOM.scrollTop = 0;
    wasOpen.current = propertiesOpen;
  }, [propertiesOpen, section]);

  // Escape closes the block only while focus is in it or on its toggle. In
  // the text, Escape belongs to the editor, so there the menu item closes it.
  const closePropertiesOnEscape = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape' || !propertiesOpen || !(event.target instanceof Element)) return;
    const onToggle = event.target.closest('[data-properties-toggle]') !== null;
    if (!onToggle && !event.target.closest('[data-page-properties]')) return;
    event.preventDefault();
    if (section && onToggleProperties) onToggleProperties();
    else usePagePropertiesStore.getState().setOpen(false);
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

  const problem = document.saveState === 'conflict' || document.saveState === 'error';
  return (
    <div
      className={section ? 'opal-editor' : 'opal-editor flex h-full min-h-0 flex-col'}
      data-layout={layout}
      data-problem={problem ? '' : undefined}
      data-properties-shown={propertiesOpen ? '' : undefined}
      onKeyDown={closePropertiesOnEscape}
    >
      <div ref={host} className={section ? 'relative' : 'relative min-h-0 flex-1'} />
      <EditorStatus
        saveState={document.saveState}
        error={document.error}
        properties={document.properties}
        words={words}
        readOnly={isLogPage(path)}
        propertiesOpen={propertiesOpen}
        onToggleProperties={section && onToggleProperties ? onToggleProperties : togglePageProperties}
        onKeepMine={document.resolveConflict}
        onKeepDisk={keepDiskVersion}
        onRetry={() => void document.flush()}
      />
    </div>
  );
};
