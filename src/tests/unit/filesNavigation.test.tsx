import userEvent from '@testing-library/user-event';
import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { FilesRoute } from '@/renderer/features/disk-explorer/components/FilesRoute';
import { NameDialog } from '@/renderer/features/disk-explorer/components/dialogs/NameDialog';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { filesLocationSnapshots } from '@/renderer/features/disk-explorer/navigation/filesLocationSnapshots';
import { pathMutationCoordinator } from '@/renderer/features/disk-explorer/navigation/pathMutationCoordinator';
import { fileLocation } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { entry, installDiskApi } from '@/tests/helpers/diskApi';
import { installActivityApi } from '@/tests/helpers/activityApi';
import { openedPath, resetTabs, tabPaths } from '@/tests/helpers/tabs';
const ROOT = '/Vault',
  FOLDER = '/Vault/References',
  NOTE = '/Vault/brief.md';
const items = [
  entry({
    path: FOLDER,
    name: 'References',
    kind: 'directory',
    isDirectory: true,
  }),
  entry({
    path: '/Vault/Other',
    name: 'Other',
    kind: 'directory',
    isDirectory: true,
  }),
  entry({ path: NOTE, name: 'brief.md', kind: 'markdown' }),
];
/** Back and Forward walk the active tab's history, as the top row's buttons do. */
function Harness() {
  const location = useLocation();
  return (
    <>
      <button onClick={() => useTabsStore.getState().back()}>Back</button>
      <button onClick={() => useTabsStore.getState().forward()}>Forward</button>
      <output data-testid="location">{location.search}</output>
      <FilesRoute />
      <NameDialog />
    </>
  );
}
async function setup(search = '?mode=browse&dir=%2FVault') {
  render(
    <MemoryRouter initialEntries={['/files' + search]}>
      <Harness />
    </MemoryRouter>
  );
  await waitFor(() =>
    expect(useDiskStore.getState().currentDirectory).toBe(ROOT)
  );
  await waitFor(() =>
    expect(useDiskStore.getState().listings[ROOT]).toBeDefined()
  );
}
const item = (path: string) => screen.getByTestId('disk-folder-entry-' + path);
beforeEach(() => {
  localStorage.clear();
  filesLocationSnapshots.clear();
  installActivityApi();
  installDiskApi({
    listRoots: vi.fn(async () => ({ success: true as const, data: [ROOT] })),
    readDirectory: vi.fn(async (path) => ({
      success: true as const,
      data: { path, entries: path === ROOT ? items : [] },
    })),
  });
  useDiskStore.setState({
    roots: [],
    listings: {},
    currentDirectory: null,
    selectedPath: null,
    selectedPaths: [],
    focusedPath: null,
    filter: '',
    pendingAction: null,
    pendingDelete: null,
    quickPreviewPath: null,
    isQuickLookOpen: false,
    isPreviewPaneOpen: false,
    loading: { isLoading: false, error: null },
  });
  resetTabs();
});
it('selects folders without navigating and supports multiple folder selection', async () => {
  await setup();
  // A plain click opens a folder; ⌘-click only selects it, as in Finder.
  fireEvent.click(item(FOLDER), { metaKey: true });
  expect(useDiskStore.getState().currentDirectory).toBe(ROOT);
  expect(item(NOTE)).toBeVisible();
  fireEvent.click(item('/Vault/Other'), { ctrlKey: true });
  expect(useDiskStore.getState().selectedPaths).toEqual([
    FOLDER,
    '/Vault/Other',
  ]);
  expect(openedPath()).toBeNull();
});
it('shows the selected file in an explicitly opened preview without a tab or route change', async () => {
  await setup();
  fireEvent.click(item(NOTE), { metaKey: true });
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  expect(screen.getByTestId('detail-title')).toHaveTextContent('brief.md');
  expect(openedPath()).toBeNull();
  expect(screen.getByTestId('location')).toHaveTextContent('mode=browse');
});
it('opens a folder explicitly and Back restores its selection', async () => {
  await setup();
  fireEvent.click(item(FOLDER), { metaKey: true });
  fireEvent.doubleClick(item(FOLDER));
  await waitFor(() =>
    expect(useDiskStore.getState().currentDirectory).toBe(FOLDER)
  );
  fireEvent.click(screen.getByText('Back'));
  await waitFor(() =>
    expect(useDiskStore.getState().selectedPaths).toEqual([FOLDER])
  );
  expect(item(NOTE)).toBeVisible();
  fireEvent.click(screen.getByText('Forward'));
  await waitFor(() =>
    expect(useDiskStore.getState().currentDirectory).toBe(FOLDER)
  );
});
it('an explicit file open replaces the folder in its tab and Back restores the selection', async () => {
  await setup();
  fireEvent.click(item(NOTE), { metaKey: true });
  fireEvent.doubleClick(item(NOTE));
  await screen.findByTestId('files-focus');
  expect(screen.queryByTestId('disk-folder-list')).toBeNull();
  expect(tabPaths()).toEqual([NOTE]);
  fireEvent.click(screen.getByText('Back'));
  await waitFor(() =>
    expect(item(NOTE)).toHaveAttribute('aria-pressed', 'true')
  );
});
it('Cmd+Down opens while Space previews and Return renames', async () => {
  await setup();
  fireEvent.click(item(NOTE), { metaKey: true });
  fireEvent.keyDown(item(NOTE), { key: ' ', code: 'Space' });
  expect(useDiskStore.getState().isQuickLookOpen).toBe(true);
  expect(openedPath()).toBeNull();
  act(() => useDiskStore.getState().closeQuickLook());
  fireEvent.keyDown(item(NOTE), { key: 'Enter' });
  expect(useDiskStore.getState().pendingAction?.kind).toBe('rename');
  act(() => useDiskStore.setState({ pendingAction: null }));
  fireEvent.keyDown(item(NOTE), { key: 'ArrowDown', metaKey: true });
  await screen.findByTestId('files-focus');
});
it('breadcrumbs navigate through history', async () => {
  await setup();
  fireEvent.doubleClick(item(FOLDER));
  await waitFor(() =>
    expect(useDiskStore.getState().currentDirectory).toBe(FOLDER)
  );
  fireEvent.click(screen.getByTestId('crumb-' + ROOT));
  await waitFor(() =>
    expect(useDiskStore.getState().currentDirectory).toBe(ROOT)
  );
  fireEvent.click(screen.getByText('Back'));
  await waitFor(() =>
    expect(useDiskStore.getState().currentDirectory).toBe(FOLDER)
  );
});
it.each(['list', 'gallery'])(
  'restores the actual %s viewport after a folder round trip',
  async (mode) => {
    const many = Array.from({ length: 100 }, (_, i) =>
      entry({ path: `/Vault/${i}.png`, name: `${i}.png`, kind: 'image' })
    );
    window.diskAPI.readDirectory = vi.fn(async (path) => ({
      success: true as const,
      data: { path, entries: path === ROOT ? [...items, ...many] : [] },
    }));
    await setup();
    fireEvent.click(screen.getByTestId('disk-folder-view-' + mode));
    const viewport = screen.getByTestId('disk-folder-' + mode)
      .firstElementChild as HTMLElement;
    Object.defineProperties(viewport, {
      scrollHeight: { value: 10000 },
      clientHeight: { value: 600 },
    });
    act(() => useDiskStore.getState().select(FOLDER));
    fireEvent.scroll(viewport, { target: { scrollTop: 480 } });
    fireEvent.keyDown(screen.getByTestId('disk-folder-' + mode), {
      key: 'ArrowDown',
      metaKey: true,
    });
    await waitFor(() =>
      expect(useDiskStore.getState().currentDirectory).toBe(FOLDER)
    );
    fireEvent.click(screen.getByText('Back'));
    await waitFor(() =>
      expect(
        (
          screen.getByTestId('disk-folder-' + mode)
            .firstElementChild as HTMLElement
        ).scrollTop
      ).toBe(480)
    );
  }
);
it('replaces the live focused URL on rename and clears removed focus', async () => {
  await setup();
  fireEvent.doubleClick(item(NOTE));
  await screen.findByTestId('files-focus');
  act(() => {
    pathMutationCoordinator.applyAppMutation({
      kind: 'rename',
      oldPath: NOTE,
      newPath: '/Vault/renamed.md',
    });
  });
  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent(
      'file=%2FVault%2Frenamed.md'
    )
  );
  act(() => {
    pathMutationCoordinator.applyExternalRemoval(['/Vault/renamed.md']);
  });
  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent('mode=browse')
  );
  expect(screen.queryByTestId('files-focus')).toBeNull();
});
it('switching and closing tabs moves the URL without a history step', async () => {
  await setup();
  fireEvent.doubleClick(item(NOTE));
  await screen.findByTestId('files-focus');
  const [noteTab] = useTabsStore.getState().tabs;
  act(() =>
    useTabsStore.getState().open(fileLocation('/Vault/second.txt'), { newTab: true })
  );
  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent(
      'file=%2FVault%2Fsecond.txt'
    )
  );
  act(() => useTabsStore.getState().activate(noteTab.id));
  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent(
      'file=%2FVault%2Fbrief.md'
    )
  );
  act(() => useTabsStore.getState().close(noteTab.id));
  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent(
      'file=%2FVault%2Fsecond.txt'
    )
  );
  // The closed tab is not in any history: Back has nowhere to go.
  fireEvent.click(screen.getByText('Back'));
  expect(tabPaths()).toEqual(['/Vault/second.txt']);
  act(() => useTabsStore.getState().closeAll());
  await screen.findByTestId('no-page-open');
  expect(screen.getByTestId('location').textContent).toBe('');
});
it('ignores late focused-file stat responses and never falls back to a selected file', async () => {
  let finishA: (
    result: Awaited<ReturnType<typeof window.diskAPI.stat>>
  ) => void = () => undefined;
  window.diskAPI.stat = vi.fn((path) =>
    path === '/Vault/a.txt'
      ? new Promise<Awaited<ReturnType<typeof window.diskAPI.stat>>>(
          (resolve) => {
            finishA = resolve;
          }
        )
      : Promise.resolve({ success: false as const, error: 'Missing' })
  );
  await setup();
  fireEvent.click(item(NOTE), { metaKey: true });
  act(() => useTabsStore.getState().open(fileLocation('/Vault/a.txt'), { newTab: true }));
  await screen.findByTestId('files-focus');
  act(() => useTabsStore.getState().open(fileLocation('/Vault/b.txt'), { newTab: true }));
  await screen.findByText('File unavailable');
  act(() =>
    finishA({
      success: true,
      data: entry({ path: '/Vault/a.txt', name: 'a.txt', kind: 'text' }),
    })
  );
  await waitFor(() => expect(screen.queryByTestId('detail-title')).toBeNull());
  expect(screen.getByText('File unavailable')).toBeVisible();
});
it('updates the live route when a folder subtree moves', async () => {
  await setup();
  fireEvent.doubleClick(item(FOLDER));
  await waitFor(() =>
    expect(useDiskStore.getState().currentDirectory).toBe(FOLDER)
  );
  act(() => {
    pathMutationCoordinator.applyAppMutation({
      kind: 'move',
      oldPath: FOLDER,
      newPath: '/Vault/Moved',
    });
  });
  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent(
      'dir=%2FVault%2FMoved'
    )
  );
  expect(useDiskStore.getState().currentDirectory).toBe('/Vault/Moved');
});
it('closed roots clear the live focused surface', async () => {
  await setup();
  fireEvent.doubleClick(item(NOTE));
  await screen.findByTestId('files-focus');
  await act(async () => {
    await useDiskStore.getState().closeRoot(ROOT);
  });
  await waitFor(() => expect(screen.queryByTestId('files-focus')).toBeNull());
  expect(useDiskStore.getState().currentDirectory).toBeNull();
  expect(screen.getByTestId('location').textContent).toBe('');
});
it('shortcuts respect independent controls, contenteditable and handled events', async () => {
  await setup();
  fireEvent.click(item(NOTE), { metaKey: true });
  for (const target of [
    screen.getByText('Back'),
    Object.assign(document.createElement('div'), { contentEditable: 'true' }),
  ]) {
    if (!target.isConnected) document.body.append(target);
    fireEvent.keyDown(target, { key: 'ArrowDown', metaKey: true });
    fireEvent.keyDown(target, { key: ' ', code: 'Space' });
    fireEvent.keyDown(target, { key: 'Delete' });
  }
  expect(openedPath()).toBeNull();
  expect(useDiskStore.getState().pendingDelete).toBeNull();
  expect(useDiskStore.getState().isQuickLookOpen).toBe(false);
});
it('a successful rename dialog remaps the route and cached selection', async () => {
  await setup();
  fireEvent.doubleClick(item(NOTE));
  await screen.findByTestId('files-focus');
  window.diskAPI.rename = vi.fn(async () => ({
    success: true as const,
    data: { path: '/Vault/new.md' },
  }));
  act(() => useDiskStore.getState().beginRename(NOTE));
  fireEvent.change(screen.getByTestId('name-dialog-input'), {
    target: { value: 'new.md' },
  });
  fireEvent.click(screen.getByTestId('name-dialog-submit'));
  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent(
      'file=%2FVault%2Fnew.md'
    )
  );
});
it('external listing removal clears the focused file route', async () => {
  await setup();
  fireEvent.doubleClick(item(NOTE));
  await screen.findByTestId('files-focus');
  window.diskAPI.readDirectory = vi.fn(async (path) => ({
    success: true as const,
    data: { path, entries: items.filter((item) => item.path !== NOTE) },
  }));
  await act(async () => {
    await useDiskStore.getState().invalidate([ROOT]);
  });
  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent('mode=browse')
  );
});
it('successful drag move remaps the file in the tab history', async () => {
  await setup();
  fireEvent.doubleClick(item(NOTE));
  await screen.findByTestId('files-focus');
  fireEvent.click(screen.getByText('Back'));
  await waitFor(() => expect(item(FOLDER)).toBeVisible());
  window.diskAPI.move = vi.fn(async () => ({
    success: true as const,
    data: { path: FOLDER + '/brief.md' },
  }));
  fireEvent.drop(item(FOLDER), { dataTransfer: { getData: () => NOTE } });
  await waitFor(() =>
    expect(useTabsStore.getState().tabs[0].history[1].location).toEqual(
      fileLocation(FOLDER + '/brief.md')
    )
  );
  fireEvent.click(screen.getByText('Forward'));
  await waitFor(() => expect(openedPath()).toBe(FOLDER + '/brief.md'));
});
it('finishes initial loading when URL canonicalization happens during a delayed listing', async () => {
  let finish: (
    value: Awaited<ReturnType<typeof window.diskAPI.readDirectory>>
  ) => void = () => undefined;
  window.diskAPI.readDirectory = vi.fn(
    () =>
      new Promise<Awaited<ReturnType<typeof window.diskAPI.readDirectory>>>(
        (resolve) => {
          finish = resolve;
        }
      )
  );
  render(
    <MemoryRouter initialEntries={['/files?mode=browse&dir=%2FVault']}>
      <Harness />
    </MemoryRouter>
  );
  await screen.findByText('Loading…');
  await act(async () => {
    finish({ success: true, data: { path: ROOT, entries: items } });
  });
  await waitFor(() => expect(item(NOTE)).toBeVisible());
});
it('Quick Preview is modeless and leaves the collection available', async () => {
  await setup();
  fireEvent.click(item(NOTE), { metaKey: true });
  fireEvent.keyDown(item(NOTE), { key: ' ', code: 'Space' });
  expect(screen.getByRole('dialog', { name: 'brief.md' })).toHaveAttribute(
    'aria-modal',
    'false'
  );
  fireEvent.click(item(FOLDER), { metaKey: true });
  expect(useDiskStore.getState().currentDirectory).toBe(ROOT);
});
it('activates tabs in another allowed root using that file’s folder', async () => {
  window.diskAPI.listRoots = vi.fn(async () => ({
    success: true as const,
    data: [ROOT, '/Second'],
  }));
  await setup();
  act(() => useTabsStore.getState().open(fileLocation('/Second/a.txt'), { newTab: true }));
  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent(
      'mode=focus&dir=%2FSecond&file=%2FSecond%2Fa.txt'
    )
  );
});

