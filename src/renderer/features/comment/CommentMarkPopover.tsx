import React, { useEffect, useRef } from 'react';
import type { EditorView } from '@codemirror/view';
import { Button, Popover, PopoverAnchor, PopoverContent } from '@/renderer/shared/ui';
import { groupOf, groupStatus, openMark, setOpenMark, type OpenMarks } from './commentEditor';
import { useCommentStore, type CommentMark } from './commentStore';
import { InlineCode } from './InlineCode';

interface CommentMarkPopoverProps {
  view: EditorView;
  open: OpenMarks;
}

/** The shared mark's element that holds any of `ids`. */
function markElement(view: EditorView, ids: readonly string[]): HTMLElement | null {
  for (const element of view.dom.querySelectorAll<HTMLElement>('[data-comment-ids]')) {
    const held = (element.dataset.commentIds ?? '').split(' ');
    if (held.some((id) => ids.includes(id))) return element;
  }
  return null;
}

/** One comment in the popover: the comment, then the run's last message, with Stop or Dismiss. */
const Entry: React.FC<{ mark: CommentMark; onDismiss: () => void }> = ({ mark, onDismiss }) => {
  const running = mark.status === 'running' || mark.status === 'stopping';
  return (
    <div className="opal-comment-entry" data-testid="comment-entry" data-status={mark.status}>
      <p className="opal-comment-quote">{mark.comment}</p>
      {running ? null : <p className="opal-comment-reply"><InlineCode text={mark.reply} /></p>}
      {running ? (
        <div className="opal-comment-actions">
          <Button size="compact" variant="secondary" disabled={mark.status === 'stopping'} onClick={() => void useCommentStore.getState().stop(mark.id)}>
            {mark.status === 'stopping' ? 'Stopping…' : 'Stop'}
          </Button>
        </div>
      ) : mark.status === 'failed' ? (
        <div className="opal-comment-actions">
          <Button size="compact" variant="secondary" onClick={onDismiss}>Dismiss</Button>
        </div>
      ) : null}
    </div>
  );
};

/**
 * What a mark holds: each comment made on its row, oldest first, with the
 * run's last message. A running comment offers Stop, a failed one Dismiss.
 * A done comment goes once a popover that showed it closes; the mark goes
 * when it holds no comments.
 */
export const CommentMarkPopover: React.FC<CommentMarkPopoverProps> = ({ view, open }) => {
  const marks = useCommentStore((state) => state.marks);
  const ids = useRef(open.ids);
  ids.current = open.ids;
  const shown = (groupOf(view, open.ids)?.ids ?? open.ids)
    .map((id) => marks[id])
    .filter((mark): mark is CommentMark => mark !== undefined)
    .sort((a, b) => a.order - b.order);
  const anchor = useRef({
    getBoundingClientRect: () => markElement(view, ids.current)?.getBoundingClientRect() ?? new DOMRect(),
    contextElement: view.contentDOM,
  });
  // The done comments this popover has shown; they have been read.
  const read = useRef(new Set<string>());
  for (const mark of shown) if (mark.status === 'done') read.current.add(mark.id);
  useEffect(() => () => {
    const { marks: now, remove } = useCommentStore.getState();
    for (const id of read.current) if (now[id]?.status === 'done') remove(id);
  }, []);

  const close = () => {
    if (view.state.field(openMark, false)?.n === open.n) view.dispatch({ effects: setOpenMark.of(null) });
  };
  if (shown.length === 0) return null;
  return (
    <Popover open onOpenChange={(next) => { if (!next) close(); }}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        side="bottom"
        align="start"
        className="w-80 p-3"
        data-testid="comment-popover"
        data-status={groupStatus(shown.map((mark) => mark.status))}
        data-count={shown.length}
        aria-label={shown.length > 1 ? `${shown.length} comments` : 'Comment'}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        // A press on the mark itself toggles it; the mark handles that.
        onInteractOutside={(event) => {
          if (event.target instanceof Element && event.target.closest('[data-comment-ids]') === markElement(view, ids.current)) event.preventDefault();
        }}
      >
        <div className="opal-comment-entries">
          {shown.map((mark) => (
            <Entry
              key={mark.id}
              mark={mark}
              onDismiss={() => {
                useCommentStore.getState().remove(mark.id);
                if (shown.length === 1) {
                  close();
                  view.focus();
                }
              }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
