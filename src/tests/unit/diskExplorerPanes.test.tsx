import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { DiskExplorer } from '@/renderer/features/disk-explorer/components/DiskExplorer';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';

beforeEach(() => {
  window.localStorage.clear();
  // DiskExplorer reloads roots on mount, so the fake API must report them too;
  // otherwise the seeded store is immediately overwritten with an empty tree.
  installDiskApi({
    listRoots: vi.fn(async () => ({ success: true as const, data: ['/V'] })),
    readDirectory: vi.fn(async (p: string) => ({
      success: true as const,
      data: {
        path: p,
        entries: [entry({ path: '/V/a.md', name: 'a.md', kind: 'markdown' })],
      },
    })),
  });
  useDiskStore.setState({
    roots: ['/V'],
    listings: { '/V': [entry({ path: '/V/a.md', name: 'a.md', kind: 'markdown' })] },
    expanded: { '/V': true },
    currentDirectory: '/V',
    focusedPath: null,
    selectedPath: null,
    selectedPaths: [],
    isPreviewPaneOpen: false,
  });
});

describe('DiskExplorer panes', () => {
  it('renders a persisted pane group', async () => {
    render(<DiskExplorer />);
    await waitFor(() =>
      expect(screen.getByTestId('pane-group-files')).toBeInTheDocument()
    );
  });

  it('renders a resize handle between panes', async () => {
    render(<DiskExplorer />);
    await waitFor(() =>
      expect(screen.getAllByTestId('pane-handle').length).toBeGreaterThanOrEqual(1)
    );
  });

  it('renders the tree and collection, then opens the detail pane explicitly', async () => {
    render(<DiskExplorer />);
    // disk-tree-item-* comes from DiskTreeItem; detail-empty from DetailPane.
    await waitFor(() =>
      expect(screen.getByTestId('disk-tree-item-/V/a.md')).toBeInTheDocument()
    );
    expect(screen.queryByTestId('detail-empty')).toBeNull();
    fireEvent.click(screen.getByRole('button', {name: 'Preview'}));
    expect(screen.getByTestId('detail-empty')).toBeInTheDocument();
  });

  it('still renders the open-folder action', async () => {
    render(<DiskExplorer />);
    await waitFor(() =>
      expect(screen.getByTestId('disk-explorer-open-folder')).toBeInTheDocument()
    );
  });

  it('defers navigation to AppShell without duplicating the directory tree', async () => {
    useDiskStore.setState({ currentDirectory: '/V' });
    render(<DiskExplorer showNavigationPane={false} />);

    await waitFor(() =>
      expect(screen.getByTestId('pane-group-files-shell')).toBeInTheDocument()
    );
    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.queryByTestId('disk-explorer-open-folder')).toBeNull();
    expect(
      screen.getByTestId('disk-folder-entry-/V/a.md')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('detail-empty')).toBeNull();
  });
});
