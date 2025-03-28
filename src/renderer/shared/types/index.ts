// src/shared/types/index.ts

import OpenAI from "openai";

// FSEntry type for file explorer
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

// New interface for embedded items
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
    [key: string]: any;  // Allow additional properties for different embed types
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
}

export interface DirectoryEntry {
  name: string;
  type: "directory" | "note";
  noteMetadata?: NoteMetadata;
  fullPath: string;
  children?: DirectoryEntry[];
}

// Consolidated global type definitions
declare global {
  interface Window {
    electron: {
      saveNote: (note: Note, dirPath: string) => Promise<any>;
      deleteNote: (noteId: string, dirPath: string) => Promise<any>;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      getNotePath: (noteId: string) => Promise<string>;
      getOpenAIKey: () => Promise<string>;
      setOpenAIKey: (key: string) => Promise<void>;
      createDirectory: (dirPath: string) => Promise<any>;
      deleteDirectory: (dirPath: string) => Promise<any>;
      getTopLevelFolders: () => Promise<string[]>;
      addTopLevelFolder: (folderPath: string) => Promise<any>;
      removeTopLevelFolder: (folderPath: string) => Promise<any>;
      openFolderDialog: () => Promise<string>;
      getDirectoryStructure: (dirPath: string) => Promise<any>;
      loadNote: (notePath: string) => Promise<any>;
      deleteFileNode: (fileNodeType: string, fileNodePath: string) => Promise<any>;
      generateNoteEmbeddings: (note: Note, fileNode: any) => Promise<any>;
      findSimilarNotes: (query: string, directoryStructures: any) => Promise<any>;
      performRAGChat: (conversation: { role: string; content: string }[], directoryStructures: any) => Promise<any>;
      
      // Database File Operations
      createFolder: (parentPath: string, folderName: string) => Promise<any>;
      createNote: (parentPath: string, noteName: string, initialContent: string) => Promise<any>;
      listItems: (directoryPath: string) => Promise<any>;
      getItemByPath: (itemPath: string) => Promise<any>;
      deleteItem: (itemPath: string) => Promise<any>;
      renameItem: (itemPath: string, newName: string) => Promise<any>;
      moveItem: (oldPath: string, newParentPath: string) => Promise<any>;
      getNoteContent: (notePath: string) => Promise<any>;
      updateNoteContent: (notePath: string, newContent: string) => Promise<any>;
      importFile: (sourceFilePath: string, newPath: string) => Promise<any>;
      addRootFolder: (folderPath: string) => Promise<any>;
    };
    
    databaseAPI: {
      createFolder: (parentPath: string, folderName: string) => Promise<any>;
      createNote: (parentPath: string, noteName: string, initialContent: string) => Promise<any>;
      getNoteContent: (notePath: string) => Promise<any>;
      updateNoteContent: (notePath: string, newContent: string) => Promise<any>;
      listItems: (directoryPath: string) => Promise<any>;
      getItemByPath: (itemPath: string) => Promise<any>;
      deleteItem: (itemPath: string) => Promise<any>;
      renameItem: (itemPath: string, newName: string) => Promise<any>;
      moveItem: (oldPath: string, newParentPath: string) => Promise<any>;
      addRootFolder: (folderPath: string) => Promise<any>;
      importFile: (sourceFilePath: string, destinationPath: string) => Promise<any>;
      triggerMigration: () => Promise<any>;
      cleanupOldNotes: () => Promise<any>;
      resetDatabase: () => Promise<any>;
    };
    
    fileExplorer: {
      getEntries: () => Promise<{success: boolean, items: Record<string, FSEntry>}>;
      getNote: (id: string) => Promise<{success: boolean, note: Note}>;
      updateNoteContent: (id: string, content: string) => Promise<{success: boolean, error?: string}>;
      renameItem: (itemPath: string, newName: string) => Promise<{success: boolean, newPath: string, error?: string}>;
      mountFolder: (targetPath: string, realFolderPath: string) => Promise<{success: boolean, id?: string, path?: string, error?: string}>;
      unmountFolder: (mountedFolderPath: string) => Promise<{success: boolean, error?: string}>;
      getImageData: (imagePath: string) => Promise<{success: boolean, dataUrl?: string, error?: string}>;
      createEmbeddedItem: (noteId: string, embeddedItemId: string, positionData: any) => 
        Promise<{success: boolean, embeddedId?: string, embeddingCode?: string, error?: string}>;
      getEmbeddedItem: (embeddedId: string) => 
        Promise<{success: boolean, embeddedItem?: EmbeddedItem, error?: string}>;
      getNoteEmbeddedItems: (noteId: string) => 
        Promise<{success: boolean, embeddedItems?: EmbeddedItem[], error?: string}>;
      updateEmbeddedItem: (embeddedId: string, positionData: any) => 
        Promise<{success: boolean, error?: string}>;
      deleteEmbeddedItem: (embeddedId: string) => 
        Promise<{success: boolean, error?: string}>;
    };
    
    chatAPI: {
      getConversation: (conversationId: string) => Promise<{success: boolean, messages: any[], error?: string}>;
      getAllConversations: () => Promise<{success: boolean, conversations: any[], error?: string}>;
      addMessage: (conversationId: string, role: string, content: string) => Promise<{success: boolean, messageId: string, error?: string}>;
      performRAG: (conversationId: string, query: string) => Promise<{success: boolean, message: any, error?: string}>;
      performRAGStreaming: (
        conversationId: string, 
        query: string, 
        callback: (chunk: string) => void
      ) => () => void; // Returns a cleanup function
    };
  }
}