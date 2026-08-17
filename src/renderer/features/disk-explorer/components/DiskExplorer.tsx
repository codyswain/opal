import React, { useEffect, useMemo } from 'react';
import { FolderPlus, X } from 'lucide-react';
import type { DiskEntry } from '@/types/disk';
import { useDiskStore } from '../store/diskStore';
import { QuickLook } from './QuickLook';
import { DetailPane } from './detail/DetailPane';
import { Breadcrumb } from './Breadcrumb';
import { DiskTree } from './DiskTree';
import { DiskFolderView } from './DiskFolderView';
import { NameDialog } from './dialogs/NameDialog';
import { Toolbar } from './Toolbar';

/** The detail pane always shows a directory: a selected file shows its parent. */
function directoryForSelection(
  selectedPath: string | null,
  isDirectory: (path: string) => boolean,
  roots: string[]
): string | null {
  if (!selectedPath) return roots[0] ?? null;
  if (isDirectory(selectedPath)) return selectedPath;

  const parent = selectedPath.slice(0, selectedPath.lastIndexOf('/'));
  return parent || roots[0] || null;
}

export const DiskExplorer: React.FC = () => {
  const roots = useDiskStore((state) => state.roots);
  const listings = useDiskStore((state) => state.listings);
  const selectedPath = useDiskStore((state) => state.selectedPath);
  const error = useDiskStore((state) => state.loading.error);
  const openFolder = useDiskStore((state) => state.openFolder);
  const invalidate = useDiskStore((state) => state.invalidate);
  const openQuickLook = useDiskStore((state) => state.openQuickLook);
  const select = useDiskStore((state) => state.select);
  const toggleQuickLook = useDiskStore((state) => state.toggleQuickLook);

  // A path is a directory if it is a root, or if any cached listing describes
  // it as one. That is enough without another IPC round-trip, because the tree
  // can only surface a path it has already listed.
  const isDirectory = useMemo(() => {
    const directories = new Set(roots);
    for (const entries of Object.values(listings)) {
      for (const entry of entries) {
        if (entry.isDirectory) directories.add(entry.path);
      }
    }
    return (candidate: string) => directories.has(candidate);
  }, [roots, listings]);

  const activeDirectory = directoryForSelection(selectedPath, isDirectory, roots);

  // The selected entry object, found in whichever cached listing contains it.
  // The tree can only surface a path it has already listed, so no IPC is needed.
  const selectedEntry = useMemo<DiskEntry | null>(() => {
    if (!selectedPath) return null;
    for (const entries of Object.values(listings)) {
      const match = entries.find((candidate) => candidate.path === selectedPath);
      if (match) return match;
    }
    return null;
  }, [selectedPath, listings]);

  useEffect(() => {
    return window.diskAPI.onChanged(({ directories }) => {
      void invalidate(directories);
    });
  }, [invalidate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowDown') {
        event.preventDefault();
        if (!selectedEntry) return;
        if (selectedEntry.isDirectory) {
          select(selectedEntry.path);
          void useDiskStore.getState().toggleExpanded(selectedEntry.path);
        } else {
          openQuickLook();
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowUp') {
        event.preventDefault();
        if (!activeDirectory) return;
        // Never navigate above a root - the guard would reject it anyway.
        if (roots.includes(activeDirectory)) return;
        const parent = activeDirectory.slice(0, activeDirectory.lastIndexOf('/'));
        if (parent) select(parent);
        return;
      }

      if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
        // Enter renames the selection - Finder's binding. Not while typing.
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
        if (!selectedPath) return;
        event.preventDefault();
        useDiskStore.getState().beginRename(selectedPath);
        return;
      }

      if (event.code !== 'Space') return;

      // Never hijack Space while the user is typing — the filter box in Task 9
      // and the rename dialog in Task 15 both need it.
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      if (!selectedEntry) return;

      event.preventDefault();
      toggleQuickLook();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeDirectory, openQuickLook, roots, select, selectedEntry, toggleQuickLook]);

  return (
    <div className="flex h-full w-full overflow-hidden">
      <aside className="w-64 shrink-0 border-r border-border/60 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 shrink-0">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Files
          </span>
          <button
            type="button"
            onClick={() => void openFolder()}
            aria-label="Open folder"
            data-testid="disk-explorer-open-folder"
            className="p-1 rounded hover:bg-muted text-muted-foreground"
          >
            <FolderPlus className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          <DiskTree />
        </div>
      </aside>

      <section className="flex-1 flex min-w-0 flex-col overflow-hidden">
        {error && <ErrorBanner message={error} />}
        {activeDirectory ? (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-border/60 shrink-0 min-w-0">
              <Breadcrumb dirPath={activeDirectory} />
              <Toolbar dirPath={activeDirectory} />
            </div>
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <div className="min-w-0 flex-1 overflow-hidden">
                <DiskFolderView dirPath={activeDirectory} />
              </div>
              <aside className="w-80 shrink-0 overflow-hidden border-l border-border/60">
                <DetailPane entry={selectedEntry} />
              </aside>
            </div>
          </>
        ) : (
          <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
            Open a folder to get started
          </div>
        )}
      </section>
      <QuickLook entry={selectedEntry} />
      <NameDialog />
    </div>
  );
};

const ErrorBanner: React.FC<{ message: string }> = ({ message }) => {
  const clearError = useDiskStore((state) => state.clearError);

  return (
    <div
      role="alert"
      data-testid="disk-explorer-error"
      className="flex items-center gap-2 px-4 py-2 text-sm bg-destructive/10 text-destructive border-b border-destructive/20 shrink-0"
    >
      <span className="flex-1">{message}</span>
      <button
        type="button"
        aria-label="Dismiss error"
        onClick={clearError}
        className="p-0.5 rounded hover:bg-destructive/20"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};
