import React from 'react';
import { Button } from '@/renderer/shared/ui';
import type { ViewDraft } from '../../store/viewDraftsStore';

export type ViewPendingAction = 'save' | 'save-new' | 'duplicate' | 'remove' | 'reload' | null;

interface ViewActionsProps {
  draft: ViewDraft;
  edited: boolean;
  pending: ViewPendingAction;
  confirmingRemove: boolean;
  onSaveView: () => void;
  onSaveChanges: () => void;
  onSaveAsNew: () => void;
  onReset: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onConfirmRemove: () => void;
  onCancelRemove: () => void;
}

/** The durable-definition controls; nothing here writes without an explicit click. */
export const ViewActions: React.FC<ViewActionsProps> = ({
  draft, edited, pending, confirmingRemove,
  onSaveView, onSaveChanges, onSaveAsNew, onReset, onDuplicate, onRemove, onConfirmRemove, onCancelRemove,
}) => {
  const busy = pending !== null;
  if (!draft.saved) {
    return (
      <Button size="compact" disabled={busy} onClick={onSaveView}>
        {pending === 'save-new' ? 'Saving…' : 'Save view'}
      </Button>
    );
  }
  if (confirmingRemove) {
    return (
      <span role="group" aria-label="Confirm removing this view" className="flex items-center gap-1 text-xs">
        <span>Remove this view? Your files are not affected.</span>
        <Button size="compact" variant="destructive" disabled={busy} onClick={onConfirmRemove}>
          {pending === 'remove' ? 'Removing…' : 'Remove'}
        </Button>
        <Button size="compact" variant="ghost" disabled={busy} onClick={onCancelRemove}>Cancel</Button>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1">
      {edited ? (
        <span data-testid="view-edited" className="rounded-full bg-amber-500/15 px-2 py-0.5 text-2xs font-medium text-amber-700 dark:text-amber-300">
          Edited
        </span>
      ) : null}
      {edited ? (
        <>
          <Button size="compact" disabled={busy} onClick={onSaveChanges}>
            {pending === 'save' ? 'Saving…' : 'Save changes'}
          </Button>
          <Button size="compact" variant="outline" disabled={busy} onClick={onSaveAsNew}>Save as new</Button>
          <Button size="compact" variant="ghost" disabled={busy} onClick={onReset}>Reset</Button>
        </>
      ) : (
        <Button size="compact" variant="ghost" disabled={busy} onClick={onDuplicate}>
          {pending === 'duplicate' ? 'Duplicating…' : 'Duplicate'}
        </Button>
      )}
      <Button size="compact" variant="ghost" disabled={busy} onClick={onRemove}>Remove</Button>
    </span>
  );
};
