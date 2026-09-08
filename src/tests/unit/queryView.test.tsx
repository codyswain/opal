import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { FilesRoute } from '@/renderer/features/disk-explorer/components/FilesRoute';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { useViewDraftsStore } from '@/renderer/features/disk-explorer/store/viewDraftsStore';
import { useCollectionQueryStore } from '@/renderer/features/disk-explorer/store/collectionQueryStore';
import { filesLocationSnapshots } from '@/renderer/features/disk-explorer/navigation/filesLocationSnapshots';
import { emptyQuery, folderScope } from '@/common/collectionQuery';
import type { CollectionQuery } from '@/types/collectionQuery';
import { entry, installDiskApi } from '@/tests/helpers/diskApi';
import { installActivityApi } from '@/tests/helpers/activityApi';
import { collectionResult, collectionRow, installCollectionsApi } from '@/tests/helpers/collectionsApi';
import { installViewsApi, savedView } from '@/tests/helpers/viewsApi';
import { useSavedViewsStore } from '@/renderer/features/disk-explorer/store/savedViewsStore';
import { toast } from 'sonner';
import { TIME_REFRESH_MS } from '@/renderer/features/disk-explorer/components/query/QueryView';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

const ROOT = '/Vault';
const PDF = '/Vault/Papers/atlas.pdf';
const IMAGE = '/Vault/Projects/Deep/cover.png';
const NOTE = '/Vault/notes.md';
const NOW = Date.now();

function Harness() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate(-1)}>Back</button>
      <output data-testid="location">{location.search}</output>
      <FilesRoute />
    </>
  );
}

