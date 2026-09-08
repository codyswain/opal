import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { DiskFolderView } from '@/renderer/features/disk-explorer/components/DiskFolderView';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';
import type { DirectoryListing, DiskResult } from '@/types/disk';

const DIR = '/V/Photos';

beforeEach(() => {
  installDiskApi();
  useDiskStore.setState({
    roots: ['/V'],
    listings: {},
    expanded: {},
    selectedPath: null,
    isQuickLookOpen: false,
    pendingAction: null,
    pendingDelete: null,
    filter: '',
    sort: { field: 'name', direction: 'asc' },
    density: 'comfortable',
    loading: { isLoading: false, error: null },
  });
});

describe('loading and empty states', () => {
  it('shows skeleton tiles while the listing loads, not a Loading label', async () => {
    installDiskApi({
      readDirectory: vi.fn(() => new Promise<DiskResult<DirectoryListing>>(() => undefined)),
    });

    render(<DiskFolderView dirPath={DIR} />);
    await waitFor(() => expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0));
    expect(screen.queryByText(/^Loading/)).not.toBeInTheDocument();
  });

  it('shows a real empty state for an empty folder', async () => {
    useDiskStore.setState({ listings: { [DIR]: [] } });
    render(<DiskFolderView dirPath={DIR} />);

    await waitFor(() => expect(screen.getByTestId('disk-folder-empty')).toBeInTheDocument());
    expect(screen.getByTestId('empty-state-title')).toBeInTheDocument();
  });

  it('distinguishes filtered-to-nothing from genuinely empty', async () => {
    useDiskStore.setState({
      listings: { [DIR]: [entry({ path: `${DIR}/a.jpg`, name: 'a.jpg', kind: 'image' })] },
      filter: 'zzzz',
    });

    render(<DiskFolderView dirPath={DIR} />);
    await waitFor(() => expect(screen.getByTestId('disk-folder-no-matches')).toBeInTheDocument());
    expect(screen.queryByTestId('disk-folder-empty')).not.toBeInTheDocument();
  });
});

describe('density', () => {
  it('defaults to comfortable', () => {
    expect(useDiskStore.getState().density).toBe('comfortable');
  });

  it('switches to compact in the store', () => {
    useDiskStore.getState().setDensity('compact');
    expect(useDiskStore.getState().density).toBe('compact');
  });

  it('switches density from the Display popover', async () => {
    const user = userEvent.setup();
    installDiskApi();
    useDiskStore.setState({ listings: { [DIR]: [] } });
    render(<DiskFolderView dirPath={DIR} />);

    await user.click(screen.getByTestId('display-menu'));
    await user.click(await screen.findByRole('radio', { name: 'Compact' }));

    expect(useDiskStore.getState().density).toBe('compact');
  });
});

describe('welcome panel', () => {
  it('explains the app and opens a folder', async () => {
    const { WelcomePanel } = await import('@/renderer/features/disk-explorer/components/WelcomePanel');
    const api = installDiskApi();
    const user = userEvent.setup();
    render(<WelcomePanel />);
    expect(screen.getByText('Open a folder to begin')).toBeInTheDocument();
    expect(screen.getByText('Ask your library')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open folder…' }));
    expect(api.openFolder).toHaveBeenCalled();
  });
});
