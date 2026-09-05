import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { filesLocationSnapshots } from '@/renderer/features/disk-explorer/navigation/filesLocationSnapshots';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { DiskExplorer } from '@/renderer/features/disk-explorer/components/DiskExplorer';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';

const { toastError } = vi.hoisted(() => ({
  toastError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastError,
  },
}));

const ROOT = '/Vault';
const PHOTOS = '/Vault/Photos';
let onChanged: ReturnType<typeof vi.fn>;
let changedListener: ((payload: { directories: string[] }) => void) | null;
let readDirectory: ReturnType<typeof vi.fn>;

beforeEach(() => {
  filesLocationSnapshots.clear();
  useTabsStore.setState({openPaths: [], openedPath: null, activePath: null, previewPath: null});
  changedListener = null;
  toastError.mockClear();
  onChanged = vi.fn((callback: (payload: { directories: string[] }) => void) => {
    changedListener = callback;
    return () => {
      changedListener = null;
    };
  });
  readDirectory = vi.fn(async (p: string) => ({
    success: true as const,
    data: {
      path: p,
      entries: p === PHOTOS
        ? [entry({ path: `${PHOTOS}/a.jpg`, name: 'a.jpg', kind: 'image' })]
        : [],
    },
  }));

  installDiskApi({
    readDirectory,
    openFolder: vi.fn(async () => ({ success: true as const, data: { root: ROOT } })),
    listRoots: vi.fn(async () => ({ success: true as const, data: [ROOT] })),
    onChanged,
  });

  useDiskStore.setState({
    roots: [ROOT],
    listings: {
      [ROOT]: [entry({ path: PHOTOS, name: 'Photos', kind: 'directory', isDirectory: true })],
    },
    expanded: { [ROOT]: true },
    currentDirectory: ROOT,
    focusedPath: null,
    isQuickLookOpen: false,
    quickPreviewPath: null,
    selectedPath: null,
    selectedPaths: [],
    pendingAction: null,
    pendingDelete: null,
    sort: { field: 'name', direction: 'asc' },
    loading: { isLoading: false, error: null },
  });
});

