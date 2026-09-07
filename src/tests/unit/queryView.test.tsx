import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { FilesRoute } from '@/renderer/features/disk-explorer/components/FilesRoute';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { useQueryDraftsStore } from '@/renderer/features/disk-explorer/store/queryDraftsStore';
import { useCollectionQueryStore } from '@/renderer/features/disk-explorer/store/collectionQueryStore';
import { filesLocationSnapshots } from '@/renderer/features/disk-explorer/navigation/filesLocationSnapshots';
import { emptyQuery, folderScope } from '@/common/collectionQuery';
import type { CollectionQuery } from '@/types/collectionQuery';
import { entry, installDiskApi } from '@/tests/helpers/diskApi';
import { installActivityApi } from '@/tests/helpers/activityApi';
import { collectionResult, collectionRow, installCollectionsApi } from '@/tests/helpers/collectionsApi';

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
  useQueryDraftsStore.getState().reset();
  useCollectionQueryStore.getState().reset();
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
    const id = useQueryDraftsStore.getState().create({ scope: folderScope('/Vault/Papers'), origin: '/Vault/Papers' });
    renderQuery(id);
    const row = await screen.findByTestId(`disk-folder-entry-${PDF}`);
    expect(api.query).toHaveBeenCalledTimes(1);
    expect(lastQuery(api).scope).toEqual({ kind: 'folders', folders: ['/Vault/Papers'], includeDescendants: true });
    expect(within(row).getByText('Papers')).toBeInTheDocument();
    expect(within(row).getByText('2 KB')).toBeInTheDocument();
    expect(screen.getByText('Match all filters')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Papers' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Include subfolders' })).toHaveAttribute('aria-checked', 'true');
    expect(useDiskStore.getState().currentCollection).toEqual({ kind: 'query', id });
    expect(window.activityAPI.record).not.toHaveBeenCalled();
  });

  it('turns a kind chip and a tags chip into one validated query after the debounce', async () => {
    const api = installCollectionsApi({ query: vi.fn(async () => ({ success: true as const, data: collectionResult(rows()) })) });
    const id = useQueryDraftsStore.getState().create();
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
    expect(useQueryDraftsStore.getState().get(id)?.query.filters).toHaveLength(2);
    await user.selectOptions(screen.getByLabelText('Sort by'), 'touched');
    await waitFor(() => expect(lastQuery(api).sort).toEqual({ field: 'touched', direction: 'asc' }));
    await user.click(screen.getByRole('button', { name: 'Sort descending' }));
    await waitFor(() => expect(lastQuery(api).sort.direction).toBe('desc'));
    expect(await screen.findByText('Opened 1 minute ago')).toBeInTheDocument();
    expect(screen.getAllByText('Never touched').length).toBeGreaterThan(0);
  });

  it('keeps an incomplete chip out of the query and never renames while typing', async () => {
    const api = installCollectionsApi({ query: vi.fn(async () => ({ success: true as const, data: collectionResult(rows()) })) });
    const id = useQueryDraftsStore.getState().create();
    const user = userEvent.setup();
    renderQuery(id);
    await screen.findByTestId(`disk-folder-entry-${PDF}`);
    await user.click(screen.getByTestId(`disk-folder-entry-${PDF}`));
    await user.selectOptions(screen.getByLabelText('Add filter'), 'name');
    const input = screen.getByLabelText('Name value');
    await user.type(input, 'atl{Enter}');
    expect(useDiskStore.getState().pendingAction).toBeNull();
    await waitFor(() => expect(lastQuery(api).filters).toEqual([{ field: 'name', op: 'contains', value: 'atl' }]));
    await user.clear(input);
    await waitFor(() => expect(lastQuery(api).filters).toEqual([]));
    expect(screen.getByTestId('query-chip-name')).toBeInTheDocument();
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
    const id = useQueryDraftsStore.getState().create({ scope: folderScope('/Gone') });
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
    const id = useQueryDraftsStore.getState().create();
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
    const id = useQueryDraftsStore.getState().create();
    useQueryDraftsStore.getState().update(id, { ...emptyQuery(), filters: [{ field: 'kind', op: 'in', values: ['pdf'] }] });
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
    const id = useQueryDraftsStore.getState().create();
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
