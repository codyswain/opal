import { create } from 'zustand';
import {
  isFsPathAtOrBelow,
  parentFsPath,
} from '@/common/fsPaths';
import { readPref, writePref } from '@/renderer/shared/prefs/prefs';
import type { DiskEntry } from '@/types/disk';
import {
  pathMutationCoordinator,
} from '../navigation/pathMutationCoordinator';
import {
  remapDiskState,
  removePathsFromDiskState,
} from './diskPathState';
import { isTreeExpanded } from './treeExpansion';

const EXPANDED_PREF_KEY = 'tree.expanded';

export interface PendingAction {
  /** The folder the new folder goes in. */
  target: string;
  kind: 'new-folder';
}

export interface DiskState {
  /** Absolute paths of folders the user has opened. */
  roots: string[];
  /** False until the first answer about the opened folders, so nothing claims there are none. */
  rootsLoaded: boolean;
  /** Directory path -> its immediate children. Populated lazily. */
  listings: Record<string, DiskEntry[]>;
  /**
   * Directory path -> whether it is expanded in the tree; see isTreeExpanded
   * for roots. Persisted across launches.
   */
  expanded: Record<string, boolean>;
  pendingAction: PendingAction | null;
  pendingDelete: string | null;
  loading: { isLoading: boolean; error: string | null };
}

export interface DiskActions {
  loadRoots: () => Promise<void>;
  openFolder: () => Promise<void>;
  closeRoot: (rootPath: string) => Promise<void>;
  loadDirectory: (dirPath: string, options?: { force?: boolean }) => Promise<void>;
  /** Drop cached listings for directories that changed on disk, and reload the visible ones. */
  invalidate: (directories: string[]) => Promise<void>;
  toggleExpanded: (dirPath: string) => Promise<void>;
  /** Loads what the tree shows at launch: open roots and the expanded folders inside them. */
  loadTree: () => Promise<void>;
  /** Expands and loads every folder above a path, so the tree can scroll to it. */
  revealPath: (targetPath: string) => Promise<void>;
  beginNewFolder: (parentDir: string) => void;
  beginDelete: (target: string) => void;
  cancelDelete: () => void;
  cancelAction: () => void;
  clearError: () => void;
}

export type DiskStore = DiskState & DiskActions;

