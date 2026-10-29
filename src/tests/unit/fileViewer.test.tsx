import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { FileViewer } from '@/renderer/features/disk-explorer/components/FileViewer';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';

const IMAGE = entry({ path: '/V/Photos/cover.png', name: 'cover.png', kind: 'image' });
const PDF = entry({ path: '/V/brief.pdf', name: 'brief.pdf', kind: 'pdf' });
const TEXT = entry({ path: '/V/a.ts', name: 'a.ts', kind: 'text', size: 20 });
const AUDIO = entry({ path: '/V/memo.m4a', name: 'memo.m4a', kind: 'audio' });

beforeEach(() => {
  installDiskApi({
    readTextFile: vi.fn(async (path: string) => ({
      success: true as const,
      data: { path, text: 'const x = 1;\n', truncated: false, size: 13 },
    })),
  });
});

describe('FileViewer', () => {
  it('shows an image inline, streamed through the guarded file scheme', () => {
    render(<FileViewer entry={IMAGE} />);
    const image = screen.getByAltText('cover.png');
    expect(image).toHaveAttribute('src', expect.stringMatching(/^opal-file:\/\//));
  });

  it('embeds a PDF in Chromium’s viewer', () => {
    render(<FileViewer entry={PDF} />);
    expect(screen.getByTestId('pdf-viewer')).toHaveAttribute('type', 'application/pdf');
    expect(screen.getByTestId('pdf-viewer')).toHaveAttribute('src', expect.stringMatching(/^opal-file:\/\//));
  });

  it('shows text verbatim and says when only the start of a file is shown', async () => {
    const { unmount } = render(<FileViewer entry={TEXT} />);
    await waitFor(() => expect(screen.getByTestId('text-viewer')).toHaveTextContent('const x = 1;'));
    expect(window.diskAPI.readTextFile).toHaveBeenCalledWith('/V/a.ts');
    expect(screen.queryByText(/first part/)).toBeNull();
    unmount();

    window.diskAPI.readTextFile = vi.fn(async (path: string) => ({
      success: true as const,
      data: { path, text: 'x'.repeat(100), truncated: true, size: 9_000_000 },
    }));
    render(<FileViewer entry={TEXT} />);
    expect(await screen.findByText('Showing the first part of this file only.')).toBeInTheDocument();
  });

  it('hands anything else to the default app, and says when that fails', async () => {
    const user = userEvent.setup();
    render(<FileViewer entry={AUDIO} />);
    expect(screen.getByText("Opal can't show this file.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open in default app' }));
    expect(window.diskAPI.openExternal).toHaveBeenCalledWith('/V/memo.m4a');
    expect(screen.queryByRole('alert')).toBeNull();

    vi.mocked(window.diskAPI.openExternal).mockResolvedValueOnce({ success: false, error: 'No app can open it' });
    await user.click(screen.getByRole('button', { name: 'Open in default app' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No app can open it');
  });

  it('offers the default app when a text file cannot be read', async () => {
    window.diskAPI.readTextFile = vi.fn(async () => ({ success: false as const, error: 'Permission denied' }));
    render(<FileViewer entry={TEXT} />);
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open in default app' })).toBeInTheDocument();
  });
});
