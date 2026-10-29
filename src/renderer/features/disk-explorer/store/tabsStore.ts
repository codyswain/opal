import { create } from 'zustand';
import {
  isAbsoluteFsPath,
  isFsPathAtOrBelow,
  normalizeFsPath,
} from '@/common/fsPaths';
import { localDate } from '@/common/vaultModel';
import { readPref, writePref } from '@/renderer/shared/prefs/prefs';
import {
  RECENT_COLLECTION,
  fileLocation,
  filesLocationKey,
  locationPath,
  remapFilesLocation,
  type FilesLocation,
} from '../navigation/filesLocation';
import {
  pathMutationCoordinator,
  type AppPathMutation,
} from '../navigation/pathMutationCoordinator';

const PREF_KEY = 'tabs.session';
/** Before tabs had history, the open files were saved as a list of paths. */
const LEGACY_PREF_KEY = 'tabs.open';
const HISTORY_LIMIT = 50;
const RECENTLY_CLOSED_LIMIT = 20;

export interface TabEntry {
  location: FilesLocation;
  /** How far the page was scrolled when the tab last left this entry. */
  scrollTop?: number;
}

/**
 * One tab, as in Safari and Obsidian: it shows one place at a time and keeps
 * its own back and forward history.
 */
export interface Tab {
  id: string;
  /** Everything the tab has shown, oldest first. */
  history: TabEntry[];
  /** The entry the tab shows now. */
  index: number;
}

export interface TabsState {
  /** Open tabs, left to right. */
  tabs: Tab[];
  activeId: string | null;
  /** Most recently closed first, history and all; Cmd+Shift+T reopens the head. */
  recentlyClosed: ClosedTab[];
  /** The day the previous session last saved its tabs. Launch opens Today when it is not today. */
  lastSessionDate: string | null;
}

/** A closed tab and the position it had, where reopening puts it back. */
export interface ClosedTab {
  tab: Tab;
  index: number;
}

export interface OpenOptions {
  /** Open beside the active tab instead of in it. */
  newTab?: boolean;
  /** Swap the entry the tab shows instead of adding a history step. */
  replace?: boolean;
}

export interface TabsActions {
  /**
   * Shows a place in the active tab as a new history step, or in a new tab.
   * With no tab open it opens one either way.
   */
  open: (location: FilesLocation, options?: OpenOptions) => void;
  back: () => void;
  forward: () => void;
  activate: (id: string) => void;
  /** By position from the left; -1 is the last tab. */
  activateIndex: (index: number) => void;
  activateNext: () => void;
  activatePrevious: () => void;
  close: (id: string) => void;
  /** Closes every other tab; the kept tab becomes active. */
  closeOthers: (id: string) => void;
  /** Closes every tab after this one; the active tab moves here if it was among them. */
  closeToRight: (id: string) => void;
  closeAll: () => void;
  /** Reopens the most recently closed tab where it was; false when there is none. */
  reopenClosed: () => boolean;
  move: (from: number, to: number) => void;
  /** Remembers the scroll of one entry, so Back and switching tabs return to it. */
  saveScroll: (id: string, index: number, scrollTop: number) => void;
  hydrate: () => TabsState;
}

export type TabsStore = TabsState & TabsActions;

let createdTabs = 0;

function createTab(history: TabEntry[], index = history.length - 1): Tab {
  createdTabs += 1;
  return { id: `tab-${createdTabs}`, history, index };
}

export function tabLocation(tab: Tab): FilesLocation {
  return tab.history[tab.index].location;
}

/** The file a tab shows, or null while it shows Recent. */
export function tabFile(tab: Tab): string | null {
  const location = tabLocation(tab);
  return location.mode === 'focus' ? location.file : null;
}

export function selectActiveTab(state: TabsState): Tab | null {
  return state.tabs.find((tab) => tab.id === state.activeId) ?? null;
}

export function selectCurrentLocation(state: TabsState): FilesLocation | null {
  const tab = selectActiveTab(state);
  return tab ? tabLocation(tab) : null;
}

/** The file the page shows. */
export function selectOpenedPath(state: TabsState): string | null {
  const tab = selectActiveTab(state);
  return tab ? tabFile(tab) : null;
}

export function selectCanGoBack(state: TabsState): boolean {
  const tab = selectActiveTab(state);
  return !!tab && tab.index > 0;
}

export function selectCanGoForward(state: TabsState): boolean {
  const tab = selectActiveTab(state);
  return !!tab && tab.index < tab.history.length - 1;
}

