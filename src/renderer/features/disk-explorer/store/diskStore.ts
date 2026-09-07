import { create } from 'zustand';
import {
  isFsPathAtOrBelow,
  normalizeFsPath,
} from '@/common/fsPaths';
import type { SortDirection, SortField } from '@/common/sortEntries';
import type { DiskEntry } from '@/types/disk';
import {
  pathMutationCoordinator,
} from '../navigation/pathMutationCoordinator';
import {
  remapDiskState,
  removePathsFromDiskState,
} from './diskPathState';
import {
  directoryCollection,
  type FilesCollection,
} from '../navigation/filesLocation';

export interface PendingAction {
  /** The parent directory for new-folder; the item being renamed for rename. */
  target: string;
  kind: 'new-folder' | 'rename';
}

export interface DiskState {
  /** Absolute paths of folders the user has opened. */
  roots: string[];
  /** Directory path -> its immediate children. Populated lazily. */
  listings: Record<string, DiskEntry[]>;
  /** Directory path -> whether it is expanded in the tree. */
  expanded: Record<string, boolean>;
  /** The collection occupying the browse surface: a folder or built-in Recent. */
  currentCollection: FilesCollection | null;
  /** Directory of currentCollection when it is a folder; null otherwise. */
  currentDirectory: string | null;
  /** Canonical selection anchor and keyboard cursor. */
  focusedPath: string | null;
  /** @deprecated Task 7: compatibility mirror of focusedPath. */
  selectedPath: string | null;
  selectedPaths: string[];
  /** Canonical target for the independent app-rendered Quick Preview. */
  quickPreviewPath: string | null;
  /** @deprecated Task 7: compatibility mirror for the current QuickLook UI. */
  isQuickLookOpen: boolean;
  /** Explicit browse-pane visibility; selection and navigation never toggle it. */
  isPreviewPaneOpen: boolean;
  pendingAction: PendingAction | null;
  pendingDelete: string | null;
  sort: { field: SortField; direction: SortDirection };
  filter: string;
  density: 'compact' | 'comfortable';
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
  navigateToDirectory: (dirPath: string) => void;
  navigateToRecent: () => void;
  select: (targetPath: string | null) => void;
  toggleSelected: (targetPath: string) => void;
  selectRange: (entries: DiskEntry[], targetPath: string) => void;
  selectAll: (entries: readonly DiskEntry[]) => void;
  clearSelection: () => void;
  setQuickPreviewPath: (targetPath: string | null) => void;
  openQuickLook: () => void;
  closeQuickLook: () => void;
  toggleQuickLook: () => void;
  togglePreviewPane: () => void;
  beginNewFolder: (parentDir: string) => void;
  beginRename: (target: string) => void;
  beginDelete: (target: string) => void;
  cancelDelete: () => void;
  cancelAction: () => void;
  /** Selecting the active field flips direction; a new field starts ascending. */
  setSort: (field: SortField) => void;
  setFilter: (value: string) => void;
  setDensity: (value: DiskState['density']) => void;
  clearError: () => void;
}

export type DiskStore = DiskState & DiskActions;

