import BetterSqlite3 from 'better-sqlite3';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import log from 'electron-log';

class DatabaseManager {
  private static instance: DatabaseManager;
  private db: BetterSqlite3.Database;

  private constructor() {
    const dbPath = path.join(app.getPath('userData'), 'tread.db');

    log.info(`Database path: ${dbPath}`);
    log.info(`Database exists before connection: ${fs.existsSync(dbPath)}`);
    
    this.db = new BetterSqlite3(dbPath, {
      verbose: (message) => log.debug(`[SQLite] ${message}`)
    });
    
    log.info(`Database exists after connection: ${fs.existsSync(dbPath)}`);
    
    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');
  }

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  public async initialize(): Promise<void> {
    try {
      const schemaPath = app.isPackaged
        ? path.join(process.resourcesPath, 'schema.sql')
        : path.join(process.cwd(), 'src', 'main', 'database', 'schema.sql');
      
      log.info(`Loading schema from: ${schemaPath}`);
      const schemaSQL = await fs.promises.readFile(schemaPath, 'utf-8');
      
      // Execute the schema in a transaction for better reliability
      this.db.exec('BEGIN TRANSACTION;');
      this.db.exec(schemaSQL);
      this.db.exec('COMMIT;');
      
      log.info('Database schema initialized successfully');
    } catch (error) {
      // If there was an error, try to rollback the transaction
      try {
        this.db.exec('ROLLBACK;');
      } catch (rollbackError) {
        log.error('Error during rollback:', rollbackError);
      }
      
      log.error('Error initializing database schema:', error);
      throw error;
    }
  }

  public getDatabase(): BetterSqlite3.Database {
    return this.db;
  }

  public close(): void {
    if (this.db) {
      this.db.close();
    }
  }
}

export default DatabaseManager;
