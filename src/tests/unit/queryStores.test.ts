import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isDraftEdited, useViewDraftsStore, type ViewDraft } from '@/renderer/features/disk-explorer/store/viewDraftsStore';
import { useSavedViewsStore } from '@/renderer/features/disk-explorer/store/savedViewsStore';
import { installViewsApi, savedView } from '@/tests/helpers/viewsApi';
import { QUERY_EDIT_DEBOUNCE_MS, useCollectionQueryStore } from '@/renderer/features/disk-explorer/store/collectionQueryStore';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { emptyQuery, folderScope } from '@/common/collectionQuery';
import { collectionResult, collectionRow, installCollectionsApi } from '@/tests/helpers/collectionsApi';

beforeEach(() => {
  useViewDraftsStore.getState().clearAll();
  useCollectionQueryStore.getState().reset();
});

describe('queryDraftsStore', () => {
  it('creates, updates, renames and removes session drafts', () => {
    const store = useViewDraftsStore.getState();
    const id = store.create({ scope: folderScope('/Vault/A'), origin: '/Vault/A' });
    expect(useViewDraftsStore.getState().get(id)).toMatchObject({
      name: 'Untitled view', origin: '/Vault/A',
      query: { scope: { kind: 'folders', folders: ['/Vault/A'], includeDescendants: true }, filters: [] },
    });
    store.update(id, { query: { ...emptyQuery(), filters: [{ field: 'kind', op: 'in', values: ['pdf'] }] } });
    expect(useViewDraftsStore.getState().get(id)?.query.filters).toEqual([{ field: 'kind', op: 'in', values: ['pdf'] }]);
    // Callers run inside React effects; an invalid edit is refused, never thrown.
    expect(() => store.update(id, { query: { ...emptyQuery(), filters: [{ field: 'kind', op: 'in', values: [] }] } })).not.toThrow();
    expect(useViewDraftsStore.getState().get(id)?.query.filters).toEqual([{ field: 'kind', op: 'in', values: ['pdf'] }]);
    store.update(id, { name: '  Papers  ' });
    expect(useViewDraftsStore.getState().get(id)?.name).toBe('Papers');
    expect(useViewDraftsStore.getState().order).toEqual([id]);
    store.remove(id);
    expect(useViewDraftsStore.getState().has(id)).toBe(false);
    expect(useViewDraftsStore.getState().order).toEqual([]);
  });
});

