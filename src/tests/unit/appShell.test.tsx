import * as React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useNavigate, useRoutes, type RouteObject } from 'react-router-dom';
import { usePaletteStore } from '@/renderer/features/commands/store/paletteStore';
import { fileLocation } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import {
  AppShell,
  DEFAULT_SHELL_PREFERENCES,
  ShellProvider,
  useShellStore,
} from '@/renderer/features/shell';
import {
  DEFAULT_DAY_SIDEBAR_PREFERENCES,
  useDaySidebarStore,
} from '@/renderer/features/day-sidebar';
import { ThemeProvider } from '@/renderer/features/theme';
import { TooltipProvider } from '@/renderer/shared/ui';
import { entry, installDiskApi } from '@/tests/helpers/diskApi';
import { openTabs, openedPath, resetTabs } from '@/tests/helpers/tabs';

const ROUTES: RouteObject[] = [
  { path: '/files', element: <div>Files content</div> },
  { path: '/other', element: <div>Other content</div> },
];

function RouteContent() {
  return useRoutes(ROUTES);
}

function NativeRouteControl() {
  const navigate = useNavigate();
  return (
    <button
      hidden
      type="button"
      data-testid="native-route-command"
      onClick={() => navigate('/other')}
    />
  );
}

function renderShell(initialEntries = ['/files']) {
  return render(
    <MemoryRouter
      initialEntries={initialEntries}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ThemeProvider>
        <TooltipProvider>
          <ShellProvider>
            <NativeRouteControl />
            <AppShell>
              <RouteContent />
            </AppShell>
          </ShellProvider>
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  setViewportWidth(1440);
  installDiskApi();
  resetTabs();
  usePaletteStore.setState({ open: false });
  useShellStore.setState({
    ...DEFAULT_SHELL_PREFERENCES,
    narrowLayout: false,
    narrowSidebarOpen: false,
  });
  useDaySidebarStore.setState({ ...DEFAULT_DAY_SIDEBAR_PREFERENCES, pickedDay: null, lastDay: null, narrowOpen: false });
  useDiskStore.setState({
    roots: [],
    listings: {},
    expanded: {},
    loading: { isLoading: false, error: null },
  });
});