function renderQuery(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/files?mode=browse&collection=query&id=${id}`]}>
      <Harness />
    </MemoryRouter>
  );
}

const rows = () => [
  collectionRow({ entry: { path: PDF, name: 'atlas.pdf', kind: 'pdf', size: 2048 }, tags: ['research'], touchedAt: NOW - 60_000, touchedKind: 'opened', openedAt: NOW - 60_000 }),
  collectionRow({ entry: { path: IMAGE, name: 'cover.png', kind: 'image', size: 512 }, tags: ['reference'] }),
  collectionRow({ entry: { path: NOTE, name: 'notes.md', kind: 'markdown', size: 12 } }),
];

function lastQuery(api: ReturnType<typeof installCollectionsApi>): CollectionQuery {
  const calls = (api.query as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1][0] as CollectionQuery;
}

beforeEach(() => {
  filesLocationSnapshots.clear();
  useViewDraftsStore.getState().clearAll();
  useCollectionQueryStore.getState().reset();
  useSavedViewsStore.getState().reset();
  installViewsApi();
  (toast as unknown as ReturnType<typeof vi.fn>).mockClear();
  installDiskApi({
    listRoots: vi.fn(async () => ({ success: true as const, data: [ROOT] })),
    readDirectory: vi.fn(async (path: string) => ({ success: true as const, data: { path, entries: [] } })),
    stat: vi.fn(async (path: string) => ({ success: true as const, data: entry({ path, name: path.split('/').pop() ?? path, kind: 'pdf' }) })),
  });
  installActivityApi();
  useDiskStore.setState({
    roots: [], listings: {}, expanded: {}, currentDirectory: null, currentCollection: null,
    focusedPath: null, selectedPath: null, selectedPaths: [], filter: '',
    quickPreviewPath: null, isQuickLookOpen: false, isPreviewPaneOpen: false,
    pendingAction: null, pendingDelete: null, loading: { isLoading: false, error: null },
  });
  useTabsStore.setState({ openPaths: [], openedPath: null, activePath: null, previewPath: null });
});

describe('QueryView', () => {
  it('loads the draft once, shows rows with folder and detail, and marks the scope', async () => {
    const api = installCollectionsApi({ query: vi.fn(async () => ({ success: true as const, data: collectionResult(rows()) })) });
    const id = useViewDraftsStore.getState().create({ scope: folderScope('/Vault/Papers'), origin: '/Vault/Papers' });
    renderQuery(id);
    const row = await screen.findByTestId(`disk-folder-entry-${PDF}`);
    expect(api.query).toHaveBeenCalledTimes(1);
    expect(lastQuery(api).scope).toEqual({ kind: 'folders', folders: ['/Vault/Papers'], includeDescendants: true });
    expect(within(row).getByText('Papers')).toBeInTheDocument();
    expect(within(row).getByText('2 KB')).toBeInTheDocument();
    expect(screen.getByText('Match all filters')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Scope folders' })).getByText('Papers')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Include subfolders' })).toHaveAttribute('aria-checked', 'true');
    expect(useDiskStore.getState().currentCollection).toEqual({ kind: 'query', id });
    expect(window.activityAPI.record).not.toHaveBeenCalled();
  });

  it('turns a kind chip and a tags chip into one validated query after the debounce', async () => {
    const api = installCollectionsApi({ query: vi.fn(async () => ({ success: true as const, data: collectionResult(rows()) })) });
    const id = useViewDraftsStore.getState().create();
    const user = userEvent.setup();
    renderQuery(id);
    await screen.findByTestId(`disk-folder-entry-${PDF}`);
    await user.selectOptions(screen.getByLabelText('Add filter'), 'kind');
    const kindChip = screen.getByTestId('query-chip-kind');
    await user.click(within(kindChip).getByRole('button', { name: 'PDF' }));
    await user.click(within(kindChip).getByRole('button', { name: 'Image' }));
    await user.selectOptions(screen.getByLabelText('Add filter'), 'tags');
    await user.type(screen.getByLabelText('Tags value'), 'research, reference');
    await waitFor(() => expect(lastQuery(api).filters).toEqual([
      { field: 'kind', op: 'in', values: ['pdf', 'image'] },
      { field: 'tags', op: 'has-any', values: ['research', 'reference'] },
    ]));
    expect(useViewDraftsStore.getState().get(id)?.query.filters).toHaveLength(2);
    await user.selectOptions(screen.getByLabelText('Sort by'), 'touched');
    await waitFor(() => expect(lastQuery(api).sort).toEqual({ field: 'touched', direction: 'asc' }));
    await user.click(screen.getByRole('button', { name: 'Sort descending' }));
    await waitFor(() => expect(lastQuery(api).sort.direction).toBe('desc'));
    expect(await screen.findByText('Opened 1 minute ago')).toBeInTheDocument();
    expect(screen.getAllByText('Never touched').length).toBeGreaterThan(0);
  });

  it('keeps an incomplete chip out of the query and never renames while typing', async () => {
    const api = installCollectionsApi({ query: vi.fn(async () => ({ success: true as const, data: collectionResult(rows()) })) });
    const id = useViewDraftsStore.getState().create();
    const user = userEvent.setup();
    renderQuery(id);
    await screen.findByTestId(`disk-folder-entry-${PDF}`);
    fireEvent.click(screen.getByTestId(`disk-folder-entry-${PDF}`), { metaKey: true });
    await user.selectOptions(screen.getByLabelText('Add filter'), 'name');
    const input = screen.getByLabelText('Name value');
    await user.type(input, 'atl{Enter}');
    expect(useDiskStore.getState().pendingAction).toBeNull();
    await waitFor(() => expect(lastQuery(api).filters).toEqual([{ field: 'name', op: 'contains', value: 'atl' }]));
    await user.clear(input);
    await waitFor(() => expect(lastQuery(api).filters).toEqual([]));
    expect(screen.getByTestId('query-chip-name')).toBeInTheDocument();
  });

  it('shows tag pills on rows and suggests known tags in the tags chip', async () => {
    const listeners: (() => void)[] = [];
    const api = installCollectionsApi({
      query: vi.fn(async () => ({ success: true as const, data: collectionResult(rows()) })),
      tags: vi.fn(async () => ({ success: true as const, data: [{ tag: 'research', count: 2 }] })),
      onChanged: vi.fn((listener: () => void) => { listeners.push(listener); return () => undefined; }),
    });
    const id = useViewDraftsStore.getState().create();
    const user = userEvent.setup();
    renderQuery(id);
    const row = await screen.findByTestId(`disk-folder-entry-${PDF}`);
    expect(within(row).getByTestId('row-tag')).toHaveTextContent('research');
    expect(within(screen.getByTestId(`disk-folder-entry-${NOTE}`)).queryByTestId('row-tag')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Add filter'), 'tags');
    const input = screen.getByLabelText('Tags value');
    const listId = input.getAttribute('list');
    expect(listId).toBeTruthy();
    const options = () => [...(document.getElementById(listId ?? '')?.querySelectorAll('option') ?? [])].map((option) => option.getAttribute('value'));
    await waitFor(() => expect(options()).toEqual(['research']));
    (api.tags as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: true, data: [{ tag: 'atlas', count: 1 }, { tag: 'research', count: 2 }] });
    act(() => { listeners.forEach((listener) => listener()); });
    await waitFor(() => expect(options()).toEqual(['atlas', 'research']));
  });

  it('adds a folder to the scope from the picker and widens to all roots when the last one is removed', async () => {
    const api = installCollectionsApi({ query: vi.fn(async () => ({ success: true as const, data: collectionResult(rows()) })) });
    installDiskApi({
      listRoots: vi.fn(async () => ({ success: true as const, data: [ROOT] })),
      readDirectory: vi.fn(async (path: string) => ({
        success: true as const,
        data: {
          path,
          entries: path === ROOT
            ? [entry({ path: '/Vault/Papers', name: 'Papers', isDirectory: true }), entry({ path: '/Vault/notes.md', name: 'notes.md', kind: 'markdown' })]
            : [],
        },
      })),
      stat: vi.fn(async (path: string) => ({ success: true as const, data: entry({ path, name: path.split('/').pop() ?? path, kind: 'pdf' }) })),
    });
    const id = useViewDraftsStore.getState().create({ scope: folderScope('/Vault/Projects') });
    const user = userEvent.setup();
    renderQuery(id);
    await screen.findByTestId(`disk-folder-entry-${PDF}`);
    await user.click(screen.getByRole('button', { name: 'Choose folder…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choose a folder' });
    await user.click(within(dialog).getByRole('button', { name: 'Vault' }));
    expect(await within(dialog).findByRole('button', { name: 'Papers' })).toBeInTheDocument();
    expect(within(dialog).queryByText('notes.md')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Papers' }));
    await within(dialog).findByText('No subfolders.');
    expect(within(dialog).getByTestId('folder-picker-path')).toHaveTextContent('Vault › Papers');
    await user.click(within(dialog).getByRole('button', { name: 'Choose Papers' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(lastQuery(api).scope).toEqual({ kind: 'folders', folders: ['/Vault/Projects', '/Vault/Papers'], includeDescendants: true }));
    await user.click(screen.getByRole('button', { name: 'Remove Projects from scope' }));
    await user.click(screen.getByRole('button', { name: 'Remove Papers from scope' }));
    await waitFor(() => expect(lastQuery(api).scope).toEqual({ kind: 'all-roots' }));
  });

  it('Discard drops an unsaved draft and returns to the folder it came from', async () => {
    installCollectionsApi({ query: vi.fn(async () => ({ success: true as const, data: collectionResult(rows()) })) });
    const id = useViewDraftsStore.getState().create({ scope: folderScope('/Vault/Papers'), origin: '/Vault/Papers' });
    const user = userEvent.setup();
    renderQuery(id);
    await screen.findByTestId(`disk-folder-entry-${PDF}`);
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('dir=%2FVault%2FPapers'));
    await waitFor(() => expect(useViewDraftsStore.getState().has(id)).toBe(false));
  });

  it('Cmd+F adds a Name chip and focuses it, then focuses the existing text chip', async () => {
    installCollectionsApi({ query: vi.fn(async () => ({ success: true as const, data: collectionResult(rows()) })) });
    const id = useViewDraftsStore.getState().create();
    const user = userEvent.setup();
    renderQuery(id);
    await screen.findByTestId(`disk-folder-entry-${PDF}`);
    await user.keyboard('{Meta>}f{/Meta}');
    const input = await screen.findByLabelText('Name value');
    await waitFor(() => expect(input).toHaveFocus());
    await user.type(input, 'atlas');
    input.blur();
    await user.keyboard('{Meta>}f{/Meta}');
    expect(screen.getAllByTestId('query-chip-name')).toHaveLength(1);
    expect(input).toHaveFocus();
  });

  it('shows the unavailable scope and offers to widen it', async () => {
    const api = installCollectionsApi({
      query: vi.fn(async (query: CollectionQuery) => ({
        success: true as const,
        data: query.scope.kind === 'folders'
          ? collectionResult([], { unavailableScopes: ['/Gone'] })
          : collectionResult(rows()),
      })),
    });
    const id = useViewDraftsStore.getState().create({ scope: folderScope('/Gone') });
    const user = userEvent.setup();
    renderQuery(id);
    expect(await screen.findByTestId('query-unavailable')).toHaveTextContent('/Gone');
    await user.click(screen.getByRole('button', { name: 'Search all opened folders' }));
    await screen.findByTestId(`disk-folder-entry-${PDF}`);
    expect(lastQuery(api).scope).toEqual({ kind: 'all-roots' });
  });

  it('labels incomplete results, offers load more, and clears filters from the empty state', async () => {
    const api = installCollectionsApi({
      query: vi.fn(async (query: CollectionQuery, page?: { offset?: number }) => ({
        success: true as const,
        data: query.filters.length > 0
          ? collectionResult([], { total: 0 })
          : collectionResult(page?.offset ? [rows()[2]] : rows().slice(0, 2), { total: 3, incomplete: true, warnings: ['1 item with unreadable metadata was left out because a filter needs it.'] }),
      })),
    });
    const id = useViewDraftsStore.getState().create();
    const user = userEvent.setup();
    renderQuery(id);
    await screen.findByTestId(`disk-folder-entry-${PDF}`);
    expect(screen.getByTestId('query-warnings')).toHaveTextContent('Results are incomplete');
    expect(screen.getByText('2 of 3 items (incomplete)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more (2 of 3)' }));
    await screen.findByTestId(`disk-folder-entry-${NOTE}`);
    expect(api.query).toHaveBeenLastCalledWith(expect.anything(), { offset: 2, limit: 200 });
    await user.selectOptions(screen.getByLabelText('Add filter'), 'description');
    expect(await screen.findByText('No items match these filters')).toBeInTheDocument();
    await user.click(within(screen.getByTestId('disk-folder-empty')).getByRole('button', { name: 'Clear filters' }));
    await screen.findByTestId(`disk-folder-entry-${PDF}`);
    expect(screen.queryByTestId('query-chip-description')).not.toBeInTheDocument();
  });

  it('opens a result inside the query, records it, and Back restores the draft and selection', async () => {
    installCollectionsApi({ query: vi.fn(async () => ({ success: true as const, data: collectionResult(rows()) })) });
    const id = useViewDraftsStore.getState().create();
    useViewDraftsStore.getState().update(id, { query: { ...emptyQuery(), filters: [{ field: 'kind', op: 'in', values: ['pdf'] }] } });
    const user = userEvent.setup();
    renderQuery(id);
    const row = await screen.findByTestId(`disk-folder-entry-${PDF}`);
    await user.click(row);
    await user.dblClick(row);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`?mode=focus&collection=query&id=${id}&file=${encodeURIComponent(PDF)}`));
    expect(window.activityAPI.record).toHaveBeenCalledWith(PDF, 'opened');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(useDiskStore.getState().currentCollection).toEqual({ kind: 'query', id }));
    await waitFor(() => expect(useDiskStore.getState().selectedPaths).toEqual([PDF]));
    expect(within(screen.getByTestId('query-chip-kind')).getByRole('button', { name: 'PDF' })).toHaveAttribute('aria-pressed', 'true');
    expect(window.activityAPI.record).toHaveBeenCalledTimes(1);
  });

  it('reloads when main reports a change and shows a retryable error', async () => {
    let changed: (() => void) | null = null;
    const query = vi.fn()
      .mockResolvedValueOnce({ success: false as const, error: 'nope' })
      .mockResolvedValue({ success: true as const, data: collectionResult(rows()) });
    const api = installCollectionsApi({ query, onChanged: vi.fn((callback: () => void) => { changed = callback; return () => undefined; }) });
    const id = useViewDraftsStore.getState().create();
    const user = userEvent.setup();
    renderQuery(id);
    expect(await screen.findByRole('alert')).toHaveTextContent('nope');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByTestId(`disk-folder-entry-${PDF}`);
    const calls = (api.query as ReturnType<typeof vi.fn>).mock.calls.length;
    act(() => changed?.());
    await waitFor(() => expect((api.query as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls));
  });

  it('falls back to the first root when the draft is unknown', async () => {
    installCollectionsApi();
    renderQuery('missing');
    await waitFor(() => expect(useDiskStore.getState().currentDirectory).toBe(ROOT));
    expect(screen.getByTestId('location')).toHaveTextContent('?mode=browse&dir=%2FVault');
  });
});

function renderView(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/files?mode=browse&collection=view&id=${id}`]}>
      <Harness />
    </MemoryRouter>
  );
}