it.each(['list', 'gallery'])(
  'keeps the %s row DOM mounted when selection changes',
  async (mode) => {
    const user = userEvent.setup();
    await setup();
    await user.click(screen.getByTestId('disk-folder-view-' + mode));
    const row = item(FOLDER);
    await user.keyboard('{Meta>}');
    await user.click(row);
    await user.keyboard('{/Meta}');
    expect(item(FOLDER)).toBe(row);
    expect(row).toHaveFocus();
  }
);
it.each([
  ['list', FOLDER],
  ['gallery', FOLDER],
  ['list', NOTE],
  ['gallery', NOTE],
])(
  'opens a selected item through a real double-click sequence in %s: %s',
  async (mode, path) => {
    const user = userEvent.setup();
    await setup();
    await user.click(screen.getByTestId('disk-folder-view-' + mode));
    await user.dblClick(item(path));
    if (path === FOLDER) await screen.findByTestId('disk-folder-empty');
    else await screen.findByTestId('files-focus');
  }
);
it('keeps Browse active when an unrelated cached sibling disappears after going back from a file', async () => {
  await setup();
  fireEvent.doubleClick(item(NOTE));
  await screen.findByTestId('files-focus');
  fireEvent.click(screen.getByText('Back'));
  await screen.findByTestId('disk-folder-list');
  window.diskAPI.readDirectory = vi.fn(async (path) => ({
    success: true as const,
    data: { path, entries: items.filter((entry) => entry.path !== FOLDER) },
  }));
  await act(async () => {
    await useDiskStore.getState().invalidate([ROOT]);
  });
  expect(openedPath()).toBeNull();
  expect(useTabsStore.getState().tabs[0].history[1].location).toEqual(fileLocation(NOTE));
  expect(screen.getByTestId('disk-folder-list')).toBeVisible();
  expect(screen.queryByTestId('files-focus')).toBeNull();
  expect(screen.getByTestId('location')).toHaveTextContent('mode=browse');
});
it.each(['list', 'gallery'])(
  'selection keeps %s pane allocation unchanged until Preview is explicitly toggled',
  async (mode) => {
    await setup();
    fireEvent.click(screen.getByTestId('disk-folder-view-' + mode));
    const handlesBeforeSelection = screen.queryAllByRole('separator').length;
    fireEvent.click(item(NOTE), { metaKey: true });
    expect(screen.queryAllByRole('separator')).toHaveLength(
      handlesBeforeSelection
    );
    expect(screen.queryByTestId('detail-title')).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Preview' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('region', { name: 'Selected item preview' })
    ).toBeVisible();
    const handlesWithPreview = screen.queryAllByRole('separator').length;
    expect(handlesWithPreview).toBe(handlesBeforeSelection + 1);
    act(() => useDiskStore.getState().clearSelection());
    expect(screen.queryAllByRole('separator')).toHaveLength(handlesWithPreview);
    expect(screen.getByTestId('detail-empty')).toBeVisible();
    fireEvent.doubleClick(item(FOLDER));
    await screen.findByTestId('disk-folder-empty');
    expect(
      screen.getByRole('button', { name: 'Preview' })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('region', { name: 'Selected item preview' })
    ).toBeVisible();
    expect(screen.queryAllByRole('separator')).toHaveLength(handlesWithPreview);
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview' })
    );
    expect(
      screen.queryByRole('region', { name: 'Selected item preview' })
    ).toBeNull();
  }
);

it('records explicit opens and navigations but not restoration or Back', async () => {
  const api = window.activityAPI;
  await setup();
  expect(api.record).not.toHaveBeenCalled();
  const user = userEvent.setup();
  await user.dblClick(item(FOLDER));
  await waitFor(() => expect(useDiskStore.getState().currentDirectory).toBe(FOLDER));
  expect(api.record).toHaveBeenCalledWith(FOLDER, 'opened');
  await user.click(screen.getByRole('button', { name: 'Back' }));
  await waitFor(() => expect(useDiskStore.getState().currentDirectory).toBe(ROOT));
  await waitFor(() => expect(screen.queryByTestId('disk-folder-entry-' + NOTE)).toBeInTheDocument());
  await user.dblClick(item(NOTE));
  await waitFor(() => expect(openedPath()).toBe(NOTE));
  expect(api.record).toHaveBeenCalledWith(NOTE, 'opened');
  await user.click(screen.getByRole('button', { name: 'Back' }));
  await waitFor(() => expect(openedPath()).toBeNull());
  expect(api.record).toHaveBeenCalledTimes(2);
});
