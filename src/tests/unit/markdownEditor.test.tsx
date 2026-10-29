import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MarkdownEditor } from '@/renderer/features/disk-explorer/components/editor/MarkdownEditor';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';
import { resetTabs } from '@/tests/helpers/tabs';

const NOTE = '/Vault/Notes/brief.md';

beforeEach(() => {
  installDiskApi();
  useDiskStore.setState({ listings: {}, pendingAction: null });
  resetTabs();
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