export const useDiskStore = create<DiskStore>((set, get) => ({
  roots: [],
  rootsLoaded: false,
  listings: {},
  expanded: restoredExpanded(),
  pendingAction: null,
  pendingDelete: null,
  loading: { isLoading: false, error: null },

  loadRoots: async () => {
    const response = await window.diskAPI.listRoots();
    if (!response.success) {
      set({ rootsLoaded: true, loading: { isLoading: false, error: response.error } });
      return;
    }

    const previousRoots = get().roots;
    for (const root of previousRoots) {
      if (!response.data.includes(root)) {
        pathMutationCoordinator.applyRootRemoval(root);
      }
    }
    pathMutationCoordinator.reconcileAllowedRoots(response.data);

    set((state) => {
      const roots = samePaths(state.roots, response.data)
        ? state.roots
        : response.data;
      return {
        roots,
        rootsLoaded: true,
        expanded: expandedWithinRoots(state.expanded, roots),
        loading: { isLoading: false, error: null },
      };
    });
  },

  openFolder: async () => {
    set({ loading: { isLoading: true, error: null } });
    const response = await window.diskAPI.openFolder();

    if (!response.success) {
      set({ loading: { isLoading: false, error: response.error } });
      return;
    }

    const root = response.data.root;
    if (!root) {
      // Dialog cancelled — not an error, and nothing changes.
      set({ loading: { isLoading: false, error: null } });
      return;
    }

    set((state) => ({
      roots: state.roots.includes(root) ? state.roots : [...state.roots, root],
      expanded: { ...state.expanded, [root]: true },
      loading: { isLoading: false, error: null },
    }));
    pathMutationCoordinator.reconcileAllowedRoots(get().roots);

    await get().loadDirectory(root, { force: true });
  },

  closeRoot: async (rootPath) => {
    const response = await window.diskAPI.removeRoot(rootPath);
    if (!response.success) {
      set({ loading: { isLoading: false, error: response.error } });
      return;
    }

    pathMutationCoordinator.applyRootRemoval(rootPath);
    pathMutationCoordinator.reconcileAllowedRoots(get().roots);
    set({ loading: { isLoading: false, error: null } });
  },

  loadDirectory: async (dirPath, options = {}) => {
    if (!options.force && get().listings[dirPath]) return;

    set({ loading: { isLoading: true, error: null } });
    const response = await window.diskAPI.readDirectory(dirPath);

    if (!response.success) {
      set({ loading: { isLoading: false, error: response.error } });
      return;
    }

    const nextPaths = new Set(response.data.entries.map(entry => entry.path));
    const removed = (get().listings[dirPath] ?? []).filter(entry => !nextPaths.has(entry.path)).map(entry => entry.path);
    if (removed.length) pathMutationCoordinator.applyExternalRemoval(removed);

    set((state) => ({
      listings: { ...state.listings, [dirPath]: response.data.entries },
      loading: { isLoading: false, error: null },
    }));
  },

  invalidate: async (directories) => {
    const state = get();
    const known = directories.filter((directory) => state.listings[directory]);
    if (known.length === 0) return;

    await Promise.all(
      known.map((directory) => state.loadDirectory(directory, { force: true }))
    );
  },

  toggleExpanded: async (dirPath) => {
    const { roots, expanded } = get();
    const willExpand = !isTreeExpanded(roots, expanded, dirPath);
    set((state) => ({ expanded: { ...state.expanded, [dirPath]: willExpand } }));

    // Read children on first expand only; collapsing keeps the cache so
    // re-expanding is instant.
    if (willExpand) await get().loadDirectory(dirPath);
  },

  loadTree: async () => {
    const { roots, expanded } = get();
    const isOpen = (path: string) => isTreeExpanded(roots, expanded, path);
    const isShown = (path: string) => {
      const root = roots.find((candidate) => isFsPathAtOrBelow(candidate, path));
      if (!root) return false;
      for (let folder: string | null = path; folder && folder !== root; folder = parentFsPath(folder)) {
        if (!isOpen(folder)) return false;
      }
      return isOpen(root);
    };
    const folders = [...new Set([...roots, ...Object.keys(expanded)])].filter(isShown);
    await Promise.all(folders.map((folder) => get().loadDirectory(folder)));
  },

  revealPath: async (targetPath) => {
    const root = [...get().roots]
      .sort((left, right) => right.length - left.length)
      .find((candidate) => isFsPathAtOrBelow(candidate, targetPath));
    if (!root) return;
    const folders: string[] = [];
    for (
      let folder = parentFsPath(targetPath);
      folder && isFsPathAtOrBelow(root, folder);
      folder = parentFsPath(folder)
    ) {
      folders.push(folder);
    }
    const { expanded, roots } = get();
    if (folders.some((folder) => !isTreeExpanded(roots, expanded, folder))) {
      set((state) => ({
        expanded: {
          ...state.expanded,
          ...Object.fromEntries(folders.map((folder) => [folder, true])),
        },
      }));
    }
    await Promise.all(folders.map((folder) => get().loadDirectory(folder)));
  },

  beginNewFolder: (parentDir) => set({ pendingAction: { kind: 'new-folder', target: parentDir } }),
  beginDelete: (target) => set({ pendingDelete: target }),
  cancelDelete: () => set({ pendingDelete: null }),
  cancelAction: () => set({ pendingAction: null }),

  clearError: () => set({ loading: { isLoading: false, error: null } }),
}));

function restoredExpanded(): Record<string, boolean> {
  const stored = readPref<unknown>(EXPANDED_PREF_KEY, null);
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {};
  return Object.fromEntries(
    Object.entries(stored).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === 'boolean'
    )
  );
}

function expandedWithinRoots(
  expanded: Record<string, boolean>,
  roots: readonly string[]
): Record<string, boolean> {
  const kept = Object.entries(expanded).filter(([path]) =>
    roots.some((root) => isFsPathAtOrBelow(root, path))
  );
  return kept.length === Object.keys(expanded).length
    ? expanded
    : Object.fromEntries(kept);
}

function samePaths(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

// Collapsed folders are dropped rather than stored; only a collapsed root
// differs from its default.
useDiskStore.subscribe((state, previous) => {
  if (state.expanded === previous.expanded) return;
  writePref(
    EXPANDED_PREF_KEY,
    Object.fromEntries(
      Object.entries(state.expanded).filter(
        ([path, open]) => open || state.roots.includes(path)
      )
    )
  );
});

pathMutationCoordinator.register({
  id: 'disk-store',
  prepareAppMutation: (mutation) => {
    const previous = useDiskStore.getState();
    const next = remapDiskState(previous, mutation);
    return {
      commit: () => useDiskStore.setState(next),
      rollback: () => useDiskStore.setState(previous),
    };
  },
  preparePathRemoval: (paths, reason) => {
    const previous = useDiskStore.getState();
    const next = removePathsFromDiskState(previous, paths, reason);
    return {
      commit: () => useDiskStore.setState(next),
      rollback: () => useDiskStore.setState(previous),
    };
  },
});
