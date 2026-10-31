import * as React from 'react';
import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { FilesRoute } from '@/renderer/features/disk-explorer/components/FilesRoute';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { FileTree, ShellProvider } from '@/renderer/features/shell';
import { TooltipProvider } from '@/renderer/shared/ui';
import { entry, installDiskApi } from '@/tests/helpers/diskApi';
import { installActivityApi } from '@/tests/helpers/activityApi';
import { installCollectionsApi } from '@/tests/helpers/collectionsApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';
import type { DiskEntry } from '@/types/disk';
import { openedPath, resetTabs, tabPaths } from '@/tests/helpers/tabs';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: toastError }) }));

const ROOT = '/Vault';
const LIBRARY = '/Vault/Library';
const BOOKS = '/Vault/Library/Books';
const BOOK = '/Vault/Library/Books/Dune.md';
const README = '/Vault/README.md';
const NOTES = '/Vault/notes.md';

const LISTINGS: Record<string, DiskEntry[]> = {
  [ROOT]: [
    entry({ path: LIBRARY, name: 'Library', kind: 'directory', isDirectory: true }),
    entry({ path: README, name: 'README.md', kind: 'markdown' }),
    entry({ path: NOTES, name: 'notes.md', kind: 'markdown' }),
  ],
  [LIBRARY]: [
    entry({ path: BOOKS, name: 'Books', kind: 'directory', isDirectory: true }),
  ],
  [BOOKS]: [entry({ path: BOOK, name: 'Dune.md', kind: 'markdown' })],
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function renderTree(initialPath = '/files') {
  return render(
    <MemoryRouter
      initialEntries={[initialPath]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <TooltipProvider>
        <ShellProvider>
          <div className="h-[600px] w-[260px]">
            <FileTree />
          </div>
          <LocationProbe />
          <FilesRoute />
        </ShellProvider>
      </TooltipProvider>
    </MemoryRouter>
  );
}

const row = (path: string) => screen.getByTestId(`disk-tree-item-${path}`);

/** happy-dom has no DataTransfer, so supply the minimum the handlers use. */
function dataTransfer(payload = '') {
  const store: Record<string, string> = { 'text/plain': payload };
  return {
    setData: (type: string, value: string) => {
      store[type] = value;
    },
    getData: (type: string) => store[type] ?? '',
    dropEffect: 'none',
    effectAllowed: 'all',
  };
}

beforeEach(() => {
  window.localStorage.clear();
  toastError.mockClear();
  installActivityApi();
  installCollectionsApi();
  installMarkdownApi();
  installDiskApi({
    listRoots: vi.fn(async () => ({ success: true as const, data: [ROOT] })),
    readDirectory: vi.fn(async (path: string) => ({
      success: true as const,
      data: { path, entries: LISTINGS[path] ?? [] },
    })),
    stat: vi.fn(async (path: string) => ({
      success: true as const,
      data: entry({ path, name: path.split('/').pop() ?? path, kind: 'markdown' }),
    })),
    rename: vi.fn(async (path: string, name: string) => ({
      success: true as const,
      data: { path: `${path.slice(0, path.lastIndexOf('/'))}/${name}` },
    })),
    move: vi.fn(async (source: string, destination: string) => ({
      success: true as const,
      data: { path: `${destination}/${source.split('/').pop()}` },
    })),
  });
  resetTabs();
  useDiskStore.setState({
    roots: [ROOT],
    listings: { [ROOT]: LISTINGS[ROOT] },
    expanded: {},
    pendingAction: null,
    pendingDelete: null,
    loading: { isLoading: false, error: null },
  });
});

describe('FileTree', () => {
  it('lists a lone root by its children, folders first, Markdown without .md', () => {
    renderTree();
    const tree = screen.getByRole('tree', { name: 'Files' });
    expect(
      within(tree).getAllByRole('treeitem').map((item) => item.textContent)
    ).toEqual(['Library', 'README', 'notes']);
    expect(screen.queryByTestId(`disk-tree-item-${ROOT}`)).toBeNull();
    expect(row(LIBRARY)).toHaveAttribute('aria-expanded', 'false');
    expect(row(LIBRARY)).toHaveAttribute('aria-level', '1');
    expect(row(README)).not.toHaveAttribute('aria-expanded');
  });

  it('toggles a folder on click and never navigates', async () => {
    const user = userEvent.setup();
    renderTree();
    const before = screen.getByTestId('location').textContent;

    await user.click(row(LIBRARY));
    expect(await screen.findByTestId(`disk-tree-item-${BOOKS}`)).toHaveAttribute('aria-level', '2');
    expect(row(LIBRARY)).toHaveAttribute('aria-expanded', 'true');
    expect(window.diskAPI.readDirectory).toHaveBeenCalledWith(LIBRARY);
    expect(screen.getByTestId('location').textContent).toBe(before);

    await user.click(row(LIBRARY));
    expect(screen.queryByTestId(`disk-tree-item-${BOOKS}`)).toBeNull();
  });

  it('opens a file in the current tab, and in a new tab with Cmd+click or middle-click', async () => {
    const user = userEvent.setup();
    renderTree();

    await user.click(row(README));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        `file=${encodeURIComponent(README)}`
      )
    );
    expect(tabPaths()).toEqual([README]);
    expect(row(README)).toHaveAttribute('aria-selected', 'true');
    expect(window.activityAPI.record).toHaveBeenCalledWith(README, 'opened');

    await user.click(row(NOTES));
    await waitFor(() => expect(openedPath()).toBe(NOTES));
    expect(tabPaths()).toEqual([NOTES]);
    expect(useTabsStore.getState().tabs[0].history).toHaveLength(2);

    await user.keyboard('{Meta>}');
    await user.click(row(README));
    await user.keyboard('{/Meta}');
    await waitFor(() => expect(tabPaths()).toEqual([NOTES, README]));

    fireEvent(row(NOTES), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    await waitFor(() => expect(tabPaths()).toEqual([NOTES, README, NOTES]));
    expect(openedPath()).toBe(NOTES);
  });

  it('reveals and highlights a file opened from outside the tree', async () => {
    renderTree(
      `/files?mode=focus&dir=${encodeURIComponent(BOOKS)}&file=${encodeURIComponent(BOOK)}`
    );

    const book = await screen.findByTestId(`disk-tree-item-${BOOK}`);
    expect(book).toHaveAttribute('aria-selected', 'true');
    expect(book).toHaveAttribute('aria-level', '3');
    expect(useDiskStore.getState().expanded).toMatchObject({
      [LIBRARY]: true,
      [BOOKS]: true,
    });
    expect(book).toHaveAttribute('tabindex', '0');
  });

  it('follows the WAI-ARIA tree keys', async () => {
    const user = userEvent.setup();
    renderTree();
    act(() => row(LIBRARY).focus());

    await user.keyboard('{ArrowRight}');
    const books = await screen.findByTestId(`disk-tree-item-${BOOKS}`);
    expect(row(LIBRARY)).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(books).toHaveFocus());

    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(row(LIBRARY)).toHaveFocus());
    // Left at the top level does nothing; Left on an open folder closes it.
    await user.keyboard('{ArrowLeft}');
    expect(screen.queryByTestId(`disk-tree-item-${BOOKS}`)).toBeNull();
    await user.keyboard('{ArrowLeft}');
    expect(row(LIBRARY)).toHaveFocus();

    await user.keyboard('{End}');
    await waitFor(() => expect(row(NOTES)).toHaveFocus());
    expect(row(NOTES)).toHaveAttribute('tabindex', '0');
    expect(row(LIBRARY)).toHaveAttribute('tabindex', '-1');
    await user.keyboard('{ArrowUp}');
    await waitFor(() => expect(row(README)).toHaveFocus());
    await user.keyboard('{Home}');
    await waitFor(() => expect(row(LIBRARY)).toHaveFocus());

    // Type-ahead jumps by label.
    await user.keyboard('n');
    await waitFor(() => expect(row(NOTES)).toHaveFocus());

    await user.keyboard('{Enter}');
    await waitFor(() => expect(openedPath()).toBe(NOTES));
  });

  it('renames inline, keeping the hidden .md', async () => {
    const user = userEvent.setup();
    renderTree();

    await user.pointer({ keys: '[MouseRight]', target: row(README) });
    const menu = await screen.findByTestId('file-tree-menu');
    await user.click(within(menu).getByRole('menuitem', { name: 'Rename' }));

    const input = await screen.findByTestId('file-tree-rename');
    expect(input).toHaveValue('README');
    await waitFor(() => expect(input).toHaveFocus());
    await user.clear(input);
    await user.type(input, 'Start here{Enter}');

    await waitFor(() =>
      expect(window.diskAPI.rename).toHaveBeenCalledWith(README, 'Start here.md')
    );
    await waitFor(() =>
      expect(screen.getByTestId('disk-tree-item-/Vault/Start here.md')).toHaveTextContent(
        'Start here'
      )
    );
  });

  it('shows daily pages by year, renames one by its file name, and gives a year row its folder’s menu', async () => {
    const user = userEvent.setup();
    const daily = `${LIBRARY}/daily`;
    const page = `${daily}/2026-10-30.md`;
    useDiskStore.setState({
      listings: {
        [ROOT]: LISTINGS[ROOT],
        [LIBRARY]: [entry({ path: daily, name: 'daily', kind: 'directory', isDirectory: true })],
        [daily]: [entry({ path: page, name: '2026-10-30.md', kind: 'markdown' })],
      },
      expanded: { [LIBRARY]: true, [daily]: true, [`${daily}/2026`]: true },
    });
    renderTree();

    expect(row(`${daily}/2026`)).toHaveTextContent('2026');
    expect(row(`${daily}/2026`)).not.toHaveAttribute('draggable');
    expect(row(page)).toHaveTextContent('10-30 Fri');

    await user.pointer({ keys: '[MouseRight]', target: row(`${daily}/2026`) });
    const yearMenu = await screen.findByTestId('file-tree-menu');
    expect(within(yearMenu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'New note',
      'New folder',
      'Reveal in Finder',
    ]);
    await user.click(within(yearMenu).getByRole('menuitem', { name: 'New folder' }));
    expect(useDiskStore.getState().pendingAction).toEqual({ kind: 'new-folder', target: daily });

    await user.pointer({ keys: '[MouseRight]', target: row(page) });
    const menu = await screen.findByTestId('file-tree-menu');
    await user.click(within(menu).getByRole('menuitem', { name: 'Rename' }));
    const input = await screen.findByTestId('file-tree-rename');
    expect(input).toHaveValue('2026-10-30');
    await waitFor(() => expect(input).toHaveFocus());
    await user.type(input, ' old{Enter}');
    await waitFor(() => expect(window.diskAPI.rename).toHaveBeenCalledWith(page, '2026-10-30 old.md'));
  });

  it('cancels a rename on Escape and refuses a name with a slash', async () => {
    const user = userEvent.setup();
    renderTree();

    await user.pointer({ keys: '[MouseRight]', target: row(NOTES) });
    await user.click(
      within(await screen.findByTestId('file-tree-menu')).getByRole('menuitem', { name: 'Rename' })
    );
    const input = await screen.findByTestId('file-tree-rename');
    await user.clear(input);
    await user.type(input, 'a/b{Enter}');
    expect(toastError).toHaveBeenCalledWith('A name cannot be empty or contain a slash.');
    expect(screen.getByTestId('file-tree-rename')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('file-tree-rename')).toBeNull();
    expect(window.diskAPI.rename).not.toHaveBeenCalled();
    await waitFor(() => expect(row(NOTES)).toHaveFocus());
  });

  it('offers file actions on a row and starts each one', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderTree();

    const openMenu = async (path: string) => {
      await user.pointer({ keys: '[MouseRight]', target: row(path) });
      return screen.findByTestId('file-tree-menu');
    };

    let menu = await openMenu(README);
    expect(
      within(menu).getAllByRole('menuitem').map((item) => item.textContent)
    ).toEqual([
      'Open in new tab',
      'Pin',
      'New note',
      'New folder',
      'Rename',
      'Move to…',
      'Reveal in Finder',
      'Copy path',
      'Move to Trash',
    ]);
    await user.click(within(menu).getByRole('menuitem', { name: 'Copy path' }));
    expect(writeText).toHaveBeenCalledWith(README);

    menu = await openMenu(README);
    await user.click(within(menu).getByRole('menuitem', { name: 'Reveal in Finder' }));
    expect(window.diskAPI.reveal).toHaveBeenCalledWith(README);

    menu = await openMenu(README);
    await user.click(within(menu).getByRole('menuitem', { name: 'Move to Trash' }));
    await waitFor(() => expect(useDiskStore.getState().pendingDelete).toBe(README));
    // The confirmation gives focus back to the row it was asked from.
    expect(row(README)).toHaveFocus();
    useDiskStore.getState().cancelDelete();

    menu = await openMenu(LIBRARY);
    expect(within(menu).queryByRole('menuitem', { name: 'Open in new tab' })).toBeNull();
    await user.click(within(menu).getByRole('menuitem', { name: 'New folder' }));
    expect(useDiskStore.getState().pendingAction).toEqual({
      kind: 'new-folder',
      target: LIBRARY,
    });
    expect(useDiskStore.getState().expanded[LIBRARY]).toBe(true);
    useDiskStore.getState().cancelAction();

    menu = await openMenu(README);
    await user.click(within(menu).getByRole('menuitem', { name: 'Move to…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choose a folder' });
    await user.click(within(dialog).getByRole('button', { name: 'Vault' }));
    await user.click(await within(dialog).findByRole('button', { name: 'Library' }));
    await user.click(within(dialog).getByRole('button', { name: 'Choose Library' }));
    await waitFor(() => expect(window.diskAPI.move).toHaveBeenCalledWith(README, LIBRARY));
  });

  it('creates a note in the row folder and opens it', async () => {
    const user = userEvent.setup();
    renderTree();

    await user.pointer({ keys: '[MouseRight]', target: row(LIBRARY) });
    await user.click(
      within(await screen.findByTestId('file-tree-menu')).getByRole('menuitem', { name: 'New note' })
    );

    await waitFor(() => expect(window.markdownAPI.create).toHaveBeenCalledWith(LIBRARY));
    await waitFor(() =>
      expect(openedPath()).toBe(`${LIBRARY}/Untitled.md`)
    );
    expect(useDiskStore.getState().expanded[LIBRARY]).toBe(true);
  });

  it('offers the root folder actions on blank space', async () => {
    const user = userEvent.setup();
    renderTree();

    await user.pointer({ keys: '[MouseRight]', target: screen.getByRole('tree') });
    const menu = await screen.findByTestId('file-tree-menu');
    expect(
      within(menu).getAllByRole('menuitem').map((item) => item.textContent)
    ).toEqual(['New note', 'New folder', 'Reveal in Finder']);
    await user.click(within(menu).getByRole('menuitem', { name: 'New folder' }));
    expect(useDiskStore.getState().pendingAction).toEqual({
      kind: 'new-folder',
      target: ROOT,
    });
  });

  it('moves a row dropped on a folder, and nothing dropped on its own parent', async () => {
    renderTree();
    const transfer = dataTransfer();

    fireEvent.dragStart(row(README), { dataTransfer: transfer });
    expect(transfer.getData('text/plain')).toBe(README);
    const over = createEvent.dragOver(row(LIBRARY), {
      dataTransfer: dataTransfer(),
      cancelable: true,
    });
    fireEvent(row(LIBRARY), over);
    expect(over.defaultPrevented).toBe(true);
    expect(row(LIBRARY)).toHaveClass('ring-1');

    fireEvent.drop(row(LIBRARY), { dataTransfer: dataTransfer(README) });
    await waitFor(() =>
      expect(window.diskAPI.move).toHaveBeenCalledWith(README, LIBRARY)
    );

    vi.mocked(window.diskAPI.move).mockClear();
    fireEvent.drop(row(NOTES), { dataTransfer: dataTransfer(README) });
    fireEvent.drop(screen.getByRole('tree'), { dataTransfer: dataTransfer(README) });
    expect(window.diskAPI.move).not.toHaveBeenCalled();
  });

  it('takes drops on a root row when several roots are open, and never drags one', async () => {
    const other = '/Other';
    useDiskStore.setState({
      roots: [ROOT, other],
      listings: { [ROOT]: LISTINGS[ROOT], [other]: [] },
    });
    renderTree();

    expect(row(other)).not.toHaveAttribute('draggable');
    const over = createEvent.dragOver(row(other), { dataTransfer: dataTransfer(), cancelable: true });
    fireEvent.dragStart(row(README), { dataTransfer: dataTransfer() });
    fireEvent(row(other), over);
    expect(over.defaultPrevented).toBe(true);
    fireEvent.drop(row(other), { dataTransfer: dataTransfer(README) });
    await waitFor(() => expect(window.diskAPI.move).toHaveBeenCalledWith(README, other));
  });

  it('moves a nested row to the root when dropped on blank space, and reports a failure', async () => {
    useDiskStore.setState({
      listings: { ...LISTINGS },
      expanded: { [LIBRARY]: true, [BOOKS]: true },
    });
    renderTree();
    await screen.findByTestId(`disk-tree-item-${BOOK}`);

    fireEvent.drop(screen.getByRole('tree'), { dataTransfer: dataTransfer(BOOK) });
    await waitFor(() => expect(window.diskAPI.move).toHaveBeenCalledWith(BOOK, ROOT));

    vi.mocked(window.diskAPI.move).mockResolvedValueOnce({
      success: false,
      error: 'Something already exists',
    });
    fireEvent.drop(row(LIBRARY), { dataTransfer: dataTransfer(README) });
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Something already exists')
    );
  });
});
