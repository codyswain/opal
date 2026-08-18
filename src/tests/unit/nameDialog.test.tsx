import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { NameDialog } from '@/renderer/features/disk-explorer/components/dialogs/NameDialog';
import { installDiskApi } from '@/tests/helpers/diskApi';

beforeEach(() => {
  installDiskApi();
  useDiskStore.setState({
    pendingAction: null,
    loading: { isLoading: false, error: null },
  });
});

describe('NameDialog', () => {
  it('renders nothing when no action is pending', () => {
    render(<NameDialog />);
    expect(screen.queryByTestId('name-dialog')).not.toBeInTheDocument();
  });

  it('prompts for a new folder name', () => {
    useDiskStore.getState().beginNewFolder('/V');
    render(<NameDialog />);

    expect(screen.getByTestId('name-dialog-title')).toHaveTextContent('New Folder');
    expect(screen.getByTestId('name-dialog-input')).toHaveValue('');
  });

  it('pre-fills the current name when renaming', () => {
    useDiskStore.getState().beginRename('/V/note.md');
    render(<NameDialog />);

    expect(screen.getByTestId('name-dialog-title')).toHaveTextContent('Rename');
    expect(screen.getByTestId('name-dialog-input')).toHaveValue('note.md');
  });

  it('creates a folder on submit', async () => {
    const user = userEvent.setup();
    useDiskStore.getState().beginNewFolder('/V');
    render(<NameDialog />);

    await user.type(screen.getByTestId('name-dialog-input'), 'Rwanda');
    await user.click(screen.getByTestId('name-dialog-submit'));

    await waitFor(() =>
      expect(window.diskAPI.createDirectory).toHaveBeenCalledWith('/V', 'Rwanda')
    );
  });

  it('renames on submit', async () => {
    const user = userEvent.setup();
    useDiskStore.getState().beginRename('/V/note.md');
    render(<NameDialog />);

    const input = screen.getByTestId('name-dialog-input');
    await user.clear(input);
    await user.type(input, 'renamed.md');
    await user.click(screen.getByTestId('name-dialog-submit'));

    await waitFor(() =>
      expect(window.diskAPI.rename).toHaveBeenCalledWith('/V/note.md', 'renamed.md')
    );
  });

  it('submits on Enter', async () => {
    const user = userEvent.setup();
    useDiskStore.getState().beginNewFolder('/V');
    render(<NameDialog />);

    await user.type(screen.getByTestId('name-dialog-input'), 'Rwanda{Enter}');
    await waitFor(() => expect(window.diskAPI.createDirectory).toHaveBeenCalled());
  });

  it('cancels on Escape without calling anything', async () => {
    const user = userEvent.setup();
    useDiskStore.getState().beginNewFolder('/V');
    render(<NameDialog />);

    await user.type(screen.getByTestId('name-dialog-input'), '{Escape}');

    expect(useDiskStore.getState().pendingAction).toBeNull();
    expect(window.diskAPI.createDirectory).not.toHaveBeenCalled();
  });

  it('disables submit for an empty name', () => {
    useDiskStore.getState().beginNewFolder('/V');
    render(<NameDialog />);
    expect(screen.getByTestId('name-dialog-submit')).toBeDisabled();
  });

  it('disables submit for a name containing a separator', async () => {
    const user = userEvent.setup();
    useDiskStore.getState().beginNewFolder('/V');
    render(<NameDialog />);

    await user.type(screen.getByTestId('name-dialog-input'), 'a/b');
    expect(screen.getByTestId('name-dialog-submit')).toBeDisabled();
    expect(screen.getByTestId('name-dialog-hint')).toBeInTheDocument();
  });

  it('keeps the dialog open and shows the error when the write fails', async () => {
    const user = userEvent.setup();
    installDiskApi({
      createDirectory: vi.fn(async () => ({
        success: false as const,
        error: 'Something already exists at /V/Rwanda',
      })),
    });
    useDiskStore.getState().beginNewFolder('/V');
    render(<NameDialog />);

    await user.type(screen.getByTestId('name-dialog-input'), 'Rwanda{Enter}');

    await waitFor(() =>
      expect(screen.getByTestId('name-dialog-error')).toHaveTextContent('already exists')
    );
    expect(useDiskStore.getState().pendingAction).not.toBeNull();
  });

  it('closes on success', async () => {
    const user = userEvent.setup();
    useDiskStore.getState().beginNewFolder('/V');
    render(<NameDialog />);

    await user.type(screen.getByTestId('name-dialog-input'), 'Rwanda{Enter}');
    await waitFor(() => expect(useDiskStore.getState().pendingAction).toBeNull());
  });
});
