import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { FolderOpen, RotateCw, SearchX, X } from 'lucide-react';
import { LISTING_SORT_FIELDS, folderScope } from '@/common/collectionQuery';
import { filterEntries } from '@/common/filterEntries';
import { formatBytes } from '@/common/formatBytes';
import { basenameFsPath, parentFsPath } from '@/common/fsPaths';
import { activityReason, formatRelativeTime } from '@/common/relativeTime';
import { sortEntries, type SortField } from '@/common/sortEntries';
import type { CollectionQuery, CollectionRow } from '@/types/collectionQuery';
import type { DiskEntry } from '@/types/disk';
import { Button } from '@/renderer/shared/ui';
import { useDiskStore } from '../store/diskStore';
import { DEFAULT_FOLDER_VIEW, useFolderViewStore } from '../store/folderViewStore';
import { directoryCollection } from '../navigation/filesLocation';
import { filesLocationSnapshots } from '../navigation/filesLocationSnapshots';
import { Breadcrumb } from './Breadcrumb';
import { CollectionView, type CollectionRowDecoration, type CollectionViewMode } from './CollectionView';
import { EmptyState } from './EmptyState';
import { GallerySkeleton } from './Skeleton';
import { Toolbar } from './Toolbar';
import { DisplayPopover } from './query/DisplayPopover';
import { CHIP_TEXT_INPUT } from './query/FilterChips';
import { ListToolbar } from './query/ListToolbar';
import { filtersFromChips, newChip } from './query/editableFilters';
import { useCollectionResult } from './query/useCollectionResult';
import { useTagSuggestions } from './query/useTagSuggestions';

interface DiskFolderViewProps {
  dirPath: string;
  /** Rendered at the end of the toolbar, such as the Preview toggle. */
  trailing?: React.ReactNode;
}

function detailFor(row: CollectionRow, query: CollectionQuery, now: number): string {
  switch (query.sort.field) {
    case 'touched':
      return row.touchedAt && row.touchedKind ? activityReason(row.touchedKind, row.touchedAt, now) : 'Never touched';
    case 'opened':
      return row.openedAt ? `Opened ${formatRelativeTime(row.openedAt, now)}` : 'Never opened';
    case 'modified':
      return `Modified ${formatRelativeTime(row.entry.mtimeMs, now)}`;
    default:
      return row.entry.isDirectory ? 'Folder' : formatBytes(row.entry.size);
  }
}

/**
 * A folder, wearing the one list toolbar. With no filters it lists the
 * folder's own children; the first chip (or Include subfolders, or an
 * activity sort) turns the same surface into a collection query scoped to
 * the folder, without leaving it.
 */
