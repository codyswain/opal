import BetterSqlite3 from 'better-sqlite3';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import log from 'electron-log';

class DatabaseManager {
  private static instance: DatabaseManager;
  private db: BetterSqlite3.Database | null = null;

  private constructor() {
    // Database will be initialized explicitly via initialize() method
  }

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  public async initialize(dbPath?: string): Promise<BetterSqlite3.Database> {
    try {
      // If dbPath is not provided, use the default location
      const finalDbPath = dbPath || path.join(app.getPath('userData'), 'tread.db');

      log.info(`Initializing database at: ${finalDbPath}`);
      log.info(`Database exists before connection: ${fs.existsSync(finalDbPath)}`);
      
      // Create the database connection
      this.db = new BetterSqlite3(finalDbPath, {
        verbose: (message) => log.debug(`[SQLite] ${message}`)
      });
      
      log.info(`Database exists after connection: ${fs.existsSync(finalDbPath)}`);
      
      // Enable foreign keys
      this.db.pragma('foreign_keys = ON');
      
      log.info('Database connection established successfully');
      
      return this.db;
    } catch (error) {
      log.error('Error creating database connection:', error);
      throw error;
    }
  }

  public getDatabase(): BetterSqlite3.Database | null {
    return this.db;
  }

  public close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

export default DatabaseManager;
