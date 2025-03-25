// Update the window object with IPC handlers
contextBridge.exposeInMainWorld('fileExplorer', {
  // ... existing handlers ...
  
  // Add mount folder handler
  mountFolder: (targetPath: string, realFolderPath: string) => {
    return ipcRenderer.invoke('file-explorer:mount-folder', targetPath, realFolderPath);
  },
  
  // Add unmount folder handler
  unmountFolder: (mountedFolderPath: string) => {
    return ipcRenderer.invoke('file-explorer:unmount-folder', mountedFolderPath);
  },
  
  // ... existing handlers ...
}); 