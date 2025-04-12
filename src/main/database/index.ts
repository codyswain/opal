// src/main/database/index.ts
import { app } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import log from 'electron-log';
import DatabaseManager from './db';
import BetterSqlite3 from 'better-sqlite3';

// Define a minimal interface for the sqlite-vss module
interface SqliteVssModule {
  getVssLoadablePath(): string;
  getVectorLoadablePath(): string;
}

// Wrap dynamic import in a promise that resolves with the module or null
const vssModulePromise: Promise<SqliteVssModule | null> = (async () => {
  try {
    log.info('Attempting to dynamically load sqlite-vss module...');
    // Import the module - could be CommonJS or ES Module
    const vssModule: any = await import('sqlite-vss');
    log.info('Dynamically imported sqlite-vss module keys:', Object.keys(vssModule).join(', '));

    // Check if the function exists directly on the module object
    if (typeof vssModule.getVssLoadablePath === 'function') {
      log.info('sqlite-vss dynamic import successful (found getVssLoadablePath on root).');
      // Treat the module itself as conforming to our interface
      return vssModule as SqliteVssModule;
    } 
    // Optional: Check default export if direct access failed (less likely based on logs)
    else if (vssModule.default && typeof vssModule.default.getVssLoadablePath === 'function') {
      log.info('sqlite-vss dynamic import successful (found getVssLoadablePath on default export).');
      return vssModule.default as SqliteVssModule;
    } 
    // If the function isn't found
    else {
      log.error('sqlite-vss module loaded, but required getVssLoadablePath function not found.');
      return null;
    }
  } catch (error) {
    log.warn('sqlite-vss dynamic import failed entirely:', error);
    return null;
  }
})();

let dbManager: DatabaseManager | null = null;

export async function initializeDatabase() {
  // Wait for the dynamic import promise to settleI
  const sqlite_vss = await vssModulePromise;

  try {
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'opal.db');
    
    // Initialize the database
    const dbManager = DatabaseManager.getInstance();
    const db = await dbManager.initialize(dbPath);
    
    if (!db) {
      throw new Error('Failed to initialize database');
    }
    
    // Initialize VSS extension ONLY if the import succeeded
    if (sqlite_vss) {
      try {
        log.info('Attempting to prepare and load VSS extensions (vector0, vss0)...');

        // --- Load vector0 first ---
        const vectorLoadablePathFn = sqlite_vss.getVectorLoadablePath;
        if (typeof vectorLoadablePathFn !== 'function') {
          throw new Error('sqlite-vss module does not export getVectorLoadablePath as a function');
        }
        const vectorLoadablePath = vectorLoadablePathFn();
        log.info(`Resolved vector0 loadable path: ${vectorLoadablePath}`);
        try {
           log.info(`Attempting db.loadExtension for vector0: ${vectorLoadablePath}`);
           db.loadExtension(vectorLoadablePath);
           log.info('vector0 extension loaded successfully.');
        } catch (vectorLoadError) {
           log.error('Error loading vector0 extension:', vectorLoadError);
           throw vectorLoadError; // Re-throw if vector0 fails
        }

        // --- Then load vss0 ---
        const vssLoadablePathFn = sqlite_vss.getVssLoadablePath;
        if (typeof vssLoadablePathFn !== 'function') {
          throw new Error('sqlite-vss module does not export getVssLoadablePath as a function');
        }
        const vssLoadablePath = vssLoadablePathFn();
        log.info(`Resolved vss0 loadable path: ${vssLoadablePath}`);
        try {
           log.info(`Attempting db.loadExtension for vss0: ${vssLoadablePath}`);
           db.loadExtension(vssLoadablePath);
           log.info('vss0 extension loaded successfully.');
        } catch (vssLoadError) {
           log.error('Error loading vss0 extension:', vssLoadError);
           throw vssLoadError; // Re-throw if vss0 fails
        }
        
        log.info('Both vector0 and vss0 extensions loaded successfully.');

      } catch (vssPrepError) {
        log.error('Error preparing or loading VSS extension:', vssPrepError);
        // If loading failed, we want to prevent the app from proceeding 
        // as if VSS is available, so re-throw or handle appropriately.
        // For now, just log and let schema execution fail later if vss0 is needed.
      }
    } else {
      log.warn('sqlite-vss module import failed or is null, skipping VSS setup.');
    }
    
    // Load and execute schema.sql to create tables and indices
    let schemaSQL: string;
    let schemaSource = 'unknown'; // Track source - removed explicit type
    
    try {
      const schemaPath = path.join(app.getAppPath(), 'src', 'main', 'database', 'schema.sql');
      log.info(`Attempting to load schema from development path: ${schemaPath}`);
      schemaSQL = await fs.readFile(schemaPath, 'utf-8');
      log.info(`Schema successfully loaded from development path.`);
      schemaSource = 'development';
    } catch (devErr) {
      log.warn(`Failed to load schema from development path: ${devErr.message}`);
      // Fallback for packaged app: read from resources directory
      try {
        const resourcesPath = app.isPackaged ? process.resourcesPath : app.getAppPath();
        const prodSchemaPath = path.join(resourcesPath, 'schema.sql');
        log.info(`Attempting to load schema from resource/alternate path: ${prodSchemaPath}`);
        schemaSQL = await fs.readFile(prodSchemaPath, 'utf-8');
        log.info(`Schema successfully loaded from resource/alternate path.`);
        schemaSource = 'resource/alternate';
      } catch (prodErr) {
        log.warn(`Failed to load schema from resource/alternate path: ${prodErr.message}`);
        // Last fallback: hardcoded schema
        log.warn('Using embedded schema as fallback.');
        schemaSQL = getEmbeddedSchema();
        schemaSource = 'embedded';
      }
    }
    
    log.info(`Executing schema from source: ${schemaSource}`);
    // Execute the schema SQL
    try {
      db.exec(schemaSQL);
      log.info('Database schema executed successfully');

      // Now that schema is applied, run migrations
      log.info('Attempting to run database migrations...');
      await dbManager.migrateDatabase(); // Call migration explicitly
      log.info('Database migrations completed successfully.');

    } catch (execError) {
      log.error(`Error executing database schema from source ${schemaSource}:`, execError);
      log.error(`Schema content that failed (first 500 chars):
${schemaSQL.substring(0, 500)}...`);
      throw execError; // Re-throw the error to ensure initialization fails clearly
    }
    
    // Perform migrations if needed
    const workspacePath = path.join(userDataPath, 'workspace');
    
    // Ensure the workspace directory exists
    if (!fsSync.existsSync(workspacePath)) {
      await fs.mkdir(workspacePath, { recursive: true });
    }
    
    // Migrate existing embeddings to VSS if available
    if (sqlite_vss) {
      await migrateEmbeddingsToVSS();
    }
    
    log.info('Database initialization and migration completed successfully');
    
    return db;
  } catch (error) {
    log.error('Database initialization failed:', error);
    throw error;
  }
}

