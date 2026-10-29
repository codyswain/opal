import { create } from 'zustand';
import { isAbsoluteFsPath, isFsPathAtOrBelow, normalizeFsPath, remapFsPath } from '@/common/fsPaths';
import { readPref, writePref } from '@/renderer/shared/prefs/prefs';
import { pathMutationCoordinator } from '../navigation/pathMutationCoordinator';
import type { TabsState } from './tabsStore';

/** What the menu's section commands ask the open stack to do. */
export type StackMove = 'next' | 'previous';

interface StackRuntimeState {
  /** The sections with a live editor, per tab id, so the tab strip can show unsaved and problem marks. */
  live: Record<string, readonly string[]>;
  /**
   * The section the active tab's stack shows at its probe line, or its head.
   * The right sidebar's day follows it while the stream scrolls.
   */
  viewed: { tabId: string; path: string } | null;
  /** Asks a stack opened by `head` to scroll back to its top; `seq` makes each ask new. */
  reveal: { head: string; seq: number } | null;
  /** The mounted stack's handler for View > Next Section and Previous Section. */
  move: ((direction: StackMove) => boolean) | null;
  setLive: (tabId: string, paths: readonly string[]) => void;
  setViewed: (tabId: string, path: string | null) => void;
  revealHead: (head: string) => void;
  setMove: (move: ((direction: StackMove) => boolean) | null) => void;
}

const same = (left: readonly string[] | undefined, right: readonly string[]) =>
  !!left && left.length === right.length && left.every((path, index) => path === right[index]);

/** Runtime state of the mounted stacks. Nothing here is saved. */
export const useStackStore = create<StackRuntimeState>((set) => ({
  live: {},
  viewed: null,
  reveal: null,
  move: null,
  setLive: (tabId, paths) =>
    set((state) => {
      if (paths.length === 0) {
        if (!(tabId in state.live)) return {};
        const live = { ...state.live };
        delete live[tabId];
        return { live };
      }
      return same(state.live[tabId], paths) ? {} : { live: { ...state.live, [tabId]: [...paths] } };
    }),
  setViewed: (tabId, path) =>
    set((state) => {
      if (path === null) return state.viewed?.tabId === tabId ? { viewed: null } : {};
      return state.viewed?.tabId === tabId && state.viewed.path === path ? {} : { viewed: { tabId, path } };
    }),
  revealHead: (head) => set((state) => ({ reveal: { head: normalizeFsPath(head), seq: (state.reveal?.seq ?? 0) + 1 } })),
  setMove: (move) => set({ move }),
}));

/** The section the active tab's stack shows, or null when the active tab is not a stack. */
export function selectViewedPath(stack: Pick<StackRuntimeState, 'viewed'>, tabs: Pick<TabsState, 'activeId'>): string | null {
  return stack.viewed && stack.viewed.tabId === tabs.activeId ? stack.viewed.path : null;
}

const FOLDS_KEY = 'stack.folds';
/** Fold choices kept; the oldest goes first. */
export const FOLDS_LIMIT = 500;

type Folds = Record<string, boolean>;

function sanitizeFolds(value: unknown): Folds {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, boolean] => isAbsoluteFsPath(entry[0]) && typeof entry[1] === 'boolean',
  );
  return Object.fromEntries(entries.slice(-FOLDS_LIMIT));
}

interface StackFoldsState {
  /** `{ path: open }` for every section Cody folded or unfolded himself, oldest first. */
  folds: Folds;
  setOpen: (paths: readonly string[], open: boolean) => void;
}

/**
 * Fold choices, saved per file path. A choice overrides the section's
 * default in every stack and tab.
 */
export const useStackFoldsStore = create<StackFoldsState>((set) => ({
  folds: sanitizeFolds(readPref<unknown>(FOLDS_KEY, {})),
  setOpen: (paths, open) =>
    set((state) => {
      const folds = { ...state.folds };
      for (const path of paths) {
        // Deleting first moves the choice to the end, so the oldest drops first.
        delete folds[path];
        folds[path] = open;
      }
      const kept = Object.fromEntries(Object.entries(folds).slice(-FOLDS_LIMIT));
      writePref(FOLDS_KEY, kept);
      return { folds: kept };
    }),
}));

/** Whether a section shows unfolded: Cody's choice for the path, or the section's default. */
export function sectionOpen(folds: Folds, path: string, defaultOpen: boolean): boolean {
  return folds[path] ?? defaultOpen;
}

export function remapFolds(folds: Folds, oldPath: string, newPath: string): Folds {
  return Object.fromEntries(Object.entries(folds).map(([path, open]) => [remapFsPath(path, oldPath, newPath), open]));
}

export function dropFolds(folds: Folds, removed: readonly string[]): Folds {
  return Object.fromEntries(Object.entries(folds).filter(([path]) => !removed.some((root) => isFsPathAtOrBelow(root, path))));
}

function prepareFolds(next: (folds: Folds) => Folds) {
  const previous = useStackFoldsStore.getState().folds;
  const updated = next(previous);
  const apply = (folds: Folds) => {
    writePref(FOLDS_KEY, folds);
    useStackFoldsStore.setState({ folds });
  };
  return { commit: () => apply(updated), rollback: () => apply(previous) };
}

pathMutationCoordinator.register({
  id: 'stack-folds',
  prepareAppMutation: (mutation) => prepareFolds((folds) => remapFolds(folds, mutation.oldPath, mutation.newPath)),
  preparePathRemoval: (paths) => prepareFolds((folds) => dropFolds(folds, paths)),
});
