// Re-export database functionality
export { initializeDatabase, closeDatabase } from './database';

// Re-export IPC handlers
export { registerConfigIPCHandlers } from './config/handlers';
export { registerEmbeddingIPCHandlers } from './embeddings/handlers';
export { registerFileSystemIPCHandlers } from './file-system/handlers';

// Export logger
export { default as log } from './logger';
