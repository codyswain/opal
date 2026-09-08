import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiskFolderView } from '@/renderer/features/disk-explorer/components/DiskFolderView';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { useDocumentStatusStore } from '@/renderer/features/disk-explorer/store/documentStatusStore';
import { entry, installDiskApi } from '@/tests/helpers/diskApi';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

const DIR = '/V';
const NOTE = '/V/note.md';
const OTHER = '/V/other.md';
const FOLDER = '/V/Sub';

function listing() {
  return [
    entry({ path: FOLDER, name: 'Sub', isDirectory: true, kind: 'directory' }),
    entry({ path: NOTE, name: 'note.md', kind: 'markdown', size: 10 }),
    entry({ path: OTHER, name: 'other.md', kind: 'markdown', size: 12 }),
  ];
}

beforeEach(() => {
  window.localStorage.clear();
  useTabsStore.setState({ openPaths: [], openedPath: null, activePath: null, previewPath: null, recentlyClosed: [] });
  useDocumentStatusStore.setState({ statuses: {} });
  installDiskApi({
    listRoots: vi.fn(async () => ({ success: true as const, data: [DIR] })),
    readDirectory: vi.fn(async (path: string) => ({ success: true as const, data: { path, entries: path === DIR ? listing() : [] } })),
    move: vi.fn(async (source: string, destination: string) => ({ success: true as const, data: { path: `${destination}/${source.split('/').pop()}` } })),
  });
  useDiskStore.setState({
    roots: [DIR], listings: {}, expanded: {}, currentDirectory: DIR, currentCollection: { kind: 'directory', directory: DIR },
    focusedPath: null, selectedPath: null, selectedPaths: [], filter: '', pendingAction: null, pendingDelete: null,
    quickPreviewPath: null, isQuickLookOpen: false, loading: { isLoading: false, error: null },
  });
});

