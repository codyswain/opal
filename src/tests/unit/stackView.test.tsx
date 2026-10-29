import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { StackView } from '@/renderer/features/disk-explorer/components/stack/StackView';
import { flushPendingSaves } from '@/renderer/features/disk-explorer/components/editor/pendingSaves';
import { stackLocation, fileLocation } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { usePagePropertiesStore } from '@/renderer/features/disk-explorer/store/pagePropertiesStore';
import { useStackFoldsStore, useStackStore } from '@/renderer/features/disk-explorer/store/stackStore';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { TooltipProvider } from '@/renderer/shared/ui';
import type { StackSection } from '@/types/stack';
import type { VaultAPI } from '@/types/vault';
import { installActivityApi } from '@/tests/helpers/activityApi';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';
import { openTabs, tabId } from '@/tests/helpers/tabs';

const ROOT = '/Vault';
const DAILY = '/Vault/Library/daily';
const day = (offset: number) => {
  const date = new Date(2026, 9, 29 - offset);
  return `${DAILY}/${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.md`;
};
const HEAD = day(0);
const COUNT = 30;
/** Every section is drawn 300px tall, and the view is 900px, so three sections fill it. */
const SECTION_PX = 300;
const VIEW_PX = 900;

const label = (path: string) => path.slice(path.lastIndexOf('/') + 1, -3);
const section = (path: string, index: number): StackSection => ({
  path, label: label(path), detail: index === 0 ? 'Today' : null, role: index === 0 ? 'head' : 'part',
  defaultOpen: true, readOnly: false, size: 300, mtimeMs: 1,
});
const paths = Array.from({ length: COUNT }, (_, index) => day(index));

let listeners: Set<(payload: { directories: string[] }) => void>;
let restore: Array<() => void>;

function stubLayout() {
  const proto = HTMLElement.prototype;
  const saved = (['offsetTop', 'offsetHeight', 'clientHeight'] as const).map((key) => [key, Object.getOwnPropertyDescriptor(proto, key)] as const);
  const sectionIndex = (element: HTMLElement) =>
    [...(element.parentElement?.children ?? [])].filter((child) => (child as HTMLElement).dataset.stackSection).indexOf(element);
  Object.defineProperty(proto, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) { return this.dataset?.stackSection ? sectionIndex(this) * SECTION_PX : 0; },
  });
  Object.defineProperty(proto, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) { return this.dataset?.stackSection ? SECTION_PX : 0; },
  });
  Object.defineProperty(proto, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) { return this.classList?.contains('opal-stack') ? VIEW_PX : 0; },
  });
  restore.push(() => saved.forEach(([key, descriptor]) => {
    if (descriptor) Object.defineProperty(proto, key, descriptor);
    else delete (proto as unknown as Record<string, unknown>)[key];
  }));
}

function installVault(stack: (...args: [string, string, string]) => Promise<unknown> = vi.fn(async (_root: string, _kind: string, head: string) => ({
  success: true as const,
  data: { kind: 'daily' as const, head, sections: paths.map(section), folders: [DAILY] },
}))) {
  const api = {
    discover: vi.fn(), createDay: vi.fn(), day: vi.fn(), checkDigestItem: vi.fn(), onDayChanged: vi.fn(() => () => undefined),
    stack,
  } as unknown as VaultAPI;
  (window as unknown as { vaultAPI: VaultAPI }).vaultAPI = api;
  return stack;
}

const frames = async (count = 1) => {
  for (let index = 0; index < count; index += 1) {
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
  }
};

function renderStack() {
  const tab = useTabsStore.getState().tabs[0];
  return render(
    <TooltipProvider>
      <div style={{ height: VIEW_PX }}>
        <StackView tabId={tab.id} index={tab.index} location={stackLocation('daily', HEAD)} />
      </div>
    </TooltipProvider>,
  );
}

const article = (path: string) => document.querySelector<HTMLElement>(`[data-stack-section="${CSS.escape(path)}"]`) as HTMLElement;
const viewOf = (path: string) => {
  const content = article(path)?.querySelector<HTMLElement>('[data-testid="markdown-editor"]');
  return content ? EditorView.findFromDOM(content) : null;
};
const liveSections = () => [...document.querySelectorAll<HTMLElement>('[data-stack-section]')]
  .filter((element) => element.querySelector('[data-testid="markdown-editor"]'))
  .map((element) => element.dataset.stackSection);
const scroller = () => screen.getByTestId('files-stack');

