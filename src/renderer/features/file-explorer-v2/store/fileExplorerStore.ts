import { create } from 'zustand';
import { FSExplorerState } from '@/types'; // Removed FSEntry, Note, AIMetadata

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
    history: [],
    historyIndex: -1,
    isNavigatingHistory: false,
    rightSidebarTab: 'related',
  },
  loading: {
    isLoading: false,
    error: null,
  },

  loadFileSystem: async () => {
    set({ loading: { isLoading: true, error: null } });
    try {
      console.log('Calling getEntries API...');
      const {success, items} = await window.fileExplorer.getEntries();
      console.log('getEntries response:', {success, itemsCount: items ? Object.keys(items).length : 0});
      console.log('Sample items:', items ? Object.values(items).slice(0, 3) : 'No items');
      
      if (success){
        set(state => ({
          entities: {
            ...state.entities,
            nodes: items
          },
          loading: { isLoading: false, error: null }
        }));
        
        // Find the root folder to select initially
        const rootNodes = Object.values(items).filter(node => node.parentId === null);
        console.log('Root nodes found:', rootNodes.length);
        
        if (rootNodes.length > 0) {
          const rootId = rootNodes[0].id;
          
          // Initialize history with root node and select it
          set(state => ({
            ui: {
              ...state.ui,
              selectedId: rootId,
              history: [rootId],
              historyIndex: 0
            }
          }));
        }
        
        return true;
      }
      return false;
    } catch (error){
      console.error('Error loading file system:', error);
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
              [id]: {
                id: note.id,
                content: note.content || '',
                createdAt: note.createdAt || '',
                updatedAt: note.updatedAt || ''
              }
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

  updateNoteContent: async (id: string, content: string) => {
    try {
      const node = get().entities.nodes[id];
      if (!node) {
        console.error('Note node not found:', id);
        return false;
      }

      // Check if the node is a note before updating
      if (node.type !== 'note') {
        console.error('Cannot update content for non-note item:', id, node.type);
        return false;
      }

      // Call the IPC method to update the note content in the database
      const result = await window.fileExplorer.updateNoteContent(id, content);
      
      if (!result.success) {
        console.error('Failed to update note content:', result.error);
        return false;
      }
      
      // Update the local state
      set(state => ({
        entities: {
          ...state.entities,
          notes: {
            ...state.entities.notes,
            [id]: {
              ...state.entities.notes[id],
              content
            }
          }
        }
      }));
      
      return true;
    } catch (error) {
      console.error('Failed to update note content:', error);
      return false;
    }
  },

  selectEntry: async (id: string) => {
    const { ui } = get();
    const isNavigatingHistory = ui.isNavigatingHistory;
    
    // Update selected ID
    set(state => ({
      ui: {
        ...state.ui,
        selectedId: id
      }
    }));
    
    // Update navigation history if not using back/forward navigation
    if (!isNavigatingHistory) {
      set(state => {
        const currentIndex = state.ui.historyIndex;
        const history = [...state.ui.history];
        
        // If the same item is selected, don't update history
        if (history[currentIndex] === id) {
          return state;
        }
        
        // Add new entry to history, removing any forward history
        const newHistory = [...history.slice(0, currentIndex + 1), id];
        const newIndex = currentIndex + 1;
        
        return {
          ui: {
            ...state.ui,
            history: newHistory,
            historyIndex: newIndex
          }
        };
      });
    } else {
      // Reset navigating flag after navigation completes
      set(state => ({
        ui: {
          ...state.ui,
          isNavigatingHistory: false
        }
      }));
    }
    
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

  // Add navigation functions
  goBack: () => {
    const { ui } = get();
    
    if (ui.historyIndex > 0) {
      // Set navigating flag
      set(state => ({
        ui: {
          ...state.ui,
          isNavigatingHistory: true,
          historyIndex: state.ui.historyIndex - 1
        }
      }));
      
      // Navigate to the previous entry
      const newIndex = get().ui.historyIndex;
      const prevId = get().ui.history[newIndex];
      get().selectEntry(prevId);
    }
  },
  
  goForward: () => {
    const { ui } = get();
    
    if (ui.historyIndex < ui.history.length - 1) {
      // Set navigating flag
      set(state => ({
        ui: {
          ...state.ui,
          isNavigatingHistory: true,
          historyIndex: state.ui.historyIndex + 1
        }
      }));
      
      // Navigate to the next entry
      const newIndex = get().ui.historyIndex;
      const nextId = get().ui.history[newIndex];
      get().selectEntry(nextId);
    }
  },
  
  canGoBack: () => {
    return get().ui.historyIndex > 0;
  },
  
  canGoForward: () => {
    const { ui } = get();
    return ui.historyIndex < ui.history.length - 1;
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
  },

  createNote: async (parentPath: string, noteName: string) => {
    try {
      const initialContent = '# New Note\n\nStart writing here...';
      // Make sure we're using the create-note IPC method
      await window.electron.createNote(parentPath, noteName, initialContent);
      
      // Reload the file system to reflect the changes
      return get().loadFileSystem();
    } catch (error) {
      console.error('Failed to create note:', error);
      set({ loading: { isLoading: false, error: String(error) } });
      return false;
    }
  },

  createFolder: async (parentPath: string, folderName: string) => {
    try {
      // Use the createFolder IPC method
      await window.electron.createFolder(parentPath, folderName);
      
      // Reload the file system to reflect the changes
      return get().loadFileSystem();
    } catch (error) {
      console.error('Failed to create folder:', error);
      set({ loading: { isLoading: false, error: String(error) } });
      return false;
    }
  },

  renameItem: async (id: string, newName: string) => {
    try {
      const node = get().entities.nodes[id];
      if (!node) {
        console.error('Node not found for ID:', id);
        return false;
      }

      // Call the IPC method to rename the item in the database
      const result = await window.fileExplorer.renameItem(node.path, newName);
      
      if (!result.success) {
        console.error('Failed to rename item:', result.error);
        return false;
      }
      
      // Update the local state with the new name and path
      set(state => {
        const updatedNodes = { ...state.entities.nodes };
        
        // Update the renamed node
        updatedNodes[id] = {
          ...updatedNodes[id],
          name: newName,
          path: result.newPath
        };
        
        return {
          entities: {
            ...state.entities,
            nodes: updatedNodes
          }
        };
      });
      
      return true;
    } catch (error) {
      console.error('Failed to rename item:', error);
      return false;
    }
  },
})) 