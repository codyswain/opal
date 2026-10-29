import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  RECENT_COLLECTION,
  directoryCollection,
  fileLocation,
} from '@/renderer/features/disk-explorer/navigation/filesLocation';
import {
  removePathsFromTabsState,
  remapTabsState,
  retainTabsWithinRoots,
  selectCanGoBack,
  selectCanGoForward,
  selectCurrentLocation,
  selectLaunchLocation,
  useTabsStore,
} from '@/renderer/features/disk-explorer/store/tabsStore';
import { readPref, writePref } from '@/renderer/shared/prefs/prefs';
import { openTabs, openedPath, resetTabs, tabId, tabPaths } from '@/tests/helpers/tabs';

const A = '/V/a.md';
const B = '/V/b.png';
const C = '/V/c.pdf';
const RECENT = { mode: 'browse', collection: RECENT_COLLECTION } as const;

beforeEach(() => {
  window.localStorage.clear();
  resetTabs();
});

afterEach(() => {
  vi.useRealTimers();
});

const state = () => useTabsStore.getState();
const open = (path: string, newTab = false) => state().open(fileLocation(path), { newTab });

describe('opening', () => {
  it('opens the first file in a new tab and later ones in the active tab', () => {
    open(A);
    expect(tabPaths()).toEqual([A]);
    open(B);
    expect(tabPaths()).toEqual([B]);
    expect(openedPath()).toBe(B);
  });

  it('opens a new tab beside the active one and activates it', () => {
    openTabs([A, C]);
    open(B, true);
    expect(tabPaths()).toEqual([A, B, C]);
    expect(openedPath()).toBe(B);
  });

  it('allows the same file in two tabs, as Obsidian and Safari do', () => {
    open(A);
    open(A, true);
    expect(tabPaths()).toEqual([A, A]);
  });

  it('names a file by the folder that holds it, whatever the caller passed', () => {
    state().open({ mode: 'focus', collection: RECENT_COLLECTION, file: A });
    expect(selectCurrentLocation(state())).toEqual(fileLocation(A));
  });

  it('shows Recent and folders in a tab too', () => {
    open(A);
    state().open(RECENT);
    expect(tabPaths()).toEqual([null]);
    expect(selectCurrentLocation(state())).toEqual(RECENT);
  });
});

describe('history per tab', () => {
  it('walks back and forward within the active tab', () => {
    open(A);
    open(B);
    expect(selectCanGoBack(state())).toBe(true);
    state().back();
    expect(openedPath()).toBe(A);
    expect(selectCanGoForward(state())).toBe(true);
    state().forward();
    expect(openedPath()).toBe(B);
    expect(selectCanGoForward(state())).toBe(false);
  });

  it('drops forward entries when a new place opens after Back', () => {
    open(A);
    open(B);
    state().back();
    open(C);
    expect(state().tabs[0].history.map((entry) => entry.location)).toEqual([
      fileLocation(A),
      fileLocation(C),
    ]);
  });

  it('keeps each tab its own history, and switching tabs is never a step', () => {
    open(A);
    open(B);
    open(C, true);
    expect(selectCanGoBack(state())).toBe(false);
    state().activate(tabId(0));
    state().activate(tabId(1));
    state().activate(tabId(0));
    expect(state().tabs[0].history).toHaveLength(2);
    state().back();
    expect(tabPaths()).toEqual([A, C]);
  });

  it('adds no step for the place already shown, and swaps it with replace', () => {
    open(A);
    open(A);
    expect(state().tabs[0].history).toHaveLength(1);
    state().open(fileLocation(B), { replace: true });
    expect(state().tabs[0].history.map((entry) => entry.location)).toEqual([fileLocation(B)]);
  });

  it('remembers the scroll of one entry', () => {
    open(A);
    open(B);
    state().saveScroll(tabId(0), 0, 420);
    state().back();
    expect(state().tabs[0].history[0].scrollTop).toBe(420);
  });
});

describe('closing', () => {
  it('activates the neighbour to the right, or the left for the last tab', () => {
    openTabs([A, B, C], 1);
    state().close(tabId(1));
    expect(openedPath()).toBe(C);
    state().close(tabId(1));
    expect(openedPath()).toBe(A);
    state().close(tabId(0));
    expect(tabPaths()).toEqual([]);
    expect(state().activeId).toBeNull();
  });

  it('does not change the active tab when a different tab closes', () => {
    openTabs([A, B, C], 0);
    state().close(tabId(2));
    expect(openedPath()).toBe(A);
  });

  it('closeOthers keeps one tab and makes it active', () => {
    openTabs([A, B, C], 2);
    state().closeOthers(tabId(1));
    expect(tabPaths()).toEqual([B]);
    expect(openedPath()).toBe(B);
  });

  it('closeToRight keeps the tab and everything before it, moving the active tab there', () => {
    openTabs([A, B, C], 2);
    state().closeToRight(tabId(0));
    expect(tabPaths()).toEqual([A]);
    expect(openedPath()).toBe(A);
  });

  it('reopens closed tabs where they were, history and all', () => {
    openTabs([A, B, C], 1);
    open(A);
    state().close(tabId(1));
    expect(state().reopenClosed()).toBe(true);
    expect(tabPaths()).toEqual([A, A, C]);
    state().back();
    expect(tabPaths()).toEqual([A, B, C]);
    expect(state().reopenClosed()).toBe(false);
  });

  it('reopens a bulk close from the left so the order comes back', () => {
    openTabs([A, B, C], 1);
    state().closeOthers(tabId(1));
    state().reopenClosed();
    state().reopenClosed();
    expect(tabPaths()).toEqual([A, B, C]);
  });

  it('closeAll empties the row and remembers every tab', () => {
    openTabs([A, B]);
    state().closeAll();
    expect(tabPaths()).toEqual([]);
    expect(state().recentlyClosed).toHaveLength(2);
  });
});

