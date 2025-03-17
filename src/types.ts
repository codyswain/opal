type FSEntryType = 'folder' | 'file' | 'note';

export interface FSEntry {
  id: string;
  name: string;
  type: FSEntryType;
  path: string;
  parentId: string | null;
  children: string[]; // empty for files and notes
  metadata: {
    createdAt: string;
    updatedAt: string;
    size: number;
  }
}

export interface Note {
  id: string;
  content: string;
}

export interface AIMetadata {
  summary: string | null;
  tags: string[] | null;
}

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
  };
  loading: {
    isLoading: boolean;
    error: string | null;
  };
  loadFileSystem: () => Promise<boolean>;
  getNote: (id: string) => Promise<boolean>;
  
  toggleFolder: (folderId: string) => void;
  setSearchQuery: (query: string) => void;
  selectEntry: (id: string) => void;
}