import * as React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
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

const NOTES: ShellRouteDescriptor = {
  id: 'notes',
  header: { title: 'Notes' },
};

const SETTINGS: ShellRouteDescriptor = {
  id: 'settings',
  header: { title: 'Settings' },
};

const ROUTES: ShellRouteObject[] = [
  {
    path: '/files',
    element: <div>Files content</div>,
    handle: { shell: FILES },
  },
  {
    path: '/explorer',
    element: <div>Notes content</div>,
    handle: { shell: NOTES },
  },
  {
    path: '/settings',
    element: <div>Settings content</div>,
    handle: { shell: SETTINGS },
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
      data-testid="native-settings-command"
      onClick={() => navigate('/settings')}
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
    const user = userEvent.setup();
    renderShell();
    const shell = screen.getByTestId('app-shell');

    expect(shell).toHaveAttribute('data-layout', 'wide');
    expect(screen.getByTestId('workspace-sidebar')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Files' })).toBeInTheDocument();
    expect(screen.getByText('Files content')).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Notes' }));

    expect(screen.getByTestId('app-shell')).toBe(shell);
    expect(screen.getByRole('heading', { name: 'Notes' })).toBeInTheDocument();
    expect(screen.getByText('Notes content')).toBeInTheDocument();
  });

  it('uses router history for universal Back and Forward controls', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Go back' }));
    expect(screen.getByText('Files content')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Go forward' }));
    expect(screen.getByText('Settings content')).toBeInTheDocument();
  });

  it('uses the persisted desktop collapse state and traffic-light clearance', async () => {
    const user = userEvent.setup();
    useShellStore.setState({ sidebarOpen: false });
    renderShell();

    expect(screen.queryByTestId('workspace-sidebar')).not.toBeInTheDocument();
    expect(screen.getByTestId('traffic-light-spacer')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Show workspace sidebar' })
    );
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
      width: '200px',
    });

    const separator = screen.getByRole('separator', {
      name: 'Resize workspace sidebar',
    });
    separator.focus();
    await user.keyboard('{ArrowLeft}');
    expect(useShellStore.getState().sidebarWidth).toBe(192);
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
      screen.getByRole('button', { name: 'Show workspace sidebar' })
    );
    expect(screen.getByTestId('workspace-sidebar')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Close workspace sidebar' })
    ).toBeInTheDocument();
    const workspace = screen.getByTestId('workspace-surface').parentElement;
    expect(workspace).toHaveAttribute('inert');
    expect(workspace).toHaveAttribute('aria-hidden', 'true');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Choose workspace folder' })
      ).toHaveFocus()
    );

    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('workspace-sidebar')).not.toBeInTheDocument();
    expect(workspace).not.toHaveAttribute('inert');
    expect(workspace).not.toHaveAttribute('aria-hidden');
    expect(
      screen.getByRole('button', { name: 'Show workspace sidebar' })
    ).toHaveFocus();

    await user.click(
      screen.getByRole('button', { name: 'Show workspace sidebar' })
    );
    await user.click(screen.getByRole('link', { name: 'Notes' }));
    expect(screen.queryByTestId('workspace-sidebar')).not.toBeInTheDocument();
    expect(screen.getByText('Notes content')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('workspace-surface')).toHaveFocus()
    );
  });

  it('hands focus to the workspace when an external route closes the narrow sidebar', async () => {
    const user = userEvent.setup();
    setViewportWidth(640);
    renderShell();

    await user.click(
      screen.getByRole('button', { name: 'Show workspace sidebar' })
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Choose workspace folder' })
      ).toHaveFocus()
    );

    act(() => screen.getByTestId('native-settings-command').click());

    await waitFor(() =>
      expect(screen.getByText('Settings content')).toBeInTheDocument()
    );
    expect(screen.queryByTestId('workspace-sidebar')).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('workspace-surface')).toHaveFocus()
    );
  });
});
