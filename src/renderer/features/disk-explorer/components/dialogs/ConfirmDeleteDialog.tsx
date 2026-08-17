import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useDiskStore } from '../../store/diskStore';

export const ConfirmDeleteDialog: React.FC = () => {
  const pendingDelete = useDiskStore((state) => state.pendingDelete);
  const cancelDelete = useDiskStore((state) => state.cancelDelete);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!pendingDelete) return;
    setError(null);
    setIsSubmitting(false);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelDelete();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [pendingDelete, cancelDelete]);

  if (!pendingDelete) return null;

  const name = pendingDelete.split('/').pop() ?? pendingDelete;

  const confirm = async () => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    const result = await window.diskAPI.trash(pendingDelete);
    if (!result.success) {
      setError(result.error);
      setIsSubmitting(false);
      return;
    }

    useDiskStore.getState().select(null);
    cancelDelete();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        onClick={cancelDelete}
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-modal="true"
        data-testid="confirm-delete"
        className="relative flex w-[min(90vw,420px)] flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <Trash2 className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div className="min-w-0">
            <h2 className="text-base font-medium">Move "{name}" to Trash?</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              You can restore it from the Trash.
            </p>
          </div>
        </div>

        {error && (
          <p data-testid="confirm-delete-error" className="text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={cancelDelete}
            data-testid="confirm-delete-cancel"
            className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors duration-100 hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={isSubmitting}
            data-testid="confirm-delete-confirm"
            className="rounded-md bg-destructive px-3 py-2 text-sm text-destructive-foreground disabled:opacity-40"
          >
            Move to Trash
          </button>
        </div>
      </div>
    </div>
  );
};
