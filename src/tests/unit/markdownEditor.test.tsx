import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MarkdownEditor } from '@/renderer/features/disk-explorer/components/editor/MarkdownEditor';
import { Toolbar } from '@/renderer/features/disk-explorer/components/Toolbar';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';

const NOTE = '/Vault/Notes/brief.md';

beforeEach(() => {
  installDiskApi();
  useDiskStore.setState({ listings: {}, sort: { field: 'name', direction: 'asc' }, filter: '', pendingAction: null });
  useTabsStore.setState({ openPaths: [], openedPath: null, activePath: null, previewPath: null });
});

describe('MarkdownEditor', () => {
  it('opens a note, shows its text and the saved state, and reports unavailable files', async () => {
    installMarkdownApi({ [NOTE]: '# Brief\n\nHello there.\n' });
    render(<MarkdownEditor path={NOTE} />);
    // TipTap creates the editor asynchronously; re-query rather than hold a node.
    await waitFor(() => expect(screen.getByTestId('markdown-editor')).toHaveTextContent('Hello there.'), { timeout: 5000 });
    const editor = screen.getByTestId('markdown-editor');
    expect(editor).toHaveTextContent('Brief');
    expect(editor.querySelector('h1')).not.toBeNull();
    expect(screen.getByTestId('editor-save-state')).toHaveAttribute('data-state', 'clean');
    await waitFor(() => expect(screen.getByText('3 words')).toBeInTheDocument(), { timeout: 5000 });
    render(<MarkdownEditor path="/Vault/photo.jpg" />);
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(/Only Markdown/);
  }, 20_000);
});

describe('Toolbar new note', () => {
  it('creates an Untitled note in the folder and opens it', async () => {
    const api = installMarkdownApi();
    const user = userEvent.setup();
    render(<Toolbar dirPath="/Vault/Notes" />);
    await user.click(screen.getByTestId('toolbar-new-note'));
    await waitFor(() => expect(api.create).toHaveBeenCalledWith('/Vault/Notes'));
    await waitFor(() => expect(useTabsStore.getState().openedPath).toBe('/Vault/Notes/Untitled.md'));
    expect(window.diskAPI.readDirectory).toHaveBeenCalledWith('/Vault/Notes');
  });
});
