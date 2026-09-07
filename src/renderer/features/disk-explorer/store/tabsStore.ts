import { create } from 'zustand';
import {
  isAbsoluteFsPath,
  isFsPathAtOrBelow,
  normalizeFsPath,
  remapFsPath,
} from '@/common/fsPaths';
import { readPref, writePref } from '@/renderer/shared/prefs/prefs';
import {
  pathMutationCoordinator,
  type AppPathMutation,
} from '../navigation/pathMutationCoordinator';

const PREF_KEY = 'tabs.open';

export interface TabsState {
  /** Open tabs, left to right. */
  openPaths: string[];
  /** File explicitly occupying the Focus surface; never a preview adapter. */
  openedPath: string | null;
  /** @deprecated Task 7: active tab may still point at a preview adapter. */
  activePath: string | null;
  /**
   * The single italic "preview" tab, replaced by the next single-click.
   * Finder and VS Code both work this way: browsing must not litter the strip.
   */
  previewPath: string | null;
  /** Most recently closed first; Cmd+Shift+T reopens the head. Session only. */
  recentlyClosed: string[];
}

export interface TabsActions {
  /** Canonical explicit open action. Real opened files are the only target model. */
  openFile: (path: string) => void;
  /** @deprecated Task 7: temporary selection-driven preview-tab adapter. */
  openPreview: (path: string) => void;
  /** @deprecated Task 7: use openFile. */
  openPinned: (path: string) => void;
  pin: (path: string) => void;
  close: (path: string) => void;
  /** Closes every other tab; the kept tab becomes active. */
  closeOthers: (path: string) => void;
  /** Closes every tab after this one; the active tab moves here if it was among them. */
  closeToRight: (path: string) => void;
  closeAll: () => void;
  /** Reopens the most recently closed tab that is not already open; returns it. */
  reopenClosed: () => string | null;
  activate: (path: string) => void;
  activateIndex: (index: number) => void;
  activateNext: () => void;
  activatePrevious: () => void;
  move: (from: number, to: number) => void;
  hydrate: () => TabsState;
}

export type TabsStore = TabsState & TabsActions;

/** Only pinned tabs persist — see the "does not persist the preview tab" test. */
function persist(state: TabsState): void {
  writePref(
    PREF_KEY,
    state.openPaths.filter((path) => path !== state.previewPath)
  );
}

function restoredPaths(): string[] {
  const stored = readPref<unknown>(PREF_KEY, null);
  if (!Array.isArray(stored)) return [];
  return [
    ...new Set(
      stored
        .filter(
          (path): path is string =>
            typeof path === 'string' && isAbsoluteFsPath(path)
        )
        .map(normalizeFsPath)
    ),
  ];
}

function openFileState(
  state: TabsState,
  path: string
): Pick<
  TabsState,
  'openPaths' | 'openedPath' | 'activePath' | 'previewPath'
> {
  const normalizedPath = normalizeFsPath(path);
  const alreadyOpen = state.openPaths.includes(normalizedPath);
  const openPaths = alreadyOpen
    ? state.openPaths
    : [...state.openPaths, normalizedPath];
  return {
    openPaths,
    openedPath: normalizedPath,
    activePath: normalizedPath,
    previewPath:
      state.previewPath === normalizedPath ? null : state.previewPath,
  };
}

/** A preview tab is not an explicitly opened file. Task 7 removes that case. */
export function selectOpenedPath(state: TabsState): string | null {
  return state.openedPath &&
    state.openedPath !== state.previewPath &&
    state.openPaths.includes(state.openedPath)
    ? state.openedPath
    : null;
}

function activationState(
  state: TabsState,
  path: string
): Pick<TabsState, 'activePath' | 'openedPath'> {
  return {
    activePath: path,
    openedPath: path === state.previewPath ? state.openedPath : path,
  };
}

function nearestRealPath(
  openPaths: readonly string[],
  previewPath: string | null,
  index: number
): string | null {
  return (
    openPaths.slice(index).find((path) => path !== previewPath) ??
    openPaths
      .slice(0, index)
      .reverse()
      .find((path) => path !== previewPath) ??
    null
  );
}

const RECENTLY_CLOSED_LIMIT = 20;

function remember(recentlyClosed: readonly string[], closed: readonly string[]): string[] {
  return [...closed, ...recentlyClosed.filter((path) => !closed.includes(path))].slice(0, RECENTLY_CLOSED_LIMIT);
}

/** Keeps only `kept` tabs (in their current order), moving the active and opened tabs onto a kept one. */
function keepOnly(state: TabsState, kept: readonly string[]): TabsState {
  const openPaths = state.openPaths.filter((path) => kept.includes(path));
  const closed = state.openPaths.filter((path) => !kept.includes(path));
  const previewPath = state.previewPath && openPaths.includes(state.previewPath) ? state.previewPath : null;
  const fallback = openPaths[openPaths.length - 1] ?? null;
  const activePath = state.activePath && openPaths.includes(state.activePath) ? state.activePath : fallback;
  const openedPath = state.openedPath && openPaths.includes(state.openedPath)
    ? state.openedPath
    : nearestRealPath(openPaths, previewPath, Math.max(0, openPaths.length - 1));
  return { openPaths, openedPath, activePath, previewPath, recentlyClosed: remember(state.recentlyClosed, closed) };
}

