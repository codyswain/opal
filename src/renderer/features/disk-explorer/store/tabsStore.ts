import { create } from 'zustand';
import { readPref, writePref } from '@/renderer/shared/prefs/prefs';

const PREF_KEY = 'tabs.open';

export interface TabsState {
  /** Open tabs, left to right. */
  openPaths: string[];
  activePath: string | null;
  /**
   * The single italic "preview" tab, replaced by the next single-click.
   * Finder and VS Code both work this way: browsing must not litter the strip.
   */
  previewPath: string | null;
}

export interface TabsActions {
  openPreview: (path: string) => void;
  openPinned: (path: string) => void;
  pin: (path: string) => void;
  close: (path: string) => void;
  closeAll: () => void;
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
  return stored.filter((path): path is string => typeof path === 'string');
}

export const useTabsStore = create<TabsStore>((set, get) => ({
  openPaths: [],
  activePath: null,
  previewPath: null,

  openPreview: (path) =>
    set((state) => {
      if (state.openPaths.includes(path)) {
        return { activePath: path };
      }

      // Swap the outgoing preview in place so the tab does not jump position.
      const openPaths = state.previewPath
        ? state.openPaths.map((open) => (open === state.previewPath ? path : open))
        : [...state.openPaths, path];

      const next = { openPaths, activePath: path, previewPath: path };
      persist({ ...state, ...next });
      return next;
    }),

  openPinned: (path) =>
    set((state) => {
      const alreadyOpen = state.openPaths.includes(path);
      const openPaths = alreadyOpen ? state.openPaths : [...state.openPaths, path];
      // Opening pinned what was previewed promotes it rather than duplicating.
      const previewPath = state.previewPath === path ? null : state.previewPath;

      const next = { openPaths, activePath: path, previewPath };
      persist({ ...state, ...next });
      return next;
    }),

  pin: (path) =>
    set((state) => {
      if (state.previewPath !== path) return {};
      const next = { previewPath: null };
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

      const next = { openPaths, activePath, previewPath };
      persist({ ...state, ...next });
      return next;
    }),

  closeAll: () => {
    const next = { openPaths: [], activePath: null, previewPath: null };
    persist(next);
    set(next);
  },

  activate: (path) =>
    set((state) => (state.openPaths.includes(path) ? { activePath: path } : {})),

  activateIndex: (index) =>
    set((state) => {
      const path = state.openPaths[index];
      return path ? { activePath: path } : {};
    }),

  activateNext: () =>
    set((state) => {
      if (state.openPaths.length === 0) return {};
      const current = state.activePath ? state.openPaths.indexOf(state.activePath) : -1;
      const nextIndex = (current + 1) % state.openPaths.length;
      return { activePath: state.openPaths[nextIndex] };
    }),

  activatePrevious: () =>
    set((state) => {
      if (state.openPaths.length === 0) return {};
      const current = state.activePath ? state.openPaths.indexOf(state.activePath) : 0;
      const previousIndex =
        (current - 1 + state.openPaths.length) % state.openPaths.length;
      return { activePath: state.openPaths[previousIndex] };
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
    const next: TabsState = {
      openPaths,
      activePath: openPaths[0] ?? null,
      previewPath: null,
    };
    set(next);
    return next;
  },
}));
