// Re-export database functionality
export { initializeDatabase, closeDatabase } from "./database";

// Re-export IPC handlers
export { registerEmbeddingIPCHandlers } from "./embeddings/handlers";
export { registerFileSystemIPCHandlers } from "./file-system/handlers";
export { registerDatabaseIPCHandlers } from "./database/handlers";

// Export logger
export { default as log } from "./logger";
