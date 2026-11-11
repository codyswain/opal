import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { StackView, mergeSections } from '@/renderer/features/disk-explorer/components/stack/StackView';
import { TouchedList } from '@/renderer/features/disk-explorer/components/stack/TouchedList';
import { STACK_WINDOW } from '@/renderer/features/disk-explorer/components/stack/stackWindow';
import { flushPendingSaves } from '@/renderer/features/disk-explorer/components/editor/pendingSaves';
import { openWikiLink } from '@/renderer/features/disk-explorer/components/editor/wikiLinks';
import { stackLocation, fileLocation } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { usePagePropertiesStore } from '@/renderer/features/disk-explorer/store/pagePropertiesStore';
import { useStackFoldsStore, useStackStore } from '@/renderer/features/disk-explorer/store/stackStore';
import { tabLocation, useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { readPref } from '@/renderer/shared/prefs/prefs';
import { TooltipProvider } from '@/renderer/shared/ui';
import type { StackSection } from '@/types/stack';
import type { TouchedItem, TouchedWeek, TouchedWeekChange } from '@/types/touched';
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
  defaultOpen: true, readOnly: false, textHeading: null, size: 300, mtimeMs: 1,
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

function renderStack(location = stackLocation('daily', HEAD)) {
  const tab = useTabsStore.getState().tabs[0];
  return render(
    <TooltipProvider>
      <div style={{ height: VIEW_PX }}>
        <StackView tabId={tab.id} index={tab.index} location={location} />
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
  useStackStore.setState({ live: {}, viewed: null, reveal: null, caret: null, move: null });
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
    // In a section's editor Cmd+Option+Down is Next Section too, not CodeMirror's add cursor below.
    const MOD: KeyboardEventInit = /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
    act(() => { runScopeHandlers(next, new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, ...MOD }), 'editor'); });
    const third = viewOf(paths[2]) as EditorView;
    await waitFor(() => expect(third.hasFocus).toBe(true));
    expect(next.state.selection.ranges).toHaveLength(1);
    expect(scroller().scrollTop).toBe(2 * SECTION_PX);
  });

  it('opens a section on its own as a new history step', async () => {
    renderStack();
    await waitFor(() => expect(document.querySelectorAll('[data-stack-section]')).toHaveLength(16));
    fireEvent.click(within(article(paths[3])).getByRole('button', { name: `Open ${label(paths[3])} on its own` }));
    const tab = useTabsStore.getState().tabs[0];
    expect(tab.history.map((entry) => entry.location)).toEqual([stackLocation('daily', HEAD), fileLocation(paths[3])]);
  });

  it('scrolls to a page in the stream when its link is followed, and opens a new tab on Cmd+click or middle-click', async () => {
    const PERSON = '/Vault/People/Robert Xu.md';
    installMarkdownApi({
      ...Object.fromEntries(paths.map((path, index) => [path, index === 0 ? `See [[${label(paths[2])}]] and [[Robert Xu]].\n` : `Notes from ${label(path)}.\n`])),
      [PERSON]: '# Robert\n',
    });
    renderStack();
    await waitFor(() => expect(viewOf(HEAD)).toBeTruthy());
    const links = () => (viewOf(HEAD) as EditorView).contentDOM.querySelectorAll('.cm-md-wikilink');
    const tabs = () => useTabsStore.getState().tabs;
    fireEvent.mouseDown(links()[0], { metaKey: true });
    // The new tab shows that page, as a Cmd+click in the tree does, and this one stays where it was.
    await waitFor(() => expect(tabs().map(tabLocation)).toEqual([stackLocation('daily', HEAD), fileLocation(paths[2])]));
    expect(scroller().scrollTop).toBe(0);
    fireEvent.mouseDown(links()[1], { button: 1 });
    await waitFor(() => expect(tabs().map(tabLocation)[2]).toEqual(fileLocation(PERSON)));
    fireEvent.mouseDown(links()[0]);
    await waitFor(() => expect(scroller().scrollTop).toBe(2 * SECTION_PX));
    expect(tabs()).toHaveLength(3);
    expect(tabs()[0].history).toHaveLength(1);
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

  it('returns to the saved place, and Daily scrolls the stream back to its top', async () => {
    useTabsStore.getState().saveView(tabId(0), 0, { stack: { anchor: paths[10], offset: 50 } });
    renderStack();
    await waitFor(() => expect(scroller().scrollTop).toBe(10 * SECTION_PX + 50), { timeout: 3000 });
    // A saved place keeps the caret where it was: the empty head does not take it.
    expect(viewOf(HEAD)?.hasFocus ?? false).toBe(false);
    act(() => useStackStore.getState().scrollToSection(HEAD));
    expect(scroller().scrollTop).toBe(0);
  });

  describe('with pages made ahead', () => {
    // Sunday Nov 1 and Friday Oct 30, above Thursday Oct 29, today's page.
    const LATER = [day(-3), day(-1)];
    const later = (path: string) => ({ ...section(path, 1), detail: path === day(-1) ? 'Tomorrow' : 'Sunday' });
    const answer = (above: readonly string[]) => async (_root: string, _kind: string, head: string) => ({
      success: true as const,
      data: { kind: 'daily' as const, head, sections: [...above.map(later), ...paths.map(section)], folders: [DAILY] },
    });
    const order = () => [...document.querySelectorAll<HTMLElement>('[data-stack-section]')].map((element) => element.dataset.stackSection);

    beforeEach(() => {
      installMarkdownApi({
        ...Object.fromEntries(paths.map((path, index) => [path, index === 0 ? '' : `Notes from ${label(path)}.\n`])),
        [LATER[0]]: 'Planned for Sunday.\n',
        [LATER[1]]: '',
      });
    });

    it('opens at today’s page with the later days above it, nearest last, and Daily scrolls back to it', async () => {
      installVault(vi.fn(answer(LATER)));
      renderStack();
      await waitFor(() => expect(order().slice(0, 4)).toEqual([...LATER, HEAD, paths[1]]));
      // The view opens at today's page; the later days are reached by scrolling up.
      await waitFor(() => expect(scroller().scrollTop).toBe(2 * SECTION_PX));
      await waitFor(() => expect(viewOf(HEAD)?.hasFocus).toBe(true));
      expect(useStackStore.getState().viewed?.path).toBe(HEAD);
      // Five earlier pages load below the head as usual, whatever is above it.
      expect(order().length).toBeGreaterThanOrEqual(2 + STACK_WINDOW.firstLoad);

      act(() => {
        scroller().scrollTop = 0;
        scroller().dispatchEvent(new Event('scroll'));
      });
      await waitFor(() => expect(viewOf(LATER[0])).toBeTruthy());
      act(() => useStackStore.getState().scrollToSection(HEAD));
      expect(scroller().scrollTop).toBe(2 * SECTION_PX);
    });

    it('scrolls to a page just made for a later day, asking for the list again', async () => {
      const stack = installVault();
      renderStack();
      await waitFor(() => expect(liveSections()).toEqual(paths.slice(0, 6)));
      expect(scroller().scrollTop).toBe(0);
      vi.mocked(stack).mockImplementation(answer(LATER));
      act(() => useStackStore.getState().scrollToSection(HEAD, LATER[1]));
      await waitFor(() => expect(stack).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(scroller().scrollTop).toBe(SECTION_PX));
      expect(order().slice(0, 3)).toEqual([...LATER, HEAD]);
      await waitFor(() => expect(useStackStore.getState().viewed?.path).toBe(LATER[1]));
    });

    it('has the sidebar follow tomorrow’s page just made at the top, where the view already is', async () => {
      const stack = installVault();
      renderStack();
      await waitFor(() => expect(liveSections()).toEqual(paths.slice(0, 6)));
      expect(useStackStore.getState().viewed?.path).toBe(HEAD);
      // Tomorrow's page comes above today's at the top of the view, so the view does not scroll.
      vi.mocked(stack).mockImplementation(answer([LATER[1]]));
      act(() => useStackStore.getState().scrollToSection(HEAD, LATER[1]));
      await waitFor(() => expect(order().slice(0, 2)).toEqual([LATER[1], HEAD]));
      await waitFor(() => expect(useStackStore.getState().viewed?.path).toBe(LATER[1]));
      expect(scroller().scrollTop).toBe(0);
    });

    it.each(['the earlier ask’s answer comes first', 'the later ask’s answer comes first'])(
      'scrolls to a page just made while an earlier ask for the list is out, when %s',
      async (when) => {
        // Each ask waits until the test answers it, with or without the later days.
        const asks: Array<(above: readonly string[]) => void> = [];
        installVault(vi.fn((root: string, kind: string, head: string) =>
          new Promise((resolve) => asks.push((above) => resolve(answer(above)(root, kind, head))))));
        renderStack();
        expect(asks).toHaveLength(1);
        act(() => useStackStore.getState().scrollToSection(HEAD, LATER[1]));
        expect(asks).toHaveLength(2);
        const [before, after] = asks;
        if (when.startsWith('the earlier')) {
          await act(async () => before([]));
          await act(async () => after(LATER));
        } else {
          await act(async () => after(LATER));
          await act(async () => before([]));
        }
        await waitFor(() => expect(scroller().scrollTop).toBe(SECTION_PX));
        await frames(4);
        expect(order().slice(0, 3)).toEqual([...LATER, HEAD]);
        expect(scroller().scrollTop).toBe(SECTION_PX);
      },
    );

    it('starts at a later day’s page saved on a new entry', async () => {
      installVault(vi.fn(answer(LATER)));
      useTabsStore.getState().saveView(tabId(0), 0, { stack: { anchor: LATER[1], offset: 0 } });
      renderStack();
      await waitFor(() => expect(scroller().scrollTop).toBe(SECTION_PX), { timeout: 3000 });
      await waitFor(() => expect(useStackStore.getState().viewed?.path).toBe(LATER[1]));
      // The empty head does not take the caret from a page opened by name.
      expect(viewOf(HEAD)?.hasFocus ?? false).toBe(false);
    });

    it('opens at today’s page when the saved page is gone, not at the top of the later days', async () => {
      installVault(vi.fn(answer(LATER)));
      useTabsStore.getState().saveView(tabId(0), 0, { stack: { anchor: day(-2), offset: 0 } });
      renderStack();
      await waitFor(() => expect(order().slice(0, 3)).toEqual([...LATER, HEAD]));
      await waitFor(() => expect(scroller().scrollTop).toBe(2 * SECTION_PX), { timeout: 3000 });
    });

    it('brings today’s page to the top of the view with only one earlier page below it', async () => {
      installVault(vi.fn(async (_root: string, _kind: string, head: string) => ({
        success: true as const,
        data: { kind: 'daily' as const, head, sections: [...LATER.map(later), section(HEAD, 0), section(paths[1], 1)], folders: [DAILY] },
      })));
      renderStack();
      // As in the app, the scroll stops where the content ends: its sections and padding, or its minimum height.
      const element = scroller();
      const feed = element.firstElementChild as HTMLElement;
      let top = 0;
      Object.defineProperty(element, 'scrollTop', {
        configurable: true,
        get: () => top,
        set: (value: number) => {
          const height = Math.max(order().length * SECTION_PX + 128, parseFloat(feed.style.minHeight) || 0);
          top = Math.max(0, Math.min(value, height - VIEW_PX));
        },
      });
      await waitFor(() => expect(order()).toEqual([...LATER, HEAD, paths[1]]));
      await waitFor(() => expect(scroller().scrollTop).toBe(2 * SECTION_PX));
    });
  });

  it('returns to the saved place after a relaunch, where the opened folders load after the stack', async () => {
    useDiskStore.setState({ roots: [], rootsLoaded: false });
    useTabsStore.getState().saveView(tabId(0), 0, { stack: { anchor: paths[10], offset: 50 } });
    renderStack();
    // A second of waiting for the folders does not give up on the place.
    await act(() => new Promise((resolve) => setTimeout(resolve, 1000)));
    expect(scroller().scrollTop).toBe(0);
    act(() => useDiskStore.setState({ roots: [ROOT], rootsLoaded: true }));
    await waitFor(() => expect(scroller().scrollTop).toBe(10 * SECTION_PX + 50), { timeout: 3000 });
  });

  it('stops a wheel event over the text of a section before its editor, which would move the scroll for its own line', async () => {
    renderStack();
    await waitFor(() => expect(viewOf(paths[1])).toBeTruthy());
    const content = (viewOf(paths[1]) as EditorView).contentDOM;
    const reached = vi.fn();
    content.addEventListener('wheel', reached);
    act(() => { content.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 })); });
    expect(reached).not.toHaveBeenCalled();
    // A wheel elsewhere in the stack goes on as usual.
    const header = article(paths[1]).querySelector('.opal-stack-label') as HTMLElement;
    const passed = vi.fn();
    header.addEventListener('wheel', passed);
    act(() => { header.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 })); });
    expect(passed).toHaveBeenCalledTimes(1);
  });

  it('keeps a past page that was just emptied while its caret is in it', async () => {
    const stack = vi.fn(async (_root: string, _kind: string, head: string) => ({
      success: true as const,
      data: { kind: 'daily' as const, head, sections: paths.map(section), folders: [DAILY] },
    }));
    installVault(stack);
    renderStack();
    await waitFor(() => expect(viewOf(paths[2])).toBeTruthy());
    const emptied = viewOf(paths[2]) as EditorView;
    act(() => emptied.dispatch({ changes: { from: 0, to: emptied.state.doc.length }, userEvent: 'delete' }));
    // The caret is in it; the stack reads that from the focus event.
    fireEvent.focusIn(emptied.contentDOM);
    // The autosave writes the blank page.
    await act(() => new Promise((resolve) => setTimeout(resolve, 1000)));
    // The list now leaves the blank page out, as StackService does.
    stack.mockImplementation(async (_root: string, _kind: string, head: string) => ({
      success: true as const,
      data: { kind: 'daily' as const, head, sections: paths.filter((path) => path !== paths[2]).map(section), folders: [DAILY] },
    }));
    act(() => listeners.forEach((listener) => listener({ directories: [DAILY] })));
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
    expect(stack).toHaveBeenCalledTimes(2);
    expect(article(paths[2])).toBeTruthy();
    expect(viewOf(paths[2])).toBe(emptied);
    act(() => emptied.dispatch({ changes: { from: 0, insert: 'Typed again.' }, userEvent: 'input.type' }));
    expect(emptied.state.doc.toString()).toBe('Typed again.');
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

describe('mergeSections', () => {
  const list = (...indexes: number[]) => indexes.map((index) => section(paths[index], index));

  it('keeps unchanged sections, drops what the list left out, and keeps a pinned one after the section it followed', () => {
    const previous = list(0, 1, 2, 3);
    expect(mergeSections(previous, list(0, 1, 3)).map((item) => item.path)).toEqual([paths[0], paths[1], paths[3]]);
    const kept = mergeSections(previous, list(0, 1, 3), (path) => path === paths[2]);
    expect(kept.map((item) => item.path)).toEqual([paths[0], paths[1], paths[2], paths[3]]);
    expect(kept[2]).toBe(previous[2]);
    expect(kept[0]).toBe(previous[0]);
    // With every earlier section gone too, it goes first.
    expect(mergeSections(previous, list(3), (path) => path === paths[1]).map((item) => item.path)).toEqual([paths[1], paths[3]]);
  });
});

describe('recording and chat pages', () => {
  const RECORDINGS = '/Vault/Library/recordings';
  const STEM = '2026-10-26 0930 Josh x Lucas (Meet)';
  const SUMMARY = `${RECORDINGS}/${STEM}.md`;
  const TRANSCRIPT = `${RECORDINGS}/transcripts/${STEM} transcript.md`;
  const SUMMARY_BODY = '# Josh x Lucas\n\n## Summary\n\nPrinting timeline.\n';
  const TRANSCRIPT_BODY = '## Transcript\n\n**[09:30:04] John Newsom:** Hey.\n';
  const part = (path: string, label: string, defaultOpen: boolean, detail: string | null = null): StackSection => ({
    path, label, detail, role: 'part', defaultOpen, readOnly: false, textHeading: { level: 2, line: 0 }, size: 300, mtimeMs: 1,
  });
  const head = (path: string): StackSection => ({ ...section(path, 0), detail: null });
  const answer = (kind: 'recording' | 'chat', sections: StackSection[], folders: string[]) =>
    vi.fn(async (_root: string, _kind: string, head: string) => ({ success: true as const, data: { kind, head, sections, folders } }));

  it('shows the summary, then the transcript open, and saves each to its own file', async () => {
    const api = installMarkdownApi({ [SUMMARY]: SUMMARY_BODY, [TRANSCRIPT]: TRANSCRIPT_BODY });
    installVault(answer('recording', [head(SUMMARY), part(TRANSCRIPT, 'Transcript', true)], [RECORDINGS, `${RECORDINGS}/transcripts`]));
    openTabs([stackLocation('recording', SUMMARY)]);
    renderStack(stackLocation('recording', SUMMARY));
    await waitFor(() => expect(viewOf(TRANSCRIPT)).toBeTruthy());
    expect(within(article(SUMMARY)).getByRole('heading', { level: 2 })).toHaveTextContent(STEM);
    // The transcript's own "## Transcript" is its title: the header draws none, only a heading for screen readers.
    const quiet = article(TRANSCRIPT).querySelector('.opal-stack-header') as HTMLElement;
    expect(quiet).toHaveAttribute('data-quiet');
    expect(within(quiet).getByRole('heading', { name: 'Transcript' })).toHaveClass('sr-only');
    expect(within(quiet).queryByRole('button', { name: 'Transcript' })).toBeNull();
    expect(within(quiet).getByText(`${STEM} transcript`)).toBeInTheDocument();
    expect(scroller()).not.toHaveAttribute('data-lone');
    // A recording of notes has no toolbar.
    expect(screen.queryByRole('toolbar')).toBeNull();

    const transcript = viewOf(TRANSCRIPT) as EditorView;
    act(() => transcript.dispatch({ changes: { from: transcript.state.doc.length, insert: 'Lucas: Fixed a speaker label.\n' } }));
    expect(await act(() => flushPendingSaves())).toEqual([]);
    expect(api.documents.get(TRANSCRIPT)?.body).toBe(`${TRANSCRIPT_BODY}Lucas: Fixed a speaker label.\n`);
    expect(api.documents.get(SUMMARY)?.body).toBe(SUMMARY_BODY);
    expect(api.write).toHaveBeenCalledTimes(1);
  });

  it('keeps a folded transcript folded the next time the recording opens', async () => {
    installMarkdownApi({ [SUMMARY]: SUMMARY_BODY, [TRANSCRIPT]: TRANSCRIPT_BODY });
    installVault(answer('recording', [head(SUMMARY), part(TRANSCRIPT, 'Transcript', true)], [RECORDINGS]));
    openTabs([stackLocation('recording', SUMMARY)]);
    const first = renderStack(stackLocation('recording', SUMMARY));
    await waitFor(() => expect(viewOf(TRANSCRIPT)).toBeTruthy());
    fireEvent.click(within(article(TRANSCRIPT)).getByRole('button', { name: `Fold ${STEM} transcript` }));
    await waitFor(() => expect(article(TRANSCRIPT).querySelector('.opal-stack-body')).toBeNull());
    // Folded, the header shows its title again.
    expect(within(article(TRANSCRIPT)).getByRole('button', { name: 'Transcript' })).toBeInTheDocument();
    expect(readPref('stack.folds', {})).toEqual({ [TRANSCRIPT]: false });
    first.unmount();
    // A new launch starts from the saved preference.
    useStackFoldsStore.setState({ folds: readPref('stack.folds', {}) });
    renderStack(stackLocation('recording', SUMMARY));
    await waitFor(() => expect(viewOf(SUMMARY)).toBeTruthy());
    await frames(3);
    expect(article(TRANSCRIPT)).not.toHaveAttribute('data-open');
    expect(viewOf(TRANSCRIPT)).toBeNull();
  });

  it('shows a recording not split yet as one page, with nothing to fold or open alone', async () => {
    const body = `${SUMMARY_BODY}\n${TRANSCRIPT_BODY}`;
    installMarkdownApi({ [SUMMARY]: body });
    installVault(answer('recording', [head(SUMMARY)], [RECORDINGS]));
    // A fold left from before is not applied to a page on its own.
    useStackFoldsStore.setState({ folds: { [SUMMARY]: false } });
    openTabs([stackLocation('recording', SUMMARY)]);
    renderStack(stackLocation('recording', SUMMARY));
    await waitFor(() => expect(viewOf(SUMMARY)?.state.doc.toString()).toBe(body));
    expect(document.querySelectorAll('[data-stack-section]')).toHaveLength(1);
    expect(scroller()).toHaveAttribute('data-lone');
    expect(within(article(SUMMARY)).queryByRole('button', { name: /Fold|Unfold/ })).toBeNull();
    expect(within(article(SUMMARY)).queryByRole('button', { name: /on its own/ })).toBeNull();
    expect(within(article(SUMMARY)).getByRole('heading', { level: 2 })).toHaveTextContent(STEM);
    expect(screen.queryByText('No earlier pages')).toBeNull();
  });

  const CHATS = '/Vault/Library/chats';
  const CARD = `${CHATS}/sf-site-one.md`;
  const OLDER = `${CHATS}/sf-site-one/2026-10-16-claude-1486ab75.md`;
  const NEWER = `${CHATS}/sf-site-one/2026-10-21-claude-f30001cd.md`;
  const CARD_BODY = [
    '# SF Site One', '', '## Sessions', '',
    '- [[Library/chats/sf-site-one/2026-10-16-claude-1486ab75|2026-10-16 · Claude · 16 prompts]]',
    '- [[Library/chats/sf-site-one/2026-10-21-claude-f30001cd|2026-10-21 · Claude · 62 prompts]]', '',
  ].join('\n');

  function renderChat() {
    installVault(answer('chat', [
      head(CARD),
      part(NEWER, '2026-10-21 · Claude', true, '62 prompts · last active 2026-10-28 13:14'),
      part(OLDER, '2026-10-16 · Claude', false, '16 prompts · last active 2026-10-19 15:57'),
    ], [CHATS, `${CHATS}/sf-site-one`]));
    openTabs([stackLocation('chat', CARD)]);
    return renderStack(stackLocation('chat', CARD));
  }

  it('shows the thread card, the newest session open and the older one folded', async () => {
    installMarkdownApi({ [CARD]: CARD_BODY, [NEWER]: '# SF Site One · Claude · 2026-10-21\n\nNewer.\n', [OLDER]: '# SF Site One · Claude · 2026-10-16\n\nOlder.\n' });
    renderChat();
    await waitFor(() => expect(viewOf(NEWER)).toBeTruthy());
    expect([...document.querySelectorAll<HTMLElement>('[data-stack-section]')].map((element) => element.dataset.stackSection)).toEqual([CARD, NEWER, OLDER]);
    expect(article(NEWER)).toHaveAttribute('data-open');
    expect(article(OLDER)).not.toHaveAttribute('data-open');
    await frames(3);
    expect(viewOf(OLDER)).toBeNull();
    // A folded session shows its label and detail, as the card lists it.
    const folded = within(article(OLDER)).getByRole('heading', { level: 2 });
    expect(folded).toHaveTextContent('2026-10-16 · Claude16 prompts · last active 2026-10-19 15:57');
    expect(useStackStore.getState().viewed?.path).toBe(CARD);
  });

  it('drops typing in the card and in a session, and still follows a rewrite from threads.py', async () => {
    const api = installMarkdownApi({ [CARD]: CARD_BODY, [NEWER]: '# Newer\n\nFirst prompt.\n', [OLDER]: '# Older\n' });
    renderChat();
    await waitFor(() => expect(viewOf(NEWER)).toBeTruthy());
    await waitFor(() => expect(viewOf(CARD)).toBeTruthy());
    for (const path of [CARD, NEWER]) {
      const view = viewOf(path) as EditorView;
      const before = view.state.doc.toString();
      expect(view.state.readOnly).toBe(true);
      act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: 'Cody typed a note here.' }, userEvent: 'input.type' }));
      act(() => view.dispatch({ changes: { from: 0, insert: 'x' }, userEvent: 'input.type' }));
      expect(view.state.doc.toString()).toBe(before);
    }
    // The next capture rewrites the session; the stack shows it.
    api.externalEdit(NEWER, '# Newer\n\nFirst prompt.\n\nSecond prompt.\n');
    act(() => listeners.forEach((listener) => listener({ directories: [`${CHATS}/sf-site-one`] })));
    await waitFor(() => expect(viewOf(NEWER)?.state.doc.toString()).toBe('# Newer\n\nFirst prompt.\n\nSecond prompt.\n'));
    expect(within(article(NEWER)).getByRole('button', { name: /^Read-only/ })).toBeInTheDocument();
    expect(await act(() => flushPendingSaves())).toEqual([]);
    expect(api.write).not.toHaveBeenCalled();
  });

  it('scrolls to a session and opens it when its link in the card is followed', async () => {
    installMarkdownApi({ [CARD]: CARD_BODY, [NEWER]: '# Newer\n', [OLDER]: '# Older\n' });
    renderChat();
    await waitFor(() => expect(viewOf(CARD)).toBeTruthy());
    await act(() => openWikiLink(viewOf(CARD) as EditorView, 'Library/chats/sf-site-one/2026-10-16-claude-1486ab75'));
    await waitFor(() => expect(viewOf(OLDER)).toBeTruthy());
    await waitFor(() => expect(scroller().scrollTop).toBe(2 * SECTION_PX));
    expect(useStackFoldsStore.getState().folds).toEqual({ [OLDER]: true });
    // Following it stayed in the stack: no new history step.
    expect(useTabsStore.getState().tabs[0].history).toHaveLength(1);
  });
});

