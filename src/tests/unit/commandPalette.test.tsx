import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AppCommands, CommandPalette, usePaletteStore } from '@/renderer/features/commands';
import { commandRegistry } from '@/renderer/features/commands/services/commandRegistry';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { usePagePropertiesStore } from '@/renderer/features/disk-explorer/store/pagePropertiesStore';
import { useStackStore } from '@/renderer/features/disk-explorer/store/stackStore';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { stackLocation } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { usePinsStore } from '@/renderer/features/disk-explorer/store/pinsStore';
import { installPinsApi, setPins } from '@/tests/helpers/pinsApi';
import { useSettingsStore } from '@/renderer/features/settings';
import { ShellProvider } from '@/renderer/features/shell';
import { ThemeProvider } from '@/renderer/features/theme';
import { TooltipProvider } from '@/renderer/shared/ui';
import { installActivityApi, recentResult } from '@/tests/helpers/activityApi';
import { collectionResult, collectionRow, installCollectionsApi } from '@/tests/helpers/collectionsApi';
import { entry, installDiskApi } from '@/tests/helpers/diskApi';
import { openTabs, openedPath, resetTabs, tabPaths } from '@/tests/helpers/tabs';
import { COMMAND_IDS, TAB_POSITION_COMMAND_IDS } from '@/common/commandIds';

const ROOT = '/Vault';
const PLAN = '/Vault/Projects/Atlas/plan.md';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderPalette() {
  return render(
    <MemoryRouter initialEntries={['/files']}>
      <ThemeProvider>
        <TooltipProvider>
          <ShellProvider>
            <AppCommands />
            <CommandPalette />
            <LocationProbe />
          </ShellProvider>
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  usePaletteStore.setState({ open: false, initialQuery: '', newTab: false });
  resetTabs();
  useSettingsStore.setState({ open: false });
  usePagePropertiesStore.setState({ open: false });
  for (const command of commandRegistry.getAllCommands()) commandRegistry.unregisterCommand(command);
  (window as unknown as { systemAPI: unknown }).systemAPI = { reportCommands: vi.fn(), onMenuCommand: vi.fn(() => () => undefined), closeWindow: vi.fn() };
  installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: [ROOT] })) });
  installActivityApi({ recent: vi.fn(async () => ({ success: true as const, data: recentResult([{ entry: entry({ path: '/Vault/inbox.md', name: 'inbox.md', kind: 'markdown' }), touchedAt: Date.now() - 60_000, touchedKind: 'opened', openedAt: Date.now() - 60_000, organizedAt: null, editedAt: null }]) })) });
  useDiskStore.setState({ roots: [ROOT] });
});

