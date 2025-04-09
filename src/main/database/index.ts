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
  load(db: BetterSqlite3.Database): void;
}

// Import the sqlite-vss module dynamically
let sqlite_vss: SqliteVssModule | null = null;
(async () => {
  try {
    // Explicitly log the require attempt
    log.info('Attempting to dynamically load sqlite-vss module...');
    // Use dynamic import() instead of require()
    const vssModule = await import('sqlite-vss');
    // Assuming the default export is what we need
    sqlite_vss = vssModule.default || vssModule; 
    log.info('sqlite-vss module loaded successfully');
  } catch (error) {
    log.warn('sqlite-vss extension not available (dynamic import failed):', error);
  }
})();

let dbManager: DatabaseManager | null = null;

export async function initializeDatabase() {
  try {
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'opal.db');
    
    log.info(`Initializing database at: ${dbPath}`);
    
    // Initialize the database
    const dbManager = DatabaseManager.getInstance();
    const db = await dbManager.initialize(dbPath);
    
    if (!db) {
      throw new Error('Failed to initialize database');
    }
    
    // Initialize VSS extension if available
    if (sqlite_vss) {
      try {
        log.info('Loading sqlite-vss extension for vector search');
        // Add explicit error handling and logging for VSS loading
        try {
          sqlite_vss.load(db);
          log.info('VSS extension loaded into database successfully');
        } catch (loadError) {
          log.error('Error during VSS extension loading:', loadError);
          throw loadError;
        }
        
        // Create the vector index table if it doesn't exist
        try {
          db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS vector_index USING vss0(
              embedding(1536), -- OpenAI's ada-002 embedding dimension
              item_id TEXT
            );
          `);
          
          // Verify the table was created
          const tableExists = db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='vector_index'
          `).get();
          
          if (tableExists) {
            log.info('Vector index table created/exists successfully');
          } else {
            log.error('Failed to create vector_index table even though no error was thrown');
          }
        } catch (tableError) {
          log.error('Error creating vector_index table:', tableError);
          throw tableError;
        }
        
        log.info('Vector search (VSS) extension loaded successfully');
      } catch (vssError) {
        log.error('Error loading sqlite-vss extension:', vssError);
      }
    } else {
      log.warn('sqlite-vss extension not available, vector search will use fallback method');
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
          embedding(1536), -- OpenAI's ada-002 embedding dimension
          item_id TEXT
        );
      `);
    }
    
    // Get all notes with embeddings
    const notesWithEmbeddings = db.prepare(`
      SELECT i.id, a.embedding 
      FROM items i
      JOIN ai_metadata a ON i.id = a.item_id
      WHERE i.type = 'note' AND a.embedding IS NOT NULL
    `).all() as { id: string, embedding: string }[];
    
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
        
        // Check if this note already exists in the VSS index
        const existingVectorItem = db.prepare(`
          SELECT item_id FROM vector_index WHERE item_id = ?
        `).get(note.id);
        
        if (existingVectorItem) {
          // Already exists, skip
          continue;
        }
        
        // Convert the vector to a buffer
        const vectorBuffer = Buffer.from(new Float32Array(vector).buffer);
        
        // Insert into the VSS index
        db.prepare(`
          INSERT INTO vector_index(embedding, item_id) VALUES (?, ?)
        `).run(vectorBuffer, note.id);
        
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
