import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { ASK_MESSAGE, INSTALL_URL, NOT_INSTALLED_MESSAGE } from '@/common/commentText';
import type { AgentReadiness } from '@/types/agent';
import { Button, Popover, PopoverAnchor, PopoverContent } from '@/renderer/shared/ui';
import { commentBox, commentHost, selectedLines, setCommentBox, type CommentBoxAt } from './commentEditor';
import { useCommentStore } from './commentStore';

const MAX_ROWS = 6;

/** Where the box's text is on screen: from its first character to the end of its last row; the caret with no selection. */
function selectionRect(view: EditorView, box: CommentBoxAt): DOMRect {
  const start = view.coordsAtPos(box.from, 1);
  if (!start) return new DOMRect();
  const end = box.to > box.from ? view.coordsAtPos(box.to, -1) : start;
  const bottom = Math.max(start.bottom, end?.bottom ?? start.bottom);
  const right = end && end.top === start.top ? Math.max(end.right, start.left + 1) : start.left + 1;
  return new DOMRect(start.left, start.top, right - start.left, bottom - start.top);
}

/** The line under the field: why the comment cannot go yet, or the first-use question. */
type Problem =
  | { kind: 'missing' }
  | { kind: 'signed-out' }
  | { kind: 'ask'; folder: string }
  | { kind: 'error'; text: string };

const problemOf = (readiness: AgentReadiness): Problem | null =>
  readiness.state === 'missing' ? { kind: 'missing' }
    : readiness.state === 'signed-out' ? { kind: 'signed-out' }
      : null;

interface CommentBoxProps {
  view: EditorView;
  box: CommentBoxAt;
}

/**
 * The one-line box under a selection. Enter sends, Shift+Enter adds a line,
 * Escape or a click elsewhere closes it and keeps nothing. Sending saves the
 * page, waits for the save, then starts the run and puts its mark in the
 * margin. A setup problem shows under the field and the comment stays.
 */
export const CommentBox: React.FC<CommentBoxProps> = ({ view, box }) => {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const runButton = useRef<HTMLButtonElement>(null);
  const shown = useRef(box);
  shown.current = box;
  const host = view.state.facet(commentHost);
  const path = host?.path ?? '';
  const anchor = useRef({ getBoundingClientRect: () => selectionRect(view, shown.current), contextElement: view.contentDOM });
  const mine = () => view.state.field(commentBox, false)?.id === shown.current.id;

  const close = (focusPage = true) => {
    if (mine()) view.dispatch({ effects: setCommentBox.of(null) });
    if (focusPage) view.focus();
  };

  // Asked as the box opens, so a setup problem shows before anything is typed.
  useEffect(() => {
    let live = true;
    void window.agentAPI?.readiness(path).then((result) => {
      if (!live || !result.success) return;
      const found = problemOf(result.data);
      if (found) setProblem(found);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [path]);

  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = 'auto';
    if (element.scrollHeight <= 0) return;
    const style = getComputedStyle(element);
    const line = parseFloat(style.lineHeight) || 20;
    const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const borders = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
    element.style.height = `${Math.min(element.scrollHeight + borders, MAX_ROWS * line + padding + borders)}px`;
  });

  useEffect(() => {
    if (problem?.kind === 'ask') runButton.current?.focus();
  }, [problem]);

  const send = async (allowed = false) => {
    const comment = text.trim();
    if (!comment || busy || !host) return;
    const agent = window.agentAPI;
    setBusy(true);
    try {
      if (allowed) {
        const answer = await agent.allowFolder(path);
        if (!answer.success) return setProblem({ kind: 'error', text: answer.error });
      }
      const ready = await agent.readiness(path);
      if (!ready.success) return setProblem({ kind: 'error', text: ready.error });
      if (ready.data.state === 'ask') return setProblem({ kind: 'ask', folder: ready.data.folder });
      const found = problemOf(ready.data);
      if (found) return setProblem(found);
      // The run reads the file, so it waits for what was typed to reach it.
      await host.flush();
      const at = view.state.field(commentBox, false);
      if (!at || at.id !== shown.current.id) return;
      const started = await agent.start({ path, comment, selection: selectedLines(view.state, at.from, at.to) });
      if (!started.success) return setProblem({ kind: 'error', text: started.error });
      useCommentStore.getState().add({
        id: started.data.id,
        path,
        status: 'running',
        comment,
        reply: '',
        pos: view.state.doc.lineAt(Math.min(view.state.field(commentBox, false)?.from ?? at.from, view.state.doc.length)).from,
      });
      close();
    } catch {
      setProblem({ kind: 'error', text: 'The comment could not be sent.' });
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // An input method's Enter picks a candidate; it does not send.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  const rows = Math.min(MAX_ROWS, Math.max(1, text.split('\n').length));
  return (
    <Popover open onOpenChange={(open) => { if (!open) close(false); }}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        side="bottom"
        align="start"
        className="w-80 p-2"
        data-testid="comment-box"
        aria-label="Comment"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          field.current?.focus();
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (event.isComposing || event.keyCode === 229) {
            event.preventDefault();
            return;
          }
          // Escape on the question goes back to the comment.
          if (problem?.kind === 'ask') {
            event.preventDefault();
            setProblem(null);
            field.current?.focus();
            return;
          }
          event.preventDefault();
          close();
        }}
      >
        <textarea
          ref={field}
          aria-label="Comment"
          placeholder="Comment"
          className="opal-comment-field"
          rows={rows}
          value={text}
          readOnly={busy}
          onChange={(event) => {
            setText(event.target.value);
            if (problem?.kind === 'error') setProblem(null);
          }}
          onKeyDown={onKeyDown}
        />
        {problem ? (
          <div className="opal-comment-line" data-testid="comment-line" role="status" aria-live="polite" data-problem={problem.kind}>
            {problem.kind === 'missing' ? (
              <>
                {NOT_INSTALLED_MESSAGE}{' '}
                <a href={INSTALL_URL} target="_blank" rel="noreferrer">How to install</a>
              </>
            ) : problem.kind === 'signed-out' ? (
              <>Claude Code is not signed in. Run <code>claude auth login</code> in a terminal.</>
            ) : problem.kind === 'ask' ? (
              <>
                <p>{ASK_MESSAGE}</p>
                <div className="opal-comment-actions">
                  <Button size="compact" variant="ghost" onClick={() => { setProblem(null); field.current?.focus(); }}>Cancel</Button>
                  <Button ref={runButton} size="compact" disabled={busy} onClick={() => void send(true)}>Run</Button>
                </div>
              </>
            ) : (
              problem.text
            )}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
};
