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
      openFolderDialog: () => Promise<string | null>;
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
