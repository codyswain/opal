import React, { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { basenameFsPath } from '@/common/fsPaths';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/shared/ui';
import { useDiskStore } from '../../store/diskStore';

/**
 * Asks before Move to Trash. The confirm button takes focus, as in Finder's
 * alerts, and closing hands focus back to where it was (the tree row).
 */
export const ConfirmDeleteDialog: React.FC = () => {
  const pendingDelete = useDiskStore((state) => state.pendingDelete);
  const cancelDelete = useDiskStore((state) => state.cancelDelete);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!pendingDelete) return;
    setError(null);
    setIsSubmitting(false);
  }, [pendingDelete]);

  const confirm = async () => {
    if (!pendingDelete || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    const result = await window.diskAPI.trash(pendingDelete);
    if (!result.success) {
      setError(result.error);
      setIsSubmitting(false);
      return;
    }

    cancelDelete();
  };

  return (
    <Dialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) cancelDelete(); }}>
      <DialogContent
        data-testid="confirm-delete"
        className="max-w-sm"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          confirmRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 aria-hidden className="h-4 w-4 shrink-0 text-icon" />
            {`Move "${pendingDelete ? basenameFsPath(pendingDelete) : ''}" to Trash?`}
          </DialogTitle>
          <DialogDescription>You can restore it from the Trash.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" data-testid="confirm-delete-error" className="mt-3 text-ui font-medium text-foreground">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" data-testid="confirm-delete-cancel" onClick={cancelDelete}>
            Cancel
          </Button>
          <Button
            ref={confirmRef}
            data-testid="confirm-delete-confirm"
            disabled={isSubmitting}
            onClick={() => void confirm()}
          >
            Move to Trash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
