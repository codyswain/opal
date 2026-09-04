import { create } from 'zustand';
import {
  hasPref,
  readPref,
  writePref,
} from '@/renderer/shared/prefs/prefs';

export const SHELL_PREFERENCE_KEY = 'shell.layout';

export const SHELL_LIMITS = {
  sidebar: { min: 180, max: 360 },
  inspector: { min: 280, max: 520 },
} as const;

export interface ShellPreferences {
  sidebarOpen: boolean;
  sidebarWidth: number;
  inspectorOpen: boolean;
  inspectorWidth: number;
  inspectorActiveTab: string | null;
}

export const DEFAULT_SHELL_PREFERENCES: ShellPreferences = {
  sidebarOpen: true,
  sidebarWidth: 220,
  inspectorOpen: false,
  inspectorWidth: 336,
  inspectorActiveTab: null,
};

export interface ShellActions {
  setSidebarOpen(open: boolean): void;
  toggleSidebar(): void;
  setNarrowLayout(narrow: boolean): void;
  closeNarrowSidebar(): void;
  setSidebarWidth(width: number): void;
  setInspectorOpen(open: boolean): void;
  toggleInspector(): void;
  setInspectorWidth(width: number): void;
  setInspectorActiveTab(tabId: string | null): void;
  hydrate(): ShellPreferences;
  reset(): void;
}

export interface ShellRuntimeState {
  narrowLayout: boolean;
  narrowSidebarOpen: boolean;
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

function safeTabId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 80 ? normalized : null;
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
    inspectorOpen: safeBoolean(
      candidate.inspectorOpen,
      fallback.inspectorOpen
    ),
    inspectorWidth: safeWidth(
      candidate.inspectorWidth,
      fallback.inspectorWidth,
      SHELL_LIMITS.inspector
    ),
    inspectorActiveTab: safeTabId(candidate.inspectorActiveTab),
  };
}

function readShellPreferences(): ShellPreferences {
  if (hasPref(SHELL_PREFERENCE_KEY)) {
    const stored = readPref<unknown>(
      SHELL_PREFERENCE_KEY,
      DEFAULT_SHELL_PREFERENCES
    );
    return sanitizeShellPreferences(stored);
  }

  // One-cycle compatibility with App.tsx's pre-shell preference keys.
  const migrated = sanitizeShellPreferences({
    sidebarOpen: readPref('isLeftSidebarOpen', true),
    inspectorOpen: readPref('isRightSidebarOpen', false),
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
    inspectorOpen: state.inspectorOpen,
    inspectorWidth: state.inspectorWidth,
    inspectorActiveTab: state.inspectorActiveTab,
  };
}

export const useShellStore = create<ShellStore>((set) => ({
  ...readShellPreferences(),
  narrowLayout: false,
  narrowSidebarOpen: false,

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
  setInspectorOpen: (inspectorOpen) =>
    set((state) => {
      const next = { ...preferencesFrom(state), inspectorOpen };
      persist(next);
      return next;
    }),
  toggleInspector: () =>
    set((state) => {
      const next = {
        ...preferencesFrom(state),
        inspectorOpen: !state.inspectorOpen,
      };
      persist(next);
      return next;
    }),
  setInspectorWidth: (width) =>
    set((state) => {
      const next = {
        ...preferencesFrom(state),
        inspectorWidth: safeWidth(
          width,
          state.inspectorWidth,
          SHELL_LIMITS.inspector
        ),
      };
      persist(next);
      return next;
    }),
  setInspectorActiveTab: (inspectorActiveTab) =>
    set((state) => {
      const next = {
        ...preferencesFrom(state),
        inspectorActiveTab: safeTabId(inspectorActiveTab),
      };
      persist(next);
      return next;
    }),
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
