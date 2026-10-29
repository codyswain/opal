import React, { useEffect, useState } from 'react';
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

/** Mirrors FileWriter.assertValidName so the user gets feedback before submitting. */
export function isValidName(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed.length > 0 &&
    trimmed !== '.' &&
    trimmed !== '..' &&
    !trimmed.includes('/') &&
    !trimmed.includes('\\')
  );
}

/** Names a new folder; renames happen inline in the tree. */
export const NameDialog: React.FC = () => {
  const pendingAction = useDiskStore((state) => state.pendingAction);
  const cancelAction = useDiskStore((state) => state.cancelAction);

  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!pendingAction) return;
    setName('');
    setError(null);
    setIsSubmitting(false);
  }, [pendingAction]);

  const submit = async () => {
    if (!pendingAction || !isValidName(name) || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const result = await window.diskAPI.createDirectory(pendingAction.target, name.trim());

    if (!result.success) {
      // Keep the dialog open so the user can correct the name in place rather
      // than retyping it from scratch.
      setError(result.error);
      setIsSubmitting(false);
      return;
    }

    cancelAction();
  };

  return (
    <Dialog open={pendingAction !== null} onOpenChange={(open) => { if (!open) cancelAction(); }}>
      <DialogContent data-testid="name-dialog" className="max-w-sm" showCloseButton={false}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle data-testid="name-dialog-title">New folder</DialogTitle>
            <DialogDescription className="sr-only">Name the new folder.</DialogDescription>
          </DialogHeader>
          <input
            type="text"
            value={name}
            spellCheck={false}
            onChange={(event) => setName(event.target.value)}
            aria-label="Folder name"
            data-testid="name-dialog-input"
            className="mt-3 h-control w-full rounded-control border border-border-strong bg-canvas px-2 text-ui text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
          />
          {name.length > 0 && !isValidName(name) ? (
            <p data-testid="name-dialog-hint" className="mt-2 text-ui text-foreground-secondary">
              A name cannot be empty or contain a slash.
            </p>
          ) : null}
          {error ? (
            <p role="alert" data-testid="name-dialog-error" className="mt-2 text-ui font-medium text-foreground">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" data-testid="name-dialog-cancel" onClick={cancelAction}>
              Cancel
            </Button>
            <Button type="submit" data-testid="name-dialog-submit" disabled={!isValidName(name) || isSubmitting}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
