import React, { useEffect, useId, useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/shared/ui';
import { VIEW_NAME_MAX_LENGTH } from '@/types/savedView';

interface NameViewDialogProps {
  open: boolean;
  title: string;
  description: string;
  initialName: string;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => void;
}

export const NameViewDialog: React.FC<NameViewDialogProps> = ({
  open, title, description, initialName, submitLabel, busy = false, error = null, onOpenChange, onSubmit,
}) => {
  const inputId = useId();
  const [name, setName] = useState(initialName);
  useEffect(() => { if (open) setName(initialName); }, [open, initialName]);
  const trimmed = name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= VIEW_NAME_MAX_LENGTH;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !busy) onSubmit(trimmed);
          }}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <label htmlFor={inputId} className="text-xs font-medium">View name</label>
            <input
              id={inputId}
              autoFocus
              placeholder="Untitled view"
              onFocus={(event) => event.target.select()}
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!valid || busy}>{busy ? 'Saving…' : submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