export const useTabsStore = create<TabsStore>((set, get) => ({
  openPaths: [],
  openedPath: null,
  activePath: null,
  previewPath: null,
  recentlyClosed: [],

  openFile: (path) =>
    set((state) => {
      const next = openFileState(state, path);
      persist({ ...state, ...next });
      return next;
    }),

  openPreview: (path) =>
    set((state) => {
      const normalizedPath = normalizeFsPath(path);
      if (state.openPaths.includes(normalizedPath)) {
        return { activePath: normalizedPath };
      }

      // Swap the outgoing preview in place so the tab does not jump position.
      const openPaths = state.previewPath
        ? state.openPaths.map((open) =>
            open === state.previewPath ? normalizedPath : open
          )
        : [...state.openPaths, normalizedPath];

      const next = {
        openPaths,
        activePath: normalizedPath,
        previewPath: normalizedPath,
      };
      persist({ ...state, ...next });
      return next;
    }),

  openPinned: (path) => get().openFile(path),

  pin: (path) =>
    set((state) => {
      if (state.previewPath !== path) return {};
      const next: Pick<TabsState, 'previewPath' | 'openedPath'> = {
        previewPath: null,
        openedPath:
          state.activePath === path ? path : state.openedPath,
      };
      persist({ ...state, ...next });
      return next;
    }),

  close: (path) =>
    set((state) => {
      const index = state.openPaths.indexOf(path);
      if (index === -1) return {};

      const openPaths = state.openPaths.filter((open) => open !== path);
      const previewPath = state.previewPath === path ? null : state.previewPath;

      let activePath = state.activePath;
      if (state.activePath === path) {
        // Prefer the tab to the right, matching every editor's behaviour.
        activePath = openPaths[index] ?? openPaths[index - 1] ?? null;
      }
      let openedPath = state.openedPath;
      if (openedPath === path) {
        openedPath = nearestRealPath(openPaths, previewPath, index);
      } else if (
        !openedPath &&
        activePath &&
        activePath !== previewPath
      ) {
        openedPath = activePath;
      }

      const next = { openPaths, openedPath, activePath, previewPath, recentlyClosed: remember(state.recentlyClosed, [path]) };
      persist({ ...state, ...next });
      return next;
    }),

  closeOthers: (path) =>
    set((state) => {
      if (!state.openPaths.includes(path)) return {};
      const next = keepOnly(state, [path]);
      persist(next);
      return next;
    }),

  closeToRight: (path) =>
    set((state) => {
      const index = state.openPaths.indexOf(path);
      if (index === -1 || index === state.openPaths.length - 1) return {};
      const next = keepOnly(state, state.openPaths.slice(0, index + 1));
      persist(next);
      return next;
    }),

  closeAll: () =>
    set((state) => {
      const next: TabsState = {
        openPaths: [],
        openedPath: null,
        activePath: null,
        previewPath: null,
        recentlyClosed: remember(state.recentlyClosed, state.openPaths),
      };
      persist(next);
      return next;
    }),

  reopenClosed: () => {
    const state = get();
    const path = state.recentlyClosed.find((candidate) => !state.openPaths.includes(candidate)) ?? null;
    if (!path) return null;
    set({ recentlyClosed: state.recentlyClosed.filter((candidate) => candidate !== path) });
    get().openFile(path);
    return path;
  },

  activate: (path) =>
    set((state) =>
      state.openPaths.includes(path) ? activationState(state, path) : {}
    ),

  activateIndex: (index) =>
    set((state) => {
      const path = state.openPaths[index];
      return path ? activationState(state, path) : {};
    }),

  activateNext: () =>
    set((state) => {
      if (state.openPaths.length === 0) return {};
      const current = state.activePath ? state.openPaths.indexOf(state.activePath) : -1;
      const nextIndex = (current + 1) % state.openPaths.length;
      const path = state.openPaths[nextIndex];
      return path ? activationState(state, path) : {};
    }),

  activatePrevious: () =>
    set((state) => {
      if (state.openPaths.length === 0) return {};
      const current = state.activePath ? state.openPaths.indexOf(state.activePath) : 0;
      const previousIndex =
        (current - 1 + state.openPaths.length) % state.openPaths.length;
      const path = state.openPaths[previousIndex];
      return path ? activationState(state, path) : {};
    }),

  move: (from, to) =>
    set((state) => {
      const count = state.openPaths.length;
      if (from < 0 || to < 0 || from >= count || to >= count) return {};

      const openPaths = [...state.openPaths];
      const [moved] = openPaths.splice(from, 1);
      openPaths.splice(to, 0, moved);

      const next = { openPaths };
      persist({ ...state, ...next });
      return next;
    }),

  hydrate: () => {
    const openPaths = restoredPaths();
    const restored: TabsState = {
      openPaths,
      openedPath: openPaths[0] ?? null,
      activePath: openPaths[0] ?? null,
      previewPath: null,
      recentlyClosed: get().recentlyClosed,
    };
    const allowedRoots = pathMutationCoordinator.getAllowedRoots();
    const next = allowedRoots
      ? retainTabsWithinRoots(restored, allowedRoots)
      : restored;
    persist(next);
    set(next);
    return next;
  },
}));

