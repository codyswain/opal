import { create } from 'zustand';
import { localDate } from '@/common/vaultModel';
import {
  selectOpenedPath,
  useTabsStore,
} from '@/renderer/features/disk-explorer/store/tabsStore';
import { selectViewedPath, useStackStore } from '@/renderer/features/disk-explorer/store/stackStore';
import { useShellStore } from '@/renderer/features/shell/store/shellStore';
import { readPref, writePref } from '@/renderer/shared/prefs/prefs';
import {
  afterDayPicked,
  afterPageOpened,
  type DayRuleState,
} from '../dayRule';

export const DAY_SIDEBAR_PREFERENCE_KEY = 'daySidebar';

/**
 * The cards top to bottom, and the options menu's order: the digest, then
 * what the day touched, its chats, recordings and people. The activity log
 * is the least read, so it is last.
 */
export const DAY_SECTIONS = ['digest', 'documents', 'chats', 'recordings', 'people', 'activity'] as const;
export type DaySection = (typeof DAY_SECTIONS)[number];

export const DAY_SECTION_TITLES: Record<DaySection, string> = {
  activity: 'Activity log',
  documents: 'Documents',
  chats: 'Chats',
  recordings: 'Recordings',
  people: 'People',
  digest: 'Digest',
};

/**
 * Below this window width only one sidebar stays open, so the page keeps
 * about 580px beside a 240px left sidebar and the widest right one.
 */
export const ONE_SIDEBAR_BELOW = 1120;
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
  sections: { activity: true, documents: true, chats: true, recordings: true, people: true, digest: true },
  collapsed: { activity: false, documents: false, chats: false, recordings: false, people: false, digest: false },
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
 * Whether the sidebar shows. Below ONE_SIDEBAR_BELOW it gives way to an open
 * left sidebar. In the narrow layout it is an overlay, as the left one is,
 * and shows only while asked for there.
 */
export function daySidebarShown(
  state: Pick<DaySidebarStore, 'open' | 'narrowOpen'>,
  leftOpen: boolean,
  narrow: boolean,
  viewport: number,
): boolean {
  if (narrow) return state.narrowOpen;
  return state.open && (!leftOpen || viewport >= ONE_SIDEBAR_BELOW);
}

interface DaySidebarRuntime extends DayRuleState {
  /** The page the day rule last saw. */
  seenPath: string | null;
  /** The overlay in the narrow layout, which starts closed and is never saved. */
  narrowOpen: boolean;
}

interface DaySidebarActions {
  setOpen(open: boolean): void;
  setNarrowOpen(open: boolean): void;
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

/**
 * The page the day rule follows: in a stream of daily pages, the one at the
 * top of the view; otherwise the open page.
 */
export function shownPath(): string | null {
  const tabs = useTabsStore.getState();
  return selectViewedPath(useStackStore.getState(), tabs) ?? selectOpenedPath(tabs);
}

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
    seenPath: shownPath(),
    narrowOpen: false,

    setOpen: (open) => update(() => ({ open })),
    setNarrowOpen: (narrowOpen) => set({ narrowOpen }),
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

// The day rule follows every page the active tab shows, open or closed, and
// the page at the top of a stream as it scrolls.
function followShownPage(): void {
  const path = shownPath();
  const state = useDaySidebarStore.getState();
  if (path === state.seenPath) return;
  useDaySidebarStore.setState({ ...afterPageOpened(state, state.seenPath, path, localDate()), seenPath: path });
}
useTabsStore.subscribe(followShownPage);
useStackStore.subscribe(followShownPage);

// Only one overlay at a time, and a change of layout starts the overlay closed.
useShellStore.subscribe((shell, before) => {
  const opened = shell.narrowSidebarOpen && !before.narrowSidebarOpen;
  if ((opened || shell.narrowLayout !== before.narrowLayout) && useDaySidebarStore.getState().narrowOpen) {
    useDaySidebarStore.getState().setNarrowOpen(false);
  }
});

/**
 * The menu command, the shortcut and both toggle buttons. It acts on what
 * shows. Below ONE_SIDEBAR_BELOW opening it closes the left sidebar, and in
 * the narrow layout it opens or closes the overlay.
 */
export function toggleDaySidebar(viewport = window.innerWidth): void {
  const shell = useShellStore.getState();
  const state = useDaySidebarStore.getState();
  if (shell.narrowLayout) {
    if (!state.narrowOpen) shell.closeNarrowSidebar();
    state.setNarrowOpen(!state.narrowOpen);
    return;
  }
  if (daySidebarShown(state, shell.sidebarOpen, false, viewport)) {
    state.setOpen(false);
    return;
  }
  state.setOpen(true);
  if (viewport < ONE_SIDEBAR_BELOW && shell.sidebarOpen) shell.setSidebarOpen(false);
}
