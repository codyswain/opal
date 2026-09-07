import React, { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { markdownExtensions } from './editorExtensions';
import { EditorBubbleMenu } from './EditorBubbleMenu';
import { EditorStatus } from './EditorStatus';
import { useMarkdownDocument, type MarkdownDocumentActions, type MarkdownDocumentState } from './useMarkdownDocument';
import './editor.css';

interface MarkdownEditorProps {
  path: string;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

/**
 * The focused-file editor for Markdown. The document hook owns disk state;
 * the surface below mounts once the text is loaded and is re-keyed only when
 * the hook re-seeds (reload from disk), so the editor is created once per seed.
 */
export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({ path }) => {
  const document = useMarkdownDocument(path);

  if (document.status === 'unavailable') {
    return (
      <div role="alert" className="flex flex-1 items-center justify-center p-6 text-sm text-destructive">
        {document.error ?? 'This note could not be opened.'}
      </div>
    );
  }
  if (document.status !== 'ready' || document.body === null) {
    return <div role="status" className="p-8 text-sm text-muted-foreground">Opening note…</div>;
  }
  return <MarkdownEditorSurface key={`${path}:${document.seed}`} document={document} initialBody={document.body} />;
};

interface MarkdownEditorSurfaceProps {
  document: MarkdownDocumentState & MarkdownDocumentActions;
  initialBody: string;
}

const MarkdownEditorSurface: React.FC<MarkdownEditorSurfaceProps> = ({ document, initialBody }) => {
  const [words, setWords] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const extensions = useMemo(() => markdownExtensions(), []);
  // The hook's callbacks change identity across renders; the editor reads the latest.
  const actions = useRef(document);
  actions.current = document;

  const editor = useEditor({
    extensions,
    content: initialBody,
    autofocus: 'end',
    editorProps: {
      attributes: { class: 'opal-editor-content', spellcheck: 'true', 'data-testid': 'markdown-editor' },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          void actions.current.flush();
          return true;
        }
        return false;
      },
    },
    onCreate: ({ editor: created }) => setWords(countWords(created.getText())),
    onUpdate: ({ editor: updated }) => {
      setWords(countWords(updated.getText()));
      actions.current.onChange(updated.storage.markdown.getMarkdown());
    },
    onBlur: () => { void actions.current.flush(); },
  });

  useEffect(() => () => { void actions.current.flush(); }, []);

  return (
    <div className="opal-editor flex h-full min-h-0 flex-col" data-disk-shortcuts-ignore="true">
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto">
        {editor ? <EditorBubbleMenu editor={editor} container={scroller.current} /> : null}
        <EditorContent editor={editor} className="h-full" />
      </div>
      <EditorStatus
        saveState={document.saveState}
        error={document.error}
        hasFrontmatter={document.hasFrontmatter}
        words={words}
        onReloadFromDisk={() => void document.reloadFromDisk()}
        onKeepMine={() => void document.keepMine()}
        onRetry={() => void document.flush()}
      />
    </div>
  );
};
