import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { TAB_DRAG_TYPE, TabStrip } from '@/renderer/features/disk-explorer/components/TabStrip';
import { tabLabels, vaultRelativePath } from '@/renderer/features/disk-explorer/components/tabLabels';
import { usePaletteStore } from '@/renderer/features/commands/store/paletteStore';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { RECENT_COLLECTION, fileLocation } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { TooltipProvider } from '@/renderer/shared/ui';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { openTabs, openedPath, resetTabs, tabPaths } from '@/tests/helpers/tabs';
import { useDocumentStatusStore } from '@/renderer/features/disk-explorer/store/documentStatusStore';

const A = '/V/alpha.md';
const B = '/V/beta.png';
const C = '/V/gamma.txt';

beforeEach(() => {
  window.localStorage.clear();
  installDiskApi();
  resetTabs();
  useDiskStore.setState({ roots: ['/V'] });
  useDocumentStatusStore.setState({ statuses: {} });
  usePaletteStore.setState({ open: false, newTab: false });
});

const renderStrip = () => render(<TooltipProvider><TabStrip /></TooltipProvider>);

/** A dataTransfer stand-in; happy-dom's drag events carry none. */
function transfer(data: Record<string, string> = {}) {
  const store = { ...data };
  return {
    setData: (type: string, value: string) => { store[type] = value; },
    getData: (type: string) => store[type] ?? '',
    get types() { return Object.keys(store); },
    effectAllowed: 'all',
    dropEffect: 'none',
  };
}

