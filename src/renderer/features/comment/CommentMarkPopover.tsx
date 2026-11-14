import React, { useEffect, useRef } from 'react';
import type { EditorView } from '@codemirror/view';
import { Button, Popover, PopoverAnchor, PopoverContent } from '@/renderer/shared/ui';
import { openMark, setOpenMark } from './commentEditor';
import { useCommentStore } from './commentStore';

interface CommentMarkPopoverProps {
  view: EditorView;
  id: string;
}

/** The mark's own element, or an empty rectangle once it is gone. */
function markRect(view: EditorView, id: string): DOMRect {
  const element = view.dom.querySelector(`[data-comment-mark="${CSS.escape(id)}"]`);
  return element ? element.getBoundingClientRect() : new DOMRect();
}

/**
 * What a mark holds: the comment, then the run's last message. A running
 * mark offers Stop, a failed one Dismiss. A done mark goes once its popover
 * has been opened and closed.
 */
export const CommentMarkPopover: React.FC<CommentMarkPopoverProps> = ({ view, id }) => {
  const mark = useCommentStore((state) => state.marks[id]);
  const anchor = useRef({ getBoundingClientRect: () => markRect(view, id), contextElement: view.contentDOM });
  const close = () => {
    if (view.state.field(openMark, false) === id) view.dispatch({ effects: setOpenMark.of(null) });
  };
  // However it closes, a done mark that was opened has been read.
  useEffect(() => () => {
    const { marks, remove } = useCommentStore.getState();
    if (marks[id]?.status === 'done') remove(id);
  }, [id]);
  if (!mark) return null;
  const running = mark.status === 'running' || mark.status === 'stopping';
  return (
    <Popover open onOpenChange={(open) => { if (!open) close(); }}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        side="bottom"
        align="start"
        className="w-80 p-3"
        data-testid="comment-popover"
        data-status={mark.status}
        aria-label="Comment"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        // A press on the mark itself toggles it; the mark handles that.
        onInteractOutside={(event) => {
          if (event.target instanceof Element && event.target.closest(`[data-comment-mark="${CSS.escape(id)}"]`)) event.preventDefault();
        }}
      >
        <p className="opal-comment-quote">{mark.comment}</p>
        {running ? null : <p className="opal-comment-reply">{mark.reply}</p>}
        {running ? (
          <div className="opal-comment-actions">
            <Button size="compact" variant="secondary" disabled={mark.status === 'stopping'} onClick={() => void useCommentStore.getState().stop(id)}>
              {mark.status === 'stopping' ? 'Stopping…' : 'Stop'}
            </Button>
          </div>
        ) : mark.status === 'failed' ? (
          <div className="opal-comment-actions">
            <Button
              size="compact"
              variant="secondary"
              onClick={() => {
                useCommentStore.getState().remove(id);
                view.dispatch({ effects: setOpenMark.of(null) });
                view.focus();
              }}
            >
              Dismiss
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
};
