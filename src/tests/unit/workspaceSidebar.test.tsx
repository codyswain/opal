import { FilesRoute } from '@/renderer/features/disk-explorer/components/FilesRoute';
import * as React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import {
  ShellProvider,
  WorkspaceSidebar,
  type ShellRouteObject,
} from '@/renderer/features/shell';
import { ThemeProvider } from '@/renderer/features/theme';
import { TooltipProvider } from '@/renderer/shared/ui';
import { entry, installDiskApi } from '@/tests/helpers/diskApi';

const ROOT = '/Vault';
const DESIGN = '/Vault/Design';

const ROUTES: ShellRouteObject[] = [
  {
    path: '/files',
    element: null,
    handle: { shell: { id: 'files', header: { title: 'Files' } } },
  },
  {
    path: '/explorer',
    element: null,
    handle: { shell: { id: 'notes', header: { title: 'Notes' } } },
  },
  {
    path: '/settings',
    element: null,
    handle: { shell: { id: 'settings', header: { title: 'Settings' } } },
  },
];

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}

function renderSidebar(withFiles = false) {
  return render(
    <MemoryRouter
      initialEntries={['/files']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ThemeProvider>
        <TooltipProvider>
          <ShellProvider
            routes={ROUTES}
            fallbackRoute={{ id: 'opal', header: { title: 'Opal' } }}
          >
            <div className="h-[600px] w-[220px]">
              <WorkspaceSidebar />
            </div>
            <LocationProbe />
            {withFiles ? <FilesRoute /> : null}
          </ShellProvider>
        </TooltipProvider>
      </ThemeProvider>
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
                  path: DESIGN,
                  name: 'Design',
                  kind: 'directory',
                  isDirectory: true,
                }),
                entry({
                  path: '/Vault/readme.md',
                  name: 'readme.md',
                  kind: 'markdown',
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
    loading: { isLoading: false, error: null },
  });
});

describe('WorkspaceSidebar', () => {
  it('shows only real destinations and a lazy directory-only tree', async () => {
    const user = userEvent.setup();
    renderSidebar();

    expect(screen.getByRole('link', { name: 'Notes' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Files' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByText('Favorites')).toBeNull();
    expect(screen.queryByText('Search')).toBeNull();

    const root = await screen.findByTestId(`disk-tree-item-${ROOT}`);
    expect(root).toHaveAttribute('aria-level', '1');
    expect(window.diskAPI.readDirectory).not.toHaveBeenCalled();

    await user.click(screen.getByTestId(`disk-tree-toggle-${ROOT}`));
    const design = await screen.findByTestId(`disk-tree-item-${DESIGN}`);
    expect(design).toHaveAttribute('aria-level', '2');
    expect(screen.queryByText('readme.md')).toBeNull();
    expect(window.diskAPI.readDirectory).toHaveBeenCalledWith(ROOT);
  });

  it('navigates a directory through React Router and canonical disk state', async () => {
    const user = userEvent.setup();
    renderSidebar(true);
    await screen.findByTestId(`disk-tree-item-${ROOT}`);
    await user.click(screen.getByTestId(`disk-tree-toggle-${ROOT}`));
    const design = await screen.findByTestId(`disk-tree-item-${DESIGN}`);

    await user.click(design);

    await waitFor(() => expect(useDiskStore.getState().currentDirectory).toBe(DESIGN));
    expect(useDiskStore.getState().selectedPaths).toEqual([]);
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/files?mode=browse&dir=%2FVault%2FDesign'
      )
    );
  });

  it('provides roving tree focus and arrow-key navigation', async () => {
    const user = userEvent.setup();
    renderSidebar();
    const root = await screen.findByTestId(`disk-tree-item-${ROOT}`);
    await user.click(screen.getByTestId(`disk-tree-toggle-${ROOT}`));
    const design = await screen.findByTestId(`disk-tree-item-${DESIGN}`);

    act(() => root.focus());
    await user.keyboard('{ArrowDown}');

    await waitFor(() => expect(design).toHaveFocus());
    expect(root).toHaveAttribute('tabindex', '-1');
    expect(design).toHaveAttribute('tabindex', '0');
  });
});
