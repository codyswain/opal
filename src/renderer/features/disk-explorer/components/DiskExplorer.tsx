import React, { useEffect, useMemo, useState, useId } from 'react';
import { useFilesNavigation } from '../navigation/FilesNavigationContext';
import { shouldIgnoreShortcutTarget } from '../navigation/shortcutTarget';
import { FolderPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { filterEntries } from '@/common/filterEntries';
import { sortEntries } from '@/common/sortEntries';
import type { DiskEntry } from '@/types/disk';
import { useDiskStore } from '../store/diskStore';
import { useRecentStore } from '../store/recentStore';
import type { RecentItem } from '@/types/activity';
import { RecentView } from './RecentView';
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
import {
  PaneGroup,
  Pane,
  PaneHandle,
  usePaneLayout,
  sizesFor,
} from '@/renderer/shared/components/panes';

interface DiskExplorerProps {
  showNavigationPane?: boolean;
}

const NO_RECENT_ITEMS: RecentItem[] = [];

export const DiskExplorer: React.FC<DiskExplorerProps> = ({
  showNavigationPane = true,
}) => {
  const navigation = useFilesNavigation();
  const previewPaneId = useId();
  const isPreviewPaneOpen = useDiskStore((state) => state.isPreviewPaneOpen);
  const togglePreviewPane = useDiskStore((state) => state.togglePreviewPane);
  const roots = useDiskStore((state) => state.roots);
  const listings = useDiskStore((state) => state.listings);
  const currentDirectory = useDiskStore((state) => state.currentDirectory);
  const currentCollection = useDiskStore((state) => state.currentCollection);
  const recentItems = useRecentStore((state) => state.result?.items ?? NO_RECENT_ITEMS);
  const selectedPath = useDiskStore((state) => state.selectedPath);
  const sort = useDiskStore((state) => state.sort);
  const filter = useDiskStore((state) => state.filter);
  const error = useDiskStore((state) => state.loading.error);
  const openFolder = useDiskStore((state) => state.openFolder);
  const invalidate = useDiskStore((state) => state.invalidate);
  const toggleQuickLook = useDiskStore((state) => state.toggleQuickLook);

  const layoutKey = showNavigationPane ? 'files' : 'files-shell';
  const { sizes, onLayout } = usePaneLayout(
    layoutKey,
    showNavigationPane ? [20, 55, 25] : [72, 28]
  );

  const openedPath = useTabsStore((state) => state.openedPath);
  const activeDirectory = currentDirectory;
  const isRecent = currentCollection?.kind === 'recent';
  const visibleEntries = useMemo(() => {
    if (isRecent) {
      // Recent keeps its recency order; only the name filter applies.
      return filterEntries(recentItems.map((item) => item.entry), filter);
    }
    if (!activeDirectory) return [];
    return sortEntries(
      filterEntries(listings[activeDirectory] ?? [], filter),
      sort.field,
      sort.direction
    );
  }, [activeDirectory, filter, isRecent, listings, recentItems, sort.direction, sort.field]);

  // The selected entry object, found in whichever cached listing contains it,
  // or among Recent rows. The tree can only surface a path it has already
  // listed, so no IPC is needed.
  const selectedEntry = useMemo<DiskEntry | null>(() => {
    if (!selectedPath) return null;
    for (const entries of Object.values(listings)) {
      const match = entries.find(
        (candidate) => candidate.path === selectedPath
      );
      if (match) return match;
    }
    return recentItems.find((item) => item.entry.path === selectedPath)?.entry ?? null;
  }, [selectedPath, listings, recentItems]);

  const [focusedEntry, setFocusedEntry] = useState<{
    path: string;
    entry: DiskEntry | null;
    loading: boolean;
  } | null>(null);
  useEffect(() => {
    if (!openedPath) {
      setFocusedEntry(null);
      return;
    }
    const cached = Object.values(listings)
      .flat()
      .find((entry) => entry.path === openedPath && !entry.isDirectory);
    if (cached) {
      setFocusedEntry({ path: openedPath, entry: cached, loading: false });
      return;
    }
    let cancelled = false;
    setFocusedEntry({ path: openedPath, entry: null, loading: true });
    void Promise.resolve(window.diskAPI.stat(openedPath))
      .then((result) => {
        if (!cancelled)
          setFocusedEntry({
            path: openedPath,
            entry:
              result?.success &&
              result.data.path === openedPath &&
              !result.data.isDirectory
                ? result.data
                : null,
            loading: false,
          });
      })
      .catch(() => {
        if (!cancelled)
          setFocusedEntry({ path: openedPath, entry: null, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [openedPath, listings]);
  const showDetailPane = !openedPath && isPreviewPaneOpen;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        shouldIgnoreShortcutTarget(event.target as HTMLElement) ||
        useDiskStore.getState().pendingAction ||
        useDiskStore.getState().pendingDelete
      )
        return;
      if (!event.metaKey && !event.ctrlKey) return;

      const tabs = useTabsStore.getState();

      if (event.key === 'w') {
        if (!tabs.activePath) return;
        event.preventDefault();
        navigation.closeFile(tabs.activePath);
        return;
      }

      if (event.shiftKey && event.key === '[') {
        event.preventDefault();
        const index = tabs.activePath
          ? tabs.openPaths.indexOf(tabs.activePath)
          : 0;
        const path =
          tabs.openPaths[
            (index - 1 + tabs.openPaths.length) % tabs.openPaths.length
          ];
        if (path) navigation.openFile(path);
        return;
      }

      if (event.shiftKey && event.key === ']') {
        event.preventDefault();
        const index = tabs.activePath
          ? tabs.openPaths.indexOf(tabs.activePath)
          : -1;
        const path = tabs.openPaths[(index + 1) % tabs.openPaths.length];
        if (path) navigation.openFile(path);
        return;
      }

      // Cmd+1..9 jump to a tab by position, as in every browser.
      if (event.key >= '1' && event.key <= '9') {
        event.preventDefault();
        const path = tabs.openPaths[Number(event.key) - 1];
        if (path) navigation.openFile(path);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigation]);

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
      if (
        event.defaultPrevented ||
        shouldIgnoreShortcutTarget(event.target as HTMLElement)
      )
        return;
      const state = useDiskStore.getState();
      if (state.pendingAction || state.pendingDelete) return;
      if (openedPath) return;
      const selectionLocked = state.pendingDelete !== null;

      if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowDown') {
        if (selectionLocked) return;
        event.preventDefault();
        if (!selectedEntry) return;
        if (selectedEntry.isDirectory) {
          navigation.navigateDirectory(selectedEntry.path);
        } else {
          navigation.openFile(selectedEntry.path);
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowUp') {
        if (selectionLocked) return;
        event.preventDefault();
        if (!activeDirectory) return;
        // Never navigate above a root - the guard would reject it anyway.
        if (roots.includes(activeDirectory)) return;
        const parent = activeDirectory.slice(
          0,
          activeDirectory.lastIndexOf('/')
        );
        if (parent) navigation.navigateDirectory(parent);
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
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable)
        return;
      if (!selectedEntry || selectedEntry.isDirectory) return;

      event.preventDefault();
      toggleQuickLook();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeDirectory,
    navigation,
    openedPath,
    roots,
    selectedEntry,
    toggleQuickLook,
    visibleEntries,
  ]);

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
          <TabStrip />
          {(() => {
            const previewToggle = (
              <button
                type="button"
                aria-pressed={isPreviewPaneOpen}
                aria-controls={previewPaneId}
                data-disk-shortcuts-ignore="true"
                onClick={togglePreviewPane}
                className="mr-3 shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
              >
                Preview
              </button>
            );
            if (!openedPath && isRecent) {
              return (
                <div
                  data-testid="files-recent"
                  className="min-h-0 flex-1 overflow-hidden"
                >
                  <RecentView trailing={previewToggle} />
                </div>
              );
            }
            return null;
          })()}
          {openedPath ? (
            <div
              data-testid="files-focus"
              className="flex min-h-0 flex-1 flex-col"
            >
              <button
                type="button"
                onClick={navigation.returnToFolder}
                className="shrink-0 px-4 py-2 text-left text-sm"
              >
                Return to folder
              </button>
              <div className="min-h-0 flex-1">
                {focusedEntry?.path === openedPath && focusedEntry.entry ? (
                  <DetailPane entry={focusedEntry.entry} />
                ) : (
                  <div role="status" className="p-4">
                    {focusedEntry?.path !== openedPath || focusedEntry.loading
                      ? 'Loading file…'
                      : 'File unavailable'}
                  </div>
                )}
              </div>
            </div>
          ) : isRecent ? null : activeDirectory ? (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-border/60 shrink-0 min-w-0">
                <Breadcrumb dirPath={activeDirectory} />
                <Toolbar dirPath={activeDirectory} />
                <button
                  type="button"
                  aria-pressed={isPreviewPaneOpen}
                  aria-controls={previewPaneId}
                  data-disk-shortcuts-ignore="true"
                  onClick={togglePreviewPane}
                  className="mr-3 shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                >
                  Preview
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <DiskFolderView
                  key={activeDirectory}
                  dirPath={activeDirectory}
                />
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
              <div
                id={previewPaneId}
                role="region"
                aria-label="Selected item preview"
                className="flex min-h-0 flex-1 flex-col overflow-hidden"
              >
                <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-2">
                  <span className="text-xs text-muted-foreground">Preview</span>
                  <button
                    type="button"
                    aria-label="Close preview pane"
                    onClick={togglePreviewPane}
                    className="rounded p-1 hover:bg-muted"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <DetailPane entry={selectedEntry} />
                </div>
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
