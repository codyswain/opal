import { app } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import log from 'electron-log';
import BetterSqlite3 from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import DatabaseManager from './db';
import { DirectoryEntry, Note } from '@/renderer/shared/types';

// Path to the old notes directory
const NOTES_DIR = path.join(app.getPath('userData'), 'notes');

// Path to the config file
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');

/**
 * Migrates existing notes from file system to SQLite database
 */
export async function migrateNotesToDatabase(): Promise<void> {
  const dbManager = DatabaseManager.getInstance();
  const db = dbManager.getDatabase();
  
  if (!db) {
    log.error('Database not initialized, cannot migrate notes');
    return;
  }
  
  const userDataPath = app.getPath('userData');
  const workspacePath = path.join(userDataPath, 'workspace');
  log.info(`Starting note migration to database from ${workspacePath}...`);
  
  try {
    // Load top-level folders from config
    const topLevelFolders = await getTopLevelFolders();
    
    if (topLevelFolders.length === 0) {
      log.info('No top-level folders found in config, no migration needed');
      return;
    }
    
    log.info(`Found ${topLevelFolders.length} top-level folders to process`);
    
    // Check if migration has already been performed
    const checkMigrationStmt = db.prepare('SELECT COUNT(*) as count FROM items');
    const result = checkMigrationStmt.get() as { count: number };
    
    if (result.count > 0) {
      log.info('Database already contains items, checking if migration is needed');
      
      // Check if we need to migrate specific notes that might be missing
      const migrationNeeded = await checkIfMigrationNeeded(topLevelFolders);
      
      if (!migrationNeeded) {
        log.info('All notes already migrated, skipping migration');
        return;
      }
      
      log.info('Some notes need migration, proceeding with selective migration');
    }
    
    // Process each top-level folder
    for (const folderPath of topLevelFolders) {
      log.info(`Processing top-level folder: ${folderPath}`);
      
      try {
        // Check if folder exists
        await fs.access(folderPath);
        
        // Add the top-level folder to the database if it doesn't exist
        const checkFolderStmt = db.prepare('SELECT id FROM items WHERE path = ?');
        const existingFolder = checkFolderStmt.get(folderPath);
        
        if (!existingFolder) {
          const folderId = uuidv4();
          const folderName = path.basename(folderPath);
          
          const insertFolderStmt = db.prepare(`
            INSERT INTO items (id, type, path, parent_path, name)
            VALUES (?, 'folder', ?, NULL, ?)
          `);
          
          insertFolderStmt.run(folderId, folderPath, folderName);
          log.info(`Added top-level folder to database: ${folderPath}`);
        }
        
        // Load and process the directory structure
        const structure = await loadDirectoryStructure(folderPath);
        await processDirectoryEntry(structure, null, db);
        
        log.info(`Completed processing folder: ${folderPath}`);
      } catch (error) {
        log.error(`Error processing folder ${folderPath}:`, error);
        // Continue with other folders even if one fails
      }
    }
    
    log.info('Migration completed successfully');
  } catch (error) {
    log.error('Error during migration:', error);
    throw error;
  }
}

/**
 * Gets top-level folders from config.json
 */
async function getTopLevelFolders(): Promise<string[]> {
  try {
    const configContent = await fs.readFile(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(configContent);
    return config.topLevelFolders || [];
  } catch (error) {
    log.error('Error reading top-level folders from config:', error);
    return [];
  }
}

/**
 * Checks if migration is needed by comparing files on disk with database entries
 */
async function checkIfMigrationNeeded(topLevelFolders: string[]): Promise<boolean> {
  try {
    const dbManager = DatabaseManager.getInstance();
    const db = dbManager.getDatabase();
    
    // Get all note files from the file system
    const noteFiles: string[] = [];
    
    for (const folderPath of topLevelFolders) {
      try {
        const filesInFolder = await getAllNoteFiles(folderPath);
        noteFiles.push(...filesInFolder);
      } catch (error) {
        log.error(`Error scanning folder ${folderPath}:`, error);
      }
    }
    
    if (noteFiles.length === 0) {
      return false; // No note files to migrate
    }
    
    // Check if each note exists in the database
    for (const notePath of noteFiles) {
      try {
        const noteContent = await fs.readFile(notePath, 'utf-8');
        const note: Note = JSON.parse(noteContent);
        
        if (!note.id) {
          return true; // Note without ID needs migration
        }
        
        // Check if this note ID exists in the database
        const checkStmt = db.prepare('SELECT COUNT(*) as count FROM notes WHERE item_id = ?');
        const result = checkStmt.get(note.id) as { count: number };
        
        if (result.count === 0) {
          return true; // At least one note needs migration
        }
      } catch (error) {
        log.error(`Error checking note ${notePath}:`, error);
        return true; // If we can't check, assume migration is needed
      }
    }
    
    return false; // All notes already exist in the database
  } catch (error) {
    log.error('Error checking if migration is needed:', error);
    return true; // If we can't check, assume migration is needed
  }
}

/**
 * Gets all note files recursively from a directory
 */
async function getAllNoteFiles(dirPath: string): Promise<string[]> {
  const noteFiles: string[] = [];
  
  async function scanDirectory(currentPath: string) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      
      if (entry.isDirectory()) {
        await scanDirectory(entryPath);
      } else if (
        entry.isFile() && 
        entry.name.endsWith('.json') && 
        !entry.name.endsWith('.embedding.json')
      ) {
        noteFiles.push(entryPath);
      }
    }
  }
  
  await scanDirectory(dirPath);
  return noteFiles;
}