beforeEach(() => {
  window.localStorage.clear();
  restore = [];
  listeners = new Set();
  stubLayout();
  installActivityApi();
  installDiskApi({
    onChanged: vi.fn((callback: (payload: { directories: string[] }) => void) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    }),
  });
  installMarkdownApi(Object.fromEntries(paths.map((path, index) => [path, index === 0 ? '' : `Notes from ${label(path)}.\n`])));
  installVault();
  useDiskStore.setState({ roots: [ROOT], rootsLoaded: true, listings: {} });
  usePagePropertiesStore.setState({ open: false });
  useStackFoldsStore.setState({ folds: {} });
  useStackStore.setState({ live: {}, viewed: null, reveal: null, move: null });
  openTabs([stackLocation('daily', HEAD)]);
});

afterEach(() => {
  vi.useRealTimers();
  restore.forEach((undo) => undo());
});

describe('StackView', () => {
  it('shows the head at once, then the earlier pages, with live editors only near the view', async () => {
    renderStack();
    // The head renders before the list arrives, and an empty head takes the caret.
    expect(article(HEAD)).toBeTruthy();
    const head = await waitFor(() => {
      const view = viewOf(HEAD);
      if (!view) throw new Error('no head editor');
      return view;
    });
    expect(head.hasFocus).toBe(true);
    await waitFor(() => expect(document.querySelectorAll('[data-stack-section]')).toHaveLength(16));
    expect(within(article(HEAD)).getByRole('heading')).toHaveTextContent('2026-10-29Today');
    // Three sections fill the view and three more sit within a viewport below it.
    await waitFor(() => expect(liveSections()).toEqual(paths.slice(0, 6)));
    expect(document.querySelectorAll('.cm-editor')).toHaveLength(6);
    expect(useStackStore.getState().live[tabId(0)]).toEqual(expect.arrayContaining(paths.slice(0, 6)));
    // Only the head took focus; nothing below moved the caret.
    expect(paths.slice(1, 6).every((path) => !viewOf(path)?.hasFocus)).toBe(true);
  });

  it('loads more pages as the view nears the end, ends with a line, and unmounts what it left behind', async () => {
    renderStack();
    await waitFor(() => expect(document.querySelectorAll('[data-stack-section]')).toHaveLength(16));
    const scrollTo = async (top: number) => {
      act(() => {
        scroller().scrollTop = top;
        scroller().dispatchEvent(new Event('scroll'));
      });
      await frames(2);
    };
    // The empty head took the caret; a focused section is never unmounted, so it lets go first.
    await waitFor(() => expect(viewOf(HEAD)?.hasFocus).toBe(true));
    act(() => (viewOf(HEAD) as EditorView).contentDOM.blur());
    for (let step = 1; step <= 12; step += 1) await scrollTo(step * 600);
    await scrollTo((COUNT - 3) * SECTION_PX);
    await waitFor(() => expect(document.querySelectorAll('[data-stack-section]')).toHaveLength(COUNT));
    expect(screen.getByText('No earlier pages')).toBeInTheDocument();
    // The head has been more than three viewports away for two seconds.
    await act(() => new Promise((resolve) => setTimeout(resolve, 2300)));
    await frames(4);
    expect(liveSections()).not.toContain(HEAD);
    expect(liveSections().length).toBeLessThanOrEqual(12);
    expect(liveSections()).toContain(paths[COUNT - 2]);
    // The sidebar follows the page at the probe line once it has held.
    expect(useStackStore.getState().viewed?.path).toBe(paths[COUNT - 3]);
  });

  it('saves each section to its own file, and merges a change on disk into a lower one while the head is typed in', async () => {
    const api = installMarkdownApi(Object.fromEntries(paths.map((path, index) => [path, index === 0 ? '' : `Notes from ${label(path)}.\n`])));
    renderStack();
    await waitFor(() => expect(liveSections()).toEqual(paths.slice(0, 6)));
    const head = viewOf(HEAD) as EditorView;
    const lower = viewOf(paths[2]) as EditorView;
    act(() => head.dispatch({ changes: { from: 0, insert: 'Typed in today.' } }));
    act(() => lower.dispatch({ changes: { from: lower.state.doc.length, insert: 'Typed lower down.\n' } }));
    // Another Mac appends to a section between them.
    api.externalEdit(paths[1], `Notes from ${label(paths[1])}.\nAppended elsewhere.\n`);
    act(() => listeners.forEach((listener) => listener({ directories: [DAILY] })));
    await waitFor(() => expect(viewOf(paths[1])?.state.doc.toString()).toContain('Appended elsewhere.'));
    expect(head.state.doc.toString()).toBe('Typed in today.');
    expect(await act(() => flushPendingSaves())).toEqual([]);
    expect(api.documents.get(HEAD)?.body).toBe('Typed in today.');
    expect(api.documents.get(paths[2])?.body).toBe(`Notes from ${label(paths[2])}.\nTyped lower down.\n`);
    expect(api.documents.get(paths[1])?.body).toBe(`Notes from ${label(paths[1])}.\nAppended elsewhere.\n`);
  });

  it('folds a section by its title, keeps the choice per file, and Option-click folds them all', async () => {
    renderStack();
    await waitFor(() => expect(liveSections()).toEqual(paths.slice(0, 6)));
    fireEvent.click(within(article(paths[1])).getByRole('button', { name: label(paths[1]) }));
    expect(useStackFoldsStore.getState().folds).toEqual({ [paths[1]]: false });
    await waitFor(() => expect(article(paths[1]).querySelector('.opal-stack-body')).toBeNull());
    expect(article(paths[1])).not.toHaveAttribute('data-open');
    fireEvent.click(within(article(paths[2])).getByRole('button', { name: `Fold ${label(paths[2])}` }), { altKey: true });
    await waitFor(() => expect(document.querySelectorAll('.opal-stack-body')).toHaveLength(0));
    fireEvent.click(within(article(HEAD)).getByRole('button', { name: `Unfold ${label(HEAD)}` }));
    await waitFor(() => expect(viewOf(HEAD)).toBeTruthy());
  });

  it('moves the caret across sections with the arrow keys, and between them with the menu commands', async () => {
    renderStack();
    await waitFor(() => expect(liveSections()).toEqual(paths.slice(0, 6)));
    const head = viewOf(HEAD) as EditorView;
    const press = (view: EditorView, key: string) =>
      act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key }), 'editor'); });
    press(head, 'ArrowDown');
    const next = viewOf(paths[1]) as EditorView;
    await waitFor(() => expect(next.hasFocus).toBe(true));
    expect(next.state.selection.main.head).toBe(0);
    press(next, 'ArrowUp');
    await waitFor(() => expect(head.hasFocus).toBe(true));
    // View > Next Section scrolls the next section's title to the top and puts the caret at its start.
    act(() => { useStackStore.getState().move?.('next'); });
    await waitFor(() => expect(next.hasFocus).toBe(true));
    expect(scroller().scrollTop).toBe(SECTION_PX);
  });

  it('opens a section on its own as a new history step', async () => {
    renderStack();
    await waitFor(() => expect(document.querySelectorAll('[data-stack-section]')).toHaveLength(16));
    fireEvent.click(within(article(paths[3])).getByRole('button', { name: `Open ${label(paths[3])} on its own` }));
    const tab = useTabsStore.getState().tabs[0];
    expect(tab.history.map((entry) => entry.location)).toEqual([stackLocation('daily', HEAD), fileLocation(paths[3])]);
  });

  it('shows the properties block on the section whose footer was clicked, and only there', async () => {
    renderStack();
    await waitFor(() => expect(liveSections()).toEqual(paths.slice(0, 6)));
    fireEvent.click(within(article(paths[2])).getByRole('button', { name: /word/ }));
    await waitFor(() => expect(article(paths[2]).querySelector('[data-page-properties]')).not.toBeNull());
    expect(document.querySelectorAll('[data-page-properties]')).toHaveLength(1);
    // The footer of another section moves the block there.
    fireEvent.click(within(article(paths[1])).getByRole('button', { name: /word/ }));
    await waitFor(() => expect(article(paths[1]).querySelector('[data-page-properties]')).not.toBeNull());
    expect(document.querySelectorAll('[data-page-properties]')).toHaveLength(1);
    expect(usePagePropertiesStore.getState().open).toBe(true);
  });

  it('returns to the saved place, and Today scrolls the stream back to its top', async () => {
    useTabsStore.getState().saveView(tabId(0), 0, { stack: { anchor: paths[10], offset: 50 } });
    renderStack();
    await waitFor(() => expect(scroller().scrollTop).toBe(10 * SECTION_PX + 50), { timeout: 3000 });
    // A saved place keeps the caret where it was: the empty head does not take it.
    expect(viewOf(HEAD)?.hasFocus ?? false).toBe(false);
    act(() => useStackStore.getState().revealHead(HEAD));
    expect(scroller().scrollTop).toBe(0);
  });

  it('shows the head alone when the main process cannot list the stack', async () => {
    installVault(vi.fn(async () => ({ success: false as const, error: 'No vault.' })));
    renderStack();
    await waitFor(() => expect(viewOf(HEAD)).toBeTruthy());
    await frames(3);
    expect(document.querySelectorAll('[data-stack-section]')).toHaveLength(1);
    expect(screen.queryByText('No earlier pages')).toBeInTheDocument();
  });
});
