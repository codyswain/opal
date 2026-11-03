import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { FileViewer } from '@/renderer/features/disk-explorer/components/FileViewer';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';
import { installFilesApi } from '@/tests/helpers/filesApi';

const IMAGE = entry({ path: '/V/Photos/cover.png', name: 'cover.png', kind: 'image' });
const PDF = entry({ path: '/V/brief.pdf', name: 'brief.pdf', kind: 'pdf' });
const TEXT = entry({ path: '/V/a.ts', name: 'a.ts', kind: 'text', size: 20 });
const AUDIO = entry({ path: '/V/memo.m4a', name: 'memo.m4a', kind: 'audio' });
const VIDEO = entry({ path: '/V/clip.mp4', name: 'clip.mp4', kind: 'video' });
const DECK = entry({ path: '/V/deck.pptx', name: 'deck.pptx', kind: 'other' });

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
    expect(screen.getByTestId('pdf-viewer')).toHaveAttribute('src', expect.stringMatching(/^opal-file:\/\/.*#navpanes=0$/));
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

  it('plays video and audio in native players, and offers the app for one it can\'t play', async () => {
    const { unmount } = render(<FileViewer entry={VIDEO} />);
    expect(screen.getByTestId('video-viewer')).toHaveAttribute('src', expect.stringMatching(/^opal-file:\/\/.*clip\.mp4$/));
    const video = screen.getByTestId('video-viewer');
    Object.defineProperty(video, 'error', { value: { code: 4 } });
    fireEvent.error(video);
    expect(await screen.findByText("Can't play this video in Opal.")).toBeInTheDocument();
    unmount();
    render(<FileViewer entry={AUDIO} />);
    expect(screen.getByTestId('audio-viewer')).toHaveAttribute('src', expect.stringMatching(/memo\.m4a$/));
  });

  it('says a file is not downloaded yet, for any kind, and shows it after Get from Mini', async () => {
    let status: 'lfs-missing' | 'local' = 'lfs-missing';
    installFilesApi({
      info: vi.fn(async (target: string) => ({ success: true as const, data: { path: target, name: 'clip.mp4', size: 1, mtimeMs: 0, kind: 'video' as const, status } })),
      fetch: vi.fn(async () => { status = 'local'; return { success: true as const, data: 'here' as const }; }),
    });
    const user = userEvent.setup();
    render(<FileViewer entry={VIDEO} />);
    expect(await screen.findByText('Not downloaded yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Get from Mini' }));
    expect(window.filesAPI.fetch).toHaveBeenCalledWith('/V/clip.mp4');
    expect(await screen.findByTestId('video-viewer')).toBeInTheDocument();
    (window as unknown as { filesAPI?: unknown }).filesAPI = undefined;
  });

  it('hands anything else to the default app, and says when that fails', async () => {
    const user = userEvent.setup();
    render(<FileViewer entry={DECK} />);
    expect(screen.getByText("Opal can't show this file.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open in default app' }));
    expect(window.diskAPI.openExternal).toHaveBeenCalledWith('/V/deck.pptx');
    expect(screen.queryByRole('alert')).toBeNull();

    vi.mocked(window.diskAPI.openExternal).mockResolvedValueOnce({ success: false, error: 'No app can open it' });
    await user.click(screen.getByRole('button', { name: 'Open in default app' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No app can open it');
  });

  it('says when it opened a read-only copy, or showed a script in Finder instead', async () => {
    const user = userEvent.setup();
    render(<FileViewer entry={AUDIO} />);
    vi.mocked(window.diskAPI.openExternal).mockResolvedValueOnce({ success: true, data: { action: 'opened', app: null, notice: "Opened a read-only copy. Changes won't reach the vault." } });
    await user.click(screen.getByRole('button', { name: 'Open in default app' }));
    expect(await screen.findByRole('status')).toHaveTextContent("Opened a read-only copy. Changes won't reach the vault.");
    vi.mocked(window.diskAPI.openExternal).mockResolvedValueOnce({ success: true, data: { action: 'revealed', reason: 'Opal shows apps and scripts in Finder instead of opening them.' } });
    await user.click(screen.getByRole('button', { name: 'Open in default app' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Opal shows apps and scripts in Finder instead of opening them.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers the default app when a text file cannot be read', async () => {
    window.diskAPI.readTextFile = vi.fn(async () => ({ success: false as const, error: 'Permission denied' }));
    render(<FileViewer entry={TEXT} />);
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open in default app' })).toBeInTheDocument();
  });
});
