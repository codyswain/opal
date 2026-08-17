import { create } from 'zustand';
import type { DiskEntry } from '@/types/disk';

export interface DiskState {
  /** Absolute paths of folders the user has opened. */
  roots: string[];
  /** Directory path -> its immediate children. Populated lazily. */
  listings: Record<string, DiskEntry[]>;
  /** Directory path -> whether it is expanded in the tree. */
  expanded: Record<string, boolean>;
  selectedPath: string | null;
  loading: { isLoading: boolean; error: string | null };
}

export interface DiskActions {
  loadRoots: () => Promise<void>;
  openFolder: () => Promise<void>;
  closeRoot: (rootPath: string) => Promise<void>;
  loadDirectory: (dirPath: string, options?: { force?: boolean }) => Promise<void>;
  toggleExpanded: (dirPath: string) => Promise<void>;
  select: (targetPath: string | null) => void;
  clearError: () => void;
}

export type DiskStore = DiskState & DiskActions;

export const useDiskStore = create<DiskStore>((set, get) => ({
  roots: [],
  listings: {},
  expanded: {},
  selectedPath: null,
  loading: { isLoading: false, error: null },

  loadRoots: async () => {
    const response = await window.diskAPI.listRoots();
    if (!response.success) {
      set({ loading: { isLoading: false, error: response.error } });
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
      const selectionSurvives =
        state.selectedPath !== null && !isAtOrBelow(rootPath, state.selectedPath);

      return {
        roots: state.roots.filter((root) => root !== rootPath),
        listings,
        expanded,
        selectedPath: selectionSurvives ? state.selectedPath : null,
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

  toggleExpanded: async (dirPath) => {
    const willExpand = !get().expanded[dirPath];
    set((state) => ({ expanded: { ...state.expanded, [dirPath]: willExpand } }));

    // Read children on first expand only; collapsing keeps the cache so
    // re-expanding is instant.
    if (willExpand) await get().loadDirectory(dirPath);
  },

  select: (targetPath) => set({ selectedPath: targetPath }),

  clearError: () => set({ loading: { isLoading: false, error: null } }),
}));

function isAtOrBelow(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}/`);
}
