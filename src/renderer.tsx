import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/renderer/App";
import "@/renderer/index.css";
import {
  Note,
  FileNode,
  DirectoryEntry,
  SimilarNote,
  Embedding,
  DirectoryStructures,
} from "@/renderer/shared/types";
import { Item } from "./main/database/types";

declare global {
  interface Window {
    electron: {
      saveNote: (note: Note, dirPath: string) => Promise<string>;
      deleteNote: (noteId: string, dirPath: string) => Promise<void>;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      getOpenAIKey: () => Promise<string>;
      setOpenAIKey: (key: string) => Promise<void>;
      getNotePath: (noteId: string) => Promise<string>;
      createDirectory: (dirPath: string) => Promise<void>;
      deleteDirectory: (dirPath: string) => Promise<void>;
      getTopLevelFolders: () => Promise<string[]>;
      addTopLevelFolder: (folderPath: string) => Promise<string[]>;
      removeTopLevelFolder: (folderPath: string) => Promise<string[]>;
      openFolderDialog: () => Promise<string[] | null>;
      getDirectoryStructure: (dirPath: string) => Promise<DirectoryEntry>;
      loadNote: (notePath: string) => Promise<Note>;
      deleteFileNode: (
        fileNodeType: string,
        fileNodePath: string
      ) => Promise<void>;
      generateNoteEmbeddings: (
        note: Note,
        fileNode: FileNode
      ) => Promise<Embedding>;
      findSimilarNotes: (
        query: string,
        directoryStructures: DirectoryStructures
      ) => Promise<SimilarNote[]>;
      performRAGChat: (
        conversation: { role: string; content: string }[],
        directoryStructures: DirectoryStructures
      ) => Promise<{ role: string; content: string }>;

      // Database File Operations
      createFolder: (parentPath: string, folderName: string) => Promise<void>;
      createNote: (parentPath: string, noteName: string, initialContent: string) => Promise<void>;
      listItems: (directoryPath: string) => Promise<Item[]>;
      getItemByPath: (itemPath: string) => Promise<Item>;
      deleteItem: (itemPath: string) => Promise<void>;
      renameItem: (itemPath: string, newName: string) => Promise<void>;
      moveItem: (oldPath: string, newParentPath: string) => Promise<void>;
      getNoteContent: (notePath: string) => Promise<string>;
      updateNoteContent: (notePath: string, newContent: string) => Promise<void>;
      importFile: (sourceFilePath: string, newPath: string) => Promise<void>;
      addRootFolder: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
    };
  }
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);

console.log(
  '👋 This message is being logged by "renderer.tsx", included via Vite'
);
