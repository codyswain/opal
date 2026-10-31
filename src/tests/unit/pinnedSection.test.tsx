import * as React from 'react';
import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { usePinsStore } from '@/renderer/features/disk-explorer/store/pinsStore';
import { PIN_DRAG_TYPE, ShellProvider, WorkspaceSidebar } from '@/renderer/features/shell';
import { TooltipProvider } from '@/renderer/shared/ui';
import { installActivityApi } from '@/tests/helpers/activityApi';
import { installCollectionsApi } from '@/tests/helpers/collectionsApi';
import { entry, installDiskApi } from '@/tests/helpers/diskApi';
import { installPinsApi, setPins } from '@/tests/helpers/pinsApi';
import { openedPath, resetTabs, tabPaths } from '@/tests/helpers/tabs';
import type { DiskEntry } from '@/types/disk';
import type { PinsAPI } from '@/types/pins';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: toastError }) }));

const ROOT = '/Vault';
const OTHER = '/Other';
const LIBRARY = '/Vault/Library';
const DAY = '/Vault/Library/daily/2026-10-30.md';
const INVESTORS = '/Vault/Library/parametric/investors.md';
const README = '/Vault/README.md';
const NOTES = '/Vault/notes.md';
const PHOTO = '/Vault/photo.png';
const PLAN = '/Other/plan.md';

const LISTINGS: Record<string, DiskEntry[]> = {
  [ROOT]: [
    entry({ path: LIBRARY, name: 'Library', kind: 'directory', isDirectory: true }),
    entry({ path: README, name: 'README.md', kind: 'markdown' }),
    entry({ path: NOTES, name: 'notes.md', kind: 'markdown' }),
  ],
};

let api: PinsAPI;

function renderSidebar() {
  return render(
    <MemoryRouter initialEntries={['/files']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <TooltipProvider>
        <ShellProvider>
          <div className="h-[600px] w-[260px]">
            <WorkspaceSidebar />
          </div>
        </ShellProvider>
      </TooltipProvider>
    </MemoryRouter>
  );
}

const pinned = (path: string) => screen.getByTestId(`pinned-${path}`);
const shown = () =>
  within(screen.getByRole('region', { name: 'Pinned' }))
    .getAllByRole('button')
    .map((row) => row.textContent);
const treeRow = (path: string) => screen.getByTestId(`disk-tree-item-${path}`);

/** happy-dom has no DataTransfer, so supply the minimum the handlers use. */
function dataTransfer(data: Record<string, string> = {}) {
  const store = { ...data };
  return {
    setData: (type: string, value: string) => {
      store[type] = value;
    },
    getData: (type: string) => store[type] ?? '',
    dropEffect: 'none',
    effectAllowed: 'all',
  };
}

/** A drag event at a height; happy-dom's drag events drop the pointer position. */
function dragAt(type: 'dragOver' | 'drop', target: HTMLElement, transfer: ReturnType<typeof dataTransfer>, clientY: number) {
  const event = createEvent[type](target, { dataTransfer: transfer, cancelable: true });
  Object.defineProperty(event, 'clientY', { value: clientY });
  fireEvent(target, event);
  return event;
}

/** Lays the pinned rows out 30px apart, as the sidebar does; happy-dom has no layout. */
function layOutRows() {
  screen.getAllByTestId(/^pinned-\//).forEach((row, index) => {
    row.getBoundingClientRect = () =>
      ({ top: index * 30, height: 28, bottom: index * 30 + 28, left: 0, right: 200, width: 200, x: 0, y: index * 30, toJSON: () => ({}) }) as DOMRect;
  });
}

beforeEach(() => {
  window.localStorage.clear();
  toastError.mockClear();
  installActivityApi();
  installCollectionsApi();
  installDiskApi({
    listRoots: vi.fn(async () => ({ success: true as const, data: [ROOT] })),
    readDirectory: vi.fn(async (path: string) => ({
      success: true as const,
      data: { path, entries: LISTINGS[path] ?? [] },
    })),
  });
  api = installPinsApi();
  resetTabs();
  useDiskStore.setState({
    roots: [ROOT],
    listings: { [ROOT]: LISTINGS[ROOT] },
    expanded: {},
    pendingAction: null,
    pendingDelete: null,
    loading: { isLoading: false, error: null },
  });
  setPins({ [ROOT]: [] });
});

