import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { DiskExplorer } from '@/renderer/features/disk-explorer/components/DiskExplorer';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';

const ROOT = '/Vault';
const PHOTOS = '/Vault/Photos';

beforeEach(() => {
  installDiskApi({
    readDirectory: vi.fn(async (p: string) => ({
      success: true as const,
      data: {
        path: p,
        entries: p === PHOTOS
          ? [entry({ path: `${PHOTOS}/a.jpg`, name: 'a.jpg', kind: 'image' })]
          : [],
      },
    })),
    openFolder: vi.fn(async () => ({ success: true as const, data: { root: ROOT } })),
    listRoots: vi.fn(async () => ({ success: true as const, data: [ROOT] })),
  });

  useDiskStore.setState({
    roots: [ROOT],
    listings: {
      [ROOT]: [entry({ path: PHOTOS, name: 'Photos', kind: 'directory', isDirectory: true })],
    },
    expanded: { [ROOT]: true },
    isQuickLookOpen: false,
    selectedPath: null,
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

  it('surfaces a store error', async () => {
    useDiskStore.setState({ loading: { isLoading: false, error: 'Permission denied' } });
    render(<DiskExplorer />);
    expect(await screen.findByTestId('disk-explorer-error')).toHaveTextContent('Permission denied');
  });

  it('offers an open-folder action', () => {
    render(<DiskExplorer />);
    expect(screen.getByTestId('disk-explorer-open-folder')).toBeInTheDocument();
  });

  it('only toggles quick look on Space when a selection exists', async () => {
    const user = userEvent.setup();
    render(<DiskExplorer />);

    fireEvent.keyDown(window, { code: 'Space' });
    expect(useDiskStore.getState().isQuickLookOpen).toBe(false);
    expect(screen.queryByTestId('quick-look')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('disk-tree-item-/Vault/Photos'));
    await user.click(await screen.findByTestId('disk-folder-entry-/Vault/Photos/a.jpg'));
    fireEvent.keyDown(window, { code: 'Space' });

    expect(useDiskStore.getState().isQuickLookOpen).toBe(true);
    expect(screen.getByTestId('quick-look')).toBeInTheDocument();
  });
});