describe('collectionQueryStore', () => {
  it('debounces rapid edits into one request and keeps the answered query', async () => {
    vi.useFakeTimers();
    try {
      const api = installCollectionsApi({
        query: vi.fn(async (query) => ({ success: true as const, data: collectionResult([collectionRow({ entry: { path: '/V/a.pdf', name: 'a.pdf' } })], { generation: query.filters.length }) })),
      });
      const store = useCollectionQueryStore.getState();
      const first = { ...emptyQuery(), filters: [{ field: 'name' as const, op: 'contains' as const, value: 'a' }] };
      const second = { ...first, filters: [...first.filters, { field: 'kind' as const, op: 'in' as const, values: ['pdf' as const] }] };
      void store.load('q1', first);
      const pending = store.load('q1', second);
      expect(useCollectionQueryStore.getState().results.q1.loading).toBe(true);
      await vi.advanceTimersByTimeAsync(QUERY_EDIT_DEBOUNCE_MS + 5);
      await pending;
      expect(api.query).toHaveBeenCalledTimes(1);
      expect(api.query).toHaveBeenCalledWith(second, { offset: 0, limit: 200 });
      expect(useCollectionQueryStore.getState().results.q1).toMatchObject({ loading: false, query: second, total: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops a stale response and appends pages for the same query', async () => {
    let resolveFirst!: (value: unknown) => void;
    const first = new Promise((resolve) => { resolveFirst = resolve; });
    const query = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(async () => ({ success: true as const, data: collectionResult([collectionRow({ entry: { path: '/V/new.md', name: 'new.md' } })], { total: 2 }) }))
      .mockImplementationOnce(async () => ({ success: true as const, data: collectionResult([collectionRow({ entry: { path: '/V/more.md', name: 'more.md' } })], { total: 2, offset: 1 }) }));
    installCollectionsApi({ query });
    const store = useCollectionQueryStore.getState();
    const pending = store.load('q1', emptyQuery(), { immediate: true });
    await store.load('q1', emptyQuery(), { immediate: true });
    resolveFirst({ success: true, data: collectionResult([collectionRow({ entry: { path: '/V/old.md', name: 'old.md' } })]) });
    await pending;
    expect(useCollectionQueryStore.getState().results.q1.rows.map((row) => row.entry.path)).toEqual(['/V/new.md']);
    await store.load('q1', emptyQuery(), { append: true });
    expect(query).toHaveBeenLastCalledWith(emptyQuery(), { offset: 1, limit: 200 });
    expect(useCollectionQueryStore.getState().results.q1.rows.map((row) => row.entry.path)).toEqual(['/V/new.md', '/V/more.md']);
  });

  it('keeps the last rows on failure and surfaces the error', async () => {
    installCollectionsApi({ query: vi.fn(async () => ({ success: false as const, error: 'nope' })) });
    useCollectionQueryStore.setState({ results: { q1: { rows: [collectionRow({ entry: { path: '/V/a.md', name: 'a.md' } })], total: 1, incomplete: false, warnings: [], indexState: 'ready', unavailableScopes: [], loading: false, error: null, query: emptyQuery() } } });
    await useCollectionQueryStore.getState().load('q1', emptyQuery(), { immediate: true });
    expect(useCollectionQueryStore.getState().results.q1).toMatchObject({ error: 'nope', loading: false });
    expect(useCollectionQueryStore.getState().results.q1.rows).toHaveLength(1);
  });
});

describe('diskStore.navigateToCollection', () => {
  it('handles every collection kind', () => {
    const store = useDiskStore.getState();
    store.navigateToCollection({ kind: 'query', id: 'q1' });
    expect(useDiskStore.getState()).toMatchObject({ currentCollection: { kind: 'query', id: 'q1' }, currentDirectory: null });
    store.navigateToCollection({ kind: 'directory', directory: '/Vault/A/' });
    expect(useDiskStore.getState()).toMatchObject({ currentCollection: { kind: 'directory', directory: '/Vault/A' }, currentDirectory: '/Vault/A' });
  });
});

describe('viewDraftsStore baselines', () => {
  it('opens a saved view once, tracks edits against the baseline, resets and adopts', () => {
    const view = savedView({ name: 'Papers', layout: 'gallery', query: { ...emptyQuery(), filters: [{ field: 'kind', op: 'in', values: ['pdf'] }] } });
    const store = useViewDraftsStore.getState();
    store.openSaved(view);
    const draft = useViewDraftsStore.getState().get(view.id);
    expect(draft).toMatchObject({ name: 'Papers', layout: 'gallery', saved: { revision: view.revision } });
    expect(isDraftEdited(draft as ViewDraft)).toBe(false);
    expect(useViewDraftsStore.getState().order).toEqual([]);
    store.update(view.id, { name: 'Papers (edited)', layout: 'list' });
    expect(isDraftEdited(useViewDraftsStore.getState().get(view.id) as ViewDraft)).toBe(true);
    store.openSaved({ ...view, name: 'Changed elsewhere', revision: 'rev-x' });
    expect(useViewDraftsStore.getState().get(view.id)).toMatchObject({ name: 'Papers (edited)', saved: { revision: view.revision } });
    store.reset(view.id);
    expect(isDraftEdited(useViewDraftsStore.getState().get(view.id) as ViewDraft)).toBe(false);
    expect(useViewDraftsStore.getState().get(view.id)?.layout).toBe('gallery');
    store.update(view.id, { query: emptyQuery() });
    store.markSaved(view.id, { ...view, query: emptyQuery(), revision: 'rev-2' });
    expect(useViewDraftsStore.getState().get(view.id)).toMatchObject({ saved: { revision: 'rev-2', query: emptyQuery() } });
    store.update(view.id, { name: 'Draft again' });
    store.adoptBaseline(view.id, { ...view, name: 'From disk', revision: 'rev-3' });
    expect(useViewDraftsStore.getState().get(view.id)).toMatchObject({ name: 'From disk', saved: { revision: 'rev-3' } });
    expect(isDraftEdited(useViewDraftsStore.getState().get(view.id) as ViewDraft)).toBe(false);
  });
});

describe('savedViewsStore', () => {
  it('loads the listing, exposes ids, and reloads on change', async () => {
    let changed: (() => void) | null = null;
    const api = installViewsApi([savedView({ name: 'A' })], { onChanged: vi.fn((callback: () => void) => { changed = callback; return () => undefined; }) });
    useSavedViewsStore.getState().reset();
    expect(useSavedViewsStore.getState().loaded).toBe(false);
    useSavedViewsStore.getState().subscribe();
    await useSavedViewsStore.getState().load();
    expect(useSavedViewsStore.getState().order).toEqual([api.views[0].id]);
    expect(useSavedViewsStore.getState().has(api.views[0].id)).toBe(true);
    api.views.push(savedView({ name: 'B' }));
    changed?.();
    await vi.waitFor(() => expect(useSavedViewsStore.getState().order).toHaveLength(2));
    useSavedViewsStore.getState().reset();
  });
});