describe('TabStrip', () => {
  it('shows only New tab when no tab is open, and New tab opens the palette for a new tab', async () => {
    const user = userEvent.setup();
    renderStrip();
    expect(screen.queryByTestId('tab-strip')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New tab' }));
    expect(usePaletteStore.getState()).toMatchObject({ open: true, newTab: true });
  });

  it('names tabs like the tree: Markdown without .md, other files in full, and Recent', () => {
    openTabs([A, B, { mode: 'browse', collection: RECENT_COLLECTION }]);
    renderStrip();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['alpha', 'beta.png', 'Recent']);
  });

  it('marks the active tab and activates another on click', async () => {
    const user = userEvent.setup();
    openTabs([A, B], 1);
    renderStrip();
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByText('alpha'));
    expect(openedPath()).toBe(A);
  });

  it('closes a tab from its close button without activating it', async () => {
    const user = userEvent.setup();
    openTabs([A, B], 0);
    renderStrip();
    await user.click(screen.getByTestId(`tab-close-${B}`));
    expect(tabPaths()).toEqual([A]);
    expect(openedPath()).toBe(A);
  });

  it('uses the vault-relative path as the tooltip', () => {
    useDiskStore.setState({ roots: ['/Vault'] });
    openTabs(['/Vault/Library/people/Alec Chen.md']);
    renderStrip();
    expect(screen.getByRole('tab')).toHaveAttribute('title', 'Library/people/Alec Chen.md');
  });

  it('shows the parent folder, muted, for same-name tabs', () => {
    openTabs(['/V/one/README.md', '/V/two/README.md', A]);
    renderStrip();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['READMEone', 'READMEtwo', 'alpha']);
  });

  it('shows an unsaved dot that gives way to the close glyph, and a mark for a problem', () => {
    openTabs([A, B], 1);
    useDocumentStatusStore.getState().set(A, 'dirty');
    renderStrip();
    expect(screen.getByTestId(`tab-dot-${A}`)).toHaveAttribute('title', 'Unsaved changes');
    expect(screen.getByTestId(`tab-${A}`)).toHaveAttribute('data-unsaved', 'true');
    expect(screen.getByRole('button', { name: 'Close alpha (unsaved changes)' })).toBeInTheDocument();
    expect(screen.queryByTestId(`tab-dot-${B}`)).toBeNull();
    act(() => useDocumentStatusStore.getState().set(A, 'conflict'));
    expect(screen.getByTestId(`tab-dot-${A}`)).toHaveAttribute('aria-label', 'This file needs attention');
    act(() => useDocumentStatusStore.getState().clear(A));
    expect(screen.queryByTestId(`tab-dot-${A}`)).toBeNull();
  });

  it('closes on middle click and on Delete from the keyboard', async () => {
    const user = userEvent.setup();
    openTabs([A, B]);
    renderStrip();
    await user.pointer({ keys: '[MouseMiddle]', target: screen.getByTestId(`tab-${B}`) });
    expect(tabPaths()).toEqual([A]);
    screen.getByTestId(`tab-${A}`).focus();
    await user.keyboard('{Delete}');
    expect(tabPaths()).toEqual([]);
  });

  it('moves focus between tabs with the arrow keys and activates with Enter', async () => {
    const user = userEvent.setup();
    openTabs([A, B]);
    renderStrip();
    screen.getByTestId(`tab-${A}`).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId(`tab-${B}`)).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(openedPath()).toBe(B);
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId(`tab-${A}`)).toHaveFocus();
  });

  it('keeps tabs out of the window drag region', () => {
    openTabs([A]);
    renderStrip();
    expect(screen.getByRole('tab')).toHaveClass('no-drag');
  });

  it('reorders tabs by dragging one onto another', () => {
    openTabs([A, B, C]);
    renderStrip();
    const dataTransfer = transfer();
    const tabs = screen.getAllByRole('tab');
    // Lay the tabs out on a line so the drop index can be computed from clientX.
    tabs.forEach((tab, index) => {
      tab.getBoundingClientRect = () => ({ left: index * 100, width: 100, right: index * 100 + 100, top: 0, bottom: 28, height: 28, x: index * 100, y: 0, toJSON: () => ({}) }) as DOMRect;
    });
    fireEvent.dragStart(tabs[0], { dataTransfer });
    expect(dataTransfer.getData(TAB_DRAG_TYPE)).toBe(useTabsStore.getState().tabs[0].id);
    fireEvent.dragOver(screen.getByTestId('tab-strip'), { dataTransfer, clientX: 290 });
    fireEvent.drop(screen.getByTestId('tab-strip'), { dataTransfer, clientX: 290 });
    expect(tabPaths()).toEqual([B, C, A]);
  });

  it('offers bulk closing, Reveal in Finder and Copy path from the context menu', async () => {
    const user = userEvent.setup();
    openTabs([A, B, C], 2);
    renderStrip();
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId(`tab-${B}`) });
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Close tab⌘W', 'Close other tabs', 'Close tabs to the right', 'Close all tabs', 'Reveal in Finder', 'Copy path',
    ]);
    await user.click(within(menu).getByRole('menuitem', { name: 'Close tabs to the right' }));
    expect(tabPaths()).toEqual([A, B]);
    expect(openedPath()).toBe(B);
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId(`tab-${A}`) });
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Close other tabs' }));
    expect(tabPaths()).toEqual([A]);
  });

  it('lists every tab in a menu once the row is crowded', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 8 }, (_, index) => `/V/file-${index}.md`);
    openTabs(many);
    renderStrip();
    await user.click(screen.getByRole('button', { name: 'All tabs (8)' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(8);
    await user.click(within(menu).getByRole('menuitem', { name: /file-5/ }));
    expect(openedPath()).toBe(many[5]);
  });
});

describe('tab labels', () => {
  it('tells same-name files apart by as many folders as it takes', () => {
    const labels = tabLabels(
      ['/V/a/x/README.md', '/V/b/x/README.md', '/V/b/x/README.md', '/V/c/notes.md'].map(fileLocation),
      ['/V']
    );
    expect(labels.map((label) => [label.name, label.hint])).toEqual([
      ['README', 'a/x'],
      ['README', 'b/x'],
      ['README', 'b/x'],
      ['notes', null],
    ]);
  });

  it('names Recent and leaves it alone', () => {
    expect(tabLabels([{ mode: 'browse', collection: RECENT_COLLECTION }], ['/V'])).toEqual([
      { name: 'Recent', hint: null, title: 'Recent' },
    ]);
  });

  it('starts the path with the root name when several roots are open', () => {
    expect(vaultRelativePath('/Work/notes/a.md', ['/Vault', '/Work'])).toBe('Work/notes/a.md');
    expect(vaultRelativePath('/Vault', ['/Vault'])).toBe('Vault');
    expect(vaultRelativePath('/Elsewhere/a.md', ['/Vault'])).toBe('/Elsewhere/a.md');
  });
});