describe('the toolbar of a stack that holds documents', () => {
  // Today as a document and as a note, as when Obsidian made the note, and an older document.
  const TODAY_DOC = `${DAILY}/2026-10-29.mdo`;
  const TODAY_NOTE = `${DAILY}/2026-10-29.md`;
  const OLDER_DOC = `${DAILY}/2026-10-28.mdo`;
  const mixed = [TODAY_DOC, TODAY_NOTE, OLDER_DOC];
  const sectionOf = (path: string, index: number): StackSection => ({
    path, label: path.slice(path.lastIndexOf('/') + 1).replace(/\.mdo?$/, ''), detail: null, role: index === 0 ? 'head' : 'part',
    defaultOpen: true, readOnly: false, textHeading: null, size: 300, mtimeMs: 1,
  });
  const toolbar = () => screen.getByRole('toolbar', { name: 'Formatting' });
  const tool = (name: string) => within(toolbar()).getByRole('button', { name });
  const buttons = () => within(toolbar()).getAllByRole('button');
  // The stack reads focus from the focus event; a real focus here would make happy-dom's selection events reenter CodeMirror.
  const focusIn = (path: string) => {
    const view = viewOf(path) as EditorView;
    fireEvent.focusIn(view.contentDOM);
    return view;
  };
  const text = (path: string) => (viewOf(path) as EditorView).state.doc.toString();

  beforeEach(() => {
    installMarkdownApi({ [TODAY_DOC]: 'Plan the week.\n', [TODAY_NOTE]: 'Written in Obsidian.\n', [OLDER_DOC]: 'Older plan.\n' });
    installVault(vi.fn(async (_root: string, _kind: string, head: string) => ({
      success: true as const,
      data: { kind: 'daily' as const, head, sections: mixed.map(sectionOf), folders: [DAILY] },
    })));
    openTabs([stackLocation('daily', TODAY_DOC)]);
  });

  it('draws the toolbar on Daily from the first frame, greyed while only notes are there, so the stream never moves', async () => {
    installMarkdownApi(Object.fromEntries(paths.map((path) => [path, `Notes from ${label(path)}.\n`])));
    installVault();
    openTabs([stackLocation('daily', HEAD)]);
    renderStack();
    // Before the list arrives the head, a note, is the only section.
    expect(screen.getAllByRole('toolbar', { name: 'Formatting' })).toHaveLength(1);
    await waitFor(() => expect(viewOf(paths[2])).toBeTruthy());
    expect(screen.getAllByRole('toolbar', { name: 'Formatting' })).toHaveLength(1);
    focusIn(paths[1]);
    expect(buttons().every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  });

  it('names each file of a date with both in its fold and open buttons, and shows the date as the label', async () => {
    renderStack(stackLocation('daily', TODAY_DOC));
    await waitFor(() => expect(viewOf(OLDER_DOC)).toBeTruthy());
    expect(within(article(TODAY_DOC)).getByRole('button', { name: '2026-10-29' })).toBeInTheDocument();
    expect(within(article(TODAY_DOC)).getByRole('button', { name: 'Fold 2026-10-29.mdo' })).toBeInTheDocument();
    expect(within(article(TODAY_NOTE)).getByRole('button', { name: 'Fold 2026-10-29.md' })).toBeInTheDocument();
    expect(within(article(TODAY_NOTE)).getByRole('button', { name: 'Open 2026-10-29.md on its own' })).toHaveAttribute('title', 'Open 2026-10-29.md on its own');
    // A date with one file keeps the date alone.
    expect(within(article(OLDER_DOC)).getByRole('button', { name: 'Fold 2026-10-28' })).toBeInTheDocument();
  });

  it('keeps a document’s undo history while its editor is away, and brings it back with the editor', async () => {
    renderStack(stackLocation('daily', TODAY_DOC));
    await waitFor(() => expect(viewOf(OLDER_DOC)).toBeTruthy());
    const today = focusIn(TODAY_DOC);
    act(() => today.dispatch({ changes: { from: today.state.doc.length, insert: 'Book the room.' }, selection: { anchor: today.state.doc.length + 14 }, userEvent: 'input.type' }));
    expect(await act(() => flushPendingSaves())).toEqual([]);
    // Another day takes focus, and today's editor goes, here by folding it, as the planner does far from the view.
    focusIn(OLDER_DOC);
    fireEvent.click(within(article(TODAY_DOC)).getByRole('button', { name: '2026-10-29' }));
    await waitFor(() => expect(viewOf(TODAY_DOC)).toBeNull());
    fireEvent.click(within(article(TODAY_DOC)).getByRole('button', { name: '2026-10-29' }));
    const back = await waitFor(() => {
      const view = viewOf(TODAY_DOC);
      if (!view) throw new Error('no editor yet');
      return view;
    });
    expect(back).not.toBe(today);
    expect(text(TODAY_DOC)).toBe('Plan the week.\nBook the room.');
    focusIn(TODAY_DOC);
    expect(tool('Undo')).toBeEnabled();
    fireEvent.click(tool('Undo'));
    expect(text(TODAY_DOC)).toBe('Plan the week.\n');
    expect(tool('Redo')).toBeEnabled();
  });

  it('puts the caret in an empty page it is asked to, once its editor is up, and not in one with text', async () => {
    installMarkdownApi({ [TODAY_DOC]: '', [TODAY_NOTE]: 'Written in Obsidian.\n', [OLDER_DOC]: 'Older plan.\n' });
    renderStack(stackLocation('daily', OLDER_DOC));
    await waitFor(() => expect(viewOf(TODAY_DOC)).toBeTruthy());
    expect(viewOf(TODAY_DOC)?.hasFocus).toBe(false);
    act(() => useStackStore.getState().askCaret(TODAY_NOTE));
    await frames(2);
    expect(viewOf(TODAY_NOTE)?.hasFocus).toBe(false);
    expect(useStackStore.getState().caret).toBeNull();
    act(() => useStackStore.getState().askCaret(TODAY_DOC));
    await waitFor(() => expect(viewOf(TODAY_DOC)?.hasFocus).toBe(true));
    expect(useStackStore.getState().caret).toBeNull();
    // The toolbar binds to it.
    expect(tool('Bold')).toBeEnabled();
  });

  it('shows one toolbar above the scroll, greyed out in place until a document has focus', async () => {
    renderStack(stackLocation('daily', TODAY_DOC));
    await waitFor(() => expect(viewOf(OLDER_DOC)).toBeTruthy());
    expect(screen.getAllByRole('toolbar', { name: 'Formatting' })).toHaveLength(1);
    expect(scroller().contains(toolbar())).toBe(false);
    expect(toolbar().nextElementSibling).toBe(scroller());
    const count = buttons().length;
    expect(count).toBe(14);
    expect(buttons().every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    // The head had text, so nothing took the caret, and the toolbar took nothing either.
    expect(document.activeElement).toBe(document.body);

    focusIn(TODAY_DOC);
    expect(tool('Bold')).toBeEnabled();
    focusIn(TODAY_NOTE);
    expect(tool('Bold')).toBeDisabled();
    expect(tool('Bulleted list')).toBeDisabled();
    expect(tool('Insert')).toBeDisabled();
    expect(buttons()).toHaveLength(count);
    focusIn(OLDER_DOC);
    expect(tool('Bold')).toBeEnabled();
  });

  it('acts on the document that last had focus, each with its own undo, and never takes the caret', async () => {
    renderStack(stackLocation('daily', TODAY_DOC));
    await waitFor(() => expect(viewOf(OLDER_DOC)).toBeTruthy());
    const today = focusIn(TODAY_DOC);
    act(() => today.dispatch({ selection: { anchor: 0, head: 4 } }));
    expect(tool('Bold')).toHaveAttribute('aria-pressed', 'false');
    expect(fireEvent.mouseDown(tool('Bold'))).toBe(false);
    fireEvent.click(tool('Bold'));
    expect(text(TODAY_DOC)).toBe('**Plan** the week.\n');
    expect(tool('Bold')).toHaveAttribute('aria-pressed', 'true');
    expect(tool('Undo')).toBeEnabled();

    const older = focusIn(OLDER_DOC);
    // Its own history is empty.
    expect(tool('Undo')).toBeDisabled();
    act(() => older.dispatch({ selection: { anchor: 0, head: 5 } }));
    fireEvent.click(tool('Italic'));
    expect(text(OLDER_DOC)).toBe('*Older* plan.\n');

    // A note in between leaves both documents alone.
    focusIn(TODAY_NOTE);
    fireEvent.click(tool('Bold'));
    expect(text(TODAY_NOTE)).toBe('Written in Obsidian.\n');

    focusIn(TODAY_DOC);
    fireEvent.click(tool('Undo'));
    expect(text(TODAY_DOC)).toBe('Plan the week.\n');
    expect(text(OLDER_DOC)).toBe('*Older* plan.\n');
  });

  it('is reached with Option+F10 from a document and gives the caret back to it with Escape', async () => {
    renderStack(stackLocation('daily', TODAY_DOC));
    await waitFor(() => expect(viewOf(OLDER_DOC)).toBeTruthy());
    const older = focusIn(OLDER_DOC);
    act(() => { runScopeHandlers(older, new KeyboardEvent('keydown', { key: 'F10', altKey: true }), 'editor'); });
    expect(toolbar().contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(document.activeElement).toBe(older.contentDOM);
  });
});

describe('the touched list under each daily page', () => {
  const PLAN = '/Vault/Notes/Plan.md';
  const ISSUE_URL = 'https://linear.app/acme/issue/ABC-123/fix';
  const hit = (lines: number, text: string) => ({ lines, text });
  const item = (key: string, extra: Partial<TouchedItem>): TouchedItem => ({
    key, kind: 'file', id: null, name: key, path: null, url: null, days: [null, null, null, null, null, null, null], colour: null, ...extra,
  });
  // HEAD is Thursday 2026-10-29; its week starts on Monday 2026-10-26.
  const WEEK: TouchedWeek = {
    root: ROOT,
    monday: '2026-10-26',
    items: [
      item('Notes/Plan.md', { name: 'Plan', path: PLAN, colour: 0, days: [null, null, hit(1, 'Started the plan.'), hit(1, 'Finished the plan.'), null, null, null] }),
      item('linear:ABC-123', { kind: 'issue', id: 'ABC-123', name: 'Fix the thing', url: ISSUE_URL, days: [null, null, null, hit(2, 'Fixed it.'), null, null, null] }),
      item('Notes/Once.md', { name: 'Once', path: '/Vault/Notes/Once.md', days: [null, hit(1, 'Once.'), null, null, null, null, null] }),
    ],
    digests: [],
  };
  let changed: ((change: TouchedWeekChange) => void) | null;

  beforeEach(() => {
    changed = null;
    const api = window.vaultAPI as unknown as Record<string, unknown>;
    api.touchedWeek = vi.fn(async (_root: string, date: string) => ({
      success: true as const,
      data: date === WEEK.monday ? WEEK : { root: ROOT, monday: date, items: [], digests: [] },
    }));
    api.onTouchedChanged = vi.fn((callback: (change: TouchedWeekChange) => void) => {
      changed = callback;
      return () => undefined;
    });
  });

  const list = (path: string) => article(path).querySelector<HTMLElement>('aside.opal-touched');
  const rows = (path: string) => [...(list(path)?.querySelectorAll<HTMLElement>('.opal-touched-row') ?? [])];

  it('lists a day’s items by count under its page, with the week’s squares, and nothing on a day without any', async () => {
    renderStack();
    await waitFor(() => expect(list(HEAD)).toBeTruthy());
    expect(window.vaultAPI.touchedWeek).toHaveBeenCalledWith(ROOT, '2026-10-26');
    expect(rows(HEAD).map((row) => row.textContent)).toEqual(['ABC-123Fix the thing', 'Plan']);
    expect(rows(paths[1]).map((row) => row.textContent)).toEqual(['Plan']);
    // Monday's one-line item stands alone, so Monday shows nothing.
    expect(list(paths[3])).toBeNull();
    expect(article(HEAD).dataset.touched).toBe('');
    expect(article(paths[3]).dataset.touched).toBeUndefined();
    const letters = [...(list(HEAD)?.querySelectorAll('.opal-touched-head .opal-touched-week > span') ?? [])];
    expect(letters.map((letter) => letter.textContent).join('')).toBe('MTWTFSS');
    expect(letters.findIndex((letter) => letter.hasAttribute('data-today'))).toBe(3);
    const squares = rows(HEAD)[1].querySelectorAll<HTMLElement>('.opal-touched-week > i');
    expect([...squares].map((square) => square.dataset.hit !== undefined)).toEqual([false, false, true, true, false, false, false]);
    expect(squares[2].style.backgroundColor).toBe('var(--touched-0)');
    expect(rows(HEAD)[0].querySelector<HTMLElement>('i[data-hit]')?.style.backgroundColor).toBe('');
  });

  it('links the day’s digest first, and alone on a day that touched nothing', () => {
    const DIGEST = '/Vault/Library/digests/2026-10-29 digest.md';
    const open = vi.fn();
    const { rerender } = render(<TouchedList touched={{ week: WEEK, day: 3, rows: [WEEK.items[0]], digest: DIGEST }} openPath={open} />);
    expect(screen.getAllByRole('button').map((row) => row.textContent)).toEqual(['Digest', 'Plan']);
    fireEvent.click(screen.getByRole('button', { name: 'Digest' }));
    expect(open).toHaveBeenCalledWith(DIGEST, false);
    // No rows: the digest link stands alone, with no weekday letters over it.
    rerender(<TouchedList touched={{ week: WEEK, day: 4, rows: [], digest: DIGEST }} openPath={open} />);
    expect(screen.getAllByRole('button').map((row) => row.textContent)).toEqual(['Digest']);
    expect(screen.queryByText('W')).toBeNull();
  });
  it('dims every other row while one is pointed at, and shows a filled square’s log line', async () => {
    renderStack();
    await waitFor(() => expect(rows(paths[1])).toHaveLength(1));
    const content = screen.getByRole('feed');
    fireEvent.pointerOver(rows(HEAD)[1]);
    expect(content.dataset.touchedHover).toBe('Notes/Plan.md');
    expect([...content.querySelectorAll('.opal-touched-row[data-match]')]).toEqual([rows(HEAD)[1], rows(paths[1])[0]]);
    fireEvent.pointerEnter(rows(HEAD)[1].querySelectorAll('.opal-touched-week > i')[2]);
    expect(screen.getByRole('tooltip').textContent).toBe('Wed, Oct 28, 1 log lineStarted the plan.');
    fireEvent.pointerLeave(content);
    expect(content.dataset.touchedHover).toBeUndefined();
    expect(content.querySelectorAll('[data-match]')).toHaveLength(0);
  });

  it('opens a file as a page link does and a URL in the browser, and reads the week again when it changes', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderStack();
    await waitFor(() => expect(rows(HEAD)).toHaveLength(2));
    fireEvent.click(rows(HEAD)[0]);
    expect(open).toHaveBeenCalledWith(ISSUE_URL, '_blank');
    fireEvent.click(rows(HEAD)[1]);
    await waitFor(() => expect(tabLocation(useTabsStore.getState().tabs[0])).toEqual(fileLocation(PLAN)));
    open.mockRestore();
  });

  it('asks for a week again when the main process says it changed', async () => {
    renderStack();
    await waitFor(() => expect(list(HEAD)).toBeTruthy());
    const calls = vi.mocked(window.vaultAPI.touchedWeek).mock.calls.filter(([, date]) => date === WEEK.monday).length;
    act(() => changed?.({ root: ROOT, monday: WEEK.monday }));
    await waitFor(() => expect(vi.mocked(window.vaultAPI.touchedWeek).mock.calls.filter(([, date]) => date === WEEK.monday)).toHaveLength(calls + 1));
  });
});
