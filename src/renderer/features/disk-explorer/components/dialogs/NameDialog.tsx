import React, { useEffect, useRef, useState } from 'react';
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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!pendingAction) return;
    setName('');
    setError(null);
    setIsSubmitting(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [pendingAction]);

  if (!pendingAction) return null;

  const submit = async () => {
    if (!isValidName(name) || isSubmitting) return;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div onClick={cancelAction} className="absolute inset-0 bg-background/80 backdrop-blur-sm" />

      <div
        role="dialog"
        aria-modal="true"
        data-testid="name-dialog"
        className="relative flex w-[min(90vw,400px)] flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-2xl"
      >
        <h2 data-testid="name-dialog-title" className="text-base font-medium">
          New folder
        </h2>

        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void submit();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              cancelAction();
            }
          }}
          aria-label="Folder name"
          data-testid="name-dialog-input"
          className="rounded-md border border-border bg-muted/50 px-2 py-2 text-sm focus:border-ring focus:outline-none"
        />

        {name.length > 0 && !isValidName(name) && (
          <p data-testid="name-dialog-hint" className="text-xs text-muted-foreground">
            A name cannot be empty or contain a slash.
          </p>
        )}

        {error && (
          <p data-testid="name-dialog-error" className="text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={cancelAction}
            data-testid="name-dialog-cancel"
            className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-hover hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!isValidName(name) || isSubmitting}
            data-testid="name-dialog-submit"
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
};
