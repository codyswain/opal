import * as React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useNavigate, useRoutes } from 'react-router-dom';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import {
  AppShell,
  DEFAULT_SHELL_PREFERENCES,
  ShellProvider,
  useShellStore,
  type ShellRouteDescriptor,
  type ShellRouteObject,
} from '@/renderer/features/shell';
import { ThemeProvider } from '@/renderer/features/theme';
import { TooltipProvider } from '@/renderer/shared/ui';
import { installDiskApi } from '@/tests/helpers/diskApi';

const FILES: ShellRouteDescriptor = {
  id: 'files',
  header: {
    title: 'Files',
    actions: <button type="button">New item</button>,
  },
};

const OTHER: ShellRouteDescriptor = {
  id: 'other',
  header: { title: 'Other' },
};

const ROUTES: ShellRouteObject[] = [
  {
    path: '/files',
    element: <div>Files content</div>,
    handle: { shell: FILES },
  },
  {
    path: '/other',
    element: <div>Other content</div>,
    handle: { shell: OTHER },
  },
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
          <ShellProvider routes={ROUTES} fallbackRoute={FILES}>
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
  useShellStore.setState({
    ...DEFAULT_SHELL_PREFERENCES,
    narrowLayout: false,
    narrowSidebarOpen: false,
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

describe('AppShell', () => {
  it('keeps one frame mounted while route content and context change', async () => {
    renderShell(['/files']);
    const shell = screen.getByTestId('app-shell');

    expect(shell).toHaveAttribute('data-layout', 'wide');
    expect(screen.getByTestId('workspace-sidebar')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Files' })).toBeInTheDocument();
    expect(screen.getByText('Files content')).toBeInTheDocument();

    act(() => screen.getByTestId('native-route-command').click());

    expect(screen.getByTestId('app-shell')).toBe(shell);
    expect(screen.getByTestId('workspace-sidebar')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Other' })).toBeInTheDocument();
    expect(screen.getByText('Other content')).toBeInTheDocument();
  });

  it('keeps Back and Forward in the sidebar, or in the titlebar when the sidebar is hidden', async () => {
    const user = userEvent.setup();
    renderShell(['/files']);
    act(() => screen.getByTestId('native-route-command').click());

    const sidebar = screen.getByTestId('workspace-sidebar');
    expect(within(screen.getByTestId('titlebar')).queryByRole('button', { name: 'Go back' })).toBeNull();
    await user.click(within(sidebar).getByRole('button', { name: 'Go back' }));
    expect(screen.getByText('Files content')).toBeInTheDocument();
    await user.click(within(sidebar).getByRole('button', { name: 'Go forward' }));
    expect(screen.getByText('Other content')).toBeInTheDocument();

    await user.click(within(sidebar).getByRole('button', { name: 'Hide sidebar' }));
    const titlebar = screen.getByTestId('titlebar');
    await user.click(within(titlebar).getByRole('button', { name: 'Go back' }));
    expect(screen.getByText('Files content')).toBeInTheDocument();
    expect(within(titlebar).getByRole('button', { name: 'Show sidebar' })).toBeInTheDocument();
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
      onChanged: vi.fn((callback: (payload: { directories: string[] }) => void) => {
        changed = callback;
        return () => undefined;
      }),
    });
    useDiskStore.setState({ expanded: { '/Vault/Inbox': true } });
    renderShell(['/other']);

    await waitFor(() =>
      expect(window.diskAPI.readDirectory).toHaveBeenCalledWith('/Vault')
    );
    expect(window.diskAPI.readDirectory).toHaveBeenCalledWith('/Vault/Inbox');

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
    expect(page).toHaveClass('rounded-card', 'border-page-ring', 'mr-page', 'mb-page');
    expect(page).not.toHaveClass('ml-page');

    await user.click(screen.getByRole('button', { name: 'Hide sidebar' }));
    expect(page).toHaveClass('ml-page');
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

  it('starts narrow with an off-canvas sidebar and overflows page actions', async () => {
    const user = userEvent.setup();
    setViewportWidth(640);
    renderShell();

    expect(screen.getByTestId('app-shell')).toHaveAttribute(
      'data-layout',
      'narrow'
    );
    expect(screen.queryByTestId('workspace-sidebar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New item' })).toBeNull();

    act(() => useShellStore.getState().toggleSidebar());
    expect(screen.getByTestId('workspace-sidebar')).toBeInTheDocument();
    act(() => useShellStore.getState().toggleSidebar());
    expect(screen.queryByTestId('workspace-sidebar')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Page actions' }));
    expect(screen.getByRole('button', { name: 'New item' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

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
    await user.click(screen.getByRole('link', { name: 'Recent' }));
    expect(screen.queryByTestId('workspace-sidebar')).not.toBeInTheDocument();
    expect(screen.getByText('Files content')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('workspace-surface')).toHaveFocus()
    );
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
