import { create } from 'zustand';
import { FSExplorerState, FSEntry, Note, AIMetadata } from '@/types';

/**
 * Zustand store for file explorer state management
 */
export const useFileExplorerStore = create<FSExplorerState>((set, get) => ({
  entities: {
    nodes: {},
    notes: {},
    aiMetadata: {},
  },
  ui: {
    selectedId: null,
    expandedFolders: new Set(),
    searchQuery: '',
  },
  loading: {
    isLoading: false,
    error: null,
  },

  loadFileSystem: async () => {
    set({ loading: { isLoading: true, error: null } });
    try {
      const {success, items} = await window.fileExplorer.getEntries();
      if (success){
        set(state => ({
          entities: {
            ...state.entities,
            nodes: items
          },
          loading: { isLoading: false, error: null }
        }));
        return true;
      }
      return false;
    } catch (error){
      set({ loading: { isLoading: false, error: String(error) } });
      return false;
    }
  },

  getNote: async (id: string) => {
    try {
      const { success, note } = await window.fileExplorer.getNote(id);
      
      if (success) {
        set(state => ({
          entities: {
            ...state.entities,
            notes: {
              ...state.entities.notes,
              [id]: note
            }
          }
        }));
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to get note:', error);
      return false;
    }
  },

  selectEntry: async (id: string) => {
    set(state => ({
      ui: {
        ...state.ui,
        selectedId: id
      }
    }));
    
    // Get the entry type
    const entry = get().entities.nodes[id];
    
    // If it's a note and content isn't loaded yet, fetch it
    if (entry && entry.type === 'note' && !get().entities.notes[id]) {
      get().getNote(id);
    }
    
    // Expand parent folders to show the selected entry
    if (entry && entry.parentId) {
      let currentParentId = entry.parentId;
      const newExpandedFolders = new Set(get().ui.expandedFolders);
      
      // Traverse up the tree and expand all parent folders
      while (currentParentId) {
        newExpandedFolders.add(currentParentId);
        const parent = get().entities.nodes[currentParentId];
        currentParentId = parent?.parentId || null;
      }
      
      set(state => ({
        ui: {
          ...state.ui,
          expandedFolders: newExpandedFolders
        }
      }));
    }
  },
  
  toggleFolder: (folderId: string) => {
    set(state => {
      const newExpandedFolders = new Set(state.ui.expandedFolders);
      if (newExpandedFolders.has(folderId)) {
        newExpandedFolders.delete(folderId);
      } else {
        newExpandedFolders.add(folderId);
      }
      
      return {
        ui: {
          ...state.ui,
          expandedFolders: newExpandedFolders
        }
      };
    });
  },
  
  setSearchQuery: (query: string) => {
    set(state => ({
      ui: {
        ...state.ui,
        searchQuery: query
      }
    }));
  }
})) 