import * as React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigationType,
} from 'react-router-dom';
import { FilesRoute } from '@/renderer/features/disk-explorer';
import { fileLocation } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { entry, installDiskApi } from '@/tests/helpers/diskApi';
import { openTabs, openedPath, resetTabs, tabPaths } from '@/tests/helpers/tabs';

const ROOT = '/Vault';
const ALPHA = '/Vault/Alpha';
const NOTE = '/Vault/brief.md';
const OTHER = '/Vault/other.md';

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
      <Routes>
        <Route path="/files" element={<FilesHarness />} />
      </Routes>
    </MemoryRouter>
  );
}

const search = (path: string) => `/files?mode=focus&dir=%2FVault&file=${encodeURIComponent(path)}`;

beforeEach(() => {
  window.localStorage.clear();
  installDiskApi({
    listRoots: vi.fn(async () => ({ success: true as const, data: [ROOT] })),
    readDirectory: vi.fn(async (path: string) => ({
      success: true as const,
      data: {
        path,
        entries:
          path === ROOT
            ? [
                entry({ path: ALPHA, name: 'Alpha', kind: 'directory', isDirectory: true }),
                entry({ path: NOTE, name: 'brief.md', kind: 'text' }),
                entry({ path: OTHER, name: 'other.md', kind: 'text' }),
              ]
            : [],
      },
    })),
  });
  useDiskStore.setState({
    roots: [],
    listings: {},
    expanded: {},
    currentDirectory: null,
    focusedPath: null,
    selectedPath: null,
    selectedPaths: [],
    quickPreviewPath: null,
    isQuickLookOpen: false,
    loading: { isLoading: false, error: null },
  });
  resetTabs();
});

describe('FilesRoute', () => {
  it('loads roots without a mounted sidebar and says no page is open when no tab is', async () => {
    renderFilesRoute();
    expect(await screen.findByTestId('no-page-open')).toHaveTextContent('No page is open');
    expect(window.diskAPI.listRoots).toHaveBeenCalled();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/files$/);
  });

  it('opens a URL it did not write in a tab once the roots are known', async () => {
    renderFilesRoute(search(NOTE));
    await waitFor(() => expect(openedPath()).toBe(NOTE));
    expect(tabPaths()).toEqual([NOTE]);
    await waitFor(() => expect(useDiskStore.getState().currentDirectory).toBe(ROOT));
    expect(screen.getByTestId('files-focus')).toBeInTheDocument();
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

  it('follows Back within the active tab and loads what it shows', async () => {
    useDiskStore.setState({ roots: [ROOT] });
    renderFilesRoute(search(NOTE));
    await waitFor(() => expect(openedPath()).toBe(NOTE));
    act(() =>
      useTabsStore.getState().open({ mode: 'browse', collection: { kind: 'directory', directory: ALPHA } })
    );
    await waitFor(() => expect(useDiskStore.getState().currentDirectory).toBe(ALPHA));
    act(() => useTabsStore.getState().back());
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(search(NOTE)));
    expect(useDiskStore.getState().currentDirectory).toBe(ROOT);
    expect(tabPaths()).toEqual([NOTE]);
  });

  it('keeps a URL from outside the roots out of the tabs', async () => {
    openTabs([NOTE]);
    renderFilesRoute('/files?mode=focus&dir=%2FElsewhere&file=%2FElsewhere%2Fsecret.md');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(search(NOTE)));
    expect(tabPaths()).toEqual([NOTE]);
    expect(useTabsStore.getState().tabs[0].history).toEqual([{ location: fileLocation(NOTE) }]);
  });
});