describe('CommandPalette', () => {
  it('adds body matches with snippets from a scan of the files', async () => {
    installCollectionsApi({ query: vi.fn(async () => ({ success: true as const, data: collectionResult([]) })) });
    const searchContent = vi.fn(async () => ({ success: true as const, data: { hits: [{ path: PLAN, name: 'plan.md', excerpt: 'Plant foxglove in the garden.' }], incomplete: false } }));
    window.diskAPI.searchContent = searchContent;
    const user = userEvent.setup();
    renderPalette();
    act(() => usePaletteStore.getState().show());
    await user.type(await screen.findByRole('combobox'), 'foxglove');
    expect(await screen.findByRole('option', { name: /Plant foxglove in the garden/ })).toHaveTextContent('Plant foxglove in the garden.');
    expect(searchContent).toHaveBeenLastCalledWith('foxglove');
    await user.click(screen.getByTestId(`palette-file-${PLAN}`));
    await waitFor(() => expect(openedPath()).toBe(PLAN));
  });
  it('retries a failed local content search without changing its query or scope', async () => {
    installCollectionsApi({ query: vi.fn(async () => ({ success: true as const, data: collectionResult([]) })) });
    const search = vi.fn().mockResolvedValueOnce({ success: true, data: { hits: [], incomplete: false } })
      .mockRejectedValueOnce(new Error('Temporary read failure'))
      .mockResolvedValue({ success: true, data: { hits: [{ path: PLAN, name: 'plan.md', excerpt: 'Found foxglove' }], incomplete: false } });
    window.diskAPI.searchContent = search;
    const user = userEvent.setup();
    renderPalette();
    act(() => usePaletteStore.getState().show());
    await user.type(await screen.findByRole('combobox'), 'foxglove');
    await waitFor(() => expect(search).toHaveBeenCalledWith('foxglove'));
    await user.type(screen.getByRole('combobox'), 's');
    await user.click(await screen.findByRole('button', { name: 'Retry search' }));
    expect(await screen.findByRole('option', { name: /Found foxglove/ })).toBeVisible();
    expect(search).toHaveBeenLastCalledWith('foxgloves');
    expect(screen.getByRole('combobox')).toHaveValue('foxgloves');
  });
  it('distinguishes failed filename search from no matches and allows retry', async () => {
    const query = vi.fn().mockResolvedValueOnce({ success: false, error: 'Unavailable' })
      .mockResolvedValue({ success: true, data: collectionResult([collectionRow({ entry: { path: PLAN, name: 'plan.md', kind: 'markdown' } })]) });
    installCollectionsApi({ query });
    const user = userEvent.setup();
    renderPalette();
    act(() => usePaletteStore.getState().show());
    await user.type(await screen.findByRole('combobox'), 'zzzz');
    expect(await screen.findByRole('alert')).toHaveTextContent('Filename search could not finish.');
    expect(screen.queryByText('Nothing matches “zzzz”')).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Retry search' }));
    expect(await screen.findByTestId(`palette-file-${PLAN}`)).toBeVisible();
  });
  it('discards a slow content response after the query changes', async () => {
    installCollectionsApi({ query: vi.fn(async () => ({ success: true as const, data: collectionResult([]) })) });
    let finish!: (value: unknown) => void;
    const searchContent = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue({ success: true, data: { hits: [], incomplete: false } });
    window.diskAPI.searchContent = searchContent;
    const user = userEvent.setup();
    renderPalette();
    act(() => usePaletteStore.getState().show());
    const input = await screen.findByRole('combobox');
    await user.type(input, 'old');
    await waitFor(() => expect(searchContent).toHaveBeenCalledWith('old'));
    await user.clear(input);
    await user.type(input, 'new');
    await act(async () => finish({ success: true, data: { hits: [{ path: PLAN, name: 'plan.md', excerpt: 'Obsolete result' }], incomplete: false } }));
    expect(screen.queryByText('Obsolete result')).not.toBeInTheDocument();
  });
  it('keeps the keyboard-selected command selected when body results arrive', async () => {
    installCollectionsApi({ query: vi.fn(async () => ({ success: true as const, data: collectionResult([]) })) });
    let finish!: (value: unknown) => void;
    window.diskAPI.searchContent = vi.fn(() => new Promise((resolve) => { finish = resolve; })) as typeof window.diskAPI.searchContent;
    const user = userEvent.setup();
    renderPalette();
    act(() => usePaletteStore.getState().show());
    await user.type(await screen.findByRole('combobox'), 'today');
    await waitFor(() => expect(window.diskAPI.searchContent).toHaveBeenCalled());
    await user.keyboard('{ArrowDown}{ArrowUp}');
    const selected = screen.getAllByRole('option').find((option) => option.getAttribute('aria-selected') === 'true');
    const identity = selected?.getAttribute('data-testid');
    expect(identity).toMatch(/^palette-command-/);
    await act(async () => finish({ success: true, data: { hits: [{ path: PLAN, name: 'plan.md', excerpt: 'Chat about garden plans.' }], incomplete: false } }));
    expect(screen.getByTestId(identity as string)).toHaveAttribute('aria-selected', 'true');
  });
  it('opens with Cmd+K, shows recent files and commands, and Escape closes it', async () => {
    const user = userEvent.setup();
    renderPalette();
    expect(screen.queryByTestId('command-palette')).toBeNull();
    await user.keyboard('{Meta>}k{/Meta}');
    const palette = await screen.findByTestId('command-palette');
    // One line per file: the name as the tree shows it, and no folder at the top of the vault.
    expect(await within(palette).findByTestId('palette-file-/Vault/inbox.md')).toHaveTextContent(/^inbox$/);
    expect(within(palette).getByTestId('palette-command-nav.today')).toHaveTextContent('Go to Today');
    expect(within(palette).getByTestId(`palette-command-${COMMAND_IDS.closeTab}`)).toHaveTextContent('Close tab');
    expect(within(palette).queryByTestId('palette-command-palette.open')).toBeNull();
    expect(within(palette).getByRole('group', { name: 'Recent' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('command-palette')).toBeNull());
  });

  it('searches file names across the vault as you type, folders left out, and opens the chosen one', async () => {
    const api = installCollectionsApi({
      query: vi.fn(async () => ({ success: true as const, data: collectionResult([collectionRow({ entry: { path: PLAN, name: 'plan.md', kind: 'markdown' } })]) })),
    });
    const user = userEvent.setup();
    renderPalette();
    act(() => usePaletteStore.getState().show());
    const input = await screen.findByRole('combobox', { name: 'Search files and commands' });
    await user.type(input, 'pla');
    const file = await screen.findByTestId(`palette-file-${PLAN}`);
    expect(file).toHaveTextContent(/^planProjects\/Atlas$/);
    expect(file).toHaveAttribute('title', 'Projects/Atlas/plan.md');
    expect((api.query as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toMatchObject({
      filters: [{ field: 'name', op: 'contains', value: 'pla' }, { field: 'kind', op: 'not-in', values: ['directory'] }],
      scope: { kind: 'all-roots' },
    });
    await user.keyboard('{Enter}');
    await waitFor(() => expect(openedPath()).toBe(PLAN));
    expect(tabPaths()).toEqual([PLAN]);
    expect(window.activityAPI.record).toHaveBeenCalledWith(PLAN, 'opened');
    expect(screen.queryByTestId('command-palette')).toBeNull();
  });

  it('opens the pick in the current tab, in a new tab with Cmd+Enter, and always in a new tab after New Tab', async () => {
    installCollectionsApi({
      query: vi.fn(async () => ({ success: true as const, data: collectionResult([collectionRow({ entry: { path: PLAN, name: 'plan.md', kind: 'markdown' } })]) })),
    });
    const user = userEvent.setup();
    openTabs(['/Vault/inbox.md']);
    renderPalette();
    act(() => usePaletteStore.getState().show());
    await user.type(await screen.findByRole('combobox'), 'pla');
    await screen.findByTestId(`palette-file-${PLAN}`);
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => expect(tabPaths()).toEqual(['/Vault/inbox.md', PLAN]));

    act(() => commandRegistry.executeCommand(COMMAND_IDS.newTab));
    const palette = await screen.findByTestId('command-palette');
    expect(palette).toHaveTextContent('open in new tab');
    await user.type(within(palette).getByRole('combobox'), 'pla');
    await screen.findByTestId(`palette-file-${PLAN}`);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(tabPaths()).toEqual(['/Vault/inbox.md', PLAN, PLAN]));
  });

  it('asks only for a file after New Tab, and opens Today there in a new tab when asked with >', async () => {
    const user = userEvent.setup();
    window.vaultAPI = {
      discover: vi.fn(async () => ({ success: true as const, data: [{ path: ROOT }] })),
      createDay: vi.fn(async (root: string, date: string) => ({ success: true as const, data: { path: `${root}/Library/daily/${date}.md` } })),
    } as unknown as typeof window.vaultAPI;
    openTabs(['/Vault/inbox.md']);
    renderPalette();
    act(() => commandRegistry.executeCommand(COMMAND_IDS.newTab));
    const palette = await screen.findByTestId('command-palette');
    await within(palette).findByTestId('palette-file-/Vault/inbox.md');
    expect(within(palette).queryByRole('group', { name: 'Commands' })).toBeNull();

    await user.type(within(palette).getByRole('combobox'), '>today');
    await user.click(await within(palette).findByTestId('palette-command-nav.today'));
    await waitFor(() => expect(tabPaths()).toHaveLength(2));
    expect(tabPaths()[0]).toBe('/Vault/inbox.md');
    expect(openedPath()).toMatch(/^\/Vault\/Library\/daily\/\d{4}-\d{2}-\d{2}\.md$/);
  });

  it('limits results to commands after > and runs the selected command', async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.keyboard('{Meta>}{Shift>}p{/Shift}{/Meta}');
    const palette = await screen.findByTestId('command-palette');
    expect(within(palette).getByRole('group', { name: 'Commands' })).toBeInTheDocument();
    await user.type(within(palette).getByRole('combobox'), 'settings');
    await waitFor(() => expect(within(palette).getAllByRole('option')[0]).toHaveTextContent('Settings…'));
    expect(within(palette).queryByRole('group', { name: 'Files' })).toBeNull();
    await user.keyboard('{ArrowDown}{ArrowUp}{Enter}');
    await waitFor(() => expect(useSettingsStore.getState().open).toBe(true));
    expect(screen.getByTestId('location')).toHaveTextContent('/files');
  });

  it('reports every command to main and shows shortcuts', async () => {
    renderPalette();
    const reported = (window.systemAPI.reportCommands as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as { id: string; accelerator?: string }[];
    expect(reported.map((command) => command.id)).toEqual(expect.arrayContaining(['palette.open', 'files.newNote', 'pane.toggleLeft', 'app.openSettings']));
    // Theme lives in Settings only.
    expect(reported.map((command) => command.id)).not.toContain('theme.toggle');
    expect(reported.map((command) => command.id)).not.toContain('privacy.toggle');
    // The folder view is gone, and the command that opened it with it.
    expect(reported.map((command) => command.id)).not.toContain('nav.files');
    expect(reported.map((command) => command.id).filter((id) => id.startsWith('pane.'))).toEqual(['pane.toggleLeft', 'pane.toggleRight']);
    act(() => usePaletteStore.getState().show('>side'));
    const option = await screen.findByTestId('palette-command-pane.toggleLeft');
    expect(option).toHaveTextContent(/⌘\\|Ctrl\+\\/);
    expect(reported.find((command) => command.id === COMMAND_IDS.toggleRightPane)).toMatchObject({
      label: 'Toggle Right Sidebar', accelerator: 'CmdOrCtrl+Shift+\\',
    });
    expect(reported.find((command) => command.id === COMMAND_IDS.nextTab)).toEqual({
      id: COMMAND_IDS.nextTab, label: 'Show Next Tab', accelerator: 'CmdOrCtrl+Shift+]', aliases: ['Ctrl+Tab'],
    });
  });

  it('reports Show Properties on Cmd+Shift+I, and Hide Properties while the block is open', async () => {
    renderPalette();
    const reported = () => ((window.systemAPI.reportCommands as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as { id: string; label: string; accelerator?: string }[])
      .find((command) => command.id === COMMAND_IDS.toggleProperties);
    expect(reported()).toMatchObject({ label: 'Show Properties', accelerator: 'CmdOrCtrl+Shift+I' });
    // The menu sends the command id, as View > Show Properties does.
    act(() => commandRegistry.executeCommand(COMMAND_IDS.toggleProperties));
    expect(usePagePropertiesStore.getState().open).toBe(true);
    await waitFor(() => expect(reported()).toMatchObject({ label: 'Hide Properties', accelerator: 'CmdOrCtrl+Shift+I' }));
    act(() => commandRegistry.executeCommand(COMMAND_IDS.toggleProperties));
    expect(usePagePropertiesStore.getState().open).toBe(false);
    await waitFor(() => expect(reported()?.label).toBe('Show Properties'));
  });

  it('reports Next Section and Previous Section only while a stack is shown', async () => {
    useStackStore.setState({ move: null });
    renderPalette();
    const ids = () => ((window.systemAPI.reportCommands as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as { id: string }[]).map((command) => command.id);
    expect(ids()).not.toContain(COMMAND_IDS.nextSection);
    const move = vi.fn(() => true);
    act(() => useStackStore.getState().setMove(move));
    await waitFor(() => expect(ids()).toEqual(expect.arrayContaining([COMMAND_IDS.nextSection, COMMAND_IDS.previousSection])));
    act(() => commandRegistry.executeCommand(COMMAND_IDS.previousSection));
    expect(move).toHaveBeenCalledWith('previous');
    act(() => useStackStore.getState().setMove(null));
    await waitFor(() => expect(ids()).not.toContain(COMMAND_IDS.previousSection));
  });

  it('offers Pin page for the open file only, and Unpin page once it is pinned', async () => {
    const api = installPinsApi();
    setPins({ [ROOT]: [] });
    renderPalette();
    const pinCommand = () => ((window.systemAPI.reportCommands as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as { id: string; label: string }[])
      .find((command) => command.id === 'page.togglePin');
    expect(pinCommand()).toBeUndefined();
    act(() => openTabs([PLAN]));
    await waitFor(() => expect(pinCommand()?.label).toBe('Pin page'));
    act(() => commandRegistry.executeCommand('page.togglePin'));
    expect(usePinsStore.getState().byRoot[ROOT]).toEqual([PLAN]);
    expect(api.set).toHaveBeenLastCalledWith(ROOT, [PLAN], []);
    await waitFor(() => expect(pinCommand()?.label).toBe('Unpin page'));
    act(() => usePaletteStore.getState().show('>unpin'));
    expect(await screen.findByTestId('palette-command-page.togglePin')).toHaveTextContent('Unpin page');
  });

  it('pins the section in view when a stream of daily pages is shown, not the stream\'s first page', async () => {
    const api = installPinsApi();
    setPins({ [ROOT]: [] });
    const today = '/Vault/Library/daily/2026-10-30.md';
    const monday = '/Vault/Library/daily/2026-10-26.md';
    renderPalette();
    const pinCommand = () => ((window.systemAPI.reportCommands as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as { id: string; label: string }[])
      .find((command) => command.id === 'page.togglePin');
    act(() => openTabs([stackLocation('daily', today)]));
    const tabId = useTabsStore.getState().activeId ?? '';
    act(() => useStackStore.getState().setViewed(tabId, monday));
    act(() => commandRegistry.executeCommand('page.togglePin'));
    expect(usePinsStore.getState().byRoot[ROOT]).toEqual([monday]);
    expect(api.set).toHaveBeenLastCalledWith(ROOT, [monday], []);
    await waitFor(() => expect(pinCommand()?.label).toBe('Unpin page'));
    // Scrolled back to today's page, which is not pinned.
    act(() => useStackStore.getState().setViewed(tabId, today));
    await waitFor(() => expect(pinCommand()?.label).toBe('Pin page'));
    act(() => useStackStore.getState().setViewed(tabId, null));
  });

  it('keeps the tab-position keys out of the palette', async () => {
    renderPalette();
    act(() => usePaletteStore.getState().show('>show'));
    await screen.findByTestId(`palette-command-${COMMAND_IDS.nextTab}`);
    expect(screen.queryByTestId(`palette-command-${TAB_POSITION_COMMAND_IDS[0]}`)).toBeNull();
    expect(screen.queryByTestId(`palette-command-${COMMAND_IDS.lastTab}`)).toBeNull();
  });

  it('runs the tab and history commands the menu sends', () => {
    renderPalette();
    openTabs(['/Vault/a.md', '/Vault/b.md', '/Vault/c.md']);
    const run = (id: string) => act(() => commandRegistry.executeCommand(id));
    run(TAB_POSITION_COMMAND_IDS[1]);
    expect(openedPath()).toBe('/Vault/b.md');
    run(COMMAND_IDS.lastTab);
    expect(openedPath()).toBe('/Vault/c.md');
    run(COMMAND_IDS.nextTab);
    expect(openedPath()).toBe('/Vault/a.md');
    run(COMMAND_IDS.previousTab);
    expect(openedPath()).toBe('/Vault/c.md');
    run(COMMAND_IDS.closeTab);
    expect(tabPaths()).toEqual(['/Vault/a.md', '/Vault/b.md']);
    run(COMMAND_IDS.reopenClosedTab);
    expect(tabPaths()).toEqual(['/Vault/a.md', '/Vault/b.md', '/Vault/c.md']);
    expect(window.systemAPI.closeWindow).not.toHaveBeenCalled();
    resetTabs();
    run(COMMAND_IDS.closeTab);
    expect(window.systemAPI.closeWindow).toHaveBeenCalledTimes(1);
  });
});
