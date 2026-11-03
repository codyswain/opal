import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { toast } from 'sonner';
import type { DiskEntry } from '@/types/disk';
import { useDiskStore } from '../store/diskStore';
import { RecentView } from './RecentView';
import { FileViewer } from './FileViewer';
import { MarkdownEditor } from './editor/MarkdownEditor';
import { StackView } from './stack/StackView';
import { useTabScroll } from '../hooks/useTabScroll';
import { filesLocationKey } from '../navigation/filesLocation';
import {
  selectActiveTab,
  selectCurrentLocation,
  selectOpenedPath,
  useTabsStore,
} from '../store/tabsStore';

/** The main pane: the active tab's file, stack or Recent. Tabs and the tree live in the shell. */
export const DiskExplorer: React.FC = () => {
  const listings = useDiskStore((state) => state.listings);
  const error = useDiskStore((state) => state.loading.error);
  const openedPath = useTabsStore(selectOpenedPath);
  const activeTab = useTabsStore(selectActiveTab);
  const location = useTabsStore(selectCurrentLocation);
  const stack = location?.mode === 'stack' ? location : null;
  const page = useRef<HTMLDivElement>(null);
  useTabScroll(page, activeTab?.id ?? null, activeTab?.index ?? 0, openedPath);

  // A file in a listing the tree already read shows at once; any other file
  // is looked up, and a late answer for a file left behind is dropped.
  // Refreshing other folders' listings never looks the open file up again, so
  // its page stays mounted while agents write elsewhere.
  const listedEntry = useMemo(
    () =>
      openedPath
        ? Object.values(listings)
            .flat()
            .find((entry) => entry.path === openedPath && !entry.isDirectory) ?? null
        : null,
    [openedPath, listings]
  );
  const [statted, setStatted] = useState<{
    path: string;
    entry: DiskEntry | null;
    loading: boolean;
  } | null>(null);
  useEffect(() => {
    if (!openedPath) {
      setStatted(null);
      return;
    }
    if (listedEntry) {
      // Kept so the page stays mounted if a refresh drops it from the listing.
      setStatted({ path: openedPath, entry: listedEntry, loading: false });
      return;
    }
    let cancelled = false;
    // An open file stays on screen while it is looked up again; only an answer that it is gone closes it.
    setStatted((previous) =>
      previous?.path === openedPath && previous.entry
        ? { ...previous, loading: true }
        : { path: openedPath, entry: null, loading: true }
    );
    void Promise.resolve(window.diskAPI.stat(openedPath))
      .then((result) => {
        if (!cancelled)
          setStatted({
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
          setStatted({ path: openedPath, entry: null, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [openedPath, listedEntry]);
  const focusedEntry =
    openedPath && listedEntry
      ? { path: openedPath, entry: listedEntry, loading: false }
      : statted;

  useEffect(() => {
    if (!error) return;
    toast.error(error);
  }, [error]);

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden">
      {error && <ErrorBanner message={error} />}
      {stack && activeTab ? (
        // A stack keeps its own place per tab entry, so each entry gets its own view.
        <div className="min-h-0 flex-1">
          <StackView
            key={`${activeTab.id}:${activeTab.index}:${filesLocationKey(stack)}`}
            tabId={activeTab.id}
            index={activeTab.index}
            location={stack}
          />
        </div>
      ) : openedPath ? (
        <div ref={page} data-testid="files-focus" className="min-h-0 flex-1">
          {focusedEntry?.path === openedPath && focusedEntry.entry ? (
            focusedEntry.entry.kind === 'markdown' ? (
              <MarkdownEditor key={focusedEntry.entry.path} path={focusedEntry.entry.path} />
            ) : (
              <FileViewer entry={focusedEntry.entry} />
            )
          ) : (
            <div role="status" className="p-4">
              {focusedEntry?.path !== openedPath || focusedEntry.loading
                ? 'Loading file…'
                : 'File unavailable'}
            </div>
          )}
        </div>
      ) : (
        <div data-testid="files-recent" className="min-h-0 flex-1 overflow-auto">
          <RecentView />
        </div>
      )}
    </div>
  );
};

const ErrorBanner: React.FC<{ message: string }> = ({ message }) => {
  const clearError = useDiskStore((state) => state.clearError);

  return (
    <div
      role="alert"
      data-testid="disk-explorer-error"
      className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-surface-sunken px-4 py-2 text-ui font-medium text-foreground"
    >
      <AlertCircle aria-hidden className="h-4 w-4 shrink-0 text-icon" />
      <span className="flex-1">{message}</span>
      <button
        type="button"
        aria-label="Dismiss error"
        onClick={clearError}
        className="rounded-control p-1 text-icon transition-hover hover:bg-surface-hover hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};