/**
 * Recursively loads directory structure
 */
async function loadDirectoryStructure(dirPath: string): Promise<DirectoryEntry> {
  log.debug(`Loading directory structure for path: ${dirPath}`);
  const dirName = path.basename(dirPath);
  const structure: DirectoryEntry = {
    name: dirName,
    type: 'directory',
    fullPath: dirPath,
    children: [],
  };

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    log.debug(`Found ${entries.length} entries in ${dirPath}`);

    for (const entry of entries) {
      const childPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        const childStructure = await loadDirectoryStructure(childPath);
        structure.children?.push(childStructure);
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.json') &&
        !entry.name.endsWith('.embedding.json')
      ) {
        try {
          const noteContent = await fs.readFile(childPath, 'utf-8');
          const note: Note = JSON.parse(noteContent);
          structure.children?.push({
            name: note.title,
            type: 'note',
            noteMetadata: {
              id: note.id,
              title: note.title,
            },
            fullPath: childPath,
          });
        } catch (error) {
          log.error(`Error reading note file ${childPath}:`, error);
        }
      }
    }

    return structure;
  } catch (error) {
    log.error(`Error loading directory structure for ${dirPath}:`, error);
    throw error;
  }
}

/**
 * Recursively processes directory entries and adds them to the database
 */
async function processDirectoryEntry(
  entry: DirectoryEntry,
  parentPath: string | null,
  db: BetterSqlite3.Database
): Promise<void> {
  try {
    // Check if this directory already exists in the database
    const checkDirStmt = db.prepare('SELECT id FROM items WHERE path = ?');
    const existingDir = checkDirStmt.get(entry.fullPath);
    
    let dirId: string;
    
    if (existingDir) {
      // Directory already exists, use its ID
      dirId = (existingDir as any).id;
      log.debug(`Directory already exists: ${entry.fullPath}, using ID: ${dirId}`);
    } else {
      // Insert the current directory with a new ID
      dirId = uuidv4();
      
      const insertItemStmt = db.prepare(`
        INSERT INTO items (id, type, path, parent_path, name)
        VALUES (?, 'folder', ?, ?, ?)
      `);
      
      insertItemStmt.run(dirId, entry.fullPath, parentPath, entry.name);
      log.debug(`Inserted directory: ${entry.fullPath} with ID: ${dirId}`);
    }
    
    // Process children
    if (entry.children && entry.children.length > 0) {
      for (const child of entry.children) {
        if (child.type === 'directory') {
          await processDirectoryEntry(child as DirectoryEntry, entry.fullPath, db);
        } else if (child.type === 'note' && child.noteMetadata) {
          await processNoteEntry(child, entry.fullPath, db);
        }
      }
    }
  } catch (error) {
    log.error(`Error processing directory entry ${entry.fullPath}:`, error);
    throw error;
  }
}

/**
 * Processes a note entry and adds it to the database
 */
async function processNoteEntry(
  entry: any,
  parentPath: string,
  db: BetterSqlite3.Database
): Promise<void> {
  try {
    // Read the note content
    const noteContent = await fs.readFile(entry.fullPath, 'utf-8');
    const note: Note = JSON.parse(noteContent);
    
    // Use the existing note ID or generate a new one
    const id = note.id || uuidv4();
    const notePath = path.join(parentPath, `${note.title}.note`);
    
    // Check if this note already exists in the database
    const checkNoteStmt = db.prepare('SELECT id FROM items WHERE id = ? OR path = ?');
    const existingNote = checkNoteStmt.get(id, notePath);
    
    if (existingNote) {
      log.debug(`Note already exists: ${notePath}, skipping`);
      return;
    }
    
    // Insert into database using a transaction
    db.transaction(() => {
      const insertItemStmt = db.prepare(`
        INSERT INTO items (id, type, path, parent_path, name)
        VALUES (?, 'note', ?, ?, ?)
      `);
      
      const insertNoteStmt = db.prepare(`
        INSERT INTO notes (item_id, content)
        VALUES (?, ?)
      `);
      
      insertItemStmt.run(id, notePath, parentPath, note.title);
      insertNoteStmt.run(id, note.content || '');
    })();
    
    log.debug(`Migrated note: ${entry.fullPath} to ${notePath}`);
  } catch (error) {
    log.error(`Error processing note entry ${entry.fullPath}:`, error);
    throw error;
  }
}

