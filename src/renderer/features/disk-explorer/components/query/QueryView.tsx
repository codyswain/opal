import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, RotateCw, SearchX, SlidersHorizontal, X } from 'lucide-react';
import { filesLocationSnapshots } from '../../navigation/filesLocationSnapshots';
import { toast } from 'sonner';
import { activityReason, formatRelativeTime } from '@/common/relativeTime';
import { formatBytes } from '@/common/formatBytes';
import { basenameFsPath, parentFsPath } from '@/common/fsPaths';
import { sameQuery, suggestViewName } from '@/common/collectionQuery';
import type { CollectionQuery, CollectionRow } from '@/types/collectionQuery';
import type { DiskEntry } from '@/types/disk';
import { Button } from '@/renderer/shared/ui';
import { useDiskStore } from '../../store/diskStore';
import { isDraftEdited, useViewDraftsStore } from '../../store/viewDraftsStore';
import { useSavedViewsStore } from '../../store/savedViewsStore';
import { EMPTY_RESULT, useCollectionQueryStore } from '../../store/collectionQueryStore';
import { RECENT_COLLECTION, directoryCollection, queryCollection, viewCollection } from '../../navigation/filesLocation';
import { useFilesNavigation } from '../../navigation/FilesNavigationContext';
import type { SavedViewDefinition } from '@/types/savedView';
import { CollectionView, type CollectionRowDecoration } from '../CollectionView';
import { EmptyState } from '../EmptyState';
import { GallerySkeleton } from '../Skeleton';
import { CHIP_TEXT_INPUT, FilterChips } from './FilterChips';
import { useTagSuggestions } from './useTagSuggestions';
import { newChip } from './editableFilters';
import { ScopeControl } from './ScopeControl';
import { SortControl } from './SortControl';
import { chipFromFilter, filtersFromChips, type EditableChip } from './editableFilters';
import { NameViewDialog } from './NameViewDialog';
import { ViewActions, type ViewPendingAction } from './ViewActions';

const UNDO_WINDOW_MS = 10_000;
/** Relative-time filters drift; re-evaluate at least once a minute while visible. */
export const TIME_REFRESH_MS = 60_000;

