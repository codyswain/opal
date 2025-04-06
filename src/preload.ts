import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
import { Note, FileNode, DirectoryStructures } from "./renderer/shared/types";

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
  openFolderDialog: () => ipcRenderer.invoke("dialog:openDirectory"),
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
  clearVectorIndex: () => 
    ipcRenderer.invoke("clear-vector-index"),
  regenerateAllEmbeddings: () => 
    ipcRenderer.invoke("regenerate-all-embeddings"),

  // Database File Operations
  createFolder: (parentPath: string, folderName: string) =>
    ipcRenderer.invoke("create-folder", parentPath, folderName),
  createNote: (parentPath: string, noteName: string, initialContent: string) =>
    ipcRenderer.invoke("create-note", parentPath, noteName, initialContent),
  listItems: (directoryPath: string) =>
    ipcRenderer.invoke("list-items", directoryPath),
  getItemByPath: (itemPath: string) =>
    ipcRenderer.invoke("get-item-by-path", itemPath),
  deleteItem: (itemPath: string) =>
    ipcRenderer.invoke("delete-item", itemPath),
  renameItem: (itemPath: string, newName: string) =>
    ipcRenderer.invoke("rename-item", itemPath, newName),
  moveItem: (oldPath: string, newParentPath: string) =>
    ipcRenderer.invoke("move-item", oldPath, newParentPath),
  getNoteContent: (notePath: string) =>
    ipcRenderer.invoke("get-note-content", notePath),
  updateNoteContent: (notePath: string, newContent: string) =>
    ipcRenderer.invoke("update-note-content", notePath, newContent),
  importFile: (sourceFilePath: string, newPath: string) =>
    ipcRenderer.invoke("import-file", sourceFilePath, newPath),
  addRootFolder: (folderPath: string) =>
    ipcRenderer.invoke("add-root-folder", folderPath),
});

// Expose the database API to the renderer process
contextBridge.exposeInMainWorld('databaseAPI', {
  // Folder operations
  createFolder: (parentPath: string, folderName: string) => 
    ipcRenderer.invoke('create-folder', parentPath, folderName),
  
  // Note operations
  createNote: (parentPath: string, noteName: string, initialContent: string) => 
    ipcRenderer.invoke('create-note', parentPath, noteName, initialContent),
  getNoteContent: (notePath: string) => 
    ipcRenderer.invoke('get-note-content', notePath),
  updateNoteContent: (notePath: string, newContent: string) => 
    ipcRenderer.invoke('update-note-content', notePath, newContent),
  
  // Item operations
  listItems: (directoryPath: string) => 
    ipcRenderer.invoke('list-items', directoryPath),
  getItemByPath: (itemPath: string) => 
    ipcRenderer.invoke('get-item-by-path', itemPath),
  deleteItem: (itemPath: string) => 
    ipcRenderer.invoke('delete-item', itemPath),
  renameItem: (itemPath: string, newName: string) => 
    ipcRenderer.invoke('rename-item', itemPath, newName),
  moveItem: (oldPath: string, newParentPath: string) => 
    ipcRenderer.invoke('move-item', oldPath, newParentPath),
  
  // Root folder operations
  addRootFolder: (folderPath: string) => 
    ipcRenderer.invoke('add-root-folder', folderPath),
  
  // File operations
  importFile: (sourceFilePath: string, destinationPath: string) => 
    ipcRenderer.invoke('import-file', sourceFilePath, destinationPath),

  // Migration utilities
  triggerMigration: () => 
    ipcRenderer.invoke('trigger-migration'),
  cleanupOldNotes: () => 
    ipcRenderer.invoke('cleanup-old-notes'),

  // Add this to your existing databaseAPI
  resetDatabase: () => 
    ipcRenderer.invoke('reset-database'),
});

// Define the entire fileExplorer API block
contextBridge.exposeInMainWorld("fileExplorer", {
  openDialogToMountDirpath: () => ipcRenderer.invoke("open-folder-dialog"),
  getEntries: () => ipcRenderer.invoke("file-explorer:get-entries"),
  getNote: (id: string) => ipcRenderer.invoke('file-explorer:get-note', id),
  updateNoteContent: (id: string, content: string) => ipcRenderer.invoke('file-explorer:update-note-content', id, content),
  renameItem: (itemPath: string, newName: string) => ipcRenderer.invoke('file-explorer:rename-item', itemPath, newName),
  createFolder: (parentPath: string, folderName: string) => ipcRenderer.invoke('file-explorer:create-folder', parentPath, folderName),
  createNote: (parentPath: string, noteName: string, initialContent: string) => ipcRenderer.invoke('file-explorer:create-note', parentPath, noteName, initialContent),
  deleteItem: (itemPath: string) => ipcRenderer.invoke('file-explorer:delete-item', itemPath),
  moveItem: (oldPath: string, newParentPath: string) => ipcRenderer.invoke('file-explorer:move-item', oldPath, newParentPath),
});

// Expose chat API to the renderer process
contextBridge.exposeInMainWorld("chatAPI", {
  getConversation: (conversationId: string) => 
    ipcRenderer.invoke('chat:get-conversation', conversationId),
  getAllConversations: () =>
    ipcRenderer.invoke('chat:get-all-conversations'),
  addMessage: (conversationId: string, role: string, content: string) => 
    ipcRenderer.invoke('chat:add-message', conversationId, role, content),
  performRAG: (conversationId: string, query: string) => 
    ipcRenderer.invoke('chat:perform-rag', conversationId, query),
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