/**
 * The place launch goes back to: the active restored tab, unless nothing was
 * restored or the day has changed since the last session, when launch opens
 * Today instead.
 */
export function selectLaunchLocation(
  state: TabsState,
  today = localDate()
): FilesLocation | null {
  return state.lastSessionDate === today ? selectCurrentLocation(state) : null;
}

/** Tabs compare places by key, so a file's path is kept normalized. */
function canonical(location: FilesLocation): FilesLocation {
  return location.mode === 'focus' ? fileLocation(location.file) : location;
}

interface StoredSession {
  date: string;
  active: number;
  tabs: Array<Pick<Tab, 'history' | 'index'>>;
}

function persist(state: Pick<TabsState, 'tabs' | 'activeId'>): void {
  writePref<StoredSession>(PREF_KEY, {
    date: localDate(),
    active: state.tabs.findIndex((tab) => tab.id === state.activeId),
    tabs: state.tabs.map(({ history, index }) => ({ history, index })),
  });
}

function isStoredPath(value: unknown): value is string {
  return typeof value === 'string' && isAbsoluteFsPath(value);
}

/** Folder pages are gone; a stored one is dropped from the history. */
function restoredLocation(value: unknown): FilesLocation | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as {
    mode?: unknown;
    collection?: { kind?: unknown };
    file?: unknown;
  };
  if (candidate.mode === 'focus') {
    return isStoredPath(candidate.file) ? fileLocation(candidate.file) : null;
  }
  return candidate.mode === 'browse' && candidate.collection?.kind === 'recent'
    ? { mode: 'browse', collection: RECENT_COLLECTION }
    : null;
}

function restoredTab(value: unknown): Tab | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { history?: unknown; index?: unknown };
  if (!Array.isArray(candidate.history)) return null;
  const history = candidate.history
    .flatMap((value: unknown): TabEntry[] => {
      const entry = value as Partial<TabEntry> | null;
      const location = restoredLocation(entry?.location);
      if (!location) return [];
      const scrollTop = entry?.scrollTop;
      return typeof scrollTop === 'number' && Number.isFinite(scrollTop) && scrollTop > 0
        ? [{ location, scrollTop }]
        : [{ location }];
    })
    .slice(-HISTORY_LIMIT);
  if (history.length === 0) return null;
  const index =
    typeof candidate.index === 'number' && Number.isInteger(candidate.index)
      ? Math.min(history.length - 1, Math.max(0, candidate.index))
      : history.length - 1;
  return createTab(history, index);
}

function restoredSession(): Pick<TabsState, 'tabs' | 'activeId' | 'lastSessionDate'> {
  const stored = readPref<unknown>(PREF_KEY, null);
  if (stored && typeof stored === 'object') {
    const session = stored as Partial<StoredSession>;
    const candidates = Array.isArray(session.tabs) ? session.tabs.map(restoredTab) : [];
    const tabs = candidates.filter((tab): tab is Tab => tab !== null);
    const active =
      typeof session.active === 'number' ? candidates[session.active] : null;
    return {
      tabs,
      activeId: active?.id ?? tabs[0]?.id ?? null,
      lastSessionDate: typeof session.date === 'string' ? session.date : null,
    };
  }
  const legacy = readPref<unknown>(LEGACY_PREF_KEY, null);
  const paths = Array.isArray(legacy)
    ? [...new Set(legacy.filter(isStoredPath).map(normalizeFsPath))]
    : [];
  const tabs = paths.map((path) => createTab([{ location: fileLocation(path) }]));
  return { tabs, activeId: tabs[0]?.id ?? null, lastSessionDate: null };
}

function replaceTab(tabs: readonly Tab[], tab: Tab): Tab[] {
  return tabs.map((candidate) => (candidate.id === tab.id ? tab : candidate));
}

/** Inserts beside the active tab, where Obsidian and Safari put a new one. */
function insertBesideActive(state: TabsState, tab: Tab): Tab[] {
  const active = state.tabs.findIndex((candidate) => candidate.id === state.activeId);
  const at = active === -1 ? state.tabs.length : active + 1;
  return [...state.tabs.slice(0, at), tab, ...state.tabs.slice(at)];
}

function remember(state: TabsState, closed: readonly Tab[]): ClosedTab[] {
  // A bulk close reopens from the left, so each tab lands back where it was.
  const entries = closed.map((tab) => ({ tab, index: state.tabs.indexOf(tab) }));
  return [...entries, ...state.recentlyClosed].slice(0, RECENTLY_CLOSED_LIMIT);
}

