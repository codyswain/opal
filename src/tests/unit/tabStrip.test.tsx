import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { TAB_DRAG_TYPE, TabStrip } from '@/renderer/features/disk-explorer/components/TabStrip';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { useDocumentStatusStore } from '@/renderer/features/disk-explorer/store/documentStatusStore';

const A = '/V/alpha.md';
const B = '/V/beta.png';

beforeEach(() => {
  window.localStorage.clear();
  installDiskApi();
  useTabsStore.setState({
    openPaths: [],
    openedPath: null,
    activePath: null,
    previewPath: null,
    recentlyClosed: [],
  });
  useDocumentStatusStore.setState({ statuses: {} });
});

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
  it('renders nothing when no tabs are open', () => {
    render(<TabStrip />);
    expect(screen.queryByTestId('tab-strip')).not.toBeInTheDocument();
  });

  it('renders one tab per open path, labelled by basename', () => {
    useTabsStore.setState({ openPaths: [A, B], activePath: A, previewPath: null });
    render(<TabStrip />);

    expect(screen.getByTestId('tab-strip')).toBeInTheDocument();
    expect(screen.getByText('alpha.md')).toBeInTheDocument();
    expect(screen.getByText('beta.png')).toBeInTheDocument();
  });

  it('marks the active tab for assistive tech', () => {
    useTabsStore.setState({ openPaths: [A, B], activePath: B, previewPath: null });
    render(<TabStrip />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('activates a tab when clicked', async () => {
    const user = userEvent.setup();
    useTabsStore.setState({ openPaths: [A, B], activePath: A, previewPath: null });
    render(<TabStrip />);

    await user.click(screen.getByText('beta.png'));
    expect(useTabsStore.getState().activePath).toBe(B);
  });

  it('explicitly opens a tab on double click', async () => {
    const user = userEvent.setup();
    useTabsStore.setState({ openPaths: [A], activePath: A, previewPath: null });
    render(<TabStrip />);

    await user.dblClick(screen.getByText('alpha.md'));
    expect(useTabsStore.getState().openedPath).toBe(A);
  });

  it('closes a tab from its close button without activating it', async () => {
    const user = userEvent.setup();
    useTabsStore.setState({ openPaths: [A, B], activePath: A, previewPath: null });
    render(<TabStrip />);

    await user.click(screen.getByTestId(`tab-close-${B}`));
    expect(useTabsStore.getState().openPaths).toEqual([A]);
    expect(useTabsStore.getState().activePath).toBe(A);
  });

  it('gives each tab a title attribute carrying the full path', () => {
    // Basenames collide constantly; the tooltip is how you tell them apart.
    useTabsStore.setState({ openPaths: [A], activePath: A, previewPath: null });
    render(<TabStrip />);
    expect(screen.getByRole('tab')).toHaveAttribute('title', A);
  });

  it('renders real file tabs without preview styling', () => {
    useTabsStore.setState({ openPaths: [A], activePath: A, previewPath: null });
    render(<TabStrip />);
    expect(screen.getByTestId(`tab-label-${A}`).className).not.toMatch(/italic/);
  });

  it('shows a kind icon and an unsaved dot that gives way to the close glyph', () => {
    useTabsStore.setState({ openPaths: [A, B], activePath: B, previewPath: null });
    useDocumentStatusStore.getState().set(A, 'dirty');
    render(<TabStrip />);
    expect(screen.getByTestId(`tab-dot-${A}`)).toHaveAttribute('title', 'Unsaved changes');
    expect(screen.getByTestId(`tab-${A}`)).toHaveAttribute('data-unsaved', 'true');
    expect(screen.getByRole('button', { name: 'Close alpha.md (unsaved changes)' })).toBeInTheDocument();
    expect(screen.queryByTestId(`tab-dot-${B}`)).toBeNull();
    act(() => useDocumentStatusStore.getState().set(A, 'conflict'));
    expect(screen.getByTestId(`tab-dot-${A}`)).toHaveAttribute('title', 'This file needs attention');
    act(() => useDocumentStatusStore.getState().clear(A));
    expect(screen.queryByTestId(`tab-dot-${A}`)).toBeNull();
  });

  it('closes on middle click and on Delete from the keyboard', async () => {
    const user = userEvent.setup();
    useTabsStore.setState({ openPaths: [A, B], activePath: A, previewPath: null });
    render(<TabStrip />);
    await user.pointer({ keys: '[MouseMiddle]', target: screen.getByTestId(`tab-${B}`) });
    expect(useTabsStore.getState().openPaths).toEqual([A]);
    screen.getByTestId(`tab-${A}`).focus();
    await user.keyboard('{Delete}');
    expect(useTabsStore.getState().openPaths).toEqual([]);
  });

  it('moves focus between tabs with the arrow keys and activates with Enter', async () => {
    const user = userEvent.setup();
    useTabsStore.setState({ openPaths: [A, B], activePath: A, previewPath: null });
    render(<TabStrip />);
    screen.getByTestId(`tab-${A}`).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId(`tab-${B}`)).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(useTabsStore.getState().activePath).toBe(B);
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId(`tab-${A}`)).toHaveFocus();
  });

  it('reorders tabs by dragging one onto another', () => {
    const C = '/V/gamma.txt';
    useTabsStore.setState({ openPaths: [A, B, C], activePath: A, previewPath: null });
    render(<TabStrip />);
    const dataTransfer = transfer();
    const tabs = screen.getAllByRole('tab');
    // Lay the tabs out on a line so the drop index can be computed from clientX.
    tabs.forEach((tab, index) => {
      tab.getBoundingClientRect = () => ({ left: index * 100, width: 100, right: index * 100 + 100, top: 0, bottom: 36, height: 36, x: index * 100, y: 0, toJSON: () => ({}) }) as DOMRect;
    });
    fireEvent.dragStart(tabs[0], { dataTransfer });
    expect(dataTransfer.getData(TAB_DRAG_TYPE)).toBe(A);
    fireEvent.dragOver(screen.getByTestId('tab-strip'), { dataTransfer, clientX: 290 });
    fireEvent.drop(screen.getByTestId('tab-strip'), { dataTransfer, clientX: 290 });
    expect(useTabsStore.getState().openPaths).toEqual([B, C, A]);
  });

  it('offers Close others and Close to the right from the context menu', async () => {
    const user = userEvent.setup();
    const C = '/V/gamma.txt';
    useTabsStore.setState({ openPaths: [A, B, C], activePath: C, previewPath: null });
    render(<TabStrip />);
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId(`tab-${B}`) });
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^Close/), 'Close others', 'Close to the right', 'Close all', 'Show in folder', 'Reveal in Finder', 'Copy path'])
    );
    await user.click(within(menu).getByRole('menuitem', { name: 'Close to the right' }));
    expect(useTabsStore.getState().openPaths).toEqual([A, B]);
    expect(useTabsStore.getState().activePath).toBe(B);
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId(`tab-${A}`) });
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Close others' }));
    expect(useTabsStore.getState().openPaths).toEqual([A]);
    expect(useTabsStore.getState().activePath).toBe(A);
  });

  it('lists every tab in an overflow menu once the strip is crowded', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 8 }, (_, index) => `/V/file-${index}.md`);
    useTabsStore.setState({ openPaths: many, activePath: many[0], previewPath: null });
    render(<TabStrip />);
    await user.click(screen.getByRole('button', { name: 'All open files (8)' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(8);
    await user.click(within(menu).getByRole('menuitem', { name: /file-5\.md/ }));
    expect(useTabsStore.getState().activePath).toBe(many[5]);
  });

  it('italicizes only the preview tab and pins it on double click', async () => {
    const user = userEvent.setup();
    useTabsStore.setState({ openPaths: [A, B], activePath: B, previewPath: B, openedPath: A });
    render(<TabStrip />);
    expect(screen.getByTestId(`tab-label-${B}`).className).toMatch(/italic/);
    await user.dblClick(screen.getByText('beta.png'));
    expect(useTabsStore.getState().previewPath).toBeNull();
    expect(screen.getByTestId(`tab-label-${B}`).className).not.toMatch(/italic/);
  });
});