export const useDiskStore = create<DiskStore>((set, get) => ({
  roots: [],
  listings: {},
  expanded: {},
  currentCollection: null,
  currentDirectory: null,
  focusedPath: null,
  selectedPath: null,
  selectedPaths: [],
  quickPreviewPath: null,
  isQuickLookOpen: false,
  isPreviewPaneOpen: false,
  pendingAction: null,
  pendingDelete: null,
  sort: { field: 'name', direction: 'asc' },
  filter: '',
  density: 'comfortable',
  loading: { isLoading: false, error: null },

  togglePreviewPane: () => set(state => ({isPreviewPaneOpen: !state.isPreviewPaneOpen})),

  loadRoots: async () => {
    const response = await window.diskAPI.listRoots();
    if (!response.success) {
      set({ loading: { isLoading: false, error: response.error } });
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
      // Recent is not tied to a root; never substitute one for it.
      if (state.currentCollection?.kind === 'recent') {
        return {
          roots,
          currentDirectory: null,
          loading: { isLoading: false, error: null },
        };
      }
      const previousDirectory = state.currentDirectory;
      const currentDirectory =
        previousDirectory &&
        response.data.some((root) =>
          isFsPathAtOrBelow(root, previousDirectory)
        )
          ? previousDirectory
          : response.data[0] ?? null;

      return {
        roots,
        currentDirectory,
        currentCollection: currentDirectory
          ? directoryCollection(currentDirectory)
          : null,
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
      currentCollection: directoryCollection(root),
      currentDirectory: root,
      loading: { isLoading: false, error: null },
    }));
    pathMutationCoordinator.reconcileAllowedRoots(get().roots);

    await get().loadDirectory(root, { force: true });
    get().select(root);
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
    const willExpand = !get().expanded[dirPath];
    set((state) => ({ expanded: { ...state.expanded, [dirPath]: willExpand } }));

    // Read children on first expand only; collapsing keeps the cache so
    // re-expanding is instant.
    if (willExpand) await get().loadDirectory(dirPath);
  },

  navigateToDirectory: (dirPath) =>
    set({
      currentCollection: directoryCollection(dirPath),
      currentDirectory: normalizeFsPath(dirPath),
      focusedPath: null,
      selectedPath: null,
      selectedPaths: [],
      quickPreviewPath: null,
      isQuickLookOpen: false,
    }),

  navigateToRecent: () =>
    set({
      currentCollection: { kind: 'recent' },
      currentDirectory: null,
      focusedPath: null,
      selectedPath: null,
      selectedPaths: [],
      quickPreviewPath: null,
      isQuickLookOpen: false,
    }),

  select: (targetPath) =>
    set((state) => {
      const quickPreviewIsOpen =
        state.isQuickLookOpen || state.quickPreviewPath !== null;
      return {
        focusedPath: targetPath,
        selectedPath: targetPath,
        selectedPaths: targetPath === null ? [] : [targetPath],
        quickPreviewPath:
          targetPath !== null && quickPreviewIsOpen ? targetPath : null,
        isQuickLookOpen: targetPath !== null && quickPreviewIsOpen,
      };
    }),

  toggleSelected: (targetPath) =>
    set((state) => {
      const isSelected = state.selectedPaths.includes(targetPath);
      const next = isSelected
        ? state.selectedPaths.filter((candidate) => candidate !== targetPath)
        : [...state.selectedPaths, targetPath];
      const focusedPath = isSelected
        ? next[next.length - 1] ?? null
        : targetPath;
      const quickPreviewIsOpen =
        state.isQuickLookOpen || state.quickPreviewPath !== null;

      return {
        selectedPaths: next,
        // The anchor follows the most recent addition; removing the anchor
        // leaves the last remaining item, or nothing.
        focusedPath,
        selectedPath: focusedPath,
        quickPreviewPath:
          quickPreviewIsOpen && focusedPath ? focusedPath : null,
        isQuickLookOpen: quickPreviewIsOpen && focusedPath !== null,
      };
    }),

  selectRange: (entries, targetPath) =>
    set((state) => {
      const anchor = state.focusedPath ?? state.selectedPath;
      const quickPreviewIsOpen =
        state.isQuickLookOpen || state.quickPreviewPath !== null;
      if (!anchor) {
        return {
          focusedPath: targetPath,
          selectedPath: targetPath,
          selectedPaths: [targetPath],
          quickPreviewPath: quickPreviewIsOpen ? targetPath : null,
          isQuickLookOpen: quickPreviewIsOpen,
        };
      }

      const from = entries.findIndex((candidate) => candidate.path === anchor);
      const to = entries.findIndex((candidate) => candidate.path === targetPath);
      if (from === -1 || to === -1) {
        return {
          focusedPath: targetPath,
          selectedPath: targetPath,
          selectedPaths: [targetPath],
          quickPreviewPath: quickPreviewIsOpen ? targetPath : null,
          isQuickLookOpen: quickPreviewIsOpen,
        };
      }

      const [start, end] = from <= to ? [from, to] : [to, from];
      return {
        focusedPath: targetPath,
        selectedPath: targetPath,
        selectedPaths: entries.slice(start, end + 1).map((candidate) => candidate.path),
        quickPreviewPath: quickPreviewIsOpen ? targetPath : null,
        isQuickLookOpen: quickPreviewIsOpen,
      };
    }),

  selectAll: (entries) =>
    set((state) => {
      const selectedPaths = entries.map((entry) => entry.path);
      const focusedPath = selectedPaths[selectedPaths.length - 1] ?? null;
      return {
        focusedPath,
        selectedPath: focusedPath,
        selectedPaths,
        quickPreviewPath:
          state.isQuickLookOpen || state.quickPreviewPath !== null
            ? focusedPath
            : null,
        isQuickLookOpen:
          focusedPath !== null &&
          (state.isQuickLookOpen || state.quickPreviewPath !== null),
      };
    }),

  clearSelection: () =>
    set({
      focusedPath: null,
      selectedPath: null,
      selectedPaths: [],
      quickPreviewPath: null,
      isQuickLookOpen: false,
    }),

  setQuickPreviewPath: (targetPath) =>
    set({
      quickPreviewPath: targetPath ? normalizeFsPath(targetPath) : null,
      isQuickLookOpen: targetPath !== null,
    }),
  openQuickLook: () =>
    set((state) => ({
      quickPreviewPath: state.focusedPath ?? state.selectedPath,
      // Kept true without a target for the temporary boolean-only adapter.
      isQuickLookOpen: true,
    })),
  closeQuickLook: () =>
    set({ quickPreviewPath: null, isQuickLookOpen: false }),
  toggleQuickLook: () =>
    set((state) => {
      const isOpen =
        state.isQuickLookOpen || state.quickPreviewPath !== null;
      return isOpen
        ? { quickPreviewPath: null, isQuickLookOpen: false }
        : {
            quickPreviewPath: state.focusedPath ?? state.selectedPath,
            isQuickLookOpen: true,
          };
    }),
  beginNewFolder: (parentDir) => set({ pendingAction: { kind: 'new-folder', target: parentDir } }),
  beginRename: (target) => set({ pendingAction: { kind: 'rename', target } }),
  beginDelete: (target) => set({ pendingDelete: target }),
  cancelDelete: () => set({ pendingDelete: null }),
  cancelAction: () => set({ pendingAction: null }),
  setSort: (field) =>
    set((state) => ({
      sort:
        state.sort.field === field
          ? { field, direction: state.sort.direction === 'asc' ? 'desc' : 'asc' }
          : { field, direction: 'asc' },
    })),
  setFilter: (value) => set({ filter: value }),
  setDensity: (value) => set({ density: value }),

  clearError: () => set({ loading: { isLoading: false, error: null } }),
}));

function samePaths(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

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
