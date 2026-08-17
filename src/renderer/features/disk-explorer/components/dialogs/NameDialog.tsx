import React, { useEffect, useRef, useState } from 'react';
import { useDiskStore } from '../../store/diskStore';

/** Mirrors FileWriter.assertValidName so the user gets feedback before submitting. */
function isValidName(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed.length > 0 &&
    trimmed !== '.' &&
    trimmed !== '..' &&
    !trimmed.includes('/') &&
    !trimmed.includes('\\')
  );
}

export const NameDialog: React.FC = () => {
  const pendingAction = useDiskStore((state) => state.pendingAction);
  const cancelAction = useDiskStore((state) => state.cancelAction);

  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isRename = pendingAction?.kind === 'rename';

  useEffect(() => {
    if (!pendingAction) return;

    const initial = isRename ? pendingAction.target.split('/').pop() ?? '' : '';
    setName(initial);
    setError(null);
    setIsSubmitting(false);

    // Select the basename but not the extension, so typing replaces the name
    // and keeps ".md" - the behavior Finder has trained everyone to expect.
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      const dot = initial.lastIndexOf('.');
      input.setSelectionRange(0, dot > 0 ? dot : initial.length);
    });
  }, [isRename, pendingAction]);

  if (!pendingAction) return null;

  const submit = async () => {
    if (!isValidName(name) || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const trimmed = name.trim();
    const result = isRename
      ? await window.diskAPI.rename(pendingAction.target, trimmed)
      : await window.diskAPI.createDirectory(pendingAction.target, trimmed);

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
        className="relative w-[min(90vw,400px)] rounded-xl border border-border bg-card p-4 shadow-2xl flex flex-col gap-3"
      >
        <h2 data-testid="name-dialog-title" className="text-sm font-medium">
          {isRename ? 'Rename' : 'New Folder'}
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
          aria-label={isRename ? 'New name' : 'Folder name'}
          data-testid="name-dialog-input"
          className="rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-sm focus:border-ring focus:outline-none"
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
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!isValidName(name) || isSubmitting}
            data-testid="name-dialog-submit"
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-40"
          >
            {isRename ? 'Rename' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
};