describe('AppShell', () => {
  it('keeps one frame mounted while route content changes', async () => {
    renderShell(['/files']);
    const shell = screen.getByTestId('app-shell');

    expect(shell).toHaveAttribute('data-layout', 'wide');
    expect(screen.getByTestId('workspace-sidebar')).toBeInTheDocument();
    expect(screen.getByText('Files content')).toBeInTheDocument();

    act(() => screen.getByTestId('native-route-command').click());

    expect(screen.getByTestId('app-shell')).toBe(shell);
    expect(screen.getByTestId('workspace-sidebar')).toBeInTheDocument();
    expect(screen.getByText('Other content')).toBeInTheDocument();
  });

  it('holds the tabs and New tab in one row, with Search in the top row of the sidebar', async () => {
    const user = userEvent.setup();
    openTabs(['/Vault/brief.md', '/Vault/plan.md']);
    renderShell();
    const titlebar = screen.getByTestId('titlebar');

    expect(titlebar).toHaveClass('drag-handle', 'h-header');
    expect(within(titlebar).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['brief', 'plan']);
    expect(within(titlebar).getByRole('button', { name: 'New tab' })).toBeInTheDocument();
    expect(within(titlebar).queryByRole('button', { name: 'Search' })).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull();

    // Search is the last control of the sidebar's top row, after Back and Forward.
    const sidebar = screen.getByTestId('workspace-sidebar');
    const row = within(sidebar).getByRole('button', { name: 'Go forward' }).closest('.drag-handle') as HTMLElement;
    expect(within(row).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Hide sidebar',
      'Go back',
      'Go forward',
      'Search',
    ]);
    await user.click(within(row).getByRole('button', { name: 'Search' }));
    expect(usePaletteStore.getState()).toMatchObject({ open: true, newTab: false });
  });

  it('moves Search into the tab row with the other sidebar controls while the sidebar is hidden', async () => {
    const user = userEvent.setup();
    openTabs(['/Vault/brief.md']);
    renderShell();
    act(() => useShellStore.getState().toggleSidebar());
    const titlebar = screen.getByTestId('titlebar');
    const buttons = within(titlebar).getAllByRole('button').map((button) => button.getAttribute('aria-label'));
    expect(buttons.slice(0, 4)).toEqual(['Show sidebar', 'Go back', 'Go forward', 'Search']);
    await user.click(within(titlebar).getByRole('button', { name: 'Search' }));
    expect(usePaletteStore.getState().open).toBe(true);
  });

  it('offers Collapse all folders beside Search only while a folder is open, and collapses them all', async () => {
    const user = userEvent.setup();
    installDiskApi({
      listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })),
      readDirectory: vi.fn(async (path: string) => ({
        success: true as const,
        data: {
          path,
          entries:
            path === '/Vault'
              ? [entry({ path: '/Vault/Library', name: 'Library', isDirectory: true }), entry({ path: '/Vault/readme.md', name: 'readme.md' })]
              : [entry({ path: `${path}/daily`, name: 'daily', isDirectory: true })],
        },
      })),
    });
    renderShell();
    const sidebar = screen.getByTestId('workspace-sidebar');
    await screen.findByTestId('disk-tree-item-/Vault/Library');
    expect(within(sidebar).queryByRole('button', { name: 'Collapse all folders' })).toBeNull();

    await user.click(screen.getByTestId('disk-tree-item-/Vault/Library'));
    await screen.findByTestId('disk-tree-item-/Vault/Library/daily');
    const collapse = within(sidebar).getByRole('button', { name: 'Collapse all folders' });
    // Quiet at rest: it shows on hover of the sidebar or with focus in it.
    expect(collapse).toHaveClass('opacity-0', 'group-hover/sidebar:opacity-100', 'group-focus-within/sidebar:opacity-100');
    expect(sidebar).toHaveClass('group/sidebar');
    expect(collapse.nextElementSibling).toHaveAttribute('aria-label', 'Search');

    await user.click(collapse);
    expect(screen.queryByTestId('disk-tree-item-/Vault/Library/daily')).toBeNull();
    expect(useDiskStore.getState().expanded).toEqual({});
    expect(within(sidebar).queryByRole('button', { name: 'Collapse all folders' })).toBeNull();
  });

  it('keeps Back and Forward in the sidebar, or in the titlebar when the sidebar is hidden', async () => {
    const user = userEvent.setup();
    installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })) });
    openTabs(['/Vault/brief.md']);
    act(() => useTabsStore.getState().open(fileLocation('/Vault/plan.md')));
    renderShell(['/files']);
    await waitFor(() => expect(useDiskStore.getState().roots).toEqual(['/Vault']));

    const sidebar = screen.getByTestId('workspace-sidebar');
    expect(within(screen.getByTestId('titlebar')).queryByRole('button', { name: 'Go back' })).toBeNull();
    expect(within(sidebar).getByRole('button', { name: 'Go forward' })).toBeDisabled();
    await user.click(within(sidebar).getByRole('button', { name: 'Go back' }));
    expect(openedPath()).toBe('/Vault/brief.md');
    expect(within(sidebar).getByRole('button', { name: 'Go back' })).toBeDisabled();
    await user.click(within(sidebar).getByRole('button', { name: 'Go forward' }));
    expect(openedPath()).toBe('/Vault/plan.md');

    await user.click(within(sidebar).getByRole('button', { name: 'Hide sidebar' }));
    const titlebar = screen.getByTestId('titlebar');
    await user.click(within(titlebar).getByRole('button', { name: 'Go back' }));
    expect(openedPath()).toBe('/Vault/brief.md');
    expect(within(titlebar).getByRole('button', { name: 'Show sidebar' })).toBeInTheDocument();
  });

  it('names the window after the active page', () => {
    openTabs(['/Vault/Library/daily/2026-10-28.md', '/Vault/photo.png']);
    renderShell();
    expect(document.title).toBe('2026-10-28');
    act(() => useTabsStore.getState().activateNext());
    expect(document.title).toBe('photo.png');
    act(() => useTabsStore.getState().closeAll());
    expect(document.title).toBe('Opal');
  });

  it('drops the traffic-light inset in full screen', async () => {
    let report: ((fullScreen: boolean) => void) | undefined;
    (window as unknown as { systemAPI: unknown }).systemAPI = {
      isFullScreen: vi.fn(async () => false),
      onFullScreenChange: vi.fn((handler: (fullScreen: boolean) => void) => {
        report = handler;
        return () => undefined;
      }),
    };
    renderShell();
    expect(screen.getByTestId('traffic-light-spacer')).toBeInTheDocument();

    act(() => report?.(true));
    expect(screen.queryByTestId('traffic-light-spacer')).toBeNull();
    act(() => report?.(false));
    expect(screen.getByTestId('traffic-light-spacer')).toBeInTheDocument();
    delete (window as unknown as { systemAPI?: unknown }).systemAPI;
  });

  it('loads the opened folders for the tree and keeps cached listings live on every route', async () => {
    let changed: ((payload: { directories: string[] }) => void) | undefined;
    installDiskApi({
      listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })),
      readDirectory: vi.fn(async (path: string) => ({
        success: true as const,
        data: {
          path,
          entries: path === '/Vault' ? [entry({ path: '/Vault/Library', name: 'Library', kind: 'directory', isDirectory: true })] : [],
        },
      })),
      onChanged: vi.fn((callback: (payload: { directories: string[] }) => void) => {
        changed = callback;
        return () => undefined;
      }),
    });
    useDiskStore.setState({ expanded: { '/Vault/Library': true } });
    renderShell(['/other']);

    await waitFor(() =>
      expect(window.diskAPI.readDirectory).toHaveBeenCalledWith('/Vault')
    );
    expect(window.diskAPI.readDirectory).toHaveBeenCalledWith('/Vault/Library');

    await waitFor(() => expect(useDiskStore.getState().listings['/Vault']).toBeDefined());
    vi.mocked(window.diskAPI.readDirectory).mockClear();
    act(() => changed?.({ directories: ['/Vault', '/Vault/Uncached'] }));
    await waitFor(() => expect(window.diskAPI.readDirectory).toHaveBeenCalledTimes(1));
    expect(window.diskAPI.readDirectory).toHaveBeenCalledWith('/Vault');
  });

  it('sets the page in the chrome as a card, inset on every free side', async () => {
    const user = userEvent.setup();
    renderShell();
    const page = screen.getByTestId('workspace-surface');
    // The right sidebar's column keeps the gap on that side.
    expect(screen.getByTestId('day-sidebar')).toBeInTheDocument();
    expect(page).toHaveClass('rounded-card', 'border-page-ring', 'mb-page');
    expect(page).not.toHaveClass('ml-page');
    expect(page).not.toHaveClass('mr-page');

    await user.click(screen.getByRole('button', { name: 'Hide sidebar' }));
    expect(page).toHaveClass('ml-page');
    await user.click(screen.getByRole('button', { name: 'Hide right sidebar' }));
    expect(screen.queryByTestId('day-sidebar')).not.toBeInTheDocument();
    expect(page).toHaveClass('mr-page');
  });

  it('uses the persisted desktop collapse state and traffic-light clearance', async () => {
    const user = userEvent.setup();
    useShellStore.setState({ sidebarOpen: false });
    renderShell();

    expect(screen.queryByTestId('workspace-sidebar')).not.toBeInTheDocument();
    expect(screen.getByTestId('traffic-light-spacer')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show sidebar' }));
    expect(screen.getByTestId('workspace-sidebar')).toBeInTheDocument();
    expect(useShellStore.getState().sidebarOpen).toBe(true);
  });

  it('caps the sidebar at medium width and supports keyboard resizing', async () => {
    const user = userEvent.setup();
    setViewportWidth(1024);
    useShellStore.setState({ sidebarWidth: 300 });
    renderShell();

    expect(screen.getByTestId('app-shell')).toHaveAttribute(
      'data-layout',
      'medium'
    );
    expect(screen.getByTestId('workspace-sidebar').parentElement).toHaveStyle({
      width: '240px',
    });

    const separator = screen.getByRole('separator', {
      name: 'Resize workspace sidebar',
    });
    separator.focus();
    await user.keyboard('{ArrowLeft}');
    expect(useShellStore.getState().sidebarWidth).toBe(232);
  });

  it('starts narrow with an off-canvas sidebar and Search in the tab row', async () => {
    const user = userEvent.setup();
    setViewportWidth(640);
    renderShell();

    expect(screen.getByTestId('app-shell')).toHaveAttribute(
      'data-layout',
      'narrow'
    );
    expect(screen.queryByTestId('workspace-sidebar')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('titlebar')).getByRole('button', { name: 'Search' })).toBeInTheDocument();

    act(() => useShellStore.getState().toggleSidebar());
    expect(screen.getByTestId('workspace-sidebar')).toBeInTheDocument();
    act(() => useShellStore.getState().toggleSidebar());
    expect(screen.queryByTestId('workspace-sidebar')).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Show sidebar' })
    );
    expect(screen.getByTestId('workspace-sidebar')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Hide sidebar' })
    ).toBeInTheDocument();
    const workspace = screen.getByTestId('workspace-surface').parentElement;
    expect(workspace).toHaveAttribute('inert');
    expect(workspace).toHaveAttribute('aria-hidden', 'true');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Hide sidebar' })
      ).toHaveFocus()
    );

    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('workspace-sidebar')).not.toBeInTheDocument();
    expect(workspace).not.toHaveAttribute('inert');
    expect(workspace).not.toHaveAttribute('aria-hidden');
    expect(
      screen.getByRole('button', { name: 'Show sidebar' })
    ).toHaveFocus();

    await user.click(
      screen.getByRole('button', { name: 'Show sidebar' })
    );
    await user.click(screen.getByRole('button', { name: 'Recent' }));
    expect(screen.queryByTestId('workspace-sidebar')).not.toBeInTheDocument();
    expect(screen.getByText('Files content')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('workspace-surface')).toHaveFocus()
    );
  });

  it('keeps focus in the sidebar when it opens a page beside it', async () => {
    const user = userEvent.setup();
    const note = '/Vault/note.md';
    installDiskApi({
      listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })),
      readDirectory: vi.fn(async (path: string) => ({
        success: true as const,
        data: { path, entries: path === '/Vault' ? [entry({ path: note, name: 'note.md', kind: 'markdown' })] : [] },
      })),
    });
    renderShell();

    const row = await screen.findByTestId(`disk-tree-item-${note}`);
    act(() => row.focus());
    await user.keyboard('{Enter}');
    await waitFor(() => expect(openedPath()).toBe(note));
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(screen.getByTestId(`disk-tree-item-${note}`)).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Recent' }));
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(screen.getByTestId('workspace-surface')).not.toHaveFocus();
  });

  it('shows the right sidebar as an overlay in the narrow layout, only while asked for', async () => {
    const user = userEvent.setup();
    setViewportWidth(640);
    renderShell();
    // Open in wider windows, but the narrow layout starts with it closed.
    expect(useDaySidebarStore.getState().open).toBe(true);
    expect(screen.queryByTestId('day-sidebar')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Show right sidebar' }));
    const overlay = screen.getByRole('dialog', { name: 'Day sidebar' });
    expect(within(overlay).getByTestId('day-sidebar')).toBeInTheDocument();
    expect(within(overlay).queryByRole('separator')).toBeNull();
    const workspace = screen.getByTestId('workspace-surface').parentElement;
    expect(workspace).toHaveAttribute('inert');
    await waitFor(() => expect(within(overlay).getByRole('button', { name: 'Previous day' })).toHaveFocus());

    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('day-sidebar')).toBeNull();
    expect(workspace).not.toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: 'Show right sidebar' })).toHaveFocus();

    // Its own toggle closes it too, and opening the left one closes it.
    await user.click(screen.getByRole('button', { name: 'Show right sidebar' }));
    await user.click(screen.getByRole('button', { name: 'Hide right sidebar' }));
    expect(screen.queryByTestId('day-sidebar')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show right sidebar' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Show right sidebar' }));
    act(() => useShellStore.getState().toggleSidebar());
    expect(screen.queryByTestId('day-sidebar')).toBeNull();
    expect(screen.getByTestId('workspace-sidebar')).toBeInTheDocument();
    expect(useDaySidebarStore.getState().open).toBe(true);
  });

  it('hands focus to the workspace when an external route closes the narrow sidebar', async () => {
    const user = userEvent.setup();
    setViewportWidth(640);
    renderShell();

    await user.click(
      screen.getByRole('button', { name: 'Show sidebar' })
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Hide sidebar' })
      ).toHaveFocus()
    );

    act(() => screen.getByTestId('native-route-command').click());

    await waitFor(() =>
      expect(screen.getByText('Other content')).toBeInTheDocument()
    );
    expect(screen.queryByTestId('workspace-sidebar')).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('workspace-surface')).toHaveFocus()
    );
  });
});
