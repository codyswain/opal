// src/shared/types/index.ts

import type { default as OpenAI } from "openai";

// Duplicate Item interface from src/main/database/types.ts
export interface Item {
  id: string;
  type: 'folder' | 'file' | 'note';
  path: string;
  parent_path: string;
  name: string;
  created_at?: string;
  updated_at?: string;
  size?: number;
  is_mounted?: boolean;
  real_path?: string;
}

export type FSEntryType = 'folder' | 'file' | 'note';

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

export interface EmbeddedItem {
  embedded_id: string;
  note_id: string;
  embedded_item_id: string;
  position_in_note: {
    type: string;  // 'image', 'folder', etc.
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    scale?: number;
    [key: string]: unknown;
  };
  item_type: FSEntryType;
  item_path: string;
  item_name: string;
  real_path?: string;
}

export interface AIMetadata {
  id?: string;
  item_id: string;
  summary?: string;
  tags?: string;
}

export interface NoteMetadata {
  id: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
  tags?: string[];
}

export interface NoteContent {
  content?: string;
}

export interface Note extends NoteMetadata, NoteContent {}

export interface FileNode {
  id: string;
  name: string;
  type: 'directory' | 'note';
  parentId: string | null;
  noteMetadata?: NoteMetadata;
  fullPath: string;
  childIds?: string[];
}

export interface FileNodeMap {
  [id: string]: FileNode;
}

export interface DirectoryStructures {
  rootIds: string[];
  nodes: FileNodeMap;
}

export interface SimilarNote extends Note {
  score: number;
}

export interface TabInfo {
  id: string;
  title: string;
}

export type Embedding = OpenAI.Embeddings.CreateEmbeddingResponse;

export interface Config {
  openaiApiKey?: string;
  topLevelFolders?: string[];
}

export interface DirectoryEntry {
  name: string;
  type: "directory" | "note";
  noteMetadata?: NoteMetadata;
  fullPath: string;
  children?: DirectoryEntry[];
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  id?: string;
  created_at?: string;
}

// Correct type for chat messages from DB
export interface ChatMessage extends Message {
  sequence: number;
  conversation_id: string;
}

export interface Conversation {
  id: string; // Renamed from conversation_id for consistency
  created_at: string;
  last_message_at: string;
  title: string | null; // Title derived from first user message
  message_count: number;
}

// Add this interface for the Zustand store state
export interface FSExplorerState {
  entities: {
    nodes: Record<string, FSEntry>;
    notes: Record<string, NoteContent>; // Store note content separately
    aiMetadata: Record<string, AIMetadata>; // Store AI metadata separately
  };
  ui: {
    selectedId: string | null;
    expandedFolders: Set<string>;
    searchQuery: string;
    history: string[];
    historyIndex: number;
    isNavigatingHistory: boolean;
    rightSidebarTab: 'related' | 'chat' | 'search' | 'embeddings';
    // New state for inline folder creation
    creatingFolderInParentId: string | null;
    newFolderName: string;
    createFolderError: string | null;
  };
  loading: {
    isLoading: boolean;
    error: string | null;
  };
  // Actions
  loadFileSystem: () => Promise<boolean>;
  getNote: (id: string) => Promise<boolean>;
  updateNoteContent: (id: string, content: string) => Promise<boolean>;
  selectEntry: (id: string) => void;
  goBack: () => void;
  goForward: () => void;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  toggleFolder: (folderId: string) => void;
  setSearchQuery: (query: string) => void;
  createNote: (parentPath: string, noteName: string) => Promise<boolean>;
  createFolder: (parentPath: string, folderName: string) => Promise<boolean>;
  renameItem: (id: string, newName: string) => Promise<boolean>;
  // New actions for inline folder creation
  startCreatingFolder: (parentId: string) => void;
  setNewFolderName: (name: string) => void;
  cancelCreatingFolder: () => void;
  confirmCreateFolder: () => Promise<boolean>;
}

