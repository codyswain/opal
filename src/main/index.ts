// Re-export database functionality
export { initializeDatabase, closeDatabase } from './database';

// Re-export IPC handlers
export { registerConfigIPCHandlers } from './config/handlers';
export { registerEmbeddingIPCHandlers } from './embeddings/handlers';
export { registerFileSystemIPCHandlers } from './file-system/handlers';

// Export logger
export { default as log } from './logger';

import { registerDatabaseIPCHandlers } from './database/handlers';
import { migrateNotesToDatabase } from './database/migration';
import { cleanupOldNotes } from './database/cleanup';

import { app } from 'electron';

app.whenReady().then(async () => {
  try {
    log.info('Initializing application...');
    
    // Initialize the database
    await initializeDatabase();
    log.info('Database initialized successfully');
    
    // Register database IPC handlers
    registerDatabaseIPCHandlers();
    log.info('Database IPC handlers registered');
    
    // Migrate existing notes from file system to database
    await migrateNotesToDatabase();
    log.info('Migration from file system to database completed');
    
    // Optional: Clean up old notes after successful migration
    // Uncomment the following line if you want to automatically clean up
    // await cleanupOldNotes();
    
    // ... rest of your existing app initialization ...
    
    log.info('Application initialization completed');
  } catch (error) {
    log.error('Error during app initialization:', error);
    // You might want to show an error dialog to the user here
  }
});
