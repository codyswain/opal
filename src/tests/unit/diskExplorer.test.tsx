import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { DiskExplorer } from '@/renderer/features/disk-explorer/components/DiskExplorer';
import { RECENT_COLLECTION, fileLocation } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useRecentStore } from '@/renderer/features/disk-explorer/store/recentStore';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { ShellProvider } from '@/renderer/features/shell/context/ShellContext';
import { TooltipProvider } from '@/renderer/shared/ui';
import { installActivityApi } from '@/tests/helpers/activityApi';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';
import { openTabs, resetTabs } from '@/tests/helpers/tabs';

const { toastError } = vi.hoisted(() => ({
  toastError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastError,
  },
}));

const ROOT = '/Vault';
const PHOTO = '/Vault/cover.png';
const NOTE = '/Vault/note.md';

type StatResult = Awaited<ReturnType<typeof window.diskAPI.stat>>;

function renderPage() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <TooltipProvider>
        <ShellProvider>
          <DiskExplorer />
        </ShellProvider>
      </TooltipProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  resetTabs();
  toastError.mockClear();
  installActivityApi();
  installMarkdownApi({ [NOTE]: '# Note\n' });
  installDiskApi({
    stat: vi.fn(async () => ({ success: false as const, error: 'Missing' })),
  });
  useRecentStore.getState().reset();
  useDiskStore.setState({
    roots: [ROOT],
    rootsLoaded: true,
    listings: {
      [ROOT]: [
        entry({ path: PHOTO, name: 'cover.png', kind: 'image' }),
        entry({ path: NOTE, name: 'note.md', kind: 'markdown' }),
      ],
    },
    expanded: {},
    pendingAction: null,
    pendingDelete: null,
    loading: { isLoading: false, error: null },
  });
});

describe('DiskExplorer', () => {
  it('shows a file the tree already listed at once', () => {
    openTabs([PHOTO]);
    renderPage();
    expect(screen.getByAltText('cover.png')).toBeInTheDocument();
    expect(window.diskAPI.stat).not.toHaveBeenCalled();
  });

  it('opens Markdown in the editor', async () => {
    openTabs([NOTE]);
    renderPage();
    await waitFor(() => expect(window.markdownAPI.read).toHaveBeenCalledWith(NOTE));
    expect(screen.queryByTestId('open-in-default-app')).toBeNull();
  });

  it('looks up any other file, and drops a late answer for a file left behind', async () => {
    let finish: (result: StatResult) => void = () => undefined;
    window.diskAPI.stat = vi.fn((path: string) =>
      path === '/Vault/Deep/a.txt'
        ? new Promise<StatResult>((resolve) => { finish = resolve; })
        : Promise.resolve({ success: false as const, error: 'Missing' })
    );
    openTabs(['/Vault/Deep/a.txt']);
    renderPage();
    expect(screen.getByRole('status')).toHaveTextContent('Loading file…');
    act(() => useTabsStore.getState().open(fileLocation('/Vault/Deep/b.txt')));
    expect(await screen.findByText('File unavailable')).toBeInTheDocument();
    act(() =>
      finish({ success: true, data: entry({ path: '/Vault/Deep/a.txt', name: 'a.txt', kind: 'text' }) })
    );
    await waitFor(() => expect(screen.getByText('File unavailable')).toBeInTheDocument());
    expect(screen.queryByTestId('text-viewer')).toBeNull();
  });

  it('shows Recent when the tab does', async () => {
    useTabsStore.getState().open({ mode: 'browse', collection: RECENT_COLLECTION });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Recent' })).toBeInTheDocument();
    expect(window.activityAPI.recent).toHaveBeenCalled();
  });

  it('shows a toast and keeps the error banner for a store error', async () => {
    openTabs([PHOTO]);
    useDiskStore.setState({ loading: { isLoading: false, error: 'Permission denied' } });
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('disk-explorer-error')).toHaveTextContent('Permission denied')
    );
    expect(toastError).toHaveBeenCalledWith('Permission denied');
  });
});
