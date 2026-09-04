import React, { useEffect, useMemo } from 'react';
import { FolderPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { filterEntries } from '@/common/filterEntries';
import { sortEntries } from '@/common/sortEntries';
import type { DiskEntry } from '@/types/disk';
import { useDiskStore } from '../store/diskStore';
import { QuickLook } from './QuickLook';
import { DetailPane } from './detail/DetailPane';
import { Breadcrumb } from './Breadcrumb';
import { DiskTree } from './DiskTree';
import { DiskFolderView } from './DiskFolderView';
import { ConfirmDeleteDialog } from './dialogs/ConfirmDeleteDialog';
import { NameDialog } from './dialogs/NameDialog';
import { Toolbar } from './Toolbar';
import { TabStrip } from './TabStrip';
import { useTabsStore } from '../store/tabsStore';
import { PaneGroup, Pane, PaneHandle, usePaneLayout, sizesFor } from '@/renderer/shared/components/panes';

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

function shouldIgnoreShortcutTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
    return true;
  }

  return typeof target.closest === 'function'
    && target.closest('[role="dialog"], [data-disk-shortcuts-ignore="true"]') !== null;
}

interface DiskExplorerProps {
  showNavigationPane?: boolean;
}

export const DiskExplorer: React.FC<DiskExplorerProps> = ({
  showNavigationPane = true,
}) => {
  const roots = useDiskStore((state) => state.roots);
  const listings = useDiskStore((state) => state.listings);
  const currentDirectory = useDiskStore((state) => state.currentDirectory);
  const selectedPath = useDiskStore((state) => state.selectedPath);
  const sort = useDiskStore((state) => state.sort);
  const filter = useDiskStore((state) => state.filter);
  const error = useDiskStore((state) => state.loading.error);
  const openFolder = useDiskStore((state) => state.openFolder);
  const invalidate = useDiskStore((state) => state.invalidate);
  const openQuickLook = useDiskStore((state) => state.openQuickLook);
  const select = useDiskStore((state) => state.select);
  const toggleQuickLook = useDiskStore((state) => state.toggleQuickLook);

  const layoutKey = showNavigationPane ? 'files' : 'files-shell';
  const { sizes, onLayout } = usePaneLayout(
    layoutKey,
    showNavigationPane ? [20, 55, 25] : [72, 28]
  );

  const activeTabPath = useTabsStore((state) => state.activePath);
  const openPreviewTab = useTabsStore((state) => state.openPreview);
  const hydrateTabs = useTabsStore((state) => state.hydrate);

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

  const activeDirectory =
    (selectedPath
      ? directoryForSelection(selectedPath, isDirectory, roots)
      : currentDirectory) ??
    roots[0] ??
    null;
  const visibleEntries = useMemo(() => {
    if (!activeDirectory) return [];
    return sortEntries(
      filterEntries(listings[activeDirectory] ?? [], filter),
      sort.field,
      sort.direction
    );
  }, [activeDirectory, filter, listings, sort.direction, sort.field]);

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

  // The tab being viewed, which is not always the grid selection: clicking a
  // different tab changes what is displayed without moving the grid cursor.
  const tabEntry = useMemo<DiskEntry | null>(() => {
    if (!activeTabPath) return selectedEntry;
    for (const entries of Object.values(listings)) {
      const match = entries.find((candidate) => candidate.path === activeTabPath);
      if (match) return match;
    }
    return selectedEntry;
  }, [activeTabPath, listings, selectedEntry]);
  const showDetailPane = showNavigationPane || tabEntry !== null;

  useEffect(() => {
    hydrateTabs();
  }, [hydrateTabs]);

  useEffect(() => {
    if (!selectedEntry || selectedEntry.isDirectory) return;
    openPreviewTab(selectedEntry.path);
  }, [openPreviewTab, selectedEntry]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;

      const tabs = useTabsStore.getState();

      if (event.key === 'w') {
        if (!tabs.activePath) return;
        event.preventDefault();
        tabs.close(tabs.activePath);
        return;
      }

      if (event.shiftKey && event.key === '[') {
        event.preventDefault();
        tabs.activatePrevious();
        return;
      }

      if (event.shiftKey && event.key === ']') {
        event.preventDefault();
        tabs.activateNext();
        return;
      }

      // Cmd+1..9 jump to a tab by position, as in every browser.
      if (event.key >= '1' && event.key <= '9') {
        event.preventDefault();
        tabs.activateIndex(Number(event.key) - 1);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    return window.diskAPI.onChanged(({ directories }) => {
      void invalidate(directories);
    });
  }, [invalidate]);

  useEffect(() => {
    if (!error) return;
    toast.error(error);
  }, [error]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = useDiskStore.getState();
      const selectionLocked = state.pendingDelete !== null;

      if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowDown') {
        if (selectionLocked) return;
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
        if (selectionLocked) return;
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
        if (
          shouldIgnoreShortcutTarget(target) ||
          useDiskStore.getState().pendingAction !== null
        ) {
          return;
        }
        const targetPath = state.focusedPath ?? state.selectedPath;
        if (!targetPath) return;
        event.preventDefault();
        state.beginRename(targetPath);
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        const target = event.target as HTMLElement | null;
        if (
          shouldIgnoreShortcutTarget(target) ||
          useDiskStore.getState().pendingAction !== null
        ) {
          return;
        }
        const targetPath = state.focusedPath ?? state.selectedPath;
        if (!targetPath) return;
        event.preventDefault();
        state.beginDelete(targetPath);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        if (selectionLocked) return;
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'BUTTON' ||
          target?.isContentEditable ||
          useDiskStore.getState().pendingAction !== null
        ) {
          return;
        }
        if (visibleEntries.length === 0) return;

        event.preventDefault();
        useDiskStore.getState().selectAll(visibleEntries);
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
  }, [activeDirectory, openQuickLook, roots, select, selectedEntry, toggleQuickLook, visibleEntries]);

  return (
    <div className="flex h-full w-full overflow-hidden">
      <PaneGroup layoutKey={layoutKey} onLayout={onLayout} className="flex-1">
        {showNavigationPane ? (
          <>
            <Pane
              defaultSize={sizesFor(sizes, 0, 20)}
              minSize={12}
              maxSize={40}
              collapsible
              className="flex flex-col overflow-hidden border-r border-border/60"
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 shrink-0">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Files
                </span>
                <button
                  type="button"
                  onClick={() => void openFolder()}
                  aria-label="Open folder"
                  data-testid="disk-explorer-open-folder"
                  data-disk-shortcuts-ignore="true"
                  className="rounded p-1 text-muted-foreground transition-colors duration-100 hover:bg-muted"
                >
                  <FolderPlus className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-auto">
                <DiskTree />
              </div>
            </Pane>

            <PaneHandle />
          </>
        ) : null}

        <Pane
          defaultSize={sizesFor(
            sizes,
            showNavigationPane ? 1 : 0,
            showNavigationPane ? 55 : showDetailPane ? 72 : 100
          )}
          minSize={30}
          className="flex min-w-0 flex-col overflow-hidden"
        >
          {error && <ErrorBanner message={error} />}
          {activeDirectory ? (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-border/60 shrink-0 min-w-0">
                <Breadcrumb dirPath={activeDirectory} />
                <Toolbar dirPath={activeDirectory} />
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <DiskFolderView dirPath={activeDirectory} />
              </div>
            </>
          ) : (
            <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
              Open a folder to get started
            </div>
          )}
        </Pane>

        {showDetailPane ? (
          <>
            <PaneHandle />

            <Pane
              defaultSize={sizesFor(
                sizes,
                showNavigationPane ? 2 : 1,
                showNavigationPane ? 25 : 28
              )}
              minSize={15}
              maxSize={50}
              collapsible
              className="flex flex-col overflow-hidden border-l border-border/60"
            >
              <TabStrip />
              <div className="min-h-0 flex-1 overflow-hidden">
                <DetailPane entry={tabEntry} />
              </div>
            </Pane>
          </>
        ) : null}
      </PaneGroup>

      <QuickLook entry={selectedEntry} />
      <NameDialog />
      <ConfirmDeleteDialog />
    </div>
  );
};

const ErrorBanner: React.FC<{ message: string }> = ({ message }) => {
  const clearError = useDiskStore((state) => state.clearError);

  return (
    <div
      role="alert"
      data-testid="disk-explorer-error"
      className="flex shrink-0 items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive"
    >
      <span className="flex-1">{message}</span>
      <button
        type="button"
        aria-label="Dismiss error"
        onClick={clearError}
        className="rounded p-1 transition-colors duration-100 hover:bg-destructive/20"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};
