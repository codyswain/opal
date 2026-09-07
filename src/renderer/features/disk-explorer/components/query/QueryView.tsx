import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, RotateCw, SearchX, SlidersHorizontal, X } from 'lucide-react';
import { activityReason, formatRelativeTime } from '@/common/relativeTime';
import { formatBytes } from '@/common/formatBytes';
import { basenameFsPath, parentFsPath } from '@/common/fsPaths';
import { sameQuery } from '@/common/collectionQuery';
import type { CollectionQuery, CollectionRow } from '@/types/collectionQuery';
import type { DiskEntry } from '@/types/disk';
import { Button } from '@/renderer/shared/ui';
import { useDiskStore } from '../../store/diskStore';
import { useQueryDraftsStore } from '../../store/queryDraftsStore';
import { EMPTY_RESULT, useCollectionQueryStore } from '../../store/collectionQueryStore';
import { queryCollection } from '../../navigation/filesLocation';
import { CollectionView, type CollectionRowDecoration } from '../CollectionView';
import { EmptyState } from '../EmptyState';
import { GallerySkeleton } from '../Skeleton';
import { FilterChips } from './FilterChips';
import { ScopeControl } from './ScopeControl';
import { SortControl } from './SortControl';
import { chipFromFilter, filtersFromChips, type EditableChip } from './editableFilters';

interface QueryViewProps {
  id: string;
  trailing?: React.ReactNode;
}

function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
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

export const QueryView: React.FC<QueryViewProps> = ({ id, trailing }) => {
  const draft = useQueryDraftsStore((state) => state.drafts[id] ?? null);
  const updateDraft = useQueryDraftsStore((state) => state.update);
  const result = useCollectionQueryStore((state) => state.results[id] ?? EMPTY_RESULT);
  const load = useCollectionQueryStore((state) => state.load);
  const roots = useDiskStore((state) => state.roots);
  const now = useNow();
  const [chips, setChips] = useState<EditableChip[]>(() => (draft ? draft.query.filters.map(chipFromFilter) : []));
  const [dismissed, setDismissed] = useState<string[]>([]);
  const lastLoaded = useRef<CollectionQuery | null>(draft?.query ?? null);

  // Complete chips become the draft's filters; incomplete ones stay visible only.
  useEffect(() => {
    if (!draft) return;
    const filters = filtersFromChips(chips);
    const next = { ...draft.query, filters };
    if (!sameQuery(next, draft.query)) updateDraft(id, next);
  }, [chips, draft, id, updateDraft]);

  // FilesRoute performs the first load; later draft edits reload with the debounce.
  useEffect(() => {
    if (!draft) return;
    if (lastLoaded.current && sameQuery(lastLoaded.current, draft.query)) return;
    lastLoaded.current = draft.query;
    void load(id, draft.query);
  }, [draft, id, load]);

  useEffect(() => {
    const api = window.collectionsAPI;
    if (!api?.onChanged || !draft) return undefined;
    return api.onChanged(() => {
      const current = useQueryDraftsStore.getState().drafts[id];
      if (current) void load(id, current.query, { immediate: true });
    });
  }, [draft, id, load]);

  const byPath = useMemo(() => new Map(result.rows.map((row) => [row.entry.path, row])), [result.rows]);
  const entries = useMemo(() => result.rows.map((row) => row.entry), [result.rows]);
  const decorate = useMemo(
    () => (entry: DiskEntry): CollectionRowDecoration | null => {
      const row = byPath.get(entry.path);
      if (!row || !draft) return null;
      const parent = parentFsPath(entry.path);
      return { detail: detailFor(row, draft.query, now), secondary: parent ? basenameFsPath(parent) : undefined };
    },
    [byPath, draft, now]
  );

  if (!draft) {
    return <div role="alert" className="p-4 text-sm text-destructive">This view is no longer available.</div>;
  }

  const warnings = result.warnings.filter((warning) => !dismissed.includes(warning));
  const hasFilters = draft.query.filters.length > 0 || chips.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div data-disk-shortcuts-ignore="true" data-testid="query-header" className="flex shrink-0 flex-col gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <SlidersHorizontal aria-hidden className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">{draft.name}</h2>
          <div className="min-w-0 flex-1" />
          <SortControl sort={draft.query.sort} onChange={(sort) => updateDraft(id, { ...draft.query, sort })} />
          {trailing}
        </div>
        <ScopeControl
          scope={draft.query.scope}
          roots={roots}
          origin={draft.origin}
          onChange={(scope) => updateDraft(id, { ...draft.query, scope })}
        />
        <FilterChips chips={chips} onChange={setChips} />
      </div>

      {result.unavailableScopes.length > 0 ? (
        <div role="alert" data-testid="query-unavailable" className="flex shrink-0 items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs">
          <span className="flex-1">
            {result.unavailableScopes.length === 1 ? 'This folder is not open: ' : 'These folders are not open: '}
            {result.unavailableScopes.join(', ')}. Open it again or change the scope.
          </span>
          <Button size="compact" variant="outline" onClick={() => updateDraft(id, { ...draft.query, scope: { kind: 'all-roots' } })}>
            Search all opened folders
          </Button>
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div role="status" data-testid="query-warnings" className="flex shrink-0 items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
          <div className="flex-1">
            {result.incomplete ? <p className="font-medium">Results are incomplete.</p> : null}
            {warnings.map((warning) => <p key={warning}>{warning}</p>)}
          </div>
          <button type="button" aria-label="Dismiss" onClick={() => setDismissed((previous) => [...previous, ...warnings])} className="rounded p-1">
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : null}

      {result.error && result.rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p role="alert" className="text-sm text-destructive">{result.error}</p>
          <Button variant="outline" onClick={() => void load(id, draft.query, { immediate: true })}>
            <RotateCw aria-hidden className="h-4 w-4" />
            Retry
          </Button>
        </div>
      ) : result.loading && result.query === null ? (
        <div role="status" className="flex flex-1 flex-col">
          <p className="px-4 py-2 text-xs text-muted-foreground">Indexing your folders…</p>
          <GallerySkeleton />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <CollectionView
              location={{ mode: 'browse', collection: queryCollection(id) }}
              entries={entries}
              suggestedMode="list"
              filter=""
              onClearFilter={() => setChips([])}
              decorate={decorate}
              countLabel={`${entries.length === result.total ? entries.length : `${entries.length} of ${result.total}`} ${result.total === 1 ? 'item' : 'items'}${result.incomplete ? ' (incomplete)' : ''}`}
              emptyState={hasFilters ? (
                <EmptyState
                  Icon={SearchX}
                  title="No items match these filters"
                  description="Loosen a filter or clear them to see everything in scope."
                  action={<Button size="compact" variant="outline" onClick={() => setChips([])}>Clear filters</Button>}
                />
              ) : (
                <EmptyState Icon={FolderOpen} title="Nothing in scope" description="Open a folder or widen the scope." />
              )}
            />
          </div>
          {entries.length < result.total ? (
            <div className="flex shrink-0 items-center justify-center border-t border-border/60 py-2">
              <Button size="compact" variant="outline" disabled={result.loading} onClick={() => void load(id, draft.query, { append: true })}>
                {result.loading ? 'Loading…' : `Load more (${entries.length} of ${result.total})`}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};
