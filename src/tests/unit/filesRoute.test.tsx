import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { FilesRoute } from '@/renderer/features/disk-explorer';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { entry, installDiskApi } from '@/tests/helpers/diskApi';

const ROOT = '/Vault';
const ALPHA = '/Vault/Alpha';
const BETA = '/Vault/Beta';

function FilesHarness() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate(-1)}>
        Back
      </button>
      <output data-testid="location">
        {location.pathname}
        {location.search}
      </output>
      <FilesRoute />
    </>
  );
}

function renderFilesRoute(initialEntries: string[], initialIndex = 0) {
  return render(
    <MemoryRouter
      initialEntries={initialEntries}
      initialIndex={initialIndex}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/files" element={<FilesHarness />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  installDiskApi({
    listRoots: vi.fn(async () => ({
      success: true as const,
      data: [ROOT],
    })),
    readDirectory: vi.fn(async (path: string) => ({
      success: true as const,
      data: {
        path,
        entries:
          path === ROOT
            ? [
                entry({
                  path: ALPHA,
                  name: 'Alpha',
                  kind: 'directory',
                  isDirectory: true,
                }),
                entry({
                  path: BETA,
                  name: 'Beta',
                  kind: 'directory',
                  isDirectory: true,
                }),
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
  useTabsStore.setState({
    openPaths: [],
    openedPath: null,
    activePath: null,
    previewPath: null,
  });
});

describe('FilesRoute', () => {
  it('loads roots without a mounted sidebar and canonicalizes the first directory', async () => {
    renderFilesRoute(['/files']);

    await waitFor(() =>
      expect(useDiskStore.getState().currentDirectory).toBe(ROOT)
    );
    expect(screen.queryByRole('tree')).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/files?mode=browse&dir=%2FVault'
      )
    );
    await waitFor(() =>
      expect(window.diskAPI.readDirectory).toHaveBeenCalledWith(ROOT)
    );
  });

  it('applies Back navigation to canonical directory state', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({
      roots: [ROOT],
      currentDirectory: BETA,
      listings: { [ALPHA]: [], [BETA]: [] },
    });
    renderFilesRoute(
      [
        '/files?mode=browse&dir=%2FVault%2FAlpha',
        '/files?mode=browse&dir=%2FVault%2FBeta',
      ],
      1
    );

    await user.click(screen.getByRole('button', { name: 'Back' }));

    await waitFor(() =>
      expect(useDiskStore.getState().currentDirectory).toBe(ALPHA)
    );
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/files?mode=browse&dir=%2FVault%2FAlpha'
    );
  });

  it('restores an explicit Focus location into the open-file state', async () => {
    useDiskStore.setState({ roots: [ROOT] });
    renderFilesRoute([
      '/files?mode=focus&dir=%2FVault&file=%2FVault%2Fbrief.md',
    ]);

    await waitFor(() =>
      expect(useTabsStore.getState().openedPath).toBe('/Vault/brief.md')
    );
    expect(useDiskStore.getState().currentDirectory).toBe(ROOT);
  });
});
