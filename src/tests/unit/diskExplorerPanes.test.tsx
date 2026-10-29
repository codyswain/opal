import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { DiskExplorer } from '@/renderer/features/disk-explorer/components/DiskExplorer';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';

beforeEach(() => {
  window.localStorage.clear();
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
    expanded: {},
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
      expect(screen.getByTestId('pane-group-files-shell')).toBeInTheDocument()
    );
  });

  it('opens the detail pane explicitly, with a resize handle', async () => {
    render(<DiskExplorer />);
    await waitFor(() =>
      expect(screen.getByTestId('disk-folder-entry-/V/a.md')).toBeInTheDocument()
    );
    expect(screen.queryByTestId('detail-empty')).toBeNull();
    expect(screen.queryByTestId('pane-handle')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByTestId('detail-empty')).toBeInTheDocument();
    expect(screen.getByTestId('pane-handle')).toBeInTheDocument();
  });

  it('leaves navigation to the shell sidebar', () => {
    render(<DiskExplorer />);
    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open folder' })).toBeNull();
  });
});
