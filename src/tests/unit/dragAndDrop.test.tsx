import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { DiskTree } from '@/renderer/features/disk-explorer/components/DiskTree';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { entry, installDiskApi } from '@/tests/helpers/diskApi';

const ROOT = '/V';
const ARCHIVE = '/V/Archive';
const NOTE = '/V/note.md';

/** happy-dom has no DataTransfer, so supply the minimum the handlers use. */
function dataTransfer(payload = '') {
  const store: Record<string, string> = { 'text/plain': payload };
  return {
    setData: (type: string, value: string) => {
      store[type] = value;
    },
    getData: (type: string) => store[type] ?? '',
    dropEffect: 'none',
    effectAllowed: 'all',
  };
}

beforeEach(() => {
  installDiskApi({
    listRoots: vi.fn(async () => ({ success: true as const, data: [ROOT] })),
  });
  useDiskStore.setState({
    roots: [ROOT],
    listings: {
      [ROOT]: [
        entry({ path: ARCHIVE, name: 'Archive', kind: 'directory', isDirectory: true }),
        entry({ path: NOTE, name: 'note.md', kind: 'markdown' }),
      ],
    },
    expanded: { [ROOT]: true },
    selectedPath: null,
    loading: { isLoading: false, error: null },
  });
});

describe('drag and drop', () => {
  it('carries the source path on drag start', () => {
    render(<DiskTree />);
    const transfer = dataTransfer();

    fireEvent.dragStart(screen.getByTestId(`disk-tree-item-${NOTE}`), { dataTransfer: transfer });
    expect(transfer.getData('text/plain')).toBe(NOTE);
  });

  it('moves the file when dropped on a folder', async () => {
    render(<DiskTree />);

    fireEvent.drop(screen.getByTestId(`disk-tree-item-${ARCHIVE}`), {
      dataTransfer: dataTransfer(NOTE),
    });

    await waitFor(() => expect(window.diskAPI.move).toHaveBeenCalledWith(NOTE, ARCHIVE));
  });

  it('does not move when dropped on a file', async () => {
    render(<DiskTree />);

    fireEvent.drop(screen.getByTestId(`disk-tree-item-${NOTE}`), {
      dataTransfer: dataTransfer(ARCHIVE),
    });

    await waitFor(() => expect(window.diskAPI.move).not.toHaveBeenCalled());
  });

  it('does not move an item onto itself', async () => {
    render(<DiskTree />);

    fireEvent.drop(screen.getByTestId(`disk-tree-item-${ARCHIVE}`), {
      dataTransfer: dataTransfer(ARCHIVE),
    });

    await waitFor(() => expect(window.diskAPI.move).not.toHaveBeenCalled());
  });

  it('surfaces a move failure', async () => {
    installDiskApi({
      move: vi.fn(async () => ({ success: false as const, error: 'Something already exists' })),
    });
    render(<DiskTree />);

    fireEvent.drop(screen.getByTestId(`disk-tree-item-${ARCHIVE}`), {
      dataTransfer: dataTransfer(NOTE),
    });

    await waitFor(() =>
      expect(useDiskStore.getState().loading.error).toMatch(/already exists/i)
    );
  });
});