// Update the migrateEmbeddingsToDatabase function signature
export async function migrateEmbeddingsToDatabase(): Promise<void> {
  const dbManager = DatabaseManager.getInstance();
  const db = dbManager.getDatabase();
  
  if (!db) {
    log.error('Database not initialized, cannot migrate embeddings');
    return;
  }
  
  const userDataPath = app.getPath('userData');
  const workspacePath = path.join(userDataPath, 'workspace');
  log.info(`Starting embedding migration to database from ${workspacePath}...`);
  
  try {
    // Find all notes in the database
    const notesStmt = db.prepare(`
      SELECT i.id, i.path, i.name
      FROM items i
      WHERE i.type = 'note'
    `);
    
    const notes = notesStmt.all() as { id: string, path: string, name: string }[];
    log.info(`Found ${notes.length} notes to check for embeddings`);
    
    let migratedCount = 0;
    
    for (const note of notes) {
      // Check if there's an embedding file in the filesystem
      const dirPath = path.dirname(note.path);
      const embeddingPath = path.join(dirPath, `${note.id}.embedding.json`);
      
      try {
        // Check if the embedding file exists
        await fs.access(embeddingPath);
        
        // Read the embedding file
        const embeddingContent = await fs.readFile(embeddingPath, 'utf-8');
        const embedding = JSON.parse(embeddingContent);
        
        // Store in database
        const embeddingBuffer = Buffer.from(embeddingContent);
        
        // Check if an entry already exists
        const existingStmt = db.prepare(`
          SELECT item_id FROM ai_metadata WHERE item_id = ?
        `);
        
        const existing = existingStmt.get(note.id);
        
        if (existing) {
          // Update existing record
          const updateStmt = db.prepare(`
            UPDATE ai_metadata
            SET embedding = ?
            WHERE item_id = ?
          `);
          updateStmt.run(embeddingBuffer, note.id);
        } else {
          // Insert new record
          const insertStmt = db.prepare(`
            INSERT INTO ai_metadata (item_id, embedding)
            VALUES (?, ?)
          `);
          insertStmt.run(note.id, embeddingBuffer);
        }
        
        migratedCount++;
        
        // Optionally delete the embedding file after migration
        // await fs.unlink(embeddingPath);
        
      } catch (error) {
        // Embedding file might not exist, that's OK
        if (error.code !== 'ENOENT') {
          log.warn(`Error migrating embedding for note ${note.id}:`, error);
        }
      }
    }
    
    log.info(`Successfully migrated ${migratedCount} embeddings to database`);
  } catch (error) {
    log.error('Error migrating embeddings to database:', error);
  }
}

// Add this function to migrate the ai_metadata table
export async function migrateAIMetadataSchema(): Promise<void> {
  const dbManager = DatabaseManager.getInstance();
  const db = dbManager.getDatabase();
  
  if (!db) {
    log.error('Database not initialized, cannot migrate AI metadata schema');
    return;
  }
  
  log.info('Starting AI metadata schema migration...');
  
  try {
    // Check if we have any ai_metadata records
    const checkStmt = db.prepare('SELECT COUNT(*) as count FROM ai_metadata');
    const { count } = checkStmt.get() as { count: number };
    
    if (count > 0) {
      log.info(`Found ${count} AI metadata records that might need migration`);
    }
    
    // Begin transaction
    db.exec('BEGIN TRANSACTION');
    
    // Create a new table with the correct schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_metadata_new (
        item_id TEXT PRIMARY KEY,
        summary TEXT,
        tags TEXT,
        embedding TEXT,
        FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
      )
    `);
    
    // Copy data from the old table to the new one
    // For embedding column, convert from BLOB to TEXT if needed
    db.exec(`
      INSERT INTO ai_metadata_new (item_id, summary, tags, embedding)
      SELECT item_id, summary, tags,
             CASE 
               WHEN typeof(embedding) = 'blob' THEN json(embedding) 
               ELSE embedding 
             END as embedding
      FROM ai_metadata
    `);
    
    // Drop the old table
    db.exec('DROP TABLE IF EXISTS ai_metadata');
    
    // Rename the new table to the original name
    db.exec('ALTER TABLE ai_metadata_new RENAME TO ai_metadata');
    
    // Commit changes
    db.exec('COMMIT');
    
    log.info('AI metadata schema migration completed successfully');
    
  } catch (error) {
    // Rollback on error
    try {
      db.exec('ROLLBACK');
    } catch (rollbackError) {
      log.error('Error during rollback:', rollbackError);
    }
    
    log.error('Error migrating AI metadata schema:', error);
  }
} 