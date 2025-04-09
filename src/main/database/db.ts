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
      const finalDbPath = dbPath || path.join(app.getPath('userData'), 'opal.db');

      log.info(`Initializing database at: ${finalDbPath}`);
      log.info(`Database exists before connection: ${fs.existsSync(finalDbPath)}`);
      
      // Create the database connection
      this.db = new BetterSqlite3(finalDbPath, {
        verbose: (message) => log.debug(`[SQLite] ${message}`)
      });
      
      log.info(`Database exists after connection: ${fs.existsSync(finalDbPath)}`);
      
      // Enable foreign keys
      this.db.pragma('foreign_keys = ON');
      
      // // Migrate the database if needed // <-- REMOVED THIS CALL
      // await this.migrateDatabase();
      
      log.info('Database connection established successfully (schema not applied yet)');
      
      return this.db;
    } catch (error) {
      log.error('Error creating database connection:', error);
      throw error;
    }
  }

  /**
   * Performs database migrations as needed
   * This should be called AFTER the schema is applied.
   */
  public async migrateDatabase(): Promise<void> {
    if (!this.db) return;
    
    try {
      // Check if is_mounted column exists in items table
      const tableInfo = this.db.prepare("PRAGMA table_info(items)").all() as {name: string}[];
      const hasMountedColumn = tableInfo.some(col => col.name === 'is_mounted');
      const hasRealPathColumn = tableInfo.some(col => col.name === 'real_path');
      
      if (!hasMountedColumn) {
        log.info('Migrating database: Adding is_mounted column to items table');
        this.db.prepare("ALTER TABLE items ADD COLUMN is_mounted BOOLEAN DEFAULT 0").run();
      }
      
      if (!hasRealPathColumn) {
        log.info('Migrating database: Adding real_path column to items table');
        this.db.prepare("ALTER TABLE items ADD COLUMN real_path TEXT").run();
      }
      
      log.info('Database migration completed successfully');
    } catch (error) {
      log.error('Error during database migration:', error);
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