// Consolidated global type definitions
declare global {
  interface Window {
    electron: {
      saveNote: (note: Note, dirPath: string) => Promise<{ success: boolean; error?: string; }>;
      deleteNote: (noteId: string, dirPath: string) => Promise<{ success: boolean; error?: string; }>;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      getNotePath: (noteId: string) => Promise<string>;
      getOpenAIKey: () => Promise<string>;
      setOpenAIKey: (key: string) => Promise<void>;
      createDirectory: (dirPath: string) => Promise<{ success: boolean; error?: string; }>;
      deleteDirectory: (dirPath: string) => Promise<{ success: boolean; error?: string; }>;
      getTopLevelFolders: () => Promise<string[]>;
      addTopLevelFolder: (folderPath: string) => Promise<{ success: boolean; error?: string; }>;
      removeTopLevelFolder: (folderPath: string) => Promise<{ success: boolean; error?: string; }>;
      openFolderDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>;
      getDirectoryStructure: (dirPath: string) => Promise<DirectoryEntry>;
      loadNote: (notePath: string) => Promise<Note>;
      deleteFileNode: (fileNodeType: string, fileNodePath: string) => Promise<{ success: boolean; error?: string; }>;
      generateNoteEmbeddings: (note: Note, fileNode: FileNode) => Promise<void>;
      findSimilarNotes: (query: string, directoryStructures: DirectoryStructures) => Promise<SimilarNote[]>;
      performRAGChat: (conversation: Message[], directoryStructures: DirectoryStructures) => Promise<{ role: string; content: string }>;
      clearVectorIndex: () => Promise<{ success: boolean; message?: string }>;
      regenerateAllEmbeddings: () => Promise<{ success: boolean; count?: number; message?: string }>;
      
      // Database File Operations
      createFolder: (parentPath: string, folderName: string) => Promise<{ success: boolean; id?: string; path?: string; error?: string }>;
      createNote: (parentPath: string, noteName: string, initialContent: string) => Promise<{ success: boolean; id?: string; path?: string; error?: string }>;
      listItems: (directoryPath: string) => Promise<{ success: boolean; items?: Item[]; error?: string }>;
      getItemByPath: (itemPath: string) => Promise<{ success: boolean; item?: Item; error?: string }>;
      deleteItem: (itemPath: string) => Promise<{ success: boolean; error?: string; }>;
      renameItem: (itemPath: string, newName: string) => Promise<{ success: boolean; newPath?: string; error?: string }>;
      moveItem: (oldPath: string, newParentPath: string) => Promise<{ success: boolean; newPath?: string; error?: string }>;
      getNoteContent: (notePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
      updateNoteContent: (notePath: string, newContent: string) => Promise<{ success: boolean; error?: string; }>;
      importFile: (sourceFilePath: string, newPath: string) => Promise<{ success: boolean; id?: string; path?: string; error?: string }>;
      addRootFolder: (folderPath: string) => Promise<{ success: boolean; error?: string; }>;
    };
    
    databaseAPI: {
      createFolder: (parentPath: string, folderName: string) => Promise<{ success: boolean; id?: string; path?: string; error?: string }>;
      createNote: (parentPath: string, noteName: string, initialContent: string) => Promise<{ success: boolean; id?: string; path?: string; error?: string }>;
      getNoteContent: (notePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
      updateNoteContent: (notePath: string, newContent: string) => Promise<{ success: boolean; error?: string; }>;
      listItems: (directoryPath: string) => Promise<{ success: boolean; items?: Item[]; error?: string }>;
      getItemByPath: (itemPath: string) => Promise<{ success: boolean; item?: Item; error?: string }>;
      deleteItem: (itemPath: string) => Promise<{ success: boolean; error?: string; }>;
      renameItem: (itemPath: string, newName: string) => Promise<{ success: boolean; newPath?: string; error?: string }>;
      moveItem: (oldPath: string, newParentPath: string) => Promise<{ success: boolean; newPath?: string; error?: string }>;
      addRootFolder: (folderPath: string) => Promise<{ success: boolean; error?: string; }>;
      importFile: (sourceFilePath: string, destinationPath: string) => Promise<{ success: boolean; id?: string; path?: string; error?: string }>;
      triggerMigration: () => Promise<void>;
      cleanupOldNotes: () => Promise<{ success: boolean; message?: string }>;
      resetDatabase: () => Promise<{ success: boolean; message?: string }>;
    };
    
    fileExplorer: {
      getEntries: () => Promise<{success: boolean, items: Record<string, FSEntry>}>;
      getNote: (id: string) => Promise<{success: boolean, note: Note}>;
      updateNoteContent: (id: string, content: string) => Promise<{success: boolean, error?: string}>;
      renameItem: (itemPath: string, newName: string) => Promise<{success: boolean, newPath: string, error?: string}>;
      mountFolder: (targetPath: string, realFolderPath: string) => Promise<{success: boolean, id?: string, path?: string, error?: string}>;
      unmountFolder: (mountedFolderPath: string) => Promise<{success: boolean, error?: string}>;
      getImageData: (imagePath: string) => Promise<{success: boolean, dataUrl?: string, error?: string}>;
      createEmbeddedItem: (noteId: string, embeddedItemId: string, positionData: Record<string, unknown>) => 
        Promise<{success: boolean, embeddedId?: string, embeddingCode?: string, error?: string}>;
      getEmbeddedItem: (embeddedId: string) => 
        Promise<{success: boolean, embeddedItem?: EmbeddedItem, error?: string}>;
      getNoteEmbeddedItems: (noteId: string) => 
        Promise<{success: boolean, embeddedItems?: EmbeddedItem[], error?: string}>;
      updateEmbeddedItem: (embeddedId: string, positionData: Record<string, unknown>) => 
        Promise<{success: boolean, error?: string}>;
      deleteEmbeddedItem: (embeddedId: string) => 
        Promise<{success: boolean, error?: string}>;
    };
    
    chatAPI: {
      getConversation: (conversationId: string) => Promise<{success: boolean, messages: ChatMessage[], error?: string}>;
      getAllConversations: () => Promise<{success: boolean, conversations: Conversation[], error?: string}>;
      addMessage: (conversationId: string, role: string, content: string) => Promise<{success: boolean, messageId: string, error?: string}>;
      performRAG: (conversationId: string, query: string) => Promise<{success: boolean, message: Message, error?: string}>;
      performRAGStreaming: (
        conversationId: string, 
        query: string, 
        callback: (chunk: string) => void
      ) => () => void; // Returns a cleanup function
    };
  }
}

// This ensures the file is treated as a module.
export {};