import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { DiskFolderView } from '@/renderer/features/disk-explorer/components/DiskFolderView';
import { toOpalFileUrl } from '@/common/opalFileUrl';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';
import type { DiskEntry } from '@/types/disk';

const PHOTOS = '/Vault/Photos';
const listing: DiskEntry[] = [
  entry({ path: `${PHOTOS}/Raw`, name: 'Raw', kind: 'directory', isDirectory: true }),
  entry({ path: `${PHOTOS}/a.jpg`, name: 'a.jpg', kind: 'image', size: 2048 }),
  entry({ path: `${PHOTOS}/b.png`, name: 'b.png', kind: 'image', size: 4096 }),
  entry({ path: `${PHOTOS}/notes.md`, name: 'notes.md', kind: 'markdown', size: 12 }),
];

beforeEach(() => {
  installDiskApi({
    readDirectory: vi.fn(async (p: string) => ({
      success: true as const,
      data: { path: p, entries: listing },
    })),
  });

  useDiskStore.setState({
    roots: ['/Vault'],
    listings: { [PHOTOS]: listing },
    expanded: {},
    selectedPath: null,
    sort: { field: 'name', direction: 'asc' },
    loading: { isLoading: false, error: null },
  });
});

describe('asset URLs', () => {
  it('builds an opal-file URL', () => {
    expect(toOpalFileUrl('/Vault/Photos/a.jpg')).toBe('opal-file:///Vault/Photos/a.jpg');
  });

  it('encodes spaces and characters that are significant in URLs', () => {
    expect(toOpalFileUrl('/Vault/My Photos/a b.jpg')).not.toContain(' ');
    expect(toOpalFileUrl('/Vault/a#b.jpg')).toContain('%23');
  });
});

describe('DiskFolderView', () => {
  it('defaults an image-heavy folder to gallery mode', async () => {
    render(<DiskFolderView dirPath={PHOTOS} />);
    await waitFor(() => expect(screen.getByTestId('disk-folder-gallery')).toBeInTheDocument());
  });

  it('renders images through the opal-file protocol, never as data URLs', async () => {
    render(<DiskFolderView dirPath={PHOTOS} />);

    const image = await screen.findByAltText('a.jpg');
    expect(image.getAttribute('src')).toMatch(/^opal-file:\/\//);
    expect(image.getAttribute('src')).not.toMatch(/^data:/);
  });

  it('lazy-loads gallery images', async () => {
    render(<DiskFolderView dirPath={PHOTOS} />);
    const image = await screen.findByAltText('a.jpg');
    expect(image).toHaveAttribute('loading', 'lazy');
  });

  it('shows every entry including folders and non-images', async () => {
    render(<DiskFolderView dirPath={PHOTOS} />);
    await waitFor(() => expect(screen.getByText('Raw')).toBeInTheDocument());
    expect(screen.getByText('notes.md')).toBeInTheDocument();
  });

  it('switches to list mode and shows a size column', async () => {
    const user = userEvent.setup();
    render(<DiskFolderView dirPath={PHOTOS} />);

    await user.click(await screen.findByTestId('disk-folder-view-list'));

    expect(screen.getByTestId('disk-folder-list')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
  });

  it('selects an entry on click', async () => {
    const user = userEvent.setup();
    render(<DiskFolderView dirPath={PHOTOS} />);

    await user.click(await screen.findByTestId('disk-folder-entry-/Vault/Photos/a.jpg'));

    expect(useDiskStore.getState().selectedPath).toBe(`${PHOTOS}/a.jpg`);
  });

  it('defaults a folder with no images to list mode', async () => {
    const docs = '/Vault/Docs';
    useDiskStore.setState({
      listings: {
        [docs]: [entry({ path: `${docs}/a.md`, name: 'a.md', kind: 'markdown', size: 10 })],
      },
    });

    render(<DiskFolderView dirPath={docs} />);
    await waitFor(() => expect(screen.getByTestId('disk-folder-list')).toBeInTheDocument());
  });

  it('renders an empty state for an empty folder', async () => {
    const empty = '/Vault/Empty';
    useDiskStore.setState({ listings: { [empty]: [] } });

    render(<DiskFolderView dirPath={empty} />);
    await waitFor(() => expect(screen.getByTestId('disk-folder-empty')).toBeInTheDocument());
  });

  it('treats a whitespace-only filter as no active filter in an empty folder', async () => {
    const empty = '/Vault/Empty';
    useDiskStore.setState({ listings: { [empty]: [] } });

    render(<DiskFolderView dirPath={empty} />);

    await waitFor(() => expect(screen.getByTestId('disk-folder-empty')).toBeInTheDocument());
    act(() => {
      useDiskStore.setState({ filter: '   ' });
    });
    await waitFor(() => expect(screen.getByTestId('disk-folder-empty')).toBeInTheDocument());
    expect(screen.queryByTestId('disk-folder-no-matches')).not.toBeInTheDocument();
  });

  it('requests the listing when it is not already cached', async () => {
    useDiskStore.setState({ listings: {} });
    render(<DiskFolderView dirPath={PHOTOS} />);
    await waitFor(() => expect(window.diskAPI.readDirectory).toHaveBeenCalledWith(PHOTOS));
  });
});
