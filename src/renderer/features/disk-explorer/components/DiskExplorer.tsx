import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import type { DiskEntry } from '@/types/disk';
import { useDiskStore } from '../store/diskStore';
import { RecentView } from './RecentView';
import { FileViewer } from './FileViewer';
import { MarkdownEditor } from './editor/MarkdownEditor';
import { useTabScroll } from '../hooks/useTabScroll';
import {
  selectActiveTab,
  selectOpenedPath,
  useTabsStore,
} from '../store/tabsStore';

/** The main pane: the active tab's file or Recent. Tabs and the tree live in the shell. */
export const DiskExplorer: React.FC = () => {
  const listings = useDiskStore((state) => state.listings);
  const error = useDiskStore((state) => state.loading.error);
  const openedPath = useTabsStore(selectOpenedPath);
  const activeTab = useTabsStore(selectActiveTab);
  const page = useRef<HTMLDivElement>(null);
  useTabScroll(page, activeTab?.id ?? null, activeTab?.index ?? 0, openedPath);

  // A file in a listing the tree already read shows at once; any other file
  // is looked up, and a late answer for a file left behind is dropped.
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
    if (!openedPath || listedEntry) {
      setStatted(null);
      return;
    }
    let cancelled = false;
    setStatted({ path: openedPath, entry: null, loading: true });
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
      {openedPath ? (
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
      className="flex shrink-0 items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive"
    >
      <span className="flex-1">{message}</span>
      <button
        type="button"
        aria-label="Dismiss error"
        onClick={clearError}
        className="rounded p-1 transition-hover hover:bg-destructive/20"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};
