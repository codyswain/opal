import * as React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, useRoutes } from 'react-router-dom';
import {
  browseFiles,
  focusFile,
} from '@/renderer/features/disk-explorer/navigation/filesLocation';
import {
  DEFAULT_SHELL_PREFERENCES,
  SHELL_LIMITS,
  SHELL_PREFERENCE_KEY,
  ShellProvider,
  resolveInspectorTab,
  sanitizeShellPreferences,
  useShell,
  useShellStore,
  type ShellRouteObject,
  type ShellRouteDescriptor,
} from '@/renderer/features/shell';
import { readPref, writePref } from '@/renderer/shared/prefs/prefs';

const FILES_ROUTE: ShellRouteDescriptor = {
  id: 'files',
  header: {
    title: 'Files',
    breadcrumbs: [{ id: 'vault', label: 'Vault' }],
    actions: <button type="button">New folder</button>,
  },
  inspector: {
    ariaLabel: 'File inspector',
    tabs: [
      { id: 'preview', label: 'Preview', content: <div>Preview content</div> },
      {
        id: 'properties',
        label: 'Properties',
        content: <div>Properties content</div>,
      },
    ],
  },
};

const SETTINGS_ROUTE: ShellRouteDescriptor = {
  id: 'settings',
  header: { title: 'Settings' },
};

const FALLBACK_ROUTE: ShellRouteDescriptor = {
  id: 'unknown',
  header: { title: 'Opal' },
};

const SHELL_ROUTES: ShellRouteObject[] = [
  {
    path: '/files',
    element: <div data-testid="route-content">Files route</div>,
    handle: { shell: FILES_ROUTE },
  },
  {
    path: '/settings',
    element: <div data-testid="route-content">Settings route</div>,
    handle: { shell: SETTINGS_ROUTE },
  },
];

beforeEach(() => {
  window.localStorage.clear();
  useShellStore.setState({
    ...DEFAULT_SHELL_PREFERENCES,
    narrowLayout: false,
    narrowSidebarOpen: false,
  });
});

describe('shell preferences', () => {
  it('hydrates stable defaults synchronously', () => {
    expect(useShellStore.getState().hydrate()).toEqual(
      DEFAULT_SHELL_PREFERENCES
    );
  });

  it('restores validated cosmetic preferences', () => {
    const saved = {
      sidebarOpen: false,
      sidebarWidth: 248,
      inspectorOpen: true,
      inspectorWidth: 404,
      inspectorActiveTab: 'properties',
    };
    writePref(SHELL_PREFERENCE_KEY, saved);

    expect(useShellStore.getState().hydrate()).toEqual(saved);
  });

  it('uses field defaults and clamps corrupt persisted geometry', () => {
    writePref(SHELL_PREFERENCE_KEY, {
      sidebarOpen: 'yes',
      sidebarWidth: 9_000,
      inspectorOpen: true,
      inspectorWidth: -4,
      inspectorActiveTab: 'x'.repeat(100),
    });

    expect(useShellStore.getState().hydrate()).toEqual({
      sidebarOpen: true,
      sidebarWidth: SHELL_LIMITS.sidebar.max,
      inspectorOpen: true,
      inspectorWidth: SHELL_LIMITS.inspector.min,
      inspectorActiveTab: null,
    });
  });

  it('falls back safely when the preference envelope is malformed', () => {
    writePref('isLeftSidebarOpen', false);
    writePref('isRightSidebarOpen', true);
    window.localStorage.setItem(`opal.${SHELL_PREFERENCE_KEY}`, '{bad json');

    expect(useShellStore.getState().hydrate()).toEqual(
      DEFAULT_SHELL_PREFERENCES
    );
  });

  it('migrates the existing pane visibility preferences', () => {
    writePref('isLeftSidebarOpen', false);
    writePref('isRightSidebarOpen', true);

    expect(useShellStore.getState().hydrate()).toMatchObject({
      sidebarOpen: false,
      inspectorOpen: true,
    });
    expect(readPref<unknown>(SHELL_PREFERENCE_KEY, null)).toMatchObject({
      sidebarOpen: false,
      inspectorOpen: true,
    });
  });

  it('persists toggles, bounded widths, and the active inspector tab', () => {
    const shell = useShellStore.getState();
    shell.toggleSidebar();
    shell.setSidebarWidth(10);
    shell.toggleInspector();
    shell.setInspectorWidth(10_000);
    shell.setInspectorActiveTab(' properties ');

    expect(
      readPref(SHELL_PREFERENCE_KEY, DEFAULT_SHELL_PREFERENCES)
    ).toEqual({
      sidebarOpen: false,
      sidebarWidth: SHELL_LIMITS.sidebar.min,
      inspectorOpen: true,
      inspectorWidth: SHELL_LIMITS.inspector.max,
      inspectorActiveTab: 'properties',
    });
  });

  it('routes the shared sidebar command to the narrow overlay without changing the desktop preference', () => {
    const shell = useShellStore.getState();
    shell.setNarrowLayout(true);
    useShellStore.getState().toggleSidebar();

    expect(useShellStore.getState()).toMatchObject({
      sidebarOpen: true,
      narrowSidebarOpen: true,
    });
    expect(
      readPref(SHELL_PREFERENCE_KEY, DEFAULT_SHELL_PREFERENCES).sidebarOpen
    ).toBe(true);

    useShellStore.getState().closeNarrowSidebar();
    expect(useShellStore.getState().narrowSidebarOpen).toBe(false);
  });

  it('sanitizes unknown input without retaining non-cosmetic fields', () => {
    expect(
      sanitizeShellPreferences({
        ...DEFAULT_SHELL_PREFERENCES,
        currentRoute: '/private',
        header: { title: 'Injected' },
      })
    ).toEqual(DEFAULT_SHELL_PREFERENCES);
  });
});

