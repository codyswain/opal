// src/main/database/index.ts
import DatabaseManager from './db';
import log from 'electron-log';

let dbManager: DatabaseManager | null = null;

export async function initializeDatabase() {
  if (!dbManager) { // Only initialize if not already initialized
    try {
      dbManager = DatabaseManager.getInstance();
      await dbManager.initialize();
      log.info('Database initialized');
    } catch (error) {
      log.error('Failed to initialize database:', error);
      dbManager = null; // Important: set dbManager to null
      throw error; // Re-throw to be handled by the caller
    }
  } else {
      log.warn("Database already initialized, skipping.");
  }
}

export async function closeDatabase() {
  if (dbManager) {
    try {
      log.info('Closing database connection');
      dbManager.close();
    } catch (error) {
      log.error("Error during database close:", error);
    } finally {
      dbManager = null; // Ensure dbManager is null even if close fails
    }
  } else {
    log.warn("DatabaseManager was null, skipping close.");
  }
}
