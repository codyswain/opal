import { create } from "zustand";
import { FSExplorerStore } from "./types";
import { FSEntry } from "@/types";

export const useFileExplorerStore = create<FSExplorerStore>((set, get) => ({
  entities: {
    nodes: {} as Record<string, FSEntry>,
    notes: {} as Record<
      string,
      { id: string; content: string; createdAt: string; updatedAt: string }
    >,
    aiMetadata: {},
  },
  ui: {
    selectedId: null as string | null,
    expandedFolders: new Set<string>(),
    searchQuery: "",
    history: [] as string[],
    historyIndex: -1,
    isNavigatingHistory: false,
    rightSidebarTab: "related",
    creatingFolderInParentId: null as string | null,
    newFolderName: "",
    createFolderError: null as string | null,
  },
  loading: {
    isLoading: false,
    error: null as string | null,
  },

  loadVirtualFileSystem: async () => {
    set({ loading: { isLoading: true, error: null } });
    try {
      const { success, data: items } = await window.vfsAPI.getItems();

      if (success) {
        set((state) => ({
          entities: {
            ...state.entities,
            nodes: items,
          },
          loading: { isLoading: false, error: null },
        }));

        // Find the root folder to select initially
        const rootNodes = Object.values(items).filter(
          (node) => node.parentId === null
        );
        console.log("Root nodes found:", rootNodes.length);

        if (rootNodes.length > 0) {
          const rootId = rootNodes[0].id;

          // Initialize history with root node and select it
          set((state) => ({
            ui: {
              ...state.ui,
              selectedId: rootId,
              history: [rootId],
              historyIndex: 0,
            },
          }));
        }

        return true;
      }
      return false;
    } catch (error) {
      console.error("Error loading file system:", error);
      set({ loading: { isLoading: false, error: String(error) } });
      return false;
    }
  },

  getNote: async (id: string) => {
    try {
      const { success, note } = await window.vfsAPI.getNote(id);

      if (success) {
        set((state) => ({
          entities: {
            ...state.entities,
            notes: {
              ...state.entities.notes,
              [id]: {
                id: note.id,
                content: note.content || "",
                createdAt: note.createdAt || "",
                updatedAt: note.updatedAt || "",
              },
            },
          },
        }));
        return true;
      }
      return false;
    } catch (error) {
      console.error("Failed to get note:", error);
      return false;
    }
  },

  updateNoteContent: async (id: string, content: string) => {
    try {
      const node = get().entities.nodes[id];
      if (!node) {
        console.error("Note node not found:", id);
        return false;
      }

      // Check if the node is a note before updating
      if (node.type !== "note") {
        console.error(
          "Cannot update content for non-note item:",
          id,
          node.type
        );
        return false;
      }

      // Call the IPC method to update the note content in the database
      const result = await window.vfsAPI.updateNoteContent(id, content);

      if (!result.success) {
        console.error("Failed to update note content:", result.error);
        return false;
      }

      // Update the local state
      set((state) => ({
        entities: {
          ...state.entities,
          notes: {
            ...state.entities.notes,
            [id]: {
              ...state.entities.notes[id],
              content,
            },
          },
        },
      }));

      return true;
    } catch (error) {
      console.error("Failed to update note content:", error);
      return false;
    }
  },

  selectEntry: async (id: string) => {
    const { ui } = get();
    const isNavigatingHistory = ui.isNavigatingHistory;

    // Update selected ID
    set((state) => ({
      ui: {
        ...state.ui,
        selectedId: id,
      },
    }));

    // Update navigation history if not using back/forward navigation
    if (!isNavigatingHistory) {
      set((state) => {
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
            historyIndex: newIndex,
          },
        };
      });
    } else {
      // Reset navigating flag after navigation completes
      set((state) => ({
        ui: {
          ...state.ui,
          isNavigatingHistory: false,
        },
      }));
    }

    // Get the entry type
    const entry = get().entities.nodes[id];

    // If it's a note and content isn't loaded yet, fetch it
    if (entry && entry.type === "note" && !get().entities.notes[id]) {
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

      set((state) => ({
        ui: {
          ...state.ui,
          expandedFolders: newExpandedFolders,
        },
      }));
    }
  },

  // Add navigation functions
  goBack: () => {
    const { ui } = get();

    if (ui.historyIndex > 0) {
      // Set navigating flag
      set((state) => ({
        ui: {
          ...state.ui,
          isNavigatingHistory: true,
          historyIndex: state.ui.historyIndex - 1,
        },
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
      set((state) => ({
        ui: {
          ...state.ui,
          isNavigatingHistory: true,
          historyIndex: state.ui.historyIndex + 1,
        },
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
    set((state) => {
      const newExpandedFolders = new Set(state.ui.expandedFolders);
      if (newExpandedFolders.has(folderId)) {
        newExpandedFolders.delete(folderId);
      } else {
        newExpandedFolders.add(folderId);
      }

      return {
        ui: {
          ...state.ui,
          expandedFolders: newExpandedFolders,
        },
      };
    });
  },

  setSearchQuery: (query: string) => {
    set((state) => ({
      ui: {
        ...state.ui,
        searchQuery: query,
      },
    }));
  },

  createNote: async (parentPath: string, noteName: string) => {
    try {
      const initialContent = "# New Note\n\nStart writing here...";
      // Make sure we're using the create-note IPC method
      await window.vfsAPI.createNote(parentPath, noteName, initialContent);

      // Reload the file system to reflect the changes
      return get().loadVirtualFileSystem();
    } catch (error) {
      console.error("Failed to create note:", error);
      set({ loading: { isLoading: false, error: String(error) } });
      return false;
    }
  },

  createFolder: async (parentPath: string, folderName: string) => {
    try {
      // Use the createFolder IPC method
      await window.vfsAPI.createFolder(parentPath, folderName);

      // Reload the file system to reflect the changes
      return get().loadVirtualFileSystem();
    } catch (error) {
      console.error("Failed to create folder:", error);
      set({ loading: { isLoading: false, error: String(error) } });
      return false;
    }
  },

  /**
   * Rename a folder in the virtual file system
   * @param folderId - The ID of the folder to rename
   * @param newName - The new name of the folder
   * @returns True if the folder was renamed successfully, false otherwise
   */
  renameFolder: async (folderId: string, newName: string) => {
    try {
      const { success, data, error } = await window.vfsAPI.renameFolder(
        folderId,
        newName
      );

      if (!success) {
        console.error("Failed to rename item:", error);
        return false;
      }

      // Update the local state with the new name and path
      // TODO: refresh all children under a folder
      set((state) => {
        const prevNodes = { ...state.entities.nodes };
        prevNodes[folderId] = {
          ...prevNodes[folderId],
          name: newName,
          path: data.newPath,
        };
        return {
          entities: { ...state.entities, nodes: prevNodes },
        };
      });

      return true;
    } catch (error) {
      console.error("Failed to rename item:", error);
      return false;
    }
  },

  /**
   * Rename a note in the virtual file system
   * @param noteId - The ID of the note to rename
   * @param newName - The new name of the note
   * @returns True if the note was renamed successfully, false otherwise
   */
  renameNote: async (noteId: string, newName: string) => {
    try {
      const { success, data, error } = await window.vfsAPI.renameNote(
        noteId,
        newName
      );
      
      if (!success) {
        console.error("Failed to rename note:", error);
        return false;
      }

      // Update the local state with the new name and path
      set((state) => {
        const prevNodes = { ...state.entities.nodes };
        prevNodes[noteId] = {
          ...prevNodes[noteId],
          name: newName,
          path: data.newPath,
        };
        return {
          entities: { ...state.entities, nodes: prevNodes },
        };
      });

      return true;
    } catch (error) {
      console.error("Failed to rename note:", error);
      return false;
    }
  },

  /** 
   * Delete a folder in the virtual file system
   * @param folderId - The ID of the folder to delete
   * @returns True if the folder was deleted successfully, false otherwise
   */
  deleteFolder: async (folderId: string) => {
    try {
      const { success, error } = await window.vfsAPI.deleteFolder(folderId);
  
      if (!success) {
        console.error("Failed to delete folder:", error);
        return false;
      }

      // Reload the file system to reflect the changes
      return get().loadVirtualFileSystem(); 
    } catch (error) {
      console.error("Failed to delete folder:", error);
      return false;
    }
  },


  /**
   * Delete a note in the virtual file system
   * @param noteId - The ID of the note to delete
   * @returns True if the note was deleted successfully, false otherwise
   */
  deleteNote: async (noteId: string) => {
    try {
      const { success, error } = await window.vfsAPI.deleteNote(noteId);
  
      if (!success) {
        console.error("Failed to delete note:", error);
        return false;
      }

      set((state) => {
        const prevNodes = { ...state.entities.nodes };
        delete prevNodes[noteId];
        return { entities: { ...state.entities, nodes: prevNodes } };
      });
  
      return true;
    } catch (error) {
      console.error("Failed to delete note:", error);
      return false;
    }
  },
}));
