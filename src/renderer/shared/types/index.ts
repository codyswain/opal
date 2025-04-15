// src/shared/types/index.ts

import type { default as OpenAI } from "openai";
import { FSEntry } from '@/types'; // Import FSEntry from shared types
import { CredentialAccount } from "@/types/credentials";

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

export interface ChatMessage extends Message {
  sequence: number;
  conversation_id: string;
}

export interface Conversation {
  id: string;
  created_at: string;
  last_message_at: string;
  title: string | null;
  message_count: number;
}

declare global {
  interface Window {
    systemAPI: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      openFolderDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>;
      createDirectoryOnDisk: (dirPath: string) => Promise<{ success: boolean, error?: string }>;
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

    vfsAPI: {
      getItems: () => Promise<{success: boolean, items: Record<string, FSEntry>}>;
      renameItem: (itemPath: string, newName: string) => Promise<{success: boolean, newPath: string, error?: string}>;

      createFolder: (parentPath: string, folderName: string) => Promise<{success: boolean, error?: string}>;
      deleteFolder: (directoryPath: string) => Promise<{success: boolean, error?: string}>;
      renameFolder: (directoryPath: string, newName: string) => Promise<{success: boolean, error?: string}>;
      moveFolder: (oldPath: string, newParentPath: string) => Promise<{success: boolean, newPath?: string, error?: string}>;
      getFolder: (directoryPath: string) => Promise<{success: boolean, items: Item[], error?: string}>;

      createNote: (parentPath: string, noteName: string, initialContent: string) => Promise<{success: boolean, error?: string}>;
      deleteNote: (notePath: string) => Promise<{success: boolean, error?: string}>;
      renameNote: (notePath: string, newName: string) => Promise<{success: boolean, error?: string}>;
      moveNote: (oldPath: string, newParentPath: string) => Promise<{success: boolean, newPath?: string, error?: string}>;
      getNote: (notePath: string) => Promise<{success: boolean, note: Note, error?: string}>;
      updateNoteContent: (id: string, content: string) => Promise<{success: boolean, error?: string}>;

      createEmbeddedItem: (noteId: string, embeddedItemId: string, positionData: Record<string, unknown>) => Promise<{success: boolean, embeddedId?: string, embeddingCode?: string, error?: string}>;
      getEmbeddedItem: (embeddedId: string) => Promise<{success: boolean, embeddedItem?: EmbeddedItem, error?: string}>;
      getNoteEmbeddedItems: (noteId: string) => Promise<{success: boolean, embeddedItems?: EmbeddedItem[], error?: string}>;
      updateEmbeddedItem: (embeddedId: string, positionData: Record<string, unknown>) => Promise<{success: boolean, error?: string}>;
      deleteEmbeddedItem: (embeddedId: string) => Promise<{success: boolean, error?: string}>;

      findSimilarNotes: (query: string, directoryStructures: DirectoryStructures) => Promise<SimilarNote[]>;
    }

    syncAPI: {
      mountFolder: (targetPath: string, realFolderPath: string) => Promise<{success: boolean, id?: string, path?: string, error?: string}>;
      unmountFolder: (mountedFolderPath: string) => Promise<{success: boolean, error?: string}>;
      getImageData: (imagePath: string) => Promise<{success: boolean, dataUrl?: string, error?: string}>;
    }

    adminAPI: {
      resetDatabase: () => Promise<{ success: boolean; message?: string }>;
      backupDatabase: () => Promise<{ success: boolean; filePath?: string; message?: string }>;
      clearVectorIndex: () => Promise<{ success: boolean; message?: string }>;
      regenerateAllEmbeddings: () => Promise<{ success: boolean; count?: number; message?: string }>;
    }

    credentialAPI: {
      getKey: (account: CredentialAccount) => Promise<string>;
      setKey: (account: CredentialAccount, password: string) => Promise<void>;
      deleteKey: (account: CredentialAccount) => Promise<void>;
    };
  }
}

// This ensures the file is treated as a module.
export {};