import React, { useEffect, useMemo, useRef, useState } from 'react';
import { historyField } from '@codemirror/commands';
import { getChunks, unifiedMergeView } from '@codemirror/merge';
import { Compartment, EditorState, Transaction, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { isDocFile } from '@/common/fileKind';
import { recordOpened } from '../../activity/recordActivity';
import { fileLocation } from '../../navigation/filesLocation';
import { togglePageProperties, usePagePropertiesStore } from '../../store/pagePropertiesStore';
import { useTabsStore } from '../../store/tabsStore';
import { isLogPage } from './activityLog';
import { linkEditor, type LinkEditor } from './docMode';
import { CalloutTypeMenu } from './CalloutTypeMenu';
import { DocToolbar } from './DocToolbar';
import { EditorStatus } from './EditorStatus';
import { pageWordCount, pageWords, selectedWordCount } from './wordMotion';
import type { PageObject } from './extensionPoints';
import { setFileProperties } from './firstLine';
import { markdownEditorExtensions, replaceText, textChanges } from './editorSetup';
import { formatState, sameFormat, type FormatState } from './formatState';
import { LinkPopover } from './LinkPopover';
import { MathPopover } from './MathPopover';
import { mathEditor, type MathEditor } from './mathWrite';
import { showInlineTitle } from './livePreview';
import { ObjectBar, ObjectMenu } from './ObjectBar';
import { objectFrame } from './objectFrame';
import { setPageProperties } from './pageProperties';
import { useMarkdownDocument, type MarkdownDocumentActions, type MarkdownDocumentState } from './useMarkdownDocument';
import { usePageProperties } from './usePageProperties';
import type { OpenNote } from './wikiLinks';
import { CommentBox, CommentMarkPopover, commentBox, commentExtensions, openMark, type CommentBoxAt } from '@/renderer/features/comment';
import '@/renderer/features/comment/comment.css';
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
  /** How a followed link opens. By default it replaces the page in its tab, or opens a new tab with `newTab`. */
  openNote?: OpenNote;
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
  /**
   * Section layout: the state this file's editor had when it last went,
   * read once when the view is created. Its undo history comes back when its
   * text is still the file's.
   */
  restoreState?: () => EditorState | null;
}

/** A followed link replaces the page in its tab, or opens a new tab, as an open from the tree does. */
function openNoteInTab(path: string, newTab: boolean): void {
  recordOpened(path);
  useTabsStore.getState().open(fileLocation(path), { newTab });
}

// The word count waits for typing to pause, since it reads the whole page.
const COUNT_DELAY_MS = 250;

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
  path, layout, document, initialBody, autoFocusEmpty = false, openNote = openNoteInTab, propertiesShown, onToggleProperties, onView, extensions, restoreState,
}) => {
  const section = layout === 'section';
  const doc = isDocFile(path);
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // A document's toolbar and link popover follow the editor's state. A section has no toolbar
  // of its own: its stack draws one for all its documents (StackToolbar.tsx).
  const [docView, setDocView] = useState<EditorView | null>(null);
  const [format, setFormat] = useState<FormatState | null>(null);
  const [link, setLink] = useState<LinkEditor | null>(null);
  const [framed, setFramed] = useState<PageObject | null>(null);
  const [formula, setFormula] = useState<MathEditor | null>(null);
  // Comment's box and mark popover, in notes and documents alike.
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const [comment, setComment] = useState<{ box: CommentBoxAt | null; mark: string | null }>({ box: null, mark: null });
  const conflict = useMemo(() => new Compartment(), []);
  const [words, setWords] = useState<{ words: number; selected: number | null }>({ words: 0, selected: null });
  const counting = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The page's total is read again only after the text changed; a caret move counts the selection alone.
  const recount = useRef(false);
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
    const config = {
      extensions: [
        markdownEditorExtensions(path, openNote),
        section ? showInlineTitle.of(false) : [],
        extensions ?? [],
        keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { void actions.current.flush(); return true; } }]),
        conflict.of([]),
        commentExtensions({ path, flush: () => actions.current.flush() }),
        EditorView.updateListener.of((update) => {
          const box = update.state.field(commentBox);
          const mark = update.state.field(openMark);
          setComment((shown) => (shown.box === box && shown.mark === mark ? shown : { box, mark }));
          if (update.docChanged || update.selectionSet) {
            if (update.docChanged) recount.current = true;
            if (counting.current) clearTimeout(counting.current);
            counting.current = setTimeout(() => {
              counting.current = null;
              const whole = recount.current;
              recount.current = false;
              const total = whole ? pageWordCount(created.state) : null;
              const selected = selectedWordCount(created.state);
              setWords((shown) => {
                const words = total ?? shown.words;
                return words === shown.words && selected === shown.selected ? shown : { words, selected };
              });
            }, COUNT_DELAY_MS);
          }
          if (update.docChanged) {
            if (update.transactions.some((tr) => tr.docChanged && !tr.annotation(Transaction.remote))) {
              actions.current.onChange(update.state.doc.toString());
            }
          }
          // Every conflicting change has a pick once the merge view has no chunks left.
          if (getChunks(update.state)?.chunks.length === 0) actions.current.resolveConflict();
          if (update.focusChanged && !update.view.hasFocus) void actions.current.flush();
          if (doc && (update.docChanged || update.selectionSet || update.transactions.some((tr) => tr.effects.length > 0))) {
            if (!section) {
              const next = formatState(update.state);
              setFormat((shown) => (sameFormat(shown, next) ? shown : next));
            }
            setLink(update.state.field(linkEditor));
            setFramed(update.state.field(objectFrame, false) ?? null);
            setFormula(update.state.field(mathEditor, false) ?? null);
          }
        }),
      ],
    };
    const last = restoreState?.();
    const created = new EditorView({
      parent: host.current as HTMLDivElement,
      state: last && last.doc.toString() === initialBody
        ? EditorState.fromJSON({ ...last.toJSON({ history: historyField }), doc: initialBody }, config, { history: historyField })
        : EditorState.create({ doc: initialBody, ...config }),
    });
    view.current = created;
    setEditorView(created);
    setWords(pageWords(created.state));
    if (doc) {
      setDocView(created);
      if (!section) setFormat(formatState(created.state));
    }
    // A page opens at the top without taking focus; an empty one gets the caret.
    // In a stack only the section that asks for it does, so scrolling never moves the caret.
    if (created.state.doc.length === 0 && (!section || autoFocusEmpty)) created.focus();
    const detach = actions.current.attach({
      getText: () => created.state.doc.toString(),
      setText: (text) => replaceText(created, text),
    });
    onViewRef.current?.(created);
    return () => {
      if (counting.current) clearTimeout(counting.current);
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

  useEffect(() => {
    view.current?.dispatch({ effects: setFileProperties.of(document.properties > 0) });
  }, [document.properties]);

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
      {docView && format && !section ? <DocToolbar view={docView} format={format} /> : null}
      <div ref={host} className={section ? 'relative' : 'relative min-h-0 flex-1'} />
      {docView && link ? <LinkPopover view={docView} editor={link} /> : null}
      {docView && framed ? <ObjectBar view={docView} frame={framed} /> : null}
      {docView && formula ? <MathPopover key={formula.id} view={docView} editor={formula} /> : null}
      {docView ? <ObjectMenu view={docView} /> : null}
      {docView ? <CalloutTypeMenu view={docView} /> : null}
      {editorView && comment.box ? <CommentBox key={comment.box.id} view={editorView} box={comment.box} /> : null}
      {editorView && comment.mark ? <CommentMarkPopover key={comment.mark} view={editorView} id={comment.mark} /> : null}
      <EditorStatus
        saveState={document.saveState}
        error={document.error}
        properties={document.properties}
        words={words.words}
        selectedWords={words.selected}
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