describe('DiskExplorer', () => {
  it('renders the tree alongside a folder view', () => {
    render(<DiskExplorer />);
    expect(screen.getByRole('tree')).toBeInTheDocument();
  });

  it('shows the selected folder in the detail pane', async () => {
    const user = userEvent.setup();
    render(<DiskExplorer />);

    await user.click(screen.getByTestId('disk-tree-item-/Vault/Photos'));

    await waitFor(() => expect(screen.getByAltText('a.jpg')).toBeInTheDocument());
  });

  it('shows the parent folder when a file is selected', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({
      listings: {
        [ROOT]: [entry({ path: `${ROOT}/note.md`, name: 'note.md', kind: 'markdown' })],
      },
    });

    render(<DiskExplorer />);
    await user.click(screen.getByTestId('disk-tree-item-/Vault/note.md'));

    await waitFor(() =>
      expect(screen.getByTestId('disk-folder-entry-/Vault/note.md')).toBeInTheDocument()
    );
  });

  it('shows a toast and keeps the error banner for a store error', async () => {
    useDiskStore.setState({ loading: { isLoading: false, error: 'Permission denied' } });
    render(<DiskExplorer />);

    await waitFor(() =>
      expect(screen.getByTestId('disk-explorer-error')).toHaveTextContent('Permission denied')
    );
    expect(toastError).toHaveBeenCalledWith('Permission denied');
  });

  it('offers an open-folder action', () => {
    render(<DiskExplorer />);
    expect(screen.getByTestId('disk-explorer-open-folder')).toBeInTheDocument();
  });

  it('subscribes to disk changes and reloads affected cached directories', async () => {
    render(<DiskExplorer />);
    expect(onChanged).toHaveBeenCalledTimes(1);

    readDirectory.mockClear();
    changedListener?.({ directories: [ROOT, '/Vault/Uncached'] });

    await waitFor(() => expect(readDirectory).toHaveBeenCalledTimes(1));
    expect(readDirectory).toHaveBeenCalledWith(ROOT);
  });

  it('only toggles quick look on Space for a previewable selected entry', async () => {
    const user = userEvent.setup();
    render(<DiskExplorer />);

    fireEvent.keyDown(window, { code: 'Space' });
    expect(useDiskStore.getState().isQuickLookOpen).toBe(false);
    expect(screen.queryByTestId('quick-look')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('disk-tree-item-/Vault'));
    fireEvent.keyDown(window, { code: 'Space' });
    expect(useDiskStore.getState().isQuickLookOpen).toBe(false);
    expect(screen.queryByTestId('quick-look')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('disk-tree-item-/Vault/Photos'));
    await user.click(await screen.findByTestId('disk-folder-entry-/Vault/Photos/a.jpg'));
    fireEvent.keyDown(window, { code: 'Space' });

    expect(useDiskStore.getState().isQuickLookOpen).toBe(true);
    expect(screen.getByTestId('quick-look')).toBeInTheDocument();
  });

  it('opens the selected file in the main surface on Cmd+Down', async () => {
    const user = userEvent.setup();
    render(<DiskExplorer />);

    await user.click(screen.getByTestId('disk-tree-item-/Vault/Photos'));
    await user.click(await screen.findByTestId('disk-folder-entry-/Vault/Photos/a.jpg'));
    fireEvent.keyDown(window, { key: 'ArrowDown', metaKey: true });

    expect(useTabsStore.getState().openedPath).toBe(`${PHOTOS}/a.jpg`);
    expect(screen.getByTestId('files-focus')).toBeInTheDocument();
  });

  it('navigates into the selected collection folder on Cmd+Down', async () => {
    const user = userEvent.setup();
    render(<DiskExplorer />);
    await user.click(screen.getByTestId('disk-folder-entry-/Vault/Photos'));
    fireEvent.keyDown(window, { key: 'ArrowDown', metaKey: true });
    await waitFor(() => expect(useDiskStore.getState().currentDirectory).toBe(PHOTOS));
  });

  it('navigates to the parent folder on Cmd+Up and stops at a root', async () => {
    const user = userEvent.setup();
    render(<DiskExplorer />);

    await user.click(screen.getByTestId('disk-tree-item-/Vault/Photos'));
    await user.click(await screen.findByTestId('disk-folder-entry-/Vault/Photos/a.jpg'));
    fireEvent.keyDown(window, { key: 'ArrowUp', metaKey: true });
    expect(useDiskStore.getState().currentDirectory).toBe(ROOT);

    fireEvent.keyDown(window, { key: 'ArrowUp', metaKey: true });
    expect(useDiskStore.getState().currentDirectory).toBe(ROOT);
  });

  it('starts rename on bare Enter for the selected item', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({
      listings: {
        [ROOT]: [entry({ path: `${ROOT}/note.md`, name: 'note.md', kind: 'markdown' })],
      },
    });

    render(<DiskExplorer />);
    await user.click(screen.getByTestId('disk-tree-item-/Vault/note.md'));
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(useDiskStore.getState().pendingAction).toEqual({
      kind: 'rename',
      target: '/Vault/note.md',
    });
  });

  it('keeps Enter and Delete working after clicking a gallery tile', async () => {
    const user = userEvent.setup();
    render(<DiskExplorer />);

    await user.click(screen.getByTestId('disk-tree-item-/Vault/Photos'));
    const tile = await screen.findByTestId('disk-folder-entry-/Vault/Photos/a.jpg');
    await user.click(tile);

    fireEvent.keyDown(window, { key: 'Enter' });
    expect(useDiskStore.getState().pendingAction).toEqual({
      kind: 'rename',
      target: '/Vault/Photos/a.jpg',
    });

    useDiskStore.setState({ pendingAction: null });
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(useDiskStore.getState().pendingDelete).toBe('/Vault/Photos/a.jpg');
  });

  it('keeps Enter and Delete working after clicking a list row', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({
      listings: {
        [ROOT]: [entry({ path: `${ROOT}/note.md`, name: 'note.md', kind: 'markdown' })],
      },
    });

    render(<DiskExplorer />);
    const row = screen.getByTestId('disk-folder-entry-/Vault/note.md');
    await user.click(row);
    expect(useDiskStore.getState().focusedPath).toBe('/Vault/note.md');

    fireEvent.keyDown(window, { key: 'Enter' });
    expect(useDiskStore.getState().pendingAction).toEqual({
      kind: 'rename',
      target: '/Vault/note.md',
    });

    useDiskStore.setState({ pendingAction: null });
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(useDiskStore.getState().pendingDelete).toBe('/Vault/note.md');
  });

  it('does not start rename when Enter activates the new-folder button', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({
      listings: {
        [ROOT]: [entry({ path: `${ROOT}/note.md`, name: 'note.md', kind: 'markdown' })],
      },
    });

    render(<DiskExplorer />);
    await user.click(screen.getByTestId('disk-tree-item-/Vault/note.md'));

    const newFolderButton = screen.getByTestId('toolbar-new-folder');
    newFolderButton.focus();
    expect(newFolderButton).toHaveFocus();

    await user.keyboard('{Enter}');

    expect(useDiskStore.getState().pendingAction).toEqual({
      kind: 'new-folder',
      target: ROOT,
    });
  });

  it('starts delete confirmation on Delete for the selected item', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({
      listings: {
        [ROOT]: [entry({ path: `${ROOT}/note.md`, name: 'note.md', kind: 'markdown' })],
      },
    });

    render(<DiskExplorer />);
    await user.click(screen.getByTestId('disk-tree-item-/Vault/note.md'));
    fireEvent.keyDown(window, { key: 'Delete' });

    expect(useDiskStore.getState().pendingDelete).toBe('/Vault/note.md');
  });

  it('does not start delete when Delete targets a button or a pending action exists', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({
      listings: {
        [ROOT]: [entry({ path: `${ROOT}/note.md`, name: 'note.md', kind: 'markdown' })],
      },
    });

    render(<DiskExplorer />);
    await user.click(screen.getByTestId('disk-tree-item-/Vault/note.md'));

    const newFolderButton = screen.getByTestId('toolbar-new-folder');
    newFolderButton.focus();
    fireEvent.keyDown(newFolderButton, { key: 'Delete' });
    expect(useDiskStore.getState().pendingDelete).toBeNull();

    useDiskStore.setState({
      pendingAction: { kind: 'rename', target: '/Vault/note.md' },
      pendingDelete: null,
    });
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(useDiskStore.getState().pendingDelete).toBeNull();
  });

  it('selects every visible entry on Cmd+A', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({
      listings: {
        [ROOT]: [
          entry({ path: `${ROOT}/alpha.md`, name: 'alpha.md', kind: 'markdown' }),
          entry({ path: `${ROOT}/beta.md`, name: 'beta.md', kind: 'markdown' }),
        ],
      },
      selectedPath: `${ROOT}/alpha.md`,
      selectedPaths: [`${ROOT}/alpha.md`],
    });

    render(<DiskExplorer />);
    await user.click(screen.getByTestId(`disk-tree-item-${ROOT}/alpha.md`));
    fireEvent.keyDown(window, { key: 'a', metaKey: true });

    expect(useDiskStore.getState().selectedPath).toBe(`${ROOT}/beta.md`);
    expect(useDiskStore.getState().selectedPaths).toEqual([
      `${ROOT}/alpha.md`,
      `${ROOT}/beta.md`,
    ]);
  });

  it('does not hijack Cmd+A while typing', () => {
    useDiskStore.setState({
      listings: {
        [ROOT]: [
          entry({ path: `${ROOT}/alpha.md`, name: 'alpha.md', kind: 'markdown' }),
          entry({ path: `${ROOT}/beta.md`, name: 'beta.md', kind: 'markdown' }),
        ],
      },
      selectedPath: `${ROOT}/alpha.md`,
      selectedPaths: [`${ROOT}/alpha.md`],
    });

    render(<DiskExplorer />);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { key: 'a', metaKey: true });

    expect(useDiskStore.getState().selectedPaths).toEqual([`${ROOT}/alpha.md`]);
    input.remove();
  });

  it('ignores Cmd+A while delete confirmation is open', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({
      listings: {
        [ROOT]: [
          entry({ path: `${ROOT}/alpha.md`, name: 'alpha.md', kind: 'markdown' }),
          entry({ path: `${ROOT}/beta.md`, name: 'beta.md', kind: 'markdown' }),
        ],
      },
      pendingDelete: `${ROOT}/alpha.md`,
      selectedPath: `${ROOT}/alpha.md`,
      selectedPaths: [`${ROOT}/alpha.md`],
    });

    render(<DiskExplorer />);
    await user.click(screen.getByTestId(`disk-tree-item-${ROOT}/alpha.md`));
    fireEvent.keyDown(window, { key: 'a', metaKey: true });

    expect(useDiskStore.getState().selectedPath).toBe(`${ROOT}/alpha.md`);
    expect(useDiskStore.getState().selectedPaths).toEqual([`${ROOT}/alpha.md`]);
  });
});
