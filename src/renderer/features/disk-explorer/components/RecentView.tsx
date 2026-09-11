import React, { useEffect, useMemo, useState } from 'react';
import { Clock, FolderOpen, RotateCw, Search, X } from 'lucide-react';
import { activityReason } from '@/common/relativeTime';
import { filterEntries } from '@/common/filterEntries';
import { basenameFsPath, parentFsPath } from '@/common/fsPaths';
import type { DiskEntry } from '@/types/disk';
import { Button } from '@/renderer/shared/ui';
import { useDiskStore } from '../store/diskStore';
import { useRecentStore } from '../store/recentStore';
import { RECENT_COLLECTION, directoryCollection } from '../navigation/filesLocation';
import { filesLocationSnapshots } from '../navigation/filesLocationSnapshots';
import { useFilesNavigation } from '../navigation/FilesNavigationContext';
import { CollectionView, type CollectionRowDecoration } from './CollectionView';
import { EmptyState } from './EmptyState';
import { GallerySkeleton } from './Skeleton';

/** Re-renders relative labels so "10 minutes ago" keeps pace with the clock. */
function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

interface RecentViewProps {
  /** Header controls owned by the explorer, such as the Preview toggle. */
  trailing?: React.ReactNode;
}

export const RecentView: React.FC<RecentViewProps> = ({ trailing }) => {
  const navigation = useFilesNavigation();
  const result = useRecentStore((state) => state.result);
  const loading = useRecentStore((state) => state.loading);
  const error = useRecentStore((state) => state.error);
  const load = useRecentStore((state) => state.load);
  const clear = useRecentStore((state) => state.clear);
  const filter = useDiskStore((state) => state.filter);
  const setFilter = useDiskStore((state) => state.setFilter);
  const selectedPaths = useDiskStore((state) => state.selectedPaths);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [dismissedWarnings, setDismissedWarnings] = useState<string[]>([]);
  const now = useNow();

  // Activity and disk changes both alter membership; reload while visible.
  useEffect(() => {
    const api = window.activityAPI;
    if (!api?.onChanged) return undefined;
    return api.onChanged(() => { void load(); });
  }, [load]);
  useEffect(() => window.diskAPI.onChanged(() => { void load(); }), [load]);

  const byPath = useMemo(
    () => new Map((result?.items ?? []).map((item) => [item.entry.path, item])),
    [result]
  );
  const entries = useMemo(
    () => filterEntries((result?.items ?? []).map((item) => item.entry), filter),
    [result, filter]
  );
  const decorate = useMemo(
    () => (entry: DiskEntry): CollectionRowDecoration | null => {
      const item = byPath.get(entry.path);
      if (!item) return null;
      const parent = parentFsPath(entry.path);
      return {
        detail: activityReason(item.touchedKind, item.touchedAt, now),
        secondary: parent ? basenameFsPath(parent) : undefined,
      };
    },
    [byPath, now]
  );

  const selectedTarget = selectedPaths.length === 1 ? selectedPaths[0] : null;
  const showInFolder = () => {
    const parent = selectedTarget ? parentFsPath(selectedTarget) : null;
    if (!selectedTarget || !parent) return;
    // Arriving in the folder restores this snapshot, so the item lands selected.
    filesLocationSnapshots.patch(
      { mode: 'browse', collection: directoryCollection(parent) },
      { selectedPaths: [selectedTarget], focusedPath: selectedTarget }
    );
    navigation.navigateDirectory(parent);
  };

  const warnings = (result?.warnings ?? []).filter((warning) => !dismissedWarnings.includes(warning));
  const hasItems = !!result && result.items.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        data-disk-shortcuts-ignore="true"
        data-testid="recent-header"
        className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2"
      >
        <Clock aria-hidden className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Recent</h2>
        <div className="relative ml-2">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') setFilter(''); }}
            placeholder="Filter"
            aria-label="Filter recent items"
            data-testid="filter-input"
            className="w-40 rounded-md border border-transparent bg-muted/50 py-1 pl-7 pr-6 text-xs focus:border-ring focus:outline-none"
          />
          {filter ? (
            <button
              type="button"
              onClick={() => setFilter('')}
              aria-label="Clear filter"
              data-testid="filter-clear"
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors duration-100 hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
        <div className="min-w-0 flex-1" />
        <Button size="compact" variant="ghost" disabled={!selectedTarget} onClick={showInFolder}>
          Show in folder
        </Button>
        {confirmingClear ? (
          <span role="group" aria-label="Confirm clearing recent activity" className="flex items-center gap-1 text-xs">
            <span>Clear all recent activity? Files are not affected.</span>
            <Button size="compact" variant="destructive" onClick={() => { setConfirmingClear(false); void clear(); }}>
              Clear
            </Button>
            <Button size="compact" variant="ghost" onClick={() => setConfirmingClear(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <Button size="compact" variant="ghost" disabled={!hasItems} onClick={() => setConfirmingClear(true)}>
            Clear recent activity
          </Button>
        )}
        {trailing}
      </div>

      {warnings.length > 0 ? (
        <div role="status" className="flex shrink-0 items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
          <div className="flex-1">
            {warnings.map((warning) => <p key={warning}>{warning}</p>)}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setDismissedWarnings((previous) => [...previous, ...warnings])}
            className="rounded p-1"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : null}

      {error && !result ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p role="alert" className="text-sm text-destructive">{error}</p>
          <Button variant="outline" onClick={() => void load()}>
            <RotateCw aria-hidden className="h-4 w-4" />
            Retry
          </Button>
        </div>
      ) : !result && loading ? (
        <GallerySkeleton />
      ) : (
        <CollectionView
          location={{ mode: 'browse', collection: RECENT_COLLECTION }}
          entries={entries}
          suggestedMode="list"
          filter={filter}
          onClearFilter={() => setFilter('')}
          decorate={decorate}
          countLabel={result?.truncated ? `${entries.length} of ${result.total} items` : undefined}
          emptyState={(
            <EmptyState
              Icon={FolderOpen}
              title="Nothing recent yet"
              description="Items you open or work on will appear here."
            />
          )}
        />
      )}
    </div>
  );
};
