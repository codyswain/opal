// Re-export database functionality
export { initializeDatabase, closeDatabase } from "./database";

// Re-export IPC handlers
export { registerConfigIPCHandlers } from "./config/handlers";
export { registerEmbeddingIPCHandlers } from "./embeddings/handlers";
export { registerFileSystemIPCHandlers } from "./file-system/handlers";

// Export logger
export { default as log } from "./logger";

import { registerDatabaseIPCHandlers } from "./database/handlers";

import { app, ipcMain, dialog, BrowserWindow } from "electron";
import log from "./logger";
import { initializeDatabase } from "./database";
import { registerEmbeddingIPCHandlers } from "./embeddings/handlers";

// Register dialog handlers
function registerDialogHandlers() {
  // Add dialog handler for folder selection
  ipcMain.handle('dialog:openDirectory', async () => {
    const mainWindow = BrowserWindow.getFocusedWindow();
    
    if (!mainWindow) {
      return { canceled: true };
    }
    
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    
    return result;
  });
  
  log.info("Dialog handlers registered");
}

app.whenReady().then(async () => {
  try {
    log.info("Initializing application...");

    // Initialize the database
    await initializeDatabase();
    log.info("Database initialized successfully");

    // Register database IPC handlers
    registerDatabaseIPCHandlers();
    log.info("Database IPC handlers registered");

    // Register embedding IPC handlers before migrating embeddings
    registerEmbeddingIPCHandlers();
    log.info("Embedding IPC handlers registered");
    
    // Register dialog handlers
    registerDialogHandlers();

    log.info("Application initialization completed");
  } catch (error) {
    log.error("Error during app initialization:", error);
    // You might want to show an error dialog to the user here
  }
});