export const DiskFolderView: React.FC<DiskFolderViewProps> = ({ dirPath, trailing }) => {
  const entries = useDiskStore((state) => state.listings[dirPath]);
  const loadDirectory = useDiskStore((state) => state.loadDirectory);
  const sort = useDiskStore((state) => state.sort);
  const density = useDiskStore((state) => state.density);
  const setDensity = useDiskStore((state) => state.setDensity);
  const filter = useDiskStore((state) => state.filter);
  const setFilter = useDiskStore((state) => state.setFilter);
  const view = useFolderViewStore((state) => state.byDirectory[dirPath] ?? DEFAULT_FOLDER_VIEW);
  const setChips = useFolderViewStore((state) => state.setChips);
  const setIncludeDescendants = useFolderViewStore((state) => state.setIncludeDescendants);
  const setLayout = useFolderViewStore((state) => state.setLayout);
  const tagSuggestions = useTagSuggestions();
  const header = useRef<HTMLDivElement>(null);
  const hasMountedRef = useRef(false);

  useEffect(() => { void loadDirectory(dirPath); }, [dirPath, loadDirectory]);
  // A filter carried into a new folder makes it look empty for no visible
  // reason. Clear it whenever the folder changes.
  useEffect(() => {
    if (!hasMountedRef.current) { hasMountedRef.current = true; return; }
    setFilter('');
  }, [dirPath, setFilter]);

  // Cmd+F: focus the first text chip, or start a Name chip.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f' || event.defaultPrevented) return;
      event.preventDefault();
      const existing = header.current?.querySelector<HTMLInputElement>(`[${CHIP_TEXT_INPUT}]`);
      if (existing) { existing.focus(); existing.select(); return; }
      setChips(dirPath, [...(useFolderViewStore.getState().byDirectory[dirPath]?.chips ?? []), newChip('name')]);
      requestAnimationFrame(() => header.current?.querySelector<HTMLInputElement>(`[${CHIP_TEXT_INPUT}]`)?.focus());
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dirPath, setChips]);

  const filters = useMemo(() => filtersFromChips(view.chips), [view.chips]);
  const listingSort = LISTING_SORT_FIELDS.includes(sort.field);
  const queryMode = filters.length > 0 || view.includeDescendants || !listingSort;
  const query = useMemo<CollectionQuery | null>(
    () => (queryMode ? { version: 1, scope: folderScope(dirPath, view.includeDescendants), filters, sort: { field: sort.field, direction: sort.direction } } : null),
    [queryMode, dirPath, view.includeDescendants, filters, sort.field, sort.direction]
  );
  const { result, byPath, entries: queryEntries, reload, loadMore } = useCollectionResult(`folder:${dirPath}`, query);
  const now = Date.now();

  // A folder that is mostly pictures wants to be looked at, not listed. The
  // person's explicit choice always wins once they make one.
  const suggestedMode: CollectionViewMode = useMemo(() => {
    if (!entries || entries.length === 0) return 'list';
    const images = entries.filter((entry) => entry.kind === 'image').length;
    return images > 0 && images >= entries.length / 2 ? 'gallery' : 'list';
  }, [entries]);
  const location = useMemo(() => ({ mode: 'browse' as const, collection: directoryCollection(dirPath) }), [dirPath]);
  const layout: CollectionViewMode = view.layout
    ?? (filesLocationSnapshots.read(location)?.scroll?.view === 'gallery' ? 'gallery' : filesLocationSnapshots.read(location)?.scroll?.view === 'details' ? 'list' : suggestedMode);

  const visibleEntries = useMemo(() => {
    if (queryMode) return queryEntries;
    if (!entries) return [];
    return sortEntries(filterEntries(entries, filter), sort.field as SortField, sort.direction);
  }, [queryMode, queryEntries, entries, filter, sort.field, sort.direction]);

  const decorate = useCallback((entry: DiskEntry): CollectionRowDecoration | null => {
    if (!query) return null;
    const row = byPath.get(entry.path);
    if (!row) return null;
    const parent = parentFsPath(entry.path);
    return {
      detail: detailFor(row, query, now),
      secondary: view.includeDescendants && parent && parent !== dirPath ? basenameFsPath(parent) : undefined,
      tags: row.tags ?? undefined,
    };
  }, [query, byPath, now, view.includeDescendants, dirPath]);

  const toolbar = (
    <ListToolbar
      headerRef={header}
      leading={<><Breadcrumb dirPath={dirPath} /><Toolbar dirPath={dirPath} /></>}
      chips={view.chips}
      onChipsChange={(chips) => setChips(dirPath, chips)}
      tagSuggestions={tagSuggestions}
      layout={layout}
      onLayout={(next) => setLayout(dirPath, next)}
      actions={(
        <>
          <DisplayPopover
            sort={{ field: sort.field, direction: sort.direction }}
            onSort={(next) => useDiskStore.setState({ sort: next })}
            density={density}
            onDensity={setDensity}
            includeDescendants={view.includeDescendants}
            onIncludeDescendants={(value) => setIncludeDescendants(dirPath, value)}
          />
          {trailing}
        </>
      )}
    />
  );

  if (!entries && !queryMode) {
    return <div className="flex h-full min-h-0 flex-col">{toolbar}<GallerySkeleton /></div>;
  }

  const emptyState = queryMode ? (
    <EmptyState
      Icon={SearchX}
      title="No items match these filters"
      description={view.includeDescendants ? 'Loosen a filter or clear them to see everything here.' : 'Only this folder was searched. Loosen a filter, or search its subfolders too.'}
      action={(
        <span className="flex items-center gap-2">
          {!view.includeDescendants ? (
            <Button size="compact" onClick={() => setIncludeDescendants(dirPath, true)}>Search subfolders too</Button>
          ) : null}
          <Button size="compact" variant="outline" onClick={() => setChips(dirPath, [])}>Clear filters</Button>
        </span>
      )}
    />
  ) : (
    <EmptyState Icon={FolderOpen} title="This folder is empty" description="Add files here or open a different folder to keep browsing." />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {toolbar}
      {result.warnings.length > 0 && queryMode ? (
        <div role="status" data-testid="query-warnings" className="flex shrink-0 items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
          <div className="flex-1">
            {result.incomplete ? <p className="font-medium">Results are incomplete.</p> : null}
            {result.warnings.map((warning) => <p key={warning}>{warning}</p>)}
          </div>
          <X aria-hidden className="h-3 w-3 opacity-50" />
        </div>
      ) : null}
      {queryMode && result.error && result.rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p role="alert" className="text-sm text-destructive">{result.error}</p>
          <Button variant="outline" onClick={reload}><RotateCw aria-hidden className="h-4 w-4" />Retry</Button>
        </div>
      ) : queryMode && result.loading && result.query === null ? (
        <div role="status" className="flex flex-1 flex-col">
          <p className="px-4 py-2 text-xs text-muted-foreground">Indexing your folders…</p>
          <GallerySkeleton />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <CollectionView
              location={location}
              mode={layout}
              onModeChange={(next) => setLayout(dirPath, next)}
              layoutControls={false}
              entries={visibleEntries}
              suggestedMode={suggestedMode}
              filter={queryMode ? '' : filter}
              onClearFilter={() => setFilter('')}
              decorate={queryMode ? decorate : undefined}
              countLabel={queryMode ? `${visibleEntries.length === result.total ? visibleEntries.length : `${visibleEntries.length} of ${result.total}`} ${result.total === 1 ? 'item' : 'items'}${result.incomplete ? ' (incomplete)' : ''}` : undefined}
              emptyState={emptyState}
            />
          </div>
          {queryMode && visibleEntries.length < result.total ? (
            <div className="flex shrink-0 items-center justify-center border-t border-border/60 py-2">
              <Button size="compact" variant="outline" disabled={result.loading} onClick={loadMore}>
                {result.loading ? 'Loading…' : `Load more (${visibleEntries.length} of ${result.total})`}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};