function hasRelativeTimeFilter(query: CollectionQuery): boolean {
  return query.filters.some((filter) => filter.op === 'within');
}

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
  const navigation = useFilesNavigation();
  const draft = useViewDraftsStore((state) => state.drafts[id] ?? null);
  const updateDraft = useViewDraftsStore((state) => state.update);
  const [pending, setPending] = useState<ViewPendingAction>(null);
  const [conflict, setConflict] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [nameDialog, setNameDialog] = useState<'save-view' | 'save-new' | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [nameInput, setNameInput] = useState(draft?.name ?? '');
  useEffect(() => { setNameInput(draft?.name ?? ''); }, [draft?.name]);
  const result = useCollectionQueryStore((state) => state.results[id] ?? EMPTY_RESULT);
  const load = useCollectionQueryStore((state) => state.load);
  const roots = useDiskStore((state) => state.roots);
  const selectedPaths = useDiskStore((state) => state.selectedPaths);
  const now = useNow();
  const tagSuggestions = useTagSuggestions();
  const header = useRef<HTMLDivElement>(null);
  const [chips, setChips] = useState<EditableChip[]>(() => (draft ? draft.query.filters.map(chipFromFilter) : []));
  const [dismissed, setDismissed] = useState<string[]>([]);
  const lastLoaded = useRef<CollectionQuery | null>(draft?.query ?? null);
  // The filters the current chips were last derived from or pushed into. A
  // draft whose filters differ from this came from outside the chips (Reset,
  // Reload from disk, a save) and must rebuild the chips instead.
  const chipFilters = useRef<string>(JSON.stringify(draft?.query.filters ?? []));

  useEffect(() => {
    if (!draft) return;
    const draftFilters = JSON.stringify(draft.query.filters);
    if (draftFilters !== chipFilters.current) {
      chipFilters.current = draftFilters;
      setChips(draft.query.filters.map(chipFromFilter));
    }
  }, [draft]);

  // Complete chips become the draft's filters; incomplete ones stay visible only.
  const setChipsFromUser = (next: EditableChip[]) => {
    setChips(next);
    if (!draft) return;
    const filters = filtersFromChips(next);
    chipFilters.current = JSON.stringify(filters);
    const query = { ...draft.query, filters };
    if (!sameQuery(query, draft.query)) updateDraft(id, { query });
  };

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
      const current = useViewDraftsStore.getState().drafts[id];
      if (current) void load(id, current.query, { immediate: true });
    });
  }, [draft, id, load]);

  // "Past 7 days" is a rolling window: refresh on focus and once a minute.
  const relativeTime = draft ? hasRelativeTimeFilter(draft.query) : false;
  useEffect(() => {
    if (!relativeTime) return undefined;
    const refresh = () => {
      const current = useViewDraftsStore.getState().drafts[id];
      if (current) void load(id, current.query, { immediate: true });
    };
    const timer = setInterval(refresh, TIME_REFRESH_MS);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [relativeTime, id, load]);

  // Cmd+F filters the view: focus the first text chip, or start a Name chip.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f' || event.defaultPrevented) return;
      event.preventDefault();
      const existing = header.current?.querySelector<HTMLInputElement>(`[${CHIP_TEXT_INPUT}]`);
      if (existing) { existing.focus(); existing.select(); return; }
      setChips((previous) => [...previous, newChip('name')]);
      requestAnimationFrame(() => header.current?.querySelector<HTMLInputElement>(`[${CHIP_TEXT_INPUT}]`)?.focus());
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const byPath = useMemo(() => new Map(result.rows.map((row) => [row.entry.path, row])), [result.rows]);
  const entries = useMemo(() => result.rows.map((row) => row.entry), [result.rows]);
  const decorate = useMemo(
    () => (entry: DiskEntry): CollectionRowDecoration | null => {
      const row = byPath.get(entry.path);
      if (!row || !draft) return null;
      const parent = parentFsPath(entry.path);
      return { detail: detailFor(row, draft.query, now), secondary: parent ? basenameFsPath(parent) : undefined, tags: row.tags ?? undefined };
    },
    [byPath, draft, now]
  );

  const definitionOf = (): SavedViewDefinition | null =>
    draft ? { name: draft.name, query: draft.query, layout: draft.layout } : null;

  const createView = async (name: string, kind: 'save-view' | 'save-new') => {
    const definition = definitionOf();
    if (!definition) return;
    setPending('save-new');
    setActionError(null);
    const response = await window.viewsAPI.create({ ...definition, name });
    setPending(null);
    if (!response.success) { setActionError(response.error); return; }
    setNameDialog(null);
    await useSavedViewsStore.getState().load();
    const drafts = useViewDraftsStore.getState();
    drafts.openSaved(response.data);
    setConflict(false);
    navigation.navigateCollection(viewCollection(response.data.id));
    // The transient draft is dropped only after the router has applied the
    // view location; removing it sooner makes the departing URL unknown and
    // triggers the invalid-location fallback.
    if (kind === 'save-view') setTimeout(() => useViewDraftsStore.getState().remove(id), 0);
  };

  const discardDraft = () => {
    if (!draft || draft.saved) return;
    if (draft.origin) navigation.navigateDirectory(draft.origin);
    else navigation.navigateCollection(RECENT_COLLECTION);
    // Removed after the router leaves this location, like a saved transient draft.
    setTimeout(() => useViewDraftsStore.getState().remove(id), 0);
  };

  const saveChanges = async () => {
    const definition = definitionOf();
    if (!definition || !draft?.saved) return;
    setPending('save');
    setActionError(null);
    const response = await window.viewsAPI.save(id, definition, draft.saved.revision);
    setPending(null);
    if (!response.success) {
      if (response.conflict) setConflict(true);
      else setActionError(response.error);
      return;
    }
    useViewDraftsStore.getState().markSaved(id, response.data);
    setConflict(false);
    void useSavedViewsStore.getState().load();
  };

  const reloadFromDisk = async () => {
    setPending('reload');
    await useSavedViewsStore.getState().load();
    const view = useSavedViewsStore.getState().views[id];
    setPending(null);
    if (!view) { setActionError('This view no longer exists on disk.'); return; }
    useViewDraftsStore.getState().adoptBaseline(id, view);
    setConflict(false);
  };

  const duplicateView = async () => {
    setPending('duplicate');
    setActionError(null);
    const response = await window.viewsAPI.duplicate(id);
    setPending(null);
    if (!response.success) { setActionError(response.error); return; }
    await useSavedViewsStore.getState().load();
    useViewDraftsStore.getState().openSaved(response.data);
    navigation.navigateCollection(viewCollection(response.data.id));
  };

  const removeView = async () => {
    setPending('remove');
    setActionError(null);
    const response = await window.viewsAPI.remove(id);
    setPending(null);
    setConfirmingRemove(false);
    if (!response.success) { setActionError(response.error); return; }
    const removedName = draft?.name ?? 'View';
    useViewDraftsStore.getState().remove(id);
    await useSavedViewsStore.getState().load();
    navigation.navigateCollection(RECENT_COLLECTION);
    const { undoToken } = response.data;
    toast(`Removed “${removedName}”`, {
      duration: UNDO_WINDOW_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          void window.viewsAPI.restore(undoToken).then((restored) => {
            if (restored.success) void useSavedViewsStore.getState().load();
            else toast.error(restored.error);
          });
        },
      },
    });
  };

  const selectedTarget = selectedPaths.length === 1 ? selectedPaths[0] : null;
  const selectionMissing = !!selectedTarget && !byPath.has(selectedTarget) && result.query !== null && !result.loading;
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

  if (!draft) {
    return <div role="alert" className="p-4 text-sm text-destructive">This view is no longer available.</div>;
  }
  const edited = isDraftEdited(draft);

  const warnings = result.warnings.filter((warning) => !dismissed.includes(warning));
  const hasFilters = draft.query.filters.length > 0 || chips.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={header} data-disk-shortcuts-ignore="true" data-testid="query-header" className="flex shrink-0 flex-col gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <SlidersHorizontal aria-hidden className="h-4 w-4 text-muted-foreground" />
          <input
            aria-label="View name"
            value={nameInput}
            onChange={(event) => setNameInput(event.target.value)}
            onBlur={() => updateDraft(id, { name: nameInput })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); updateDraft(id, { name: nameInput }); }
              if (event.key === 'Escape') setNameInput(draft.name);
            }}
            className="min-w-0 max-w-64 rounded-md border border-transparent bg-transparent px-1 text-sm font-medium outline-none hover:border-border focus-visible:border-border focus-visible:ring-2 focus-visible:ring-ring"
          />
          <ViewActions
            draft={draft}
            edited={edited}
            pending={pending}
            confirmingRemove={confirmingRemove}
            onSaveView={() => setNameDialog('save-view')}
            onDiscard={discardDraft}
            onSaveChanges={() => void saveChanges()}
            onSaveAsNew={() => setNameDialog('save-new')}
            onReset={() => { useViewDraftsStore.getState().reset(id); setConflict(false); }}
            onDuplicate={() => void duplicateView()}
            onRemove={() => setConfirmingRemove(true)}
            onConfirmRemove={() => void removeView()}
            onCancelRemove={() => setConfirmingRemove(false)}
          />
          <div className="min-w-0 flex-1" />
          <Button size="compact" variant="ghost" disabled={!selectedTarget} onClick={showInFolder}>
            Show in folder
          </Button>
          <SortControl sort={draft.query.sort} onChange={(sort) => updateDraft(id, { query: { ...draft.query, sort } })} />
          {trailing}
        </div>
        {selectionMissing ? (
          <p role="status" data-testid="query-selection-missing" className="text-xs text-muted-foreground">
            The selected item no longer matches these filters. Its preview stays open until you select something else.
          </p>
        ) : null}
        {conflict ? (
          <div role="alert" data-testid="view-conflict" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs">
            <span className="flex-1">This view changed on disk since you opened it. Reload it to take the disk version, or keep your edits as a new view.</span>
            <Button size="compact" variant="outline" disabled={pending !== null} onClick={() => void reloadFromDisk()}>Reload from disk</Button>
            <Button size="compact" disabled={pending !== null} onClick={() => setNameDialog('save-new')}>Save as new</Button>
          </div>
        ) : null}
        {actionError ? <p role="alert" className="text-xs text-destructive">{actionError}</p> : null}
        <ScopeControl
          scope={draft.query.scope}
          roots={roots}
          origin={draft.origin}
          onChange={(scope) => updateDraft(id, { query: { ...draft.query, scope } })}
        />
        <FilterChips chips={chips} onChange={setChipsFromUser} tagSuggestions={tagSuggestions} />
      </div>

      {result.unavailableScopes.length > 0 ? (
        <div role="alert" data-testid="query-unavailable" className="flex shrink-0 items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs">
          <span className="flex-1">
            {result.unavailableScopes.length === 1 ? 'This folder is not open: ' : 'These folders are not open: '}
            {result.unavailableScopes.join(', ')}. Open it again or change the scope.
          </span>
          <Button size="compact" variant="outline" onClick={() => updateDraft(id, { query: { ...draft.query, scope: { kind: 'all-roots' } } })}>
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
              location={{ mode: 'browse', collection: draft.saved ? viewCollection(id) : queryCollection(id) }}
              mode={draft.layout}
              onModeChange={(layout) => updateDraft(id, { layout })}
              entries={entries}
              suggestedMode="list"
              filter=""
              onClearFilter={() => setChipsFromUser([])}
              decorate={decorate}
              countLabel={`${entries.length === result.total ? entries.length : `${entries.length} of ${result.total}`} ${result.total === 1 ? 'item' : 'items'}${result.incomplete ? ' (incomplete)' : ''}`}
              emptyState={hasFilters ? (
                <EmptyState
                  Icon={SearchX}
                  title="No items match these filters"
                  description="Loosen a filter or clear them to see everything in scope."
                  action={<Button size="compact" variant="outline" onClick={() => setChipsFromUser([])}>Clear filters</Button>}
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
      <NameViewDialog
        open={nameDialog !== null}
        title={nameDialog === 'save-new' ? 'Save as new view' : 'Save view'}
        description={nameDialog === 'save-new' ? 'Your edits become a separate view; the original keeps its saved definition.' : 'Name this collection to reopen it from the sidebar.'}
        initialName={draft.name === 'Untitled view' ? suggestViewName(draft.query) : draft.name}
        submitLabel={nameDialog === 'save-new' ? 'Save as new' : 'Save view'}
        busy={pending === 'save-new'}
        error={actionError}
        onOpenChange={(open) => { if (!open) setNameDialog(null); }}
        onSubmit={(name) => void createView(name, nameDialog ?? 'save-view')}
      />
    </div>
  );
};
