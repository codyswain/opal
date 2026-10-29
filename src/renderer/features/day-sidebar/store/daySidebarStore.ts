import { create } from 'zustand';
import { localDate } from '@/common/vaultModel';
import {
  selectOpenedPath,
  useTabsStore,
} from '@/renderer/features/disk-explorer/store/tabsStore';
import { useShellStore } from '@/renderer/features/shell/store/shellStore';
import { readPref, writePref } from '@/renderer/shared/prefs/prefs';
import {
  afterDayPicked,
  afterPageOpened,
  type DayRuleState,
} from '../dayRule';

export const DAY_SIDEBAR_PREFERENCE_KEY = 'daySidebar';

export const DAY_SECTIONS = ['activity', 'chats', 'recordings', 'digest'] as const;
export type DaySection = (typeof DAY_SECTIONS)[number];

export const DAY_SECTION_TITLES: Record<DaySection, string> = {
  activity: 'Activity log',
  chats: 'Chats',
  recordings: 'Recordings',
  digest: 'Digest',
};

/** Below this window width only one sidebar stays open, so the page keeps about 560px. */
export const ONE_SIDEBAR_BELOW = 1000;
/** At and above this width the sidebar is wider, as the left one is. */
const WIDE_FROM = 1200;

export const DAY_SIDEBAR_LIMITS = {
  min: 240,
  wide: { default: 300, max: 400 },
  medium: { default: 260, max: 300 },
} as const;

export interface DaySidebarPreferences {
  open: boolean;
  sections: Record<DaySection, boolean>;
  /** Cards folded to their header. */
  collapsed: Record<DaySection, boolean>;
  /** A width the user dragged to, or null for the default. */
  width: number | null;
}

export const DEFAULT_DAY_SIDEBAR_PREFERENCES: DaySidebarPreferences = {
  open: true,
  sections: { activity: true, chats: true, recordings: true, digest: true },
  collapsed: { activity: false, chats: false, recordings: false, digest: false },
  width: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function flags(value: unknown, fallback: Record<DaySection, boolean>): Record<DaySection, boolean> {
  const candidate = isRecord(value) ? value : {};
  return Object.fromEntries(
    DAY_SECTIONS.map((section) => [
      section,
      typeof candidate[section] === 'boolean' ? candidate[section] : fallback[section],
    ]),
  ) as Record<DaySection, boolean>;
}

function safeWidth(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(DAY_SIDEBAR_LIMITS.wide.max, Math.max(DAY_SIDEBAR_LIMITS.min, Math.round(value)));
}

export function sanitizeDaySidebarPreferences(value: unknown): DaySidebarPreferences {
  const candidate = isRecord(value) ? value : {};
  const fallback = DEFAULT_DAY_SIDEBAR_PREFERENCES;
  return {
    open: typeof candidate.open === 'boolean' ? candidate.open : fallback.open,
    sections: flags(candidate.sections, fallback.sections),
    collapsed: flags(candidate.collapsed, fallback.collapsed),
    width: safeWidth(candidate.width),
  };
}

/** The width for a window width: the dragged width within the layout's limit, or the layout's default. */
export function daySidebarWidth(preferred: number | null, viewport: number): number {
  const limits = viewport >= WIDE_FROM ? DAY_SIDEBAR_LIMITS.wide : DAY_SIDEBAR_LIMITS.medium;
  return preferred === null ? limits.default : Math.min(limits.max, preferred);
}

export function daySidebarMaxWidth(viewport: number): number {
  return viewport >= WIDE_FROM ? DAY_SIDEBAR_LIMITS.wide.max : DAY_SIDEBAR_LIMITS.medium.max;
}

/**
 * Whether the sidebar shows beside the page. Below 1000px it gives way to an
 * open left sidebar; the narrow layout's left sidebar is an overlay, so there
 * both can show.
 */
export function daySidebarShown(open: boolean, leftOpen: boolean, narrow: boolean, viewport: number): boolean {
  return open && (narrow || !leftOpen || viewport >= ONE_SIDEBAR_BELOW);
}

interface DaySidebarRuntime extends DayRuleState {
  /** The page the day rule last saw. */
  seenPath: string | null;
}

interface DaySidebarActions {
  setOpen(open: boolean): void;
  toggleSection(section: DaySection): void;
  toggleCollapsed(section: DaySection): void;
  setWidth(width: number | null): void;
  /** The arrows and Go to today. */
  pickDay(day: string): void;
  /** Follows the open page's own day again. */
  followPage(): void;
  hydrate(): DaySidebarPreferences;
}

export type DaySidebarStore = DaySidebarPreferences & DaySidebarRuntime & DaySidebarActions;

function preferencesFrom(state: DaySidebarPreferences): DaySidebarPreferences {
  return {
    open: state.open,
    sections: state.sections,
    collapsed: state.collapsed,
    width: state.width,
  };
}

function readPreferences(): DaySidebarPreferences {
  return sanitizeDaySidebarPreferences(
    readPref<unknown>(DAY_SIDEBAR_PREFERENCE_KEY, DEFAULT_DAY_SIDEBAR_PREFERENCES),
  );
}

const openedPath = () => selectOpenedPath(useTabsStore.getState());

export const useDaySidebarStore = create<DaySidebarStore>((set) => {
  const update = (change: (state: DaySidebarStore) => Partial<DaySidebarPreferences>) =>
    set((state) => {
      const next = { ...preferencesFrom(state), ...change(state) };
      writePref(DAY_SIDEBAR_PREFERENCE_KEY, next);
      return next;
    });

  return {
    ...readPreferences(),
    pickedDay: null,
    lastDay: null,
    seenPath: openedPath(),

    setOpen: (open) => update(() => ({ open })),
    toggleSection: (section) =>
      update((state) => ({ sections: { ...state.sections, [section]: !state.sections[section] } })),
    toggleCollapsed: (section) =>
      update((state) => ({ collapsed: { ...state.collapsed, [section]: !state.collapsed[section] } })),
    setWidth: (width) => update(() => ({ width: width === null ? null : safeWidth(width) })),
    pickDay: (day) => set((state) => afterDayPicked(state, state.seenPath, day, localDate())),
    followPage: () => set({ pickedDay: null }),
    hydrate: () => {
      const next = readPreferences();
      set(next);
      return next;
    },
  };
});

// The day rule follows every page the active tab shows, open or closed.
useTabsStore.subscribe((tabs) => {
  const path = selectOpenedPath(tabs);
  const state = useDaySidebarStore.getState();
  if (path === state.seenPath) return;
  useDaySidebarStore.setState({ ...afterPageOpened(state, state.seenPath, path), seenPath: path });
});

/**
 * The menu command, the shortcut and both toggle buttons. It acts on what
 * shows, and below 1000px opening it closes the left sidebar.
 */
export function toggleDaySidebar(viewport = window.innerWidth): void {
  const shell = useShellStore.getState();
  const state = useDaySidebarStore.getState();
  if (daySidebarShown(state.open, shell.sidebarOpen, shell.narrowLayout, viewport)) {
    state.setOpen(false);
    return;
  }
  state.setOpen(true);
  if (!shell.narrowLayout && viewport < ONE_SIDEBAR_BELOW && shell.sidebarOpen) shell.setSidebarOpen(false);
}