// Function to return embedded schema as a fallback
function getEmbeddedSchema(): string {
  return `
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK( type IN ('folder', 'file', 'note') ),
      path TEXT NOT NULL UNIQUE,
      parent_path TEXT,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      size INTEGER,
      FOREIGN KEY (parent_path) REFERENCES items(path)
          ON UPDATE CASCADE
          ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS notes (
      item_id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_metadata (
      item_id TEXT PRIMARY KEY,
      summary TEXT,
      tags TEXT,
      embedding TEXT,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK( role IN ('user', 'assistant') ),
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      conversation_id TEXT NOT NULL,
      sequence INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_items_path ON items (path);
    CREATE INDEX IF NOT EXISTS idx_items_parent_path ON items (parent_path);
    CREATE INDEX IF NOT EXISTS idx_items_type ON items (type);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages (conversation_id, sequence);

    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(content, summary, content=notes, content_rowid=item_id);
  `;
}

// Function to migrate existing embeddings to the VSS index
async function migrateEmbeddingsToVSS() {
  // Get database instance
  const dbManager = DatabaseManager.getInstance();
  const db = dbManager.getDatabase();
  
  if (!db) {
    log.error('Database not initialized, cannot migrate embeddings to VSS');
    return;
  }
  
  try {
    log.info('Starting migration of embeddings to VSS vector index');
    
    // First check if the vector_index table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='vector_index'
    `).get();
    
    if (!tableExists) {
      log.warn('Vector index table does not exist, creating it now');
      
      // Create the vector index table
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vector_index USING vss0(
          embedding(1536) -- Define only the vector column and dimensions
          // item_id TEXT -- Remove extra columns from constructor
        );
      `);
    }
    
    // Get all notes with embeddings AND their rowid from the items table
    const notesWithEmbeddings = db.prepare(`
      SELECT i.rowid, i.id, a.embedding 
      FROM items i
      JOIN ai_metadata a ON i.id = a.item_id
      WHERE i.type = 'note' AND a.embedding IS NOT NULL
    `).all() as { rowid: number, id: string, embedding: string }[];
    
    log.info(`Found ${notesWithEmbeddings.length} notes with embeddings to migrate to VSS`);
    
    let migratedCount = 0;
    
    // Insert each embedding into the VSS index
    for (const note of notesWithEmbeddings) {
      try {
        // Parse the embedding JSON
        const embedding = JSON.parse(note.embedding);
        const vector = embedding.data[0].embedding;
        
        if (!vector || !Array.isArray(vector)) {
          log.warn(`Invalid embedding format for note ${note.id}, skipping VSS migration`);
          continue;
        }
        
        // Check if this note already exists in the VSS index using rowid
        const existingVectorItem = db.prepare(`
          SELECT rowid FROM vector_index WHERE rowid = ?
        `).get(note.rowid);
        
        if (existingVectorItem) {
          // Already exists, skip
          continue;
        }
        
        // Convert the vector to a buffer
        const vectorBuffer = Buffer.from(new Float32Array(vector).buffer);
        
        // Insert into the VSS index using rowid and embedding
        db.prepare(`
          INSERT INTO vector_index(rowid, embedding) VALUES (?, ?)
        `).run(note.rowid, vectorBuffer);
        
        migratedCount++;
      } catch (error) {
        log.warn(`Error migrating embedding for note ${note.id} to VSS:`, error);
      }
    }
    
    log.info(`Successfully migrated ${migratedCount} embeddings to VSS vector index`);
  } catch (error) {
    log.error('Error migrating embeddings to VSS:', error);
  }
}

export async function closeDatabase() {
  log.info('Closing database connection');
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
