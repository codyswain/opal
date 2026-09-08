import { create } from 'zustand';
import type { CollectionViewMode } from '../components/CollectionView';
import type { EditableChip } from '../components/query/editableFilters';

export interface FolderViewState {
  /** Applied and half-typed filters, in the toolbar's order. */
  chips: EditableChip[];
  includeDescendants: boolean;
  /** Null until the person chooses; the folder then suggests a layout. */
  layout: CollectionViewMode | null;
}

export const DEFAULT_FOLDER_VIEW: FolderViewState = { chips: [], includeDescendants: false, layout: null };

interface FolderViewStore {
  byDirectory: Record<string, FolderViewState>;
  setChips: (directory: string, chips: EditableChip[]) => void;
  setIncludeDescendants: (directory: string, value: boolean) => void;
  setLayout: (directory: string, layout: CollectionViewMode) => void;
  clear: (directory: string) => void;
  reset: () => void;
}

/**
 * What the toolbar holds for each folder: its filters, whether subfolders are
 * searched, and the chosen layout. Session-only; a saved view is the durable
 * form of the same state.
 */
export const useFolderViewStore = create<FolderViewStore>((set) => {
  const patch = (directory: string, change: Partial<FolderViewState>) =>
    set((state) => ({ byDirectory: { ...state.byDirectory, [directory]: { ...(state.byDirectory[directory] ?? DEFAULT_FOLDER_VIEW), ...change } } }));
  return {
    byDirectory: {},
    setChips: (directory, chips) => patch(directory, { chips }),
    setIncludeDescendants: (directory, includeDescendants) => patch(directory, { includeDescendants }),
    setLayout: (directory, layout) => patch(directory, { layout }),
    clear: (directory) => set((state) => {
      const byDirectory = { ...state.byDirectory };
      delete byDirectory[directory];
      return { byDirectory };
    }),
    reset: () => set({ byDirectory: {} }),
  };
});
