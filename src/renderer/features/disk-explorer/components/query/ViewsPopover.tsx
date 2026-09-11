import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { VIEW_NAME_MAX_LENGTH, type SavedView } from '@/types/savedView';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@/renderer/shared/ui';
import { useSavedViewsStore } from '../../store/savedViewsStore';

interface ViewsPopoverProps {
  /** The view this surface shows, if it is a saved one. */
  currentId?: string | null;
  /** Whether the current saved view carries unsaved edits. */
  edited?: boolean;
  /** Name offered when saving the current definition. */
  suggestedName: string;
  /** Saves the current definition as a new view. */
  onSaveAs: (name: string) => Promise<void> | void;
  onSaveChanges?: () => void;
  onReset?: () => void;
  onOpen: (view: SavedView) => void;
  onRename: (view: SavedView, name: string) => Promise<void> | void;
  onRemove: (view: SavedView) => Promise<void> | void;
}

/**
 * The Views button: every saved view, and "save what I am looking at". A view
 * is a named toolbar state, so it lives beside Filter and Display.
 */
export const ViewsPopover: React.FC<ViewsPopoverProps> = ({
  currentId = null, edited = false, suggestedName, onSaveAs, onSaveChanges, onReset, onOpen, onRename, onRemove,
}) => {
  const order = useSavedViewsStore((state) => state.order);
  const byId = useSavedViewsStore((state) => state.views);
  const views = useMemo(() => order.map((id) => byId[id]).filter((view): view is SavedView => !!view), [order, byId]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const createInput = useRef<HTMLInputElement>(null);
  const renameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) { setCreating(false); setRenamingId(null); return; }
  }, [open]);
  useEffect(() => {
    if (creating) { setDraftName(suggestedName); requestAnimationFrame(() => { createInput.current?.focus(); createInput.current?.select(); }); }
  }, [creating, suggestedName]);
  useEffect(() => {
    if (renamingId) requestAnimationFrame(() => { renameInput.current?.focus(); renameInput.current?.select(); });
  }, [renamingId]);

  const submitCreate = async () => {
    const name = draftName.trim().slice(0, VIEW_NAME_MAX_LENGTH);
    if (!name || busy) return;
    setBusy(true);
    try { await onSaveAs(name); setCreating(false); setOpen(false); } finally { setBusy(false); }
  };
  const submitRename = async (view: SavedView) => {
    const name = renameDraft.trim().slice(0, VIEW_NAME_MAX_LENGTH);
    setRenamingId(null);
    if (!name || name === view.name) return;
    await onRename(view, name);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="views-menu"
          data-disk-shortcuts-ignore="true"
          className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors duration-100 hover:bg-surface-hover hover:text-foreground ${currentId ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          <Bookmark aria-hidden className={`h-3.5 w-3.5 ${currentId ? 'fill-current' : ''}`} />
          Views
          {edited ? <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Unsaved changes" /> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" data-testid="views-popover">
        <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
          <span className="text-xs font-medium text-foreground">Views</span>
          {currentId && edited && onSaveChanges ? (
            <span className="flex items-center gap-1">
              <Button size="compact" onClick={() => { onSaveChanges(); setOpen(false); }}>Save changes</Button>
              {onReset ? <Button size="compact" variant="ghost" onClick={onReset}>Reset</Button> : null}
            </span>
          ) : null}
        </div>
        {creating ? (
          <form className="flex items-center gap-1.5 border-b border-border-subtle p-2" onSubmit={(event) => { event.preventDefault(); void submitCreate(); }}>
            <input
              ref={createInput}
              aria-label="View name"
              value={draftName}
              placeholder="View name"
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setCreating(false); } }}
              className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button size="compact" type="submit" disabled={!draftName.trim() || busy}>{busy ? 'Saving…' : 'Save'}</Button>
            <Button size="compact" variant="ghost" type="button" onClick={() => setCreating(false)}>Cancel</Button>
          </form>
        ) : (
          <button
            type="button"
            data-testid="views-save-current"
            onClick={() => setCreating(true)}
            className="flex w-full items-center gap-2 border-b border-border-subtle px-3 py-2 text-left text-xs text-foreground-secondary hover:bg-surface-hover hover:text-foreground"
          >
            <Plus aria-hidden className="h-3.5 w-3.5" />
            {currentId ? 'Save as new view…' : 'Save current as view…'}
          </button>
        )}
        <ul role="listbox" aria-label="Saved views" className="max-h-72 overflow-auto p-1">
          {views.length === 0 ? <li className="px-2 py-3 text-xs text-muted-foreground">No saved views yet.</li> : null}
          {views.map((view) => {
            const active = view.id === currentId;
            return (
              <li key={view.id} role="option" aria-selected={active} className="group flex h-8 items-center gap-1 rounded-row pl-2 pr-1 hover:bg-surface-hover">
                {renamingId === view.id ? (
                  <input
                    ref={renameInput}
                    aria-label={`Rename ${view.name}`}
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onBlur={() => void submitRename(view)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') { event.preventDefault(); void submitRename(view); }
                      if (event.key === 'Escape') { event.preventDefault(); setRenamingId(null); }
                    }}
                    className="h-6 min-w-0 flex-1 rounded border border-border bg-background px-1.5 text-xs outline-none"
                  />
                ) : (
                  <button type="button" onClick={() => { onOpen(view); setOpen(false); }} className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs text-foreground">
                    <span className="flex h-3.5 w-3.5 items-center justify-center text-focus">{active ? <Check aria-hidden className="h-3.5 w-3.5" /> : null}</span>
                    <span className="truncate">{view.name}</span>
                  </button>
                )}
                <button type="button" aria-label={`Rename view ${view.name}`} onClick={() => { setRenamingId(view.id); setRenameDraft(view.name); }} className="rounded p-1 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100">
                  <Pencil className="h-3 w-3" />
                </button>
                <button type="button" aria-label={`Remove view ${view.name}`} onClick={() => void onRemove(view)} className="rounded p-1 text-muted-foreground opacity-0 hover:text-danger group-hover:opacity-100 focus-visible:opacity-100">
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
};
