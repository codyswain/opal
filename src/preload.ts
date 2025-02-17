import { contextBridge, ipcRenderer } from "electron";
import { Note, FileNode, DirectoryStructures, Embedding, SimilarNote } from "./renderer/shared/types";

/* 
  The preload script runs in an isolated context. (since contextIsolation is 
  enabled in main.ts.)

  It calls contextBridge which provides a secure way to bridge across isolated
  contexts. exposeInMainWorld, exposes these methods in the main world. 
  Confusingly, the main world is the JS context that your renderer (e.g., React)
  runs in. 

  So the preload script runs in an isolated context, but it exposes IPC methods,
  and these IPC methods provide a bridge between the main electron process, and
  the renderer process. 

  |--Main Process--|--Preload Script--|--Renderer Process--|
  After preload script runs:
  |--Main Process--|   <--IPC-->   |--Renderer Process--|
*/

contextBridge.exposeInMainWorld("electron", {
  saveNote: (note: Note, dirPath: string) =>
    ipcRenderer.invoke("save-note", note, dirPath),
  deleteNote: (noteId: string, dirPath: string) =>
    ipcRenderer.invoke("delete-note", noteId, dirPath),
  minimize: () => ipcRenderer.send("minimize-window"),
  maximize: () => ipcRenderer.send("maximize-window"),
  close: () => ipcRenderer.send("close-window"),
  getNotePath: (noteId: string) => ipcRenderer.invoke("get-note-path", noteId),
  getOpenAIKey: () => ipcRenderer.invoke("get-openai-key"),
  setOpenAIKey: (key: string) => ipcRenderer.invoke("set-openai-key", key),
  createDirectory: (dirPath: string) =>
    ipcRenderer.invoke("create-directory", dirPath),
  deleteDirectory: (dirPath: string) =>
    ipcRenderer.invoke("delete-directory", dirPath),
  getTopLevelFolders: () => ipcRenderer.invoke("get-top-level-folders"),
  addTopLevelFolder: (folderPath: string) =>
    ipcRenderer.invoke("add-top-level-folder", folderPath),
  removeTopLevelFolder: (folderPath: string) =>
    ipcRenderer.invoke("remove-top-level-folder", folderPath),
  openFolderDialog: () => ipcRenderer.invoke("open-folder-dialog"),
  getDirectoryStructure: (dirPath: string) =>
    ipcRenderer.invoke("get-directory-structure", dirPath),
  loadNote: (notePath: string) => ipcRenderer.invoke("load-note", notePath),
  deleteFileNode: (fileNodeType: string, fileNodePath: string) =>
    ipcRenderer.invoke("delete-file-node", fileNodeType, fileNodePath),
  generateNoteEmbeddings: (note: Note, fileNode: FileNode) =>
    ipcRenderer.invoke("generate-note-embeddings", note, fileNode),
  findSimilarNotes: (query: string, directoryStructures: DirectoryStructures) =>
    ipcRenderer.invoke("perform-similarity-search", query, directoryStructures),
  performRAGChat: (
    conversation: { role: string; content: string }[],
    directoryStructures: DirectoryStructures
  ) => ipcRenderer.invoke("perform-rag-chat", conversation, directoryStructures),
});
