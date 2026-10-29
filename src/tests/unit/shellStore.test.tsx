import * as React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, useNavigationType, useRoutes, type RouteObject } from 'react-router-dom';
import {
  browseFiles,
  fileLocation,
  focusFile,
} from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import {
  DEFAULT_SHELL_PREFERENCES,
  SHELL_LIMITS,
  SHELL_PREFERENCE_KEY,
  ShellProvider,
  sanitizeShellPreferences,
  useShell,
  useShellStore,
} from '@/renderer/features/shell';
import { readPref, writePref } from '@/renderer/shared/prefs/prefs';
import { resetTabs, tabPaths } from '@/tests/helpers/tabs';

const SHELL_ROUTES: RouteObject[] = [
  { path: '/files', element: <div data-testid="route-content">Files route</div> },
  { path: '/other', element: <div data-testid="route-content">Other route</div> },
];

beforeEach(() => {
  window.localStorage.clear();
  resetTabs();
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

  it('widens a sidebar left at the old 220px default to the new default', () => {
    writePref(SHELL_PREFERENCE_KEY, { sidebarOpen: true, sidebarWidth: 220 });

    expect(useShellStore.getState().hydrate().sidebarWidth).toBe(
      DEFAULT_SHELL_PREFERENCES.sidebarWidth
    );
    expect(DEFAULT_SHELL_PREFERENCES.sidebarWidth).toBe(260);
  });

  it('restores validated cosmetic preferences', () => {
    const saved = {
      sidebarOpen: false,
      sidebarWidth: 248,
    };
    writePref(SHELL_PREFERENCE_KEY, saved);

    expect(useShellStore.getState().hydrate()).toEqual(saved);
  });

  it('uses field defaults and clamps corrupt persisted geometry', () => {
    writePref(SHELL_PREFERENCE_KEY, {
      sidebarOpen: 'yes',
      sidebarWidth: 9_000,
    });

    expect(useShellStore.getState().hydrate()).toEqual({
      sidebarOpen: true,
      sidebarWidth: SHELL_LIMITS.sidebar.max,
    });
  });

  it('falls back safely when the preference envelope is malformed', () => {
    writePref('isLeftSidebarOpen', false);
    window.localStorage.setItem(`opal.${SHELL_PREFERENCE_KEY}`, '{bad json');

    expect(useShellStore.getState().hydrate()).toEqual(
      DEFAULT_SHELL_PREFERENCES
    );
  });

  it('migrates the existing sidebar visibility preference', () => {
    writePref('isLeftSidebarOpen', false);

    expect(useShellStore.getState().hydrate()).toMatchObject({
      sidebarOpen: false,
    });
    expect(readPref<unknown>(SHELL_PREFERENCE_KEY, null)).toMatchObject({
      sidebarOpen: false,
    });
  });

  it('persists toggles and bounded widths', () => {
    const shell = useShellStore.getState();
    shell.toggleSidebar();
    shell.setSidebarWidth(10);

    expect(
      readPref(SHELL_PREFERENCE_KEY, DEFAULT_SHELL_PREFERENCES)
    ).toEqual({
      sidebarOpen: false,
      sidebarWidth: SHELL_LIMITS.sidebar.min,
    });
  });

  it('drops the retired inspector fields from stored preferences', () => {
    writePref(SHELL_PREFERENCE_KEY, {
      sidebarOpen: true,
      sidebarWidth: 248,
      inspectorOpen: true,
      inspectorWidth: 404,
    });

    expect(useShellStore.getState().hydrate()).toEqual({
      sidebarOpen: true,
      sidebarWidth: 248,
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
  const navigationType = useNavigationType();
  return (
    <>
      <output data-testid="router-location">
        {shell.location.pathname}
        {shell.location.search}
      </output>
      <output data-testid="navigation-type">{navigationType}</output>
      <button type="button" onClick={() => shell.navigateTo('/other')}>
        Other
      </button>
      <button type="button" onClick={() => shell.navigateFiles(browseFiles('/Vault'))}>
        Browse vault
      </button>
      <button
        type="button"
        onClick={() => shell.navigateFiles(focusFile('/Vault', '/Vault/note.md'), { newTab: true })}
      >
        Note in a new tab
      </button>
      <button type="button" onClick={() => shell.navigateFiles(browseFiles('/Ignored', 'none'))}>
        No route change
      </button>
      <button
        type="button"
        onClick={() => shell.navigateFiles(focusFile('/Vault', '/Vault/note.md', 'replace'))}
      >
        Replace with note
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

function renderShell(initialEntry: string) {
  return render(
    <MemoryRouter
      initialEntries={[initialEntry]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ShellProvider>
        <StableShellProbe />
        <RouteContent />
      </ShellProvider>
    </MemoryRouter>
  );
}

describe('shell navigation contract', () => {
  it('keeps one shell mounted while the route changes', async () => {
    const user = userEvent.setup();
    shellMounts = 0;
    renderShell('/files');
    await user.click(screen.getByRole('button', { name: 'Other' }));
    expect(screen.getByTestId('router-location')).toHaveTextContent('/other');
    expect(screen.getByTestId('route-content')).toHaveTextContent('Other route');
    expect(shellMounts).toBe(1);
  });

  it('opens files intents in the active tab, or a new one, and ignores none', async () => {
    const user = userEvent.setup();
    renderShell('/files');
    await user.click(screen.getByRole('button', { name: 'Browse vault' }));
    await user.click(screen.getByRole('button', { name: 'Note in a new tab' }));
    await user.click(screen.getByRole('button', { name: 'No route change' }));
    expect(tabPaths()).toEqual([null, '/Vault/note.md']);
    // On the files route the route itself mirrors the tab into the URL.
    expect(screen.getByTestId('router-location')).toHaveTextContent(/^\/files$/);
  });

  it('swaps the shown entry for a replace intent instead of adding a step', async () => {
    const user = userEvent.setup();
    renderShell('/files');
    await user.click(screen.getByRole('button', { name: 'Browse vault' }));
    await user.click(screen.getByRole('button', { name: 'Replace with note' }));
    expect(useTabsStore.getState().tabs[0].history).toEqual([
      { location: fileLocation('/Vault/note.md') },
    ]);
  });

  it('goes to the files route when an intent comes from another route, without a history step', async () => {
    const user = userEvent.setup();
    renderShell('/other');
    await user.click(screen.getByRole('button', { name: 'Browse vault' }));
    expect(screen.getByTestId('router-location')).toHaveTextContent(
      '/files?mode=browse&dir=%2FVault'
    );
    expect(screen.getByTestId('navigation-type')).toHaveTextContent('REPLACE');
  });
});