function ShellConsumer() {
  const shell = useShell();
  return (
    <>
      <output data-testid="route-id">{shell.route.id}</output>
      <output data-testid="route-title">{shell.route.header.title}</output>
      <output data-testid="router-location">
        {shell.location.pathname}
        {shell.location.search}
      </output>
      <button type="button" onClick={() => shell.navigateTo('/settings')}>
        Settings
      </button>
      <button type="button" onClick={shell.goBack}>
        Back
      </button>
      <button type="button" onClick={shell.goForward}>
        Forward
      </button>
      <button
        type="button"
        onClick={() => shell.navigateFiles(browseFiles('/Vault'))}
      >
        Browse vault
      </button>
      <button
        type="button"
        onClick={() =>
          shell.navigateFiles(browseFiles('/Ignored', 'none'))
        }
      >
        No route change
      </button>
      <button
        type="button"
        onClick={() =>
          shell.navigateFiles(
            focusFile('/Vault', '/Vault/note.md', 'replace')
          )
        }
      >
        Replace with focused file
      </button>
    </>
  );
}

let shellMounts = 0;

function StableShellProbe() {
  React.useEffect(() => {
    shellMounts += 1;
  }, []);
  return <ShellConsumer />;
}

function RouteContent() {
  return useRoutes(SHELL_ROUTES);
}

function DescriptorHarness() {
  return (
    <ShellProvider routes={SHELL_ROUTES} fallbackRoute={FALLBACK_ROUTE}>
      <StableShellProbe />
      <RouteContent />
    </ShellProvider>
  );
}

describe('shell route contract', () => {
  it('updates declarative route chrome with the live router location', async () => {
    const user = userEvent.setup();
    shellMounts = 0;
    render(
      <MemoryRouter
        initialEntries={['/files']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <DescriptorHarness />
      </MemoryRouter>
    );

    expect(screen.getByTestId('route-id')).toHaveTextContent('files');
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByTestId('route-id')).toHaveTextContent('settings');
    expect(screen.getByTestId('route-title')).toHaveTextContent('Settings');
    expect(screen.getByTestId('router-location')).toHaveTextContent('/settings');
    expect(screen.getByTestId('route-content')).toHaveTextContent(
      'Settings route'
    );
    expect(shellMounts).toBe(1);
  });

  it('uses React Router for top-level Back and Forward', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={['/files']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <DescriptorHarness />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('router-location')).toHaveTextContent('/files');
    await user.click(screen.getByRole('button', { name: 'Forward' }));
    expect(screen.getByTestId('router-location')).toHaveTextContent('/settings');
  });

  it('adapts Task 3 files intents into the same router history', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={['/settings']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <DescriptorHarness />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'Browse vault' }));
    expect(screen.getByTestId('router-location')).toHaveTextContent(
      '/files?mode=browse&dir=%2FVault'
    );
    await user.click(screen.getByRole('button', { name: 'No route change' }));
    expect(screen.getByTestId('router-location')).toHaveTextContent(
      '/files?mode=browse&dir=%2FVault'
    );
  });

  it('replaces with a Focus location instead of adding history', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={[
          '/settings',
          '/files?mode=browse&dir=%2FVault',
        ]}
        initialIndex={1}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <DescriptorHarness />
      </MemoryRouter>
    );

    await user.click(
      screen.getByRole('button', { name: 'Replace with focused file' })
    );
    expect(screen.getByTestId('router-location')).toHaveTextContent(
      '/files?mode=focus&dir=%2FVault&file=%2FVault%2Fnote.md'
    );
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('router-location')).toHaveTextContent('/settings');
  });

  it('resolves a valid inspector tab or the route default', () => {
    expect(resolveInspectorTab(FILES_ROUTE.inspector, 'properties')?.id).toBe(
      'properties'
    );
    expect(resolveInspectorTab(FILES_ROUTE.inspector, 'missing')?.id).toBe(
      'preview'
    );
    expect(resolveInspectorTab(undefined, 'preview')).toBeNull();
  });
});
