import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AppCommands, CommandPalette, usePaletteStore } from '@/renderer/features/commands';
import { commandRegistry } from '@/renderer/features/commands/services/commandRegistry';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { ShellProvider } from '@/renderer/features/shell';
import { ThemeProvider } from '@/renderer/features/theme';
import { TooltipProvider } from '@/renderer/shared/ui';
import { installActivityApi, recentResult } from '@/tests/helpers/activityApi';
import { collectionResult, collectionRow, installCollectionsApi } from '@/tests/helpers/collectionsApi';
import { entry, installDiskApi } from '@/tests/helpers/diskApi';
import { installChatApi } from '@/tests/helpers/chatApi';

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
          <ShellProvider routes={[{ path: '/files', element: null, handle: { shell: { id: 'files', header: { title: 'Files' } } } }, { path: '/chat', element: null, handle: { shell: { id: 'chat', header: { title: 'Chat' } } } }]} fallbackRoute={{ id: 'opal', header: { title: 'Opal' } }}>
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
  usePaletteStore.setState({ open: false, initialQuery: '' });
  for (const command of commandRegistry.getAllCommands()) commandRegistry.unregisterCommand(command);
  (window as unknown as { systemAPI: unknown }).systemAPI = { reportCommands: vi.fn(), onMenuCommand: vi.fn(() => () => undefined) };
  installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: [ROOT] })) });
  installActivityApi({ recent: vi.fn(async () => ({ success: true as const, data: recentResult([{ entry: entry({ path: '/Vault/inbox.md', name: 'inbox.md', kind: 'markdown' }), touchedAt: Date.now() - 60_000, touchedKind: 'opened', openedAt: Date.now() - 60_000, organizedAt: null, editedAt: null }]) })) });
  installChatApi();
  useDiskStore.setState({ roots: [ROOT], currentDirectory: ROOT });
});

describe('CommandPalette', () => {
  it('adds body matches with snippets and offers a deeper local search', async () => {
    installCollectionsApi({ query: vi.fn(async () => ({ success: true as const, data: collectionResult([]) })) });
    const searchContent = vi.fn(async () => ({ success: true as const, data: { hits: [{ path: PLAN, name: 'plan.md', excerpt: 'Plant foxglove in the garden.' }], incomplete: false } }));
    window.chatAPI.searchContent = searchContent;
    const user = userEvent.setup();
    renderPalette();
    act(() => usePaletteStore.getState().show());
    await user.type(await screen.findByRole('combobox'), 'foxglove');
    expect(await screen.findByText('Plant foxglove in the garden.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Search current text files' }));
    await waitFor(() => expect(searchContent).toHaveBeenLastCalledWith('foxglove', true));
    await user.click(screen.getByTestId(`palette-file-${PLAN}`));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`file=${encodeURIComponent(PLAN)}`));
  });
  it('discards a slow content response after the query changes', async () => {
    installCollectionsApi({ query: vi.fn(async () => ({ success: true as const, data: collectionResult([]) })) });
    let finish!: (value: unknown) => void;
    const searchContent = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue({ success: true, data: { hits: [], incomplete: false } });
    window.chatAPI.searchContent = searchContent;
    const user = userEvent.setup();
    renderPalette();
    act(() => usePaletteStore.getState().show());
    const input = await screen.findByRole('combobox');
    await user.type(input, 'old');
    await waitFor(() => expect(searchContent).toHaveBeenCalledWith('old', false));
    await user.clear(input);
    await user.type(input, 'new');
    await act(async () => finish({ success: true, data: { hits: [{ path: PLAN, name: 'plan.md', excerpt: 'Obsolete result' }], incomplete: false } }));
    expect(screen.queryByText('Obsolete result')).not.toBeInTheDocument();
  });
  it('opens with Cmd+K, shows recent files and commands, and Escape closes it', async () => {
    const user = userEvent.setup();
    renderPalette();
    expect(screen.queryByTestId('command-palette')).toBeNull();
    await user.keyboard('{Meta>}k{/Meta}');
    const palette = await screen.findByTestId('command-palette');
    expect(await within(palette).findByTestId('palette-file-/Vault/inbox.md')).toHaveTextContent('Opened 1 minute ago');
    expect(within(palette).getByTestId('palette-command-nav.chat')).toBeInTheDocument();
    expect(within(palette).getByRole('group', { name: 'Recent' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('command-palette')).toBeNull());
  });

  it('searches files across the library as you type and opens the chosen one', async () => {
    const api = installCollectionsApi({
      query: vi.fn(async () => ({ success: true as const, data: collectionResult([collectionRow({ entry: { path: PLAN, name: 'plan.md', kind: 'markdown' } })]) })),
    });
    const user = userEvent.setup();
    renderPalette();
    act(() => usePaletteStore.getState().show());
    const input = await screen.findByRole('combobox', { name: 'Search files and commands' });
    await user.type(input, 'pla');
    const file = await screen.findByTestId(`palette-file-${PLAN}`);
    expect(file).toHaveTextContent('Vault › Projects › Atlas');
    expect((api.query as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toMatchObject({ filters: [{ field: 'name', op: 'contains', value: 'pla' }], scope: { kind: 'all-roots' } });
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`file=${encodeURIComponent(PLAN)}`));
    expect(window.activityAPI.record).toHaveBeenCalledWith(PLAN, 'opened');
    expect(screen.queryByTestId('command-palette')).toBeNull();
  });

  it('limits results to commands after > and runs the selected command', async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.keyboard('{Meta>}{Shift>}p{/Shift}{/Meta}');
    const palette = await screen.findByTestId('command-palette');
    expect(within(palette).getByRole('group', { name: 'Commands' })).toBeInTheDocument();
    await user.type(within(palette).getByRole('combobox'), 'chat');
    await waitFor(() => expect(within(palette).getAllByRole('option')[0]).toHaveTextContent('Go to Threads'));
    expect(within(palette).queryByRole('group', { name: 'Files' })).toBeNull();
    await user.keyboard('{ArrowDown}{ArrowUp}{Enter}');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/chat'));
  });

  it('reports every command to main and shows shortcuts', async () => {
    renderPalette();
    const reported = (window.systemAPI.reportCommands as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as { id: string; accelerator?: string }[];
    expect(reported.map((command) => command.id)).toEqual(expect.arrayContaining(['palette.open', 'files.newNote', 'theme.toggle', 'pane.toggleLeft', 'app.openSettings']));
    act(() => usePaletteStore.getState().show('>side'));
    const option = await screen.findByTestId('palette-command-pane.toggleLeft');
    expect(option).toHaveTextContent(/⌘B|Ctrl\+B/);
  });
});