describe('PinnedSection', () => {
  it('shows nothing while nothing is pinned', () => {
    renderSidebar();
    expect(screen.queryByTestId('pinned-section')).toBeNull();
    expect(screen.queryByText('Pinned')).toBeNull();
  });

  it('lists the pins of every opened folder in the tree order, named as the tree names them', () => {
    useDiskStore.setState({ roots: [ROOT, OTHER] });
    setPins({ [OTHER]: [PLAN], [ROOT]: [DAY, INVESTORS, PHOTO], '/Closed': ['/Closed/old.md'] });
    renderSidebar();
    expect(shown()).toEqual(['10-30 Fri', 'investors', 'photo.png', 'plan']);
    expect(pinned(INVESTORS)).toHaveAttribute('title', 'Vault/Library/parametric/investors.md');
  });

  it('opens a pin in this tab, in a new tab with Cmd+click or middle-click, and marks the open one', async () => {
    setPins({ [ROOT]: [INVESTORS, README] });
    const user = userEvent.setup();
    renderSidebar();

    await user.click(pinned(INVESTORS));
    await waitFor(() => expect(openedPath()).toBe(INVESTORS));
    expect(tabPaths()).toEqual([INVESTORS]);
    expect(window.activityAPI.record).toHaveBeenCalledWith(INVESTORS, 'opened');
    expect(pinned(INVESTORS)).toHaveClass('bg-surface-selected');
    expect(pinned(INVESTORS)).toHaveAttribute('aria-pressed', 'true');
    expect(pinned(README)).not.toHaveClass('bg-surface-selected');

    await user.keyboard('{Meta>}');
    await user.click(pinned(README));
    await user.keyboard('{/Meta}');
    await waitFor(() => expect(tabPaths()).toEqual([INVESTORS, README]));

    fireEvent(pinned(INVESTORS), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    await waitFor(() => expect(tabPaths()).toEqual([INVESTORS, README, INVESTORS]));
  });

  it('reaches the rows with Tab and opens one with Enter', async () => {
    setPins({ [ROOT]: [README, NOTES] });
    const user = userEvent.setup();
    renderSidebar();
    screen.getByRole('button', { name: 'Recent' }).focus();
    await user.tab();
    expect(pinned(README)).toHaveFocus();
    await user.tab();
    expect(pinned(NOTES)).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(openedPath()).toBe(NOTES));
  });

  it('pins and unpins a file from the tree menu, and offers no pin for a folder', async () => {
    const user = userEvent.setup();
    renderSidebar();
    const menuFor = async (path: string) => {
      await user.pointer({ keys: '[MouseRight]', target: treeRow(path) });
      return screen.findByTestId('file-tree-menu');
    };

    await user.click(within(await menuFor(README)).getByRole('menuitem', { name: 'Pin' }));
    expect(shown()).toEqual(['README']);
    expect(api.set).toHaveBeenLastCalledWith(ROOT, [README]);

    await user.click(within(await menuFor(NOTES)).getByRole('menuitem', { name: 'Pin' }));
    expect(shown()).toEqual(['README', 'notes']);

    await user.click(within(await menuFor(README)).getByRole('menuitem', { name: 'Unpin' }));
    expect(shown()).toEqual(['notes']);
    expect(api.set).toHaveBeenLastCalledWith(ROOT, [NOTES]);

    const folderMenu = await menuFor(LIBRARY);
    expect(within(folderMenu).queryByRole('menuitem', { name: /^(Pin|Unpin)$/ })).toBeNull();
  });

  it('offers Open in new tab, Unpin and Reveal in Finder on a pinned row', async () => {
    setPins({ [ROOT]: [README, NOTES] });
    const user = userEvent.setup();
    renderSidebar();
    const menuFor = async (path: string) => {
      await user.pointer({ keys: '[MouseRight]', target: pinned(path) });
      return screen.findByTestId('pinned-menu');
    };

    let menu = await menuFor(README);
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Open in new tab',
      'Unpin',
      'Reveal in Finder',
    ]);
    await user.click(within(menu).getByRole('menuitem', { name: 'Reveal in Finder' }));
    expect(window.diskAPI.reveal).toHaveBeenCalledWith(README);

    menu = await menuFor(README);
    await user.click(within(menu).getByRole('menuitem', { name: 'Open in new tab' }));
    await waitFor(() => expect(tabPaths()).toEqual([README]));

    menu = await menuFor(README);
    await user.click(within(menu).getByRole('menuitem', { name: 'Unpin' }));
    expect(shown()).toEqual(['notes']);
    expect(api.set).toHaveBeenLastCalledWith(ROOT, [NOTES]);
  });

  it('reorders pins by dragging a row up or down', () => {
    setPins({ [ROOT]: [README, NOTES, INVESTORS] });
    renderSidebar();
    const section = screen.getByTestId('pinned-section');

    layOutRows();
    let transfer = dataTransfer();
    fireEvent.dragStart(pinned(README), { dataTransfer: transfer });
    expect(transfer.getData(PIN_DRAG_TYPE)).toBe(README);
    expect(transfer.getData('text/plain')).toBe('');
    dragAt('dragOver', section, transfer, 80);
    expect(pinned(INVESTORS).className).toContain('after:absolute');
    dragAt('drop', section, transfer, 80);
    expect(shown()).toEqual(['notes', 'investors', 'README']);
    expect(api.set).toHaveBeenLastCalledWith(ROOT, [NOTES, INVESTORS, README]);

    layOutRows();
    transfer = dataTransfer();
    fireEvent.dragStart(pinned(INVESTORS), { dataTransfer: transfer });
    dragAt('dragOver', section, transfer, 5);
    expect(pinned(NOTES).className).toContain('before:absolute');
    dragAt('drop', section, transfer, 5);
    expect(shown()).toEqual(['investors', 'notes', 'README']);
    expect(api.set).toHaveBeenLastCalledWith(ROOT, [INVESTORS, NOTES, README]);

    // Dropped just above itself, a row stays where it is.
    layOutRows();
    vi.mocked(api.set).mockClear();
    transfer = dataTransfer();
    fireEvent.dragStart(pinned(NOTES), { dataTransfer: transfer });
    dragAt('drop', section, transfer, 35);
    expect(shown()).toEqual(['investors', 'notes', 'README']);
    expect(api.set).not.toHaveBeenCalled();
  });

  it('pins a file dragged from the tree where it drops, and moves nothing when a pin drops on a folder', async () => {
    setPins({ [ROOT]: [README] });
    renderSidebar();
    const section = screen.getByTestId('pinned-section');
    layOutRows();

    fireEvent.dragStart(treeRow(NOTES), { dataTransfer: dataTransfer() });
    expect(dragAt('dragOver', section, dataTransfer(), 0).defaultPrevented).toBe(true);
    dragAt('drop', section, dataTransfer({ 'text/plain': NOTES }), 0);
    expect(shown()).toEqual(['notes', 'README']);
    expect(api.set).toHaveBeenLastCalledWith(ROOT, [NOTES, README]);

    // A folder from the tree is not taken.
    fireEvent.dragStart(treeRow(LIBRARY), { dataTransfer: dataTransfer() });
    const folderOver = createEvent.dragOver(section, { dataTransfer: dataTransfer(), cancelable: true });
    fireEvent(section, folderOver);
    expect(folderOver.defaultPrevented).toBe(false);
    fireEvent.dragEnd(treeRow(LIBRARY));

    const transfer = dataTransfer();
    fireEvent.dragStart(pinned(README), { dataTransfer: transfer });
    const onFolder = createEvent.dragOver(treeRow(LIBRARY), { dataTransfer: transfer, cancelable: true });
    fireEvent(treeRow(LIBRARY), onFolder);
    expect(onFolder.defaultPrevented).toBe(false);
    fireEvent.drop(treeRow(LIBRARY), { dataTransfer: transfer });
    fireEvent.dragEnd(pinned(README));
    await Promise.resolve();
    expect(window.diskAPI.move).not.toHaveBeenCalled();
    expect(shown()).toEqual(['notes', 'README']);
  });

  it('greys a pin whose file is missing, which only says so when clicked and can still be unpinned', async () => {
    setPins({ [ROOT]: [README, NOTES] }, [README]);
    const user = userEvent.setup();
    renderSidebar();

    expect(pinned(README)).toHaveClass('text-foreground-tertiary');
    expect(pinned(README)).toHaveAttribute('aria-disabled', 'true');
    expect(pinned(NOTES)).not.toHaveClass('text-foreground-tertiary');
    await user.click(pinned(README));
    expect(toastError).toHaveBeenCalledWith('"README" is not in the vault.');
    expect(tabPaths()).toEqual([]);

    await user.pointer({ keys: '[MouseRight]', target: pinned(README) });
    const menu = await screen.findByTestId('pinned-menu');
    expect(within(menu).getByRole('menuitem', { name: 'Open in new tab' })).toHaveAttribute('data-disabled');
    expect(within(menu).getByRole('menuitem', { name: 'Reveal in Finder' })).toHaveAttribute('data-disabled');
    await user.click(within(menu).getByRole('menuitem', { name: 'Unpin' }));
    expect(usePinsStore.getState().byRoot[ROOT]).toEqual([NOTES]);
  });
});