function openState(
  state: TabsState,
  target: FilesLocation,
  options: OpenOptions
): Partial<TabsState> {
  const location = canonical(target);
  const active = selectActiveTab(state);
  if (!active || options.newTab) {
    const tab = createTab([{ location }]);
    return { tabs: insertBesideActive(state, tab), activeId: tab.id };
  }
  if (filesLocationKey(tabLocation(active)) === filesLocationKey(location)) return {};
  if (options.replace) {
    const history = active.history.map((entry, index) =>
      index === active.index ? { location } : entry
    );
    return { tabs: replaceTab(state.tabs, { ...active, history }) };
  }
  const history = [...active.history.slice(0, active.index + 1), { location }].slice(
    -HISTORY_LIMIT
  );
  return {
    tabs: replaceTab(state.tabs, { ...active, history, index: history.length - 1 }),
  };
}

function stepState(state: TabsState, delta: number): Partial<TabsState> {
  const tab = selectActiveTab(state);
  const index = tab ? tab.index + delta : -1;
  if (!tab || index < 0 || index >= tab.history.length) return {};
  return { tabs: replaceTab(state.tabs, { ...tab, index }) };
}

function activateAt(state: TabsState, index: number): Partial<TabsState> {
  const tab = state.tabs.at(index);
  return tab && tab.id !== state.activeId ? { activeId: tab.id } : {};
}

function cycle(state: TabsState, delta: number): Partial<TabsState> {
  if (state.tabs.length === 0) return {};
  const current = state.tabs.findIndex((tab) => tab.id === state.activeId);
  const from = current === -1 ? (delta > 0 ? -1 : 0) : current;
  return activateAt(state, (from + delta + state.tabs.length) % state.tabs.length);
}

/** Keeps only `kept` tabs in their order, moving the active tab onto a kept one. */
function keepOnly(state: TabsState, kept: readonly Tab[]): Partial<TabsState> {
  const tabs = state.tabs.filter((tab) => kept.includes(tab));
  const closed = state.tabs.filter((tab) => !kept.includes(tab));
  const activeId = tabs.some((tab) => tab.id === state.activeId)
    ? state.activeId
    : (tabs.at(-1)?.id ?? null);
  return { tabs, activeId, recentlyClosed: remember(state, closed) };
}

export const useTabsStore = create<TabsStore>((set, get) => {
  const update = (change: (state: TabsState) => Partial<TabsState>) =>
    set((state) => {
      const next = change(state);
      if (Object.keys(next).length > 0) persist({ ...state, ...next });
      return next;
    });

  return {
    ...restoredSession(),
    recentlyClosed: [],

    open: (location, options = {}) =>
      update((state) => openState(state, location, options)),

    back: () => update((state) => stepState(state, -1)),

    forward: () => update((state) => stepState(state, 1)),

    activate: (id) =>
      update((state) =>
        state.activeId !== id && state.tabs.some((tab) => tab.id === id)
          ? { activeId: id }
          : {}
      ),

    activateIndex: (index) => update((state) => activateAt(state, index)),

    activateNext: () => update((state) => cycle(state, 1)),

    activatePrevious: () => update((state) => cycle(state, -1)),

    close: (id) =>
      update((state) => {
        const index = state.tabs.findIndex((tab) => tab.id === id);
        if (index === -1) return {};
        const tabs = state.tabs.filter((tab) => tab.id !== id);
        // Prefer the tab to the right, as browsers do.
        const activeId =
          state.activeId === id
            ? (tabs[index] ?? tabs[index - 1])?.id ?? null
            : state.activeId;
        return {
          tabs,
          activeId,
          recentlyClosed: remember(state, [state.tabs[index]]),
        };
      }),

    closeOthers: (id) =>
      update((state) => {
        const tab = state.tabs.find((candidate) => candidate.id === id);
        return tab ? { ...keepOnly(state, [tab]), activeId: id } : {};
      }),

    closeToRight: (id) =>
      update((state) => {
        const index = state.tabs.findIndex((tab) => tab.id === id);
        if (index === -1 || index === state.tabs.length - 1) return {};
        const kept = state.tabs.slice(0, index + 1);
        const next = keepOnly(state, kept);
        return kept.some((tab) => tab.id === state.activeId) ? next : { ...next, activeId: id };
      }),

    closeAll: () => update((state) => keepOnly(state, [])),

    reopenClosed: () => {
      const [closed, ...rest] = get().recentlyClosed;
      if (!closed) return false;
      update((state) => ({
        tabs: [
          ...state.tabs.slice(0, closed.index),
          closed.tab,
          ...state.tabs.slice(closed.index),
        ],
        activeId: closed.tab.id,
        recentlyClosed: rest,
      }));
      return true;
    },

    move: (from, to) =>
      update((state) => {
        const count = state.tabs.length;
        if (from < 0 || to < 0 || from >= count || to >= count || from === to) return {};
        const tabs = [...state.tabs];
        const [moved] = tabs.splice(from, 1);
        tabs.splice(to, 0, moved);
        return { tabs };
      }),

    saveScroll: (id, index, scrollTop) =>
      update((state) => {
        const tab = state.tabs.find((candidate) => candidate.id === id);
        const entry = tab?.history[index];
        if (!tab || !entry || entry.scrollTop === scrollTop) return {};
        const history = tab.history.map((candidate, at) =>
          at === index ? { ...candidate, scrollTop } : candidate
        );
        return { tabs: replaceTab(state.tabs, { ...tab, history }) };
      }),

    hydrate: () => {
      const restored: TabsState = {
        ...restoredSession(),
        recentlyClosed: get().recentlyClosed,
      };
      const allowedRoots = pathMutationCoordinator.getAllowedRoots();
      const next = allowedRoots
        ? retainTabsWithinRoots(restored, allowedRoots)
        : restored;
      set(next);
      return next;
    },
  };
});

