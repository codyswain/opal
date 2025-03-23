// Re-export database functionality
export { initializeDatabase, closeDatabase } from "./database";

// Re-export IPC handlers
export { registerConfigIPCHandlers } from "./config/handlers";
export { registerEmbeddingIPCHandlers } from "./embeddings/handlers";
export { registerFileSystemIPCHandlers } from "./file-system/handlers";

// Export logger
export { default as log } from "./logger";

import { registerDatabaseIPCHandlers } from "./database/handlers";

import { app } from "electron";
import log from "./logger";
import { initializeDatabase } from "./database";
import { registerEmbeddingIPCHandlers } from "./embeddings/handlers";

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

    log.info("Application initialization completed");
  } catch (error) {
    log.error("Error during app initialization:", error);
    // You might want to show an error dialog to the user here
  }
});