describe('ordering and selection', () => {
  it('moves a tab and ignores an out-of-range move', () => {
    openTabs([A, B, C]);
    state().move(0, 2);
    expect(tabPaths()).toEqual([B, C, A]);
    state().move(0, 5);
    expect(tabPaths()).toEqual([B, C, A]);
  });

  it('activates by position, with -1 for the last tab', () => {
    openTabs([A, B, C]);
    state().activateIndex(1);
    expect(openedPath()).toBe(B);
    state().activateIndex(-1);
    expect(openedPath()).toBe(C);
    state().activateIndex(8);
    expect(openedPath()).toBe(C);
  });

  it('cycles in both directions and wraps', () => {
    openTabs([A, B, C], 2);
    state().activateNext();
    expect(openedPath()).toBe(A);
    state().activatePrevious();
    expect(openedPath()).toBe(C);
    resetTabs();
    state().activateNext();
    expect(state().activeId).toBeNull();
  });
});

describe('persistence', () => {
  it('restores the tabs, their history and the active tab', () => {
    open(A);
    open(B);
    open(C, true);
    state().activate(tabId(0));
    const restored = state().hydrate();
    expect(restored.tabs.map((tab) => tab.history.length)).toEqual([2, 1]);
    expect(restored.tabs[0].index).toBe(1);
    expect(openedPath()).toBe(B);
  });

  it('records the day of the session, which launch compares with today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 27, 18));
    open(A);
    vi.setSystemTime(new Date(2026, 9, 28, 9));
    expect(state().hydrate().lastSessionDate).toBe('2026-10-27');
  });

  it('goes back to the restored tab on launch only on the same day', () => {
    open(A);
    const restored = state().hydrate();
    expect(selectLaunchLocation(restored, restored.lastSessionDate ?? '')).toEqual(fileLocation(A));
    expect(selectLaunchLocation(restored, '2999-01-01')).toBeNull();
    resetTabs();
    expect(selectLaunchLocation(state(), '2026-10-28')).toBeNull();
  });

  it('reads tabs saved before tabs had history', () => {
    writePref('tabs.open', [A, 'not absolute', B]);
    const restored = state().hydrate();
    expect(tabPaths()).toEqual([A, B]);
    expect(restored.lastSessionDate).toBeNull();
  });

  it('drops corrupt entries instead of failing the launch', () => {
    writePref('tabs.session', {
      date: '2026-10-28',
      active: 1,
      tabs: [
        { history: [{ location: { mode: 'focus', file: 'relative.md' } }], index: 0 },
        { history: [{ location: fileLocation(A), scrollTop: -5 }, { location: RECENT }], index: 9 },
      ],
    });
    state().hydrate();
    expect(state().tabs).toHaveLength(1);
    expect(state().tabs[0].index).toBe(1);
    expect(state().tabs[0].history[0]).toEqual({ location: fileLocation(A) });
  });

  it('keeps no more than fifty history entries per tab', () => {
    for (let index = 0; index < 60; index += 1) open(`/V/${index}.md`);
    expect(state().tabs[0].history).toHaveLength(50);
    expect(readPref<{ tabs: { history: unknown[] }[] }>('tabs.session', { tabs: [] }).tabs[0].history).toHaveLength(50);
  });
});

describe('path changes', () => {
  it('remaps every entry, closed tabs too, and keeps a file under its new folder', () => {
    openTabs([A, B]);
    state().open({ mode: 'browse', collection: directoryCollection('/V') });
    state().close(tabId(1));
    const next = remapTabsState(state(), { kind: 'move', oldPath: A, newPath: '/W/a.md' });
    expect(next.tabs[0].history[0].location).toEqual(fileLocation('/W/a.md'));
    expect(next.tabs[0].history[1].location).toEqual({
      mode: 'browse',
      collection: directoryCollection('/V'),
    });
    const moved = remapTabsState(state(), { kind: 'move', oldPath: '/V', newPath: '/X' });
    expect(moved.recentlyClosed[0].tab.history[0].location).toEqual(fileLocation('/X/b.png'));
  });

  it('falls back within a tab when its page goes, and closes a tab left with nothing', () => {
    openTabs([A, B], 0);
    open(C);
    const next = removePathsFromTabsState(state(), [C, B]);
    expect(next.tabs.map((tab) => tab.history.map((entry) => entry.location))).toEqual([
      [fileLocation(A)],
    ]);
    expect(next.activeId).toBe(next.tabs[0].id);
  });

  it('moves the active tab right when it closes for a removal', () => {
    openTabs([A, B, C], 1);
    const next = removePathsFromTabsState(state(), [B]);
    expect(next.tabs.map((tab) => tab.history[0].location)).toEqual([
      fileLocation(A),
      fileLocation(C),
    ]);
    expect(next.activeId).toBe(next.tabs[1].id);
  });

  it('keeps Recent and places inside the allowed roots', () => {
    openTabs([A, '/Gone/x.md', RECENT], 1);
    const next = retainTabsWithinRoots(state(), ['/V']);
    expect(next.tabs.map((tab) => tab.history[0].location)).toEqual([fileLocation(A), RECENT]);
    expect(next.activeId).toBe(next.tabs[1].id);
  });
});