function remapEntry(entry: TabEntry, mutation: AppPathMutation): TabEntry {
  const { location } = remapFilesLocation(entry.location, mutation.oldPath, mutation.newPath);
  return { ...entry, location };
}

function remapTab(tab: Tab, mutation: AppPathMutation): Tab {
  return { ...tab, history: tab.history.map((entry) => remapEntry(entry, mutation)) };
}

export function remapTabsState(
  state: TabsState,
  mutation: AppPathMutation
): TabsState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => remapTab(tab, mutation)),
    recentlyClosed: state.recentlyClosed.map((closed) => ({
      ...closed,
      tab: remapTab(closed.tab, mutation),
    })),
  };
}

/**
 * Drops every history entry `keep` rejects. A tab whose current entry goes
 * shows the nearest earlier entry that stays, as if Back were pressed; a tab
 * with nothing left closes, and the active tab then moves right, as on close.
 */
function keepEntries(
  state: TabsState,
  keep: (path: string) => boolean
): TabsState {
  const kept = (entry: TabEntry) => {
    const path = locationPath(entry.location);
    return path === null || keep(path);
  };
  const prune = (tab: Tab): Tab | null => {
    const history = tab.history.filter(kept);
    if (history.length === 0) return null;
    if (history.length === tab.history.length) return tab;
    const earlier = tab.history.slice(0, tab.index + 1).filter(kept).length;
    return { ...tab, history, index: Math.max(0, earlier - 1) };
  };
  const pruned = state.tabs.map(prune);
  const tabs = pruned.filter((tab): tab is Tab => tab !== null);
  const activeIndex = state.tabs.findIndex((tab) => tab.id === state.activeId);
  const activeId =
    activeIndex === -1
      ? null
      : (pruned.slice(activeIndex).find(Boolean) ??
          pruned.slice(0, activeIndex).reverse().find(Boolean))?.id ?? null;
  return {
    ...state,
    tabs,
    activeId,
    recentlyClosed: state.recentlyClosed.flatMap((closed) => {
      const tab = prune(closed.tab);
      return tab ? [{ ...closed, tab }] : [];
    }),
  };
}

export function removePathsFromTabsState(
  state: TabsState,
  removedPaths: readonly string[]
): TabsState {
  return keepEntries(
    state,
    (path) => !removedPaths.some((root) => isFsPathAtOrBelow(root, path))
  );
}

export function retainTabsWithinRoots(
  state: TabsState,
  roots: readonly string[]
): TabsState {
  return keepEntries(state, (path) =>
    roots.some((root) => isFsPathAtOrBelow(root, path))
  );
}

function prepare(next: (previous: TabsState) => TabsState) {
  const previous = useTabsStore.getState();
  const updated = next(previous);
  return {
    commit: () => {
      persist(updated);
      useTabsStore.setState(updated);
    },
    rollback: () => {
      persist(previous);
      useTabsStore.setState(previous);
    },
  };
}

pathMutationCoordinator.register({
  id: 'tabs-store',
  prepareAppMutation: (mutation) =>
    prepare((previous) => remapTabsState(previous, mutation)),
  preparePathRemoval: (paths) =>
    prepare((previous) => removePathsFromTabsState(previous, paths)),
  prepareAllowedRoots: (roots) =>
    prepare((previous) => retainTabsWithinRoots(previous, roots)),
});
