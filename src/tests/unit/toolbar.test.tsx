import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { Toolbar } from '@/renderer/features/disk-explorer/components/Toolbar';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';

beforeEach(() => {
  installDiskApi();
  useDiskStore.setState({ pendingAction: null, listings: {} });
  useTabsStore.setState({ openPaths: [], openedPath: null, activePath: null, previewPath: null, recentlyClosed: [] });
});

describe('Toolbar (New menu)', () => {
  it('starts a new-folder action for the current directory', async () => {
    const user = userEvent.setup();
    render(<Toolbar dirPath="/V" />);
    await user.click(screen.getByTestId('toolbar-new'));
    await user.click(await screen.findByTestId('toolbar-new-folder'));
    expect(useDiskStore.getState().pendingAction).toEqual({ kind: 'new-folder', target: '/V' });
  });

  it('creates a note in the current directory and opens it', async () => {
    const markdown = installMarkdownApi({}, { create: vi.fn(async () => ({ success: true as const, data: { path: '/V/Untitled.md' } })) });
    const user = userEvent.setup();
    render(<Toolbar dirPath="/V" />);
    await user.click(screen.getByTestId('toolbar-new'));
    await user.click(await screen.findByTestId('toolbar-new-note'));
    expect(markdown.create).toHaveBeenCalledWith('/V');
    await vi.waitFor(() => expect(useTabsStore.getState().openedPath).toBe('/V/Untitled.md'));
  });
});
