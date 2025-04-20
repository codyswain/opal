import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
import { DirectoryStructures } from "./renderer/shared/types";

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
  After preload script runs
  |--Main Process--|   <--IPC-->   |--Renderer Process--|
*/

contextBridge.exposeInMainWorld("systemAPI", {
  minimize: () => ipcRenderer.send("system:minimize-window"),
  maximize: () => ipcRenderer.send("system:maximize-window"),
  close: () => ipcRenderer.send("system:close-window"),
  openFolderDialog: () => ipcRenderer.invoke(`system:open-folder-dialog`),
  createDirectoryOnDisk: (dirPath: string) => ipcRenderer.invoke(`system:create-directory-on-disk`, dirPath),
});

// These need to be moved elsewhere or deprecated
contextBridge.exposeInMainWorld("fileExplorer", {
  updateNoteContent: (id: string, content: string) => ipcRenderer.invoke('file-explorer:update-note-content', id, content),
});

contextBridge.exposeInMainWorld("chatAPI", {
  getConversation: (conversationId: string) => ipcRenderer.invoke('chat:get-conversation', conversationId),
  getAllConversations: () => ipcRenderer.invoke('chat:get-all-conversations'),
  addMessage: (conversationId: string, role: string, content: string) => ipcRenderer.invoke('chat:add-message', conversationId, role, content),
  performRAG: (conversationId: string, query: string) => ipcRenderer.invoke('chat:perform-rag', conversationId, query),
  performRAGStreaming: (conversationId: string, query: string, callback: (chunk: string) => void) => {
    // Create unique channel ID for this request to avoid conflicts
    const responseChannel = `chat:rag-response:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    console.log(`Starting streaming on channel ${responseChannel}`);
    
    // Set up the listener for streaming chunks
    const listener = (_event: IpcRendererEvent, chunk: string | null) => {
      if (chunk === null) {
        // Null chunk signals end of stream, clean up listener
        console.log(`Streaming complete on ${responseChannel}`);
        // Send a special completion message to the callback
        callback("__DONE__");
        ipcRenderer.removeListener(responseChannel, listener);
      } else if (chunk.startsWith("Error:")) {
        // Handle error message from main process
        console.error(`Streaming error: ${chunk}`);
        // Pass the error as a chunk so the UI can display it
        callback(chunk);
        // Don't remove listener yet - wait for the null signal
      } else {
        // Pass the chunk to the callback without logging each chunk
        callback(chunk);
      }
    };
    
    // Add the event listener
    ipcRenderer.on(responseChannel, listener);
    
    // Start the streaming request and return cleanup function
    ipcRenderer.invoke('chat:perform-rag-streaming', conversationId, query, responseChannel)
      .then(result => {
        if (!result.success) {
          console.error(`Error starting streaming: ${result.error}`);
          // Send the error as a chunk
          callback(`Error: ${result.error}`);
        }
      })
      .catch(err => {
        console.error(`Exception invoking streaming: ${err}`);
        callback(`Error: Failed to start streaming - ${err.message}`);
      });
    
    return () => {
      ipcRenderer.removeListener(responseChannel, listener);
    };
  }
});

contextBridge.exposeInMainWorld("vfsAPI", {
  getItems: () => ipcRenderer.invoke('vfs:get-items'),

  createFolder: (parentPath: string, folderName: string) => ipcRenderer.invoke('vfs:create-folder', parentPath, folderName),
  deleteFolder: (dirPath: string) => ipcRenderer.invoke("vfs:delete-folder", dirPath),
  renameFolder: (folderId: string, newName: string) => ipcRenderer.invoke("vfs:rename-folder", folderId, newName),
  moveFolder: (oldPath: string, newParentPath: string) => ipcRenderer.invoke("vfs:move-folder", oldPath, newParentPath),
  getFolder: (directoryPath: string) => ipcRenderer.invoke("vfs:get-folder", directoryPath),

  createNote: (parentPath: string, noteName: string, initialContent: string) => ipcRenderer.invoke("create-note", parentPath, noteName, initialContent),
  deleteNote: (notePath: string) => ipcRenderer.invoke("delete-note", notePath),
  renameNote: (noteId: string, newName: string) => ipcRenderer.invoke("vfs:rename-note", noteId, newName),
  moveNote: (oldPath: string, newParentPath: string) => ipcRenderer.invoke("move-note", oldPath, newParentPath),
  getNote: (id: string) => ipcRenderer.invoke('file-explorer:get-note', id),
  updateNoteContent: (id: string, content: string) => ipcRenderer.invoke('file-explorer:update-note-content', id, content),

  createEmbeddedItem: (noteId: string, embeddedItemId: string, positionData: Record<string, unknown>) => ipcRenderer.invoke("create-embedded-item", noteId, embeddedItemId, positionData),
  getEmbeddedItem: (embeddedId: string) => ipcRenderer.invoke("get-embedded-item", embeddedId),
  getNoteEmbeddedItems: (noteId: string) => ipcRenderer.invoke("get-note-embedded-items", noteId),
  updateEmbeddedItem: (embeddedId: string, positionData: Record<string, unknown>) => ipcRenderer.invoke("update-embedded-item", embeddedId, positionData),
  deleteEmbeddedItem: (embeddedId: string) => ipcRenderer.invoke("delete-embedded-item", embeddedId),

  findSimilarNotes: (query: string, directoryStructures: DirectoryStructures) => ipcRenderer.invoke("perform-similarity-search", query, directoryStructures),
});

contextBridge.exposeInMainWorld("syncAPI", {
  mountFolder: (targetPath: string, realFolderPath: string) => ipcRenderer.invoke("mount-folder", targetPath, realFolderPath),
  unmountFolder: (mountedFolderPath: string) => ipcRenderer.invoke("unmount-folder", mountedFolderPath),
  getImageData: (imagePath: string) => ipcRenderer.invoke("get-image-data", imagePath),
});

contextBridge.exposeInMainWorld("adminAPI", {
  resetDatabase: () => ipcRenderer.invoke('reset-database'),
  backupDatabase: () => ipcRenderer.invoke('backup-database'),
  clearVectorIndex: () => ipcRenderer.invoke("clear-vector-index"),
  regenerateAllEmbeddings: () => ipcRenderer.invoke("regenerate-all-embeddings"),
});

contextBridge.exposeInMainWorld("credentialAPI", {
  getKey: (account: string) => ipcRenderer.invoke("credentials:get", account),
  setKey: (account: string, password: string) => ipcRenderer.invoke("credentials:set", account, password),
  deleteKey: (account: string) => ipcRenderer.invoke("credentials:delete", account),
});
