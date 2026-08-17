import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { DiskTree } from '@/renderer/features/disk-explorer/components/DiskTree';
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
    listRoots: vi.fn(async () => ({ success: true as const, data: [ROOT] })),
  });

  useDiskStore.setState({
    roots: [ROOT],
    listings: {
      [ROOT]: [
        entry({ path: PHOTOS, name: 'Photos', kind: 'directory', isDirectory: true }),
        entry({ path: `${ROOT}/note.md`, name: 'note.md', kind: 'markdown' }),
      ],
    },
    expanded: { [ROOT]: true },
    selectedPath: null,
    sort: { field: 'name', direction: 'asc' },
    loading: { isLoading: false, error: null },
  });
});

describe('DiskTree', () => {
  it('renders the root and its children', () => {
    render(<DiskTree />);
    expect(screen.getByText('Vault')).toBeInTheDocument();
    expect(screen.getByText('Photos')).toBeInTheDocument();
    expect(screen.getByText('note.md')).toBeInTheDocument();
  });

  it('does not render grandchildren before expansion', () => {
    render(<DiskTree />);
    expect(screen.queryByText('a.jpg')).not.toBeInTheDocument();
  });

  it('loads and renders children when a folder is expanded', async () => {
    const user = userEvent.setup();
    render(<DiskTree />);

    await user.click(screen.getByTestId('disk-tree-toggle-/Vault/Photos'));

    await waitFor(() => expect(screen.getByText('a.jpg')).toBeInTheDocument());
    expect(window.diskAPI.readDirectory).toHaveBeenCalledWith(PHOTOS);
  });

  it('selects an entry when its row is clicked', async () => {
    const user = userEvent.setup();
    render(<DiskTree />);

    await user.click(screen.getByTestId('disk-tree-item-/Vault/note.md'));

    expect(useDiskStore.getState().selectedPath).toBe(`${ROOT}/note.md`);
  });

  it('marks the selected row for assistive tech', async () => {
    const user = userEvent.setup();
    render(<DiskTree />);

    await user.click(screen.getByTestId('disk-tree-item-/Vault/note.md'));

    expect(screen.getByTestId('disk-tree-item-/Vault/note.md'))
      .toHaveAttribute('aria-selected', 'true');
  });

  it('prompts to open a folder when no roots exist', () => {
    useDiskStore.setState({ roots: [], listings: {}, expanded: {} });
    render(<DiskTree />);
    expect(screen.getByTestId('disk-tree-empty')).toBeInTheDocument();
  });
});
