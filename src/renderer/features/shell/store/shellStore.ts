import { create } from 'zustand';
import {
  hasPref,
  readPref,
  writePref,
} from '@/renderer/shared/prefs/prefs';

export const SHELL_PREFERENCE_KEY = 'shell.layout';

export const SHELL_LIMITS = {
  sidebar: { min: 180, max: 360 },
} as const;

export interface ShellPreferences {
  sidebarOpen: boolean;
  sidebarWidth: number;
}

export const DEFAULT_SHELL_PREFERENCES: ShellPreferences = {
  sidebarOpen: true,
  sidebarWidth: 260,
};

/** The default before the tree listed files; a sidebar left at it widens to the new one. */
const PREVIOUS_DEFAULT_SIDEBAR_WIDTH = 220;

export interface ShellActions {
  setSidebarOpen(open: boolean): void;
  toggleSidebar(): void;
  setNarrowLayout(narrow: boolean): void;
  closeNarrowSidebar(): void;
  setSidebarWidth(width: number): void;
  setFullScreen(fullScreen: boolean): void;
  hydrate(): ShellPreferences;
  reset(): void;
}

export interface ShellRuntimeState {
  narrowLayout: boolean;
  narrowSidebarOpen: boolean;
  /** The window is in macOS full screen, where the traffic lights are hidden. */
  fullScreen: boolean;
}

export type ShellStore = ShellPreferences & ShellRuntimeState & ShellActions;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function safeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function safeWidth(
  value: unknown,
  fallback: number,
  limits: { min: number; max: number }
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(limits.max, Math.max(limits.min, Math.round(value)));
}

export function sanitizeShellPreferences(
  value: unknown,
  fallback: ShellPreferences = DEFAULT_SHELL_PREFERENCES
): ShellPreferences {
  const candidate = isRecord(value) ? value : {};
  return {
    sidebarOpen: safeBoolean(
      candidate.sidebarOpen,
      fallback.sidebarOpen
    ),
    sidebarWidth: safeWidth(
      candidate.sidebarWidth,
      fallback.sidebarWidth,
      SHELL_LIMITS.sidebar
    ),
  };
}

function readShellPreferences(): ShellPreferences {
  if (hasPref(SHELL_PREFERENCE_KEY)) {
    const stored = sanitizeShellPreferences(
      readPref<unknown>(SHELL_PREFERENCE_KEY, DEFAULT_SHELL_PREFERENCES)
    );
    return stored.sidebarWidth === PREVIOUS_DEFAULT_SIDEBAR_WIDTH
      ? { ...stored, sidebarWidth: DEFAULT_SHELL_PREFERENCES.sidebarWidth }
      : stored;
  }

  // One-cycle compatibility with App.tsx's pre-shell preference keys.
  const migrated = sanitizeShellPreferences({
    sidebarOpen: readPref('isLeftSidebarOpen', true),
  });
  writePref(SHELL_PREFERENCE_KEY, migrated);
  return migrated;
}

function persist(preferences: ShellPreferences): void {
  writePref(SHELL_PREFERENCE_KEY, preferences);
}

function preferencesFrom(state: ShellStore): ShellPreferences {
  return {
    sidebarOpen: state.sidebarOpen,
    sidebarWidth: state.sidebarWidth,
  };
}

export const useShellStore = create<ShellStore>((set) => ({
  ...readShellPreferences(),
  narrowLayout: false,
  narrowSidebarOpen: false,
  fullScreen: false,

  setSidebarOpen: (sidebarOpen) =>
    set((state) => {
      const next = { ...preferencesFrom(state), sidebarOpen };
      persist(next);
      return next;
    }),
  toggleSidebar: () =>
    set((state) => {
      if (state.narrowLayout) {
        return { narrowSidebarOpen: !state.narrowSidebarOpen };
      }
      const next = {
        ...preferencesFrom(state),
        sidebarOpen: !state.sidebarOpen,
      };
      persist(next);
      return next;
    }),
  setNarrowLayout: (narrowLayout) =>
    set((state) =>
      state.narrowLayout === narrowLayout
        ? state
        : { narrowLayout, narrowSidebarOpen: false }
    ),
  closeNarrowSidebar: () => set({ narrowSidebarOpen: false }),
  setSidebarWidth: (width) =>
    set((state) => {
      const next = {
        ...preferencesFrom(state),
        sidebarWidth: safeWidth(
          width,
          state.sidebarWidth,
          SHELL_LIMITS.sidebar
        ),
      };
      persist(next);
      return next;
    }),
  setFullScreen: (fullScreen) => set({ fullScreen }),
  hydrate: () => {
    const next = readShellPreferences();
    set(next);
    return next;
  },
  reset: () => {
    const next = { ...DEFAULT_SHELL_PREFERENCES };
    persist(next);
    set({ ...next, narrowLayout: false, narrowSidebarOpen: false });
  },
}));