describe('saved views', () => {
  it('saves a transient draft as a view and lands on it', async () => {
    installCollectionsApi({ query: vi.fn(async () => ({ success: true as const, data: collectionResult(rows()) })) });
    const api = installViewsApi();
    const id = useViewDraftsStore.getState().create();
    useViewDraftsStore.getState().update(id, { query: { ...emptyQuery(), filters: [{ field: 'kind', op: 'in', values: ['pdf'] }] } });
    const user = userEvent.setup();
    renderQuery(id);
    await screen.findByTestId(`disk-folder-entry-${PDF}`);
    await user.click(screen.getByRole('button', { name: 'Save view' }));
    const dialog = await screen.findByRole('dialog');
    const nameInput = within(dialog).getByLabelText('View name');
    // The dialog suggests a name from the definition; typing over it replaces it.
    expect((nameInput as HTMLInputElement).value).toMatch(/PDFs|Items|Everything|^$/);
    await user.clear(nameInput);
    await user.type(nameInput, 'Papers');
    await user.click(within(dialog).getByRole('button', { name: 'Save view' }));
    await waitFor(() => expect(api.create).toHaveBeenCalledWith({
      name: 'Papers', layout: 'list', query: { ...emptyQuery(), filters: [{ field: 'kind', op: 'in', values: ['pdf'] }] },
    }));
    const saved = api.views[0];
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`?mode=browse&collection=view&id=${saved.id}`));
    expect(useViewDraftsStore.getState().has(id)).toBe(false);
    expect(useDiskStore.getState().currentCollection).toEqual({ kind: 'view', id: saved.id });
    expect(await screen.findByLabelText('View name')).toHaveValue('Papers');
    expect(screen.queryByTestId('view-edited')).not.toBeInTheDocument();
  });

  it('marks edits, resets them, and saves changes against the baseline revision', async () => {
    installCollectionsApi({ query: vi.fn(async () => ({ success: true as const, data: collectionResult(rows()) })) });
    const view = savedView({ name: 'Papers' });
    const api = installViewsApi([view]);
    const user = userEvent.setup();
    renderView(view.id);
    await screen.findByTestId(`disk-folder-entry-${PDF}`);
    expect(screen.getByLabelText('View name')).toHaveValue('Papers');
    expect(screen.queryByTestId('view-edited')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('disk-folder-view-gallery'));
    expect(await screen.findByTestId('view-edited')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(screen.queryByTestId('view-edited')).not.toBeInTheDocument());
    expect(screen.getByTestId('disk-folder-view-list')).toHaveAttribute('aria-pressed', 'true');
    await user.selectOptions(screen.getByLabelText('Add filter'), 'description');
    await screen.findByTestId('view-edited');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith(view.id, { name: 'Papers', layout: 'list', query: { ...emptyQuery(), filters: [{ field: 'description', op: 'is-empty' }] } }, view.revision));
    await waitFor(() => expect(screen.queryByTestId('view-edited')).not.toBeInTheDocument());
    expect(useViewDraftsStore.getState().get(view.id)?.saved?.revision).toBe(api.views[0].revision);
  });

  it('reports a conflict and keeps both states recoverable', async () => {
    installCollectionsApi({ query: vi.fn(async () => ({ success: true as const, data: collectionResult(rows()) })) });
    const view = savedView({ name: 'Papers' });
    const api = installViewsApi([view]);
    const user = userEvent.setup();
    renderView(view.id);
    await screen.findByTestId(`disk-folder-entry-${PDF}`);
    const name = screen.getByLabelText('View name');
    await user.clear(name);
    await user.type(name, 'Papers edited{Enter}');
    await screen.findByTestId('view-edited');
    (api as unknown as { markConflict: (id: string) => void }).markConflict(view.id);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const conflict = await screen.findByTestId('view-conflict');
    expect(api.views[0].name).toBe('Papers');
    await user.click(within(conflict).getByRole('button', { name: 'Save as new' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save as new' }));
    await waitFor(() => expect(api.views).toHaveLength(2));
    expect(api.views[1].name).toBe('Papers edited');
    expect(api.views[0].name).toBe('Papers');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`collection=view&id=${api.views[1].id}`));
  });

  it('reloads from disk after a conflict', async () => {
    installCollectionsApi({ query: vi.fn(async () => ({ success: true as const, data: collectionResult(rows()) })) });
    const view = savedView({ name: 'Papers' });
    const api = installViewsApi([view]);
    const user = userEvent.setup();
    renderView(view.id);
    await screen.findByTestId(`disk-folder-entry-${PDF}`);
    await user.click(screen.getByTestId('disk-folder-view-gallery'));
    await screen.findByTestId('view-edited');
    api.views[0] = { ...api.views[0], name: 'Edited elsewhere', revision: 'rev-disk' };
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByTestId('view-conflict');
    await user.click(screen.getByRole('button', { name: 'Reload from disk' }));
    await waitFor(() => expect(screen.getByLabelText('View name')).toHaveValue('Edited elsewhere'));
    expect(screen.queryByTestId('view-edited')).not.toBeInTheDocument();
    expect(screen.queryByTestId('view-conflict')).not.toBeInTheDocument();
  });

  it('duplicates, removes with confirmation, and undoes the removal', async () => {
    installCollectionsApi({ query: vi.fn(async () => ({ success: true as const, data: collectionResult(rows()) })) });
    installActivityApi();
    const view = savedView({ name: 'Papers' });
    const api = installViewsApi([view]);
    const user = userEvent.setup();
    renderView(view.id);
    await screen.findByTestId(`disk-folder-entry-${PDF}`);
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(api.views).toHaveLength(2));
    const copy = api.views[1];
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`collection=view&id=${copy.id}`));
    expect(await screen.findByLabelText('View name')).toHaveValue('Papers copy');
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(within(screen.getByRole('group', { name: 'Confirm removing this view' })).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith(copy.id));
    await waitFor(() => expect(useDiskStore.getState().currentCollection).toEqual({ kind: 'recent' }));
    expect(useSavedViewsStore.getState().has(copy.id)).toBe(false);
    expect(toast).toHaveBeenCalledWith('Removed “Papers copy”', expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }));
    const options = (toast as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as { action: { onClick: () => void } };
    options.action.onClick();
    await waitFor(() => expect(api.restore).toHaveBeenCalled());
    await waitFor(() => expect(useSavedViewsStore.getState().has(copy.id)).toBe(true));
  });
});