describe('row interactions', () => {
  it('opens a file as a preview tab on a single click and pins it on double click', async () => {
    const user = userEvent.setup();
    render(<DiskFolderView dirPath={DIR} />);
    const row = await screen.findByTestId(`disk-folder-entry-${NOTE}`);
    await user.click(row);
    expect(useTabsStore.getState()).toMatchObject({ openedPath: NOTE, previewPath: NOTE, openPaths: [NOTE] });
    expect(useDiskStore.getState().selectedPath).toBe(NOTE);
    await user.click(screen.getByTestId(`disk-folder-entry-${OTHER}`));
    // The preview slot is reused: one tab, now the other file.
    expect(useTabsStore.getState()).toMatchObject({ openedPath: OTHER, previewPath: OTHER, openPaths: [OTHER] });
    await user.dblClick(screen.getByTestId(`disk-folder-entry-${OTHER}`));
    expect(useTabsStore.getState().previewPath).toBeNull();
    expect(useTabsStore.getState().openPaths).toEqual([OTHER]);
  });

  it('modified clicks only change the selection', async () => {
    const user = userEvent.setup();
    render(<DiskFolderView dirPath={DIR} />);
    await screen.findByTestId(`disk-folder-entry-${NOTE}`);
    await user.keyboard('{Meta>}');
    await user.click(screen.getByTestId(`disk-folder-entry-${NOTE}`));
    await user.click(screen.getByTestId(`disk-folder-entry-${OTHER}`));
    await user.keyboard('{/Meta}');
    expect(useDiskStore.getState().selectedPaths).toEqual([NOTE, OTHER]);
    expect(useTabsStore.getState().openPaths).toEqual([]);
  });

  it('a single click on a folder opens it', async () => {
    const user = userEvent.setup();
    render(<DiskFolderView dirPath={DIR} />);
    await user.click(await screen.findByTestId(`disk-folder-entry-${FOLDER}`));
    expect(useDiskStore.getState().currentDirectory).toBe(FOLDER);
  });

  it('right-click selects the row and offers rename, move, copy path and trash', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<DiskFolderView dirPath={DIR} />);
    const row = await screen.findByTestId(`disk-folder-entry-${NOTE}`);
    await user.pointer({ keys: '[MouseRight]', target: row });
    let menu = await screen.findByTestId(`row-menu-${NOTE}`);
    expect(useDiskStore.getState().selectedPath).toBe(NOTE);
    expect(within(menu).getByRole('menuitem', { name: /^Rename…/ })).toBeEnabled();
    await user.click(within(menu).getByRole('menuitem', { name: 'Copy path' }));
    expect(writeText).toHaveBeenCalledWith(NOTE);

    await user.pointer({ keys: '[MouseRight]', target: row });
    menu = await screen.findByTestId(`row-menu-${NOTE}`);
    await user.click(within(menu).getByRole('menuitem', { name: /^Rename…/ }));
    expect(useDiskStore.getState().pendingAction).toEqual({ kind: 'rename', target: NOTE });
    useDiskStore.getState().cancelAction();

    await user.pointer({ keys: '[MouseRight]', target: row });
    menu = await screen.findByTestId(`row-menu-${NOTE}`);
    await user.click(within(menu).getByRole('menuitem', { name: /Move to Trash/ }));
    expect(useDiskStore.getState().pendingDelete).toBe(NOTE);
    useDiskStore.getState().cancelDelete();

    await user.pointer({ keys: '[MouseRight]', target: row });
    menu = await screen.findByTestId(`row-menu-${NOTE}`);
    await user.click(within(menu).getByRole('menuitem', { name: 'Move to…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choose a folder' });
    await user.click(within(dialog).getByRole('button', { name: 'V' }));
    await user.click(await within(dialog).findByRole('button', { name: 'Sub' }));
    await user.click(within(dialog).getByRole('button', { name: 'Choose Sub' }));
    await waitFor(() => expect(window.diskAPI.move).toHaveBeenCalledWith(NOTE, FOLDER));
  });

  it('acts on the whole selection when the row is part of it', async () => {
    const user = userEvent.setup();
    render(<DiskFolderView dirPath={DIR} />);
    await screen.findByTestId(`disk-folder-entry-${NOTE}`);
    useDiskStore.setState({ selectedPath: OTHER, selectedPaths: [NOTE, OTHER] });
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId(`disk-folder-entry-${NOTE}`) });
    const menu = await screen.findByTestId(`row-menu-${NOTE}`);
    expect(within(menu).getByRole('menuitem', { name: /^Move 2 items to Trash/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /^Rename…/ })).toHaveAttribute('aria-disabled', 'true');
    expect(useDiskStore.getState().selectedPaths).toEqual([NOTE, OTHER]);
  });

  it('offers New folder and New note on empty space', async () => {
    const user = userEvent.setup();
    render(<DiskFolderView dirPath={DIR} />);
    await screen.findByTestId(`disk-folder-entry-${NOTE}`);
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('disk-folder-list') });
    const menu = await screen.findByTestId('collection-surface-menu');
    await user.click(within(menu).getByRole('menuitem', { name: 'New folder' }));
    expect(useDiskStore.getState().pendingAction).toEqual({ kind: 'new-folder', target: DIR });
  });

  it('offers to search subfolders when a filtered folder has no direct matches', async () => {
    const { installCollectionsApi, collectionResult } = await import('@/tests/helpers/collectionsApi');
    const api = installCollectionsApi({ query: vi.fn(async () => ({ success: true as const, data: collectionResult([]) })) });
    const user = userEvent.setup();
    render(<DiskFolderView dirPath={DIR} />);
    await screen.findByTestId(`disk-folder-entry-${NOTE}`);
    await user.click(screen.getByTestId('filter-menu'));
    await user.click(await screen.findByTestId('add-filter-description'));
    await user.click(await screen.findByRole('button', { name: 'Search subfolders too' }));
    await waitFor(() => expect((api.query as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toMatchObject({ scope: { kind: 'folders', folders: [DIR], includeDescendants: true } }));
  });
});