export function remapTabsState(
  state: TabsState,
  mutation: AppPathMutation
): TabsState {
  const openPaths = [
    ...new Set(
      state.openPaths.map((path) =>
        remapFsPath(path, mutation.oldPath, mutation.newPath)
      )
    ),
  ];
  const activePath = state.activePath
    ? remapFsPath(state.activePath, mutation.oldPath, mutation.newPath)
    : null;
  const openedPath = state.openedPath
    ? remapFsPath(state.openedPath, mutation.oldPath, mutation.newPath)
    : null;
  const previewPath = state.previewPath
    ? remapFsPath(state.previewPath, mutation.oldPath, mutation.newPath)
    : null;
  return {
    openPaths,
    openedPath:
      openedPath && openPaths.includes(openedPath) ? openedPath : null,
    activePath:
      activePath && openPaths.includes(activePath) ? activePath : null,
    previewPath:
      previewPath && openPaths.includes(previewPath) ? previewPath : null,
    recentlyClosed: state.recentlyClosed.map((path) => remapFsPath(path, mutation.oldPath, mutation.newPath)),
  };
}

export function removePathsFromTabsState(
  state: TabsState,
  removedPaths: readonly string[]
): TabsState {
  const isRemoved = (path: string) =>
    removedPaths.some((root) => isFsPathAtOrBelow(root, path));
  const openPaths = state.openPaths.filter((path) => !isRemoved(path));
  const activeIndex = state.activePath
    ? state.openPaths.indexOf(state.activePath)
    : -1;
  let activePath = state.activePath;
  if (activePath && isRemoved(activePath)) {
    activePath =
      state.openPaths
        .slice(activeIndex + 1)
        .find((path) => !isRemoved(path)) ??
      state.openPaths
        .slice(0, Math.max(0, activeIndex))
        .reverse()
        .find((path) => !isRemoved(path)) ??
      null;
  }
  const previewPath =
    state.previewPath && !isRemoved(state.previewPath)
      ? state.previewPath
      : null;
  const openedIndex = state.openedPath
    ? state.openPaths.indexOf(state.openedPath)
    : -1;
  const openedPath =
    state.openedPath === null ? null : !isRemoved(state.openedPath)
      ? state.openedPath
      : nearestRealPath(
          openPaths,
          previewPath,
          Math.max(0, openedIndex)
        );

  return {
    openPaths,
    openedPath:
      openedPath && openPaths.includes(openedPath) ? openedPath : null,
    activePath:
      activePath && openPaths.includes(activePath) ? activePath : null,
    previewPath:
      previewPath && openPaths.includes(previewPath) ? previewPath : null,
    recentlyClosed: state.recentlyClosed.filter((path) => !isRemoved(path)),
  };
}

export function retainTabsWithinRoots(
  state: TabsState,
  roots: readonly string[]
): TabsState {
  const isAllowed = (path: string) =>
    roots.some((root) => isFsPathAtOrBelow(root, path));
  const openPaths = state.openPaths.filter(isAllowed);
  const previewPath =
    state.previewPath && openPaths.includes(state.previewPath)
      ? state.previewPath
      : null;
  const openedPath =
    state.openedPath && openPaths.includes(state.openedPath)
      ? state.openedPath
      : nearestRealPath(openPaths, previewPath, 0);
  const activePath =
    state.activePath && openPaths.includes(state.activePath)
      ? state.activePath
      : openedPath ?? openPaths[0] ?? null;
  return { openPaths, openedPath, activePath, previewPath, recentlyClosed: state.recentlyClosed.filter(isAllowed) };
}

pathMutationCoordinator.register({
  id: 'tabs-store',
  prepareAppMutation: (mutation) => {
    const previous = useTabsStore.getState();
    const next = remapTabsState(previous, mutation);
    return {
      commit: () => {
        persist(next);
        useTabsStore.setState(next);
      },
      rollback: () => {
        persist(previous);
        useTabsStore.setState(previous);
      },
    };
  },
  preparePathRemoval: (paths) => {
    const previous = useTabsStore.getState();
    const next = removePathsFromTabsState(previous, paths);
    return {
      commit: () => {
        persist(next);
        useTabsStore.setState(next);
      },
      rollback: () => {
        persist(previous);
        useTabsStore.setState(previous);
      },
    };
  },
  prepareAllowedRoots: (roots) => {
    const previous = useTabsStore.getState();
    const next = retainTabsWithinRoots(previous, roots);
    return {
      commit: () => {
        persist(next);
        useTabsStore.setState(next);
      },
      rollback: () => {
        persist(previous);
        useTabsStore.setState(previous);
      },
    };
  },
});
