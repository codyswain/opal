import { FSEntry, Note, AIMetadata } from '@/types';

export interface FSExplorerState {
  entities: {
    nodes: Record<string, FSEntry>;
    notes: Record<string, Note>;
    aiMetadata: Record<string, AIMetadata>;
  };
  ui: {
    selectedId: string | null;
    expandedFolders: Set<string>;
    searchQuery: string;
    history: string[];
    historyIndex: number;
    isNavigatingHistory: boolean;
    rightSidebarTab: string;
    // Added state for inline folder creation
    creatingFolderInParentId: string | null; 
    newFolderName: string;
    createFolderError: string | null;
  };
  loading: {
    isLoading: boolean;
    error: string | null;
  };
  loadFileSystem: () => Promise<boolean>;
  getNote: (id: string) => Promise<boolean>;
  updateNoteContent: (id: string, content: string) => Promise<boolean>;
  createNote: (parentPath: string, noteName: string) => Promise<boolean>;
  renameItem: (id: string, newName: string) => Promise<boolean>;
  createFolder: (parentPath: string, folderName: string) => Promise<boolean>;
  // Removed createFolder and renameItem as they are now handled via databaseAPI or specific actions
  
  // Actions for inline folder creation
  startCreatingFolder: (parentId: string) => void;
  setNewFolderName: (name: string) => void;
  cancelCreatingFolder: () => void;
  confirmCreateFolder: () => Promise<boolean>; 
  
  toggleFolder: (folderId: string) => void;
  setSearchQuery: (query: string) => void;
  selectEntry: (id: string) => void; // Changed from selectEntry to handle async note loading and history
  
  // Navigation methods
  goBack: () => void;
  goForward: () => void;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
} 