import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ConfirmDeleteDialog } from '@/renderer/features/disk-explorer/components/dialogs/ConfirmDeleteDialog';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { usePinsStore } from '@/renderer/features/disk-explorer/store/pinsStore';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installPinsApi, setPins } from '@/tests/helpers/pinsApi';

beforeEach(() => {
  installDiskApi();
  useDiskStore.setState({
    pendingDelete: null,
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

  it('starts on the confirm button and keeps focus inside', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({ pendingDelete: '/V/note.md' });
    render(<ConfirmDeleteDialog />);

    await waitFor(() => expect(screen.getByTestId('confirm-delete-confirm')).toHaveFocus());
    await user.tab();
    expect(screen.getByTestId('confirm-delete-cancel')).toHaveFocus();
    await user.tab();
    expect(screen.getByTestId('confirm-delete-confirm')).toHaveFocus();
  });

  it('trashes on confirm, and unpins what went to the Trash', async () => {
    const user = userEvent.setup();
    installPinsApi();
    setPins({ '/V': ['/V/note.md', '/V/keep.md'] });
    useDiskStore.setState({ pendingDelete: '/V/note.md' });
    render(<ConfirmDeleteDialog />);

    await user.click(screen.getByTestId('confirm-delete-confirm'));
    await waitFor(() => expect(window.diskAPI.trash).toHaveBeenCalledWith('/V/note.md'));
    await waitFor(() => expect(useDiskStore.getState().pendingDelete).toBeNull());
    expect(usePinsStore.getState().byRoot['/V']).toEqual(['/V/keep.md']);
    expect(window.pinsAPI.set).toHaveBeenCalledWith('/V', ['/V/keep.md'], ['/V/note.md', '/V/keep.md']);
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
});
