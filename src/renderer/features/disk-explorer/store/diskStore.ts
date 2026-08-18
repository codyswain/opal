import { create } from 'zustand';
import type { SortDirection, SortField } from '@/common/sortEntries';
import type { DiskEntry } from '@/types/disk';

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
  selectedPath: string | null;
  selectedPaths: string[];
  isQuickLookOpen: boolean;
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
  select: (targetPath: string | null) => void;
  toggleSelected: (targetPath: string) => void;
  selectRange: (entries: DiskEntry[], targetPath: string) => void;
  clearSelection: () => void;
  openQuickLook: () => void;
  closeQuickLook: () => void;
  toggleQuickLook: () => void;
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
  selectedPath: null,
  selectedPaths: [],
  isQuickLookOpen: false,
  pendingAction: null,
  pendingDelete: null,
  sort: { field: 'name', direction: 'asc' },
  filter: '',
  density: 'comfortable',
  loading: { isLoading: false, error: null },

  loadRoots: async () => {
    const response = await window.diskAPI.listRoots();
    if (!response.success) {
      set({ loading: { isLoading: false, error: response.error } });
      return;
    }

    if (samePaths(get().roots, response.data)) {
      set({ loading: { isLoading: false, error: null } });
      return;
    }

    set({ roots: response.data, loading: { isLoading: false, error: null } });
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

    await get().loadDirectory(root, { force: true });
    get().select(root);
  },

  closeRoot: async (rootPath) => {
    const response = await window.diskAPI.removeRoot(rootPath);
    if (!response.success) {
      set({ loading: { isLoading: false, error: response.error } });
      return;
    }

    set((state) => {
      // Drop every cached listing beneath the closed root, so a later reopen
      // reads fresh rather than showing a stale tree.
      const listings = Object.fromEntries(
        Object.entries(state.listings).filter(([key]) => !isAtOrBelow(rootPath, key))
      );
      const expanded = Object.fromEntries(
        Object.entries(state.expanded).filter(([key]) => !isAtOrBelow(rootPath, key))
      );
      const selectedPaths = state.selectedPaths.filter((path) => !isAtOrBelow(rootPath, path));
      const selectionSurvives =
        state.selectedPath !== null && !isAtOrBelow(rootPath, state.selectedPath);

      return {
        roots: state.roots.filter((root) => root !== rootPath),
        listings,
        expanded,
        selectedPath: selectionSurvives ? state.selectedPath : selectedPaths[selectedPaths.length - 1] ?? null,
        selectedPaths,
      };
    });
  },

  loadDirectory: async (dirPath, options = {}) => {
    if (!options.force && get().listings[dirPath]) return;

    set({ loading: { isLoading: true, error: null } });
    const response = await window.diskAPI.readDirectory(dirPath);

    if (!response.success) {
      set({ loading: { isLoading: false, error: response.error } });
      return;
    }

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

  select: (targetPath) =>
    set((state) => ({
      selectedPath: targetPath,
      selectedPaths: targetPath === null ? [] : [targetPath],
      isQuickLookOpen: targetPath === null ? false : state.isQuickLookOpen,
    })),

  toggleSelected: (targetPath) =>
    set((state) => {
      const isSelected = state.selectedPaths.includes(targetPath);
      const next = isSelected
        ? state.selectedPaths.filter((candidate) => candidate !== targetPath)
        : [...state.selectedPaths, targetPath];

      return {
        selectedPaths: next,
        // The anchor follows the most recent addition; removing the anchor
        // leaves the last remaining item, or nothing.
        selectedPath: isSelected ? next[next.length - 1] ?? null : targetPath,
      };
    }),

  selectRange: (entries, targetPath) =>
    set((state) => {
      const anchor = state.selectedPath;
      if (!anchor) return { selectedPath: targetPath, selectedPaths: [targetPath] };

      const from = entries.findIndex((candidate) => candidate.path === anchor);
      const to = entries.findIndex((candidate) => candidate.path === targetPath);
      if (from === -1 || to === -1) {
        return { selectedPath: targetPath, selectedPaths: [targetPath] };
      }

      const [start, end] = from <= to ? [from, to] : [to, from];
      return {
        selectedPath: targetPath,
        selectedPaths: entries.slice(start, end + 1).map((candidate) => candidate.path),
      };
    }),

  clearSelection: () => set({ selectedPath: null, selectedPaths: [], isQuickLookOpen: false }),

  openQuickLook: () => set({ isQuickLookOpen: true }),
  closeQuickLook: () => set({ isQuickLookOpen: false }),
  toggleQuickLook: () => set((state) => ({ isQuickLookOpen: !state.isQuickLookOpen })),
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

function isAtOrBelow(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}/`);
}

function samePaths(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}
