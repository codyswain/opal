import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigationType,
} from 'react-router-dom';
import { FilesRoute } from '@/renderer/features/disk-explorer';
import { RECENT_COLLECTION, fileLocation } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { pathMutationCoordinator } from '@/renderer/features/disk-explorer/navigation/pathMutationCoordinator';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useRecentStore } from '@/renderer/features/disk-explorer/store/recentStore';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { ShellProvider } from '@/renderer/features/shell/context/ShellContext';
import { installActivityApi } from '@/tests/helpers/activityApi';
import { entry, installDiskApi } from '@/tests/helpers/diskApi';
import { openTabs, openedPath, resetTabs, tabPaths } from '@/tests/helpers/tabs';

const ROOT = '/Vault';
const NOTE = '/Vault/brief.txt';
const OTHER = '/Vault/other.txt';

function FilesHarness() {
  const location = useLocation();
  const navigationType = useNavigationType();
  return (
    <>
      <output data-testid="location">
        {location.pathname}
        {location.search}
      </output>
      <output data-testid="navigation-type">{navigationType}</output>
      <FilesRoute />
    </>
  );
}

function renderFilesRoute(initialEntry = '/files') {
  return render(
    <MemoryRouter
      initialEntries={[initialEntry]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ShellProvider>
        <Routes>
          <Route path="/files" element={<FilesHarness />} />
        </Routes>
      </ShellProvider>
    </MemoryRouter>
  );
}

const search = (path: string) => `/files?mode=focus&file=${encodeURIComponent(path)}`;
const listing = [
  entry({ path: NOTE, name: 'brief.txt', kind: 'text' }),
  entry({ path: OTHER, name: 'other.txt', kind: 'text' }),
];

beforeEach(() => {
  window.localStorage.clear();
  installActivityApi();
  installDiskApi({
    listRoots: vi.fn(async () => ({ success: true as const, data: [] })),
    readTextFile: vi.fn(async (path: string) => ({
      success: true as const,
      data: { path, text: `text of ${path}`, truncated: false, size: 1 },
    })),
  });
  useRecentStore.getState().reset();
  useDiskStore.setState({
    roots: [ROOT],
    rootsLoaded: true,
    listings: { [ROOT]: listing },
    expanded: {},
    pendingAction: null,
    pendingDelete: null,
    loading: { isLoading: false, error: null },
  });
  pathMutationCoordinator.reconcileAllowedRoots([ROOT]);
  resetTabs();
});

describe('FilesRoute', () => {
  it('says no file is open when no tab is', () => {
    renderFilesRoute();
    expect(screen.getByTestId('no-page-open')).toHaveTextContent('No file is open.');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/files$/);
  });

  it('asks for a folder once none is known to be open, and shows nothing before that', async () => {
    useDiskStore.setState({ roots: [], rootsLoaded: false, listings: {} });
    renderFilesRoute();
    expect(screen.queryByTestId('no-folder-open')).toBeNull();
    expect(screen.queryByTestId('no-page-open')).toBeNull();
    act(() => useDiskStore.setState({ rootsLoaded: true }));
    expect(screen.getByTestId('no-folder-open')).toHaveTextContent('Open a folder of Markdown files to start.');
    fireEvent.click(screen.getByRole('button', { name: 'Open folder' }));
    await waitFor(() => expect(window.diskAPI.openFolder).toHaveBeenCalled());
  });

  it('opens a URL it did not write in a tab once the roots are known', async () => {
    useDiskStore.setState({ roots: [], rootsLoaded: false });
    renderFilesRoute(search(NOTE));
    expect(tabPaths()).toEqual([]);
    act(() => useDiskStore.setState({ roots: [ROOT], rootsLoaded: true }));
    await waitFor(() => expect(openedPath()).toBe(NOTE));
    expect(tabPaths()).toEqual([NOTE]);
    expect(await screen.findByTestId('text-viewer')).toHaveTextContent(`text of ${NOTE}`);
  });

  it('mirrors the active tab into the URL, always replacing', async () => {
    openTabs([NOTE, OTHER]);
    renderFilesRoute();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(search(NOTE)));
    expect(screen.getByTestId('navigation-type')).toHaveTextContent('REPLACE');
    act(() => useTabsStore.getState().activateNext());
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(search(OTHER)));
    expect(screen.getByTestId('navigation-type')).toHaveTextContent('REPLACE');
    act(() => useTabsStore.getState().closeAll());
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/files$/));
    expect(screen.getByTestId('no-page-open')).toBeInTheDocument();
  });

  it('follows Back within the active tab', async () => {
    renderFilesRoute(search(NOTE));
    await waitFor(() => expect(openedPath()).toBe(NOTE));
    act(() => useTabsStore.getState().open({ mode: 'browse', collection: RECENT_COLLECTION }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/files?mode=browse&collection=recent')
    );
    expect(await screen.findByRole('heading', { name: 'Recent' })).toBeInTheDocument();
    act(() => useTabsStore.getState().back());
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(search(NOTE)));
    expect(tabPaths()).toEqual([NOTE]);
  });

  it('keeps a URL from outside the roots out of the tabs', async () => {
    openTabs([NOTE]);
    renderFilesRoute('/files?mode=focus&file=%2FElsewhere%2Fsecret.md');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(search(NOTE)));
    expect(tabPaths()).toEqual([NOTE]);
    expect(useTabsStore.getState().tabs[0].history).toEqual([{ location: fileLocation(NOTE) }]);
  });

  it('follows a rename of the open file and falls back when it is removed', async () => {
    openTabs([OTHER]);
    act(() => useTabsStore.getState().open(fileLocation(NOTE)));
    renderFilesRoute();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(search(NOTE)));
    act(() => {
      pathMutationCoordinator.applyAppMutation({ kind: 'rename', oldPath: NOTE, newPath: '/Vault/renamed.txt' });
    });
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(search('/Vault/renamed.txt'))
    );
    act(() => {
      pathMutationCoordinator.applyExternalRemoval(['/Vault/renamed.txt']);
    });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(search(OTHER)));
  });

  it('asks for a folder again once the last one is closed', async () => {
    openTabs([NOTE]);
    act(() => useTabsStore.getState().open({ mode: 'browse', collection: RECENT_COLLECTION }, { newTab: true }));
    renderFilesRoute();
    await screen.findByRole('heading', { name: 'Recent' });
    await act(async () => {
      await useDiskStore.getState().closeRoot(ROOT);
    });
    expect(await screen.findByTestId('no-folder-open')).toBeInTheDocument();
    expect(tabPaths()).toEqual([null]);
  });
});
