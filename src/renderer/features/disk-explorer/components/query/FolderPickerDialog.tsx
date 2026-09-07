import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronUp, Folder } from 'lucide-react';
import { basenameFsPath, isFsPathAtOrBelow, parentFsPath } from '@/common/fsPaths';
import type { DiskEntry } from '@/types/disk';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/shared/ui';

interface FolderPickerDialogProps {
  open: boolean;
  roots: readonly string[];
  onOpenChange: (open: boolean) => void;
  onChoose: (folder: string) => void;
}

/**
 * Browses the opened roots one level at a time so any subfolder can become a
 * scope. Listings come from main through the existing guarded channel.
 */
export const FolderPickerDialog: React.FC<FolderPickerDialogProps> = ({ open, roots, onOpenChange, onChoose }) => {
  const [current, setCurrent] = useState<string | null>(null);
  const [folders, setFolders] = useState<DiskEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const browse = async (directory: string) => {
    const token = ++request.current;
    setLoading(true);
    setError(null);
    let result;
    try {
      result = await window.diskAPI.readDirectory(directory);
    } catch {
      if (token !== request.current) return;
      setLoading(false);
      setError('Could not load folder.');
      return;
    }
    if (token !== request.current) return;
    setLoading(false);
    if (!result.success) { setError(result.error); return; }
    setCurrent(result.data.path);
    setFolders(result.data.entries.filter((entry) => entry.isDirectory));
  };

  useEffect(() => {
    if (!open) { request.current += 1; return; }
    setCurrent(null);
    setFolders([]);
    setError(null);
  }, [open]);

  const containingRoot = useMemo(
    () => (current ? [...roots].filter((root) => isFsPathAtOrBelow(root, current)).sort((a, b) => b.length - a.length)[0] ?? null : null),
    [current, roots]
  );
  const parent = current ? parentFsPath(current) : null;
  const canGoUp = !!(containingRoot && parent && isFsPathAtOrBelow(containingRoot, parent));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-label="Choose a folder" data-disk-shortcuts-ignore="true" className="flex max-h-[min(80vh,600px)] max-w-lg flex-col" onEscapeKeyDown={(event) => event.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Choose a folder</DialogTitle>
          <DialogDescription>Browse an opened folder and choose it or one of its subfolders as scope.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 text-xs">
          <Button size="compact" variant="ghost" disabled={!canGoUp} onClick={() => { if (parent) void browse(parent); }}>
            <ChevronUp aria-hidden className="h-3.5 w-3.5" />
            Up
          </Button>
          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={current ?? undefined}>
            {current ?? 'Opened folders'}
          </span>
        </div>
        <ul aria-label="Folders" className="min-h-0 flex-1 overflow-auto rounded-md border border-border/60">
          {current === null ? (
            roots.length === 0 ? (
              <li className="p-3 text-sm text-muted-foreground">No folders are open.</li>
            ) : (
              roots.map((root) => (
                <li key={root}>
                  <button type="button" onClick={() => void browse(root)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted/50">
                    <Folder aria-hidden className="h-4 w-4 shrink-0 opacity-60" />
                    <span className="truncate">{basenameFsPath(root)}</span>
                  </button>
                </li>
              ))
            )
          ) : loading ? (
            <li role="status" className="p-3 text-sm text-muted-foreground">Loading…</li>
          ) : folders.length === 0 ? (
            <li className="p-3 text-sm text-muted-foreground">No subfolders.</li>
          ) : (
            folders.map((folder) => (
              <li key={folder.path}>
                <button type="button" onClick={() => void browse(folder.path)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted/50">
                  <Folder aria-hidden className="h-4 w-4 shrink-0 opacity-60" />
                  <span className="truncate">{folder.name}</span>
                </button>
              </li>
            ))
          )}
        </ul>
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!current} onClick={() => { if (current) { onChoose(current); onOpenChange(false); } }}>
            Choose {current ? basenameFsPath(current) : 'folder'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