describe('review fixes', () => {
  it('Reset and Reload from disk restore the saved chips', async () => {
    const api = installCollectionsApi({ query: vi.fn(async () => ({ success: true as const, data: collectionResult(rows()) })) });
    const view = savedView({ name: 'Papers', query: { ...emptyQuery(), filters: [{ field: 'kind', op: 'in', values: ['pdf'] }] } });
    installViewsApi([view]);
    const user = userEvent.setup();
    renderView(view.id);
    await screen.findByTestId(`disk-folder-entry-${PDF}`);
    await user.selectOptions(screen.getByLabelText('Add filter'), 'description');
    await screen.findByTestId('view-edited');
    await waitFor(() => expect(lastQuery(api).filters).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(screen.queryByTestId('query-chip-description')).not.toBeInTheDocument());
    expect(screen.getByTestId('query-chip-kind')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('view-edited')).not.toBeInTheDocument());
    await waitFor(() => expect(lastQuery(api).filters).toEqual([{ field: 'kind', op: 'in', values: ['pdf'] }]));
    expect(useViewDraftsStore.getState().get(view.id)?.query.filters).toEqual([{ field: 'kind', op: 'in', values: ['pdf'] }]);
  });

  it('opens a view with a non-preset duration without rewriting or marking it', async () => {
    const api = installCollectionsApi({ query: vi.fn(async () => ({ success: true as const, data: collectionResult(rows()) })) });
    const view = savedView({ name: 'Three hours', query: { ...emptyQuery(), filters: [{ field: 'touched', op: 'within', durationMs: 10_800_000 }] } });
    installViewsApi([view]);
    renderView(view.id);
    await screen.findByTestId(`disk-folder-entry-${PDF}`);
    await waitFor(() => expect((api.query as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1));
    expect(lastQuery(api).filters).toEqual([{ field: 'touched', op: 'within', durationMs: 10_800_000 }]);
    expect(screen.getByLabelText('Last touched duration')).toHaveValue('custom:10800000');
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(screen.queryByTestId('view-edited')).not.toBeInTheDocument();
    expect((api.query as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('refuses an over-long chip value without crashing or sending it', async () => {
    const api = installCollectionsApi({ query: vi.fn(async () => ({ success: true as const, data: collectionResult(rows()) })) });
    const id = useViewDraftsStore.getState().create();
    const user = userEvent.setup();
    renderQuery(id);
    await screen.findByTestId(`disk-folder-entry-${PDF}`);
    await user.selectOptions(screen.getByLabelText('Add filter'), 'name');
    const input = screen.getByLabelText('Name value');
    await user.click(input);
    await user.paste('x'.repeat(300));
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(screen.getByTestId('query-chip-name')).toBeInTheDocument();
    expect(lastQuery(api).filters).toEqual([]);
    expect(useViewDraftsStore.getState().get(id)?.query.filters).toEqual([]);
  });
});

describe('view polish', () => {
  it('Show in folder lands in the parent with the item selected', async () => {
    installCollectionsApi({ query: vi.fn(async () => ({ success: true as const, data: collectionResult(rows()) })) });
    installDiskApi({
      listRoots: vi.fn(async () => ({ success: true as const, data: [ROOT] })),
      readDirectory: vi.fn(async (path: string) => ({
        success: true as const,
        data: { path, entries: path === '/Vault/Papers' ? [entry({ path: PDF, name: 'atlas.pdf', kind: 'pdf' })] : [] },
      })),
    });
    const id = useViewDraftsStore.getState().create();
    const user = userEvent.setup();
    renderQuery(id);
    expect(await screen.findByRole('button', { name: 'Show in folder' })).toBeDisabled();
    fireEvent.click(screen.getByTestId(`disk-folder-entry-${PDF}`), { metaKey: true });
    await user.click(screen.getByRole('button', { name: 'Show in folder' }));
    await waitFor(() => expect(useDiskStore.getState().currentDirectory).toBe('/Vault/Papers'));
    await waitFor(() => expect(useDiskStore.getState().selectedPaths).toEqual([PDF]));
    expect(window.activityAPI.record).toHaveBeenCalledWith('/Vault/Papers', 'opened');
  });

  it('re-evaluates relative-time filters on focus and once a minute', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const api = installCollectionsApi({ query: vi.fn(async () => ({ success: true as const, data: collectionResult(rows()) })) });
      const id = useViewDraftsStore.getState().create();
      useViewDraftsStore.getState().update(id, { query: { ...emptyQuery(), filters: [{ field: 'touched', op: 'within', durationMs: 7 * 24 * 3600 * 1000 }] } });
      renderQuery(id);
      await screen.findByTestId(`disk-folder-entry-${PDF}`);
      const calls = () => (api.query as ReturnType<typeof vi.fn>).mock.calls.length;
      const before = calls();
      act(() => { window.dispatchEvent(new Event('focus')); });
      await waitFor(() => expect(calls()).toBe(before + 1));
      act(() => { vi.advanceTimersByTime(TIME_REFRESH_MS + 10); });
      await waitFor(() => expect(calls()).toBe(before + 2));
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the selected item preview when its row stops matching', async () => {
    let changed: (() => void) | null = null;
    const query = vi.fn()
      .mockResolvedValueOnce({ success: true as const, data: collectionResult(rows()) })
      .mockResolvedValue({ success: true as const, data: collectionResult(rows().slice(1)) });
    installCollectionsApi({ query, onChanged: vi.fn((callback: () => void) => { changed = callback; return () => undefined; }) });
    useDiskStore.setState({ isPreviewPaneOpen: true });
    const id = useViewDraftsStore.getState().create();
    const user = userEvent.setup();
    renderQuery(id);
    fireEvent.click(await screen.findByTestId(`disk-folder-entry-${PDF}`), { metaKey: true });
    expect(screen.getByTestId('detail-title')).toHaveTextContent('atlas.pdf');
    act(() => changed?.());
    await waitFor(() => expect(screen.queryByTestId(`disk-folder-entry-${PDF}`)).not.toBeInTheDocument());
    expect(screen.getByTestId('detail-title')).toHaveTextContent('atlas.pdf');
    expect(screen.getByTestId('query-selection-missing')).toBeInTheDocument();
    expect(useDiskStore.getState().selectedPaths).toEqual([PDF]);
    await user.click(screen.getByTestId(`disk-folder-entry-${IMAGE}`));
    expect(screen.getByTestId('detail-title')).toHaveTextContent('cover.png');
    expect(screen.queryByTestId('query-selection-missing')).not.toBeInTheDocument();
  });
});
