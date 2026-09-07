import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronUp, FolderOpen } from 'lucide-react';
import type { DiskEntry } from '@/types/disk';
import {
  basenameFsPath,
  isFsPathAtOrBelow,
  parentFsPath,
} from '@/common/fsPaths';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/shared/ui';

interface RelatedChooserProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  onConnect(target: string): Promise<string | null>;
}

export const RelatedChooser: React.FC<RelatedChooserProps> = ({
  open,
  onOpenChange,
  onConnect,
}) => {
  const filterId = useId();
  const [roots, setRoots] = useState<string[]>([]);
  const [currentDirectory, setCurrentDirectory] = useState<string | null>(null);
  const [entries, setEntries] = useState<DiskEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current += 1;
    };
  }, []);

  const browse = async (directory: string) => {
    const token = ++request.current;
    setLoading(true);
    setError(null);
    setSelected(null);
    let result;
    try {
      result = await window.diskAPI.readDirectory(directory);
    } catch {
      if (!alive.current || token !== request.current) return;
      setLoading(false);
      setEntries([]);
      setError('Could not load folder.');
      return;
    }
    if (!alive.current || token !== request.current) return;
    setLoading(false);
    if (!result.success) {
      setEntries([]);
      setError(result.error);
      return;
    }
    setCurrentDirectory(result.data.path);
    setEntries(result.data.entries);
  };

  useEffect(() => {
    if (!open) {
      request.current += 1;
      setSubmitting(false);
      return;
    }

    let cancelled = false;
    const token = ++request.current;
    setLoading(true);
    setError(null);
    void (async () => {
      let result;
      try {
        result = await window.diskAPI.listRoots();
      } catch {
        if (cancelled || !alive.current || token !== request.current) return;
        setLoading(false);
        setRoots([]);
        setEntries([]);
        setError('Could not load opened folders.');
        return;
      }
      if (cancelled || !alive.current || token !== request.current) return;
      if (!result.success) {
        setLoading(false);
        setRoots([]);
        setEntries([]);
        setError(result.error);
        return;
      }
      setRoots(result.data);
      const retained = currentDirectory && result.data.some((root) =>
        isFsPathAtOrBelow(root, currentDirectory)
      ) ? currentDirectory : null;
      const initial = retained ?? result.data[0] ?? null;
      if (!initial) {
        setLoading(false);
        setEntries([]);
        return;
      }
      void browse(initial);
    })();
    return () => {
      cancelled = true;
    };
    // Preserve the last browsed folder between successful connections.
  }, [open]);

  const visibleEntries = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) => entry.name.toLocaleLowerCase().includes(needle));
  }, [entries, filter]);

  const containingRoot = currentDirectory
    ? roots
      .filter((root) => isFsPathAtOrBelow(root, currentDirectory))
      .sort((a, b) => b.length - a.length)[0] ?? null
    : null;
  const parent = currentDirectory ? parentFsPath(currentDirectory) : null;
  const canGoUp = !!(
    containingRoot &&
    parent &&
    isFsPathAtOrBelow(containingRoot, parent)
  );

  const connect = async () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    setError(null);
    let failure;
    try {
      failure = await onConnect(selected);
    } catch {
      failure = 'Could not connect the related item.';
    }
    if (!alive.current) return;
    setSubmitting(false);
    if (failure) {
      setError(failure);
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-label="Add related item"
        data-related-chooser="true"
        data-disk-shortcuts-ignore="true"
        className="flex max-h-[min(80vh,640px)] max-w-xl flex-col"
        onEscapeKeyDown={(event) => event.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>Add related item</DialogTitle>
          <DialogDescription>
            Browse an opened folder, select one file or folder, then connect it.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3">
          <section aria-label="Opened folders" className="flex flex-wrap gap-1">
            {roots.map((root) => (
              <Button
                key={root}
                size="compact"
                variant={containingRoot === root ? 'secondary' : 'ghost'}
                aria-label={`Browse opened folder ${basenameFsPath(root)}`}
                onClick={() => void browse(root)}
              >
                {basenameFsPath(root)}
              </Button>
            ))}
          </section>

          {currentDirectory ? (
            <div className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5">
              <Button
                size="icon"
                variant="ghost"
                aria-label="Up one folder"
                disabled={!canGoUp}
                onClick={() => parent && void browse(parent)}
              >
                <ChevronUp aria-hidden className="h-4 w-4" />
              </Button>
              <div className="min-w-0 flex-1">
                <p className="text-2xs text-muted-foreground">Current folder</p>
                <p className="truncate text-sm" title={currentDirectory}>{currentDirectory}</p>
              </div>
              <label className="flex shrink-0 items-center gap-1.5 text-xs">
                <input
                  type="radio"
                  name="related-target"
                  aria-label={`Current folder ${basenameFsPath(currentDirectory)}`}
                  checked={selected === currentDirectory}
                  onChange={() => setSelected(currentDirectory)}
                />
                Select folder
              </label>
            </div>
          ) : null}

          <label htmlFor={filterId} className="text-xs font-medium">Filter items</label>
          <input
            id={filterId}
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />

          <fieldset className="min-h-0 flex-1 overflow-auto rounded-md border border-border/70 p-1">
            <legend className="sr-only">Choose a related item</legend>
            {loading ? (
              <p className="p-3 text-sm text-muted-foreground">Loading folder…</p>
            ) : visibleEntries.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                {roots.length === 0 ? 'No opened folders.' : 'No items in this folder.'}
              </p>
            ) : (
              <div className="space-y-1">
                {visibleEntries.map((entry) => (
                  <div key={entry.path} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
                    <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="related-target"
                        aria-label={entry.name}
                        checked={selected === entry.path}
                        onChange={() => setSelected(entry.path)}
                      />
                      <span className="truncate" title={entry.name}>{entry.name}</span>
                    </label>
                    {entry.isDirectory ? (
                      <Button
                        size="compact"
                        variant="ghost"
                        aria-label={`Browse ${entry.name}`}
                        onClick={() => void browse(entry.path)}
                      >
                        <FolderOpen aria-hidden className="h-4 w-4" />
                        Browse
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </fieldset>

          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!selected || submitting} onClick={() => void connect()}>
            {submitting ? 'Connecting…' : 'Connect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
