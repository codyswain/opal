import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ConfirmDeleteDialog } from '@/renderer/features/disk-explorer/components/dialogs/ConfirmDeleteDialog';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { installDiskApi } from '@/tests/helpers/diskApi';

beforeEach(() => {
  installDiskApi();
  useDiskStore.setState({
    pendingDelete: null,
    selectedPath: null,
    selectedPaths: [],
    loading: { isLoading: false, error: null },
  });
});

describe('ConfirmDeleteDialog', () => {
  it('renders nothing when no delete is pending', () => {
    render(<ConfirmDeleteDialog />);
    expect(screen.queryByTestId('confirm-delete')).not.toBeInTheDocument();
  });

  it('names the file and says Trash, not delete', () => {
    useDiskStore.setState({ pendingDelete: '/V/note.md' });
    render(<ConfirmDeleteDialog />);

    expect(screen.getByTestId('confirm-delete')).toHaveTextContent('note.md');
    expect(screen.getByTestId('confirm-delete')).toHaveTextContent(/trash/i);
  });

  it('trashes on confirm', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({ pendingDelete: '/V/note.md' });
    render(<ConfirmDeleteDialog />);

    await user.click(screen.getByTestId('confirm-delete-confirm'));
    await waitFor(() => expect(window.diskAPI.trash).toHaveBeenCalledWith('/V/note.md'));
    await waitFor(() => expect(useDiskStore.getState().pendingDelete).toBeNull());
  });

  it('does nothing on cancel', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({ pendingDelete: '/V/note.md' });
    render(<ConfirmDeleteDialog />);

    await user.click(screen.getByTestId('confirm-delete-cancel'));
    expect(window.diskAPI.trash).not.toHaveBeenCalled();
    expect(useDiskStore.getState().pendingDelete).toBeNull();
  });

  it('cancels on Escape', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({ pendingDelete: '/V/note.md' });
    render(<ConfirmDeleteDialog />);

    await user.keyboard('{Escape}');
    expect(window.diskAPI.trash).not.toHaveBeenCalled();
    expect(useDiskStore.getState().pendingDelete).toBeNull();
  });

  it('surfaces a failure and stays open', async () => {
    const user = userEvent.setup();
    installDiskApi({
      trash: vi.fn(async () => ({
        success: false as const,
        error: 'Cannot delete an opened folder. Close it first.',
      })),
    });
    useDiskStore.setState({ pendingDelete: '/V' });
    render(<ConfirmDeleteDialog />);

    await user.click(screen.getByTestId('confirm-delete-confirm'));
    await waitFor(() =>
      expect(screen.getByTestId('confirm-delete-error')).toHaveTextContent('opened folder')
    );
    expect(useDiskStore.getState().pendingDelete).not.toBeNull();
  });

  it('trashes a multi-selection in order and updates the title', async () => {
    const user = userEvent.setup();
    const trash = vi.fn(async () => ({ success: true as const, data: undefined }));
    installDiskApi({ trash });
    useDiskStore.setState({
      pendingDelete: '/V/a.md',
      selectedPath: '/V/b.md',
      selectedPaths: ['/V/a.md', '/V/b.md', '/V/c.md'],
    });
    render(<ConfirmDeleteDialog />);

    expect(screen.getByTestId('confirm-delete')).toHaveTextContent('Move 3 items to Trash?');

    await user.click(screen.getByTestId('confirm-delete-confirm'));

    await waitFor(() => expect(trash).toHaveBeenCalledTimes(3));
    expect(trash.mock.calls).toEqual([
      ['/V/a.md'],
      ['/V/b.md'],
      ['/V/c.md'],
    ]);
    expect(useDiskStore.getState().pendingDelete).toBeNull();
    expect(useDiskStore.getState().selectedPath).toBeNull();
    expect(useDiskStore.getState().selectedPaths).toEqual([]);
  });

  it('uses the selection snapshot captured when the dialog opened', async () => {
    const user = userEvent.setup();
    const trash = vi.fn(async () => ({ success: true as const, data: undefined }));
    installDiskApi({ trash });
    useDiskStore.setState({
      pendingDelete: '/V/a.md',
      selectedPath: '/V/c.md',
      selectedPaths: ['/V/a.md', '/V/b.md', '/V/c.md'],
    });
    render(<ConfirmDeleteDialog />);

    act(() => {
      useDiskStore.setState({
        selectedPath: '/V/z.md',
        selectedPaths: ['/V/z.md'],
      });
    });

    expect(screen.getByTestId('confirm-delete')).toHaveTextContent('Move 3 items to Trash?');

    await user.click(screen.getByTestId('confirm-delete-confirm'));

    await waitFor(() => expect(trash).toHaveBeenCalledTimes(3));
    expect(trash.mock.calls).toEqual([
      ['/V/a.md'],
      ['/V/b.md'],
      ['/V/c.md'],
    ]);
  });

  it('stops a multi-delete on the first failure', async () => {
    const user = userEvent.setup();
    const trash = vi
      .fn()
      .mockResolvedValueOnce({ success: true as const, data: undefined })
      .mockResolvedValueOnce({ success: false as const, error: 'Permission denied' });
    installDiskApi({ trash });
    useDiskStore.setState({
      pendingDelete: '/V/a.md',
      selectedPaths: ['/V/a.md', '/V/b.md', '/V/c.md'],
    });
    render(<ConfirmDeleteDialog />);

    await user.click(screen.getByTestId('confirm-delete-confirm'));

    await waitFor(() =>
      expect(screen.getByTestId('confirm-delete-error')).toHaveTextContent('Permission denied')
    );
    expect(trash.mock.calls).toEqual([
      ['/V/a.md'],
      ['/V/b.md'],
    ]);
    expect(useDiskStore.getState().pendingDelete).toBe('/V/a.md');
  });
});
