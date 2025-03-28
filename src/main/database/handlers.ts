// src/main/database/ipc-handlers.ts (New file for IPC handlers)
import { ipcMain } from 'electron';
import DatabaseManager from './db'; // Import DatabaseManager
import log from 'electron-log';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { Item, ItemWithAIMetadata, Note } from './types';
import { migrateNotesToDatabase } from './migration';
import { cleanupOldNotes } from './cleanup';
import { transformFileSystemData } from './transforms';
import { OpenAI } from 'openai';
import { getOpenAIKey } from '../file-system/loader';
import { generateEmbeddingsForNote } from '../embeddings/handlers';
import { app } from 'electron';
import * as chokidar from 'chokidar';
import * as fsExtra from 'fs-extra';

// Map to keep track of file watchers for mounted folders
const mountedFolderWatchers = new Map<string, chokidar.FSWatcher>();

// Add this helper function at the top of the file before registerDatabaseIPCHandlers
async function ensureEmbeddedItemsTableExists(db: any) {
  try {
    // Check if the table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='embedded_items'
    `).get();
    
    if (!tableExists) {
      log.info('Creating missing embedded_items table');
      db.exec(`
        CREATE TABLE IF NOT EXISTS embedded_items (
          id TEXT PRIMARY KEY,
          note_id TEXT NOT NULL,
          embedded_item_id TEXT NOT NULL,
          position_in_note TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (note_id) REFERENCES items(id) ON DELETE CASCADE,
          FOREIGN KEY (embedded_item_id) REFERENCES items(id) ON DELETE CASCADE
        )
      `);
      return true;
    }
    
    // Fix linter error by specifying the proper type
    interface ColumnInfo {
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: any;
      pk: number;
    }
    
    // Check if the table has the expected columns
    const columnInfo = db.prepare(`PRAGMA table_info(embedded_items)`).all() as ColumnInfo[];
    const columns = columnInfo.map(col => col.name);
    
    const requiredColumns = ['id', 'note_id', 'embedded_item_id', 'position_in_note', 'created_at', 'updated_at'];
    const missingColumns = requiredColumns.filter(col => !columns.includes(col));
    
    if (missingColumns.length > 0) {
      log.warn(`Embedded items table missing columns: ${missingColumns.join(', ')}`);
      
      // For SQLite, we need to recreate the table to add columns
      // First, rename the current table
      db.exec(`ALTER TABLE embedded_items RENAME TO embedded_items_old`);
      
      // Create new table with all required columns
      db.exec(`
        CREATE TABLE embedded_items (
          id TEXT PRIMARY KEY,
          note_id TEXT NOT NULL,
          embedded_item_id TEXT NOT NULL,
          position_in_note TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (note_id) REFERENCES items(id) ON DELETE CASCADE,
          FOREIGN KEY (embedded_item_id) REFERENCES items(id) ON DELETE CASCADE
        )
      `);
      
      // Copy existing data if possible
      try {
        const columnsToTransfer = columns.filter(col => requiredColumns.includes(col));
        if (columnsToTransfer.length > 0) {
          db.exec(`
            INSERT INTO embedded_items (${columnsToTransfer.join(', ')})
            SELECT ${columnsToTransfer.join(', ')} FROM embedded_items_old
          `);
        }
      } catch (copyError) {
        log.error('Error copying data from old embedded_items table:', copyError);
      }
      
      // Drop the old table
      db.exec(`DROP TABLE embedded_items_old`);
      
      return true;
    }
    
    return false;
  } catch (error) {
    log.error('Error checking or creating embedded_items table:', error);
    throw error;
  }
}

// Example: Get all data from a table (replace 'your_table' with your actual table name)
export async function registerDatabaseIPCHandlers() {
  const dbManager = DatabaseManager.getInstance();

  // Eventually move the logic into its own service
  ipcMain.handle('file-explorer:get-entries', async () => {
    const db = dbManager.getDatabase();
    if (!db) throw new Error("Database not initialized");

    try {
      const items = await db.prepare(`
        SELECT  i.id, i.type, i.path, i.parent_path, i.name, i.created_at, i.updated_at, i.size, 
                i.is_mounted, i.real_path, a.summary, a.tags
        FROM items i
        LEFT JOIN ai_metadata a ON i.id = a.item_id
      `).all() as (ItemWithAIMetadata & { is_mounted: number, real_path: string })[];

      const entries = transformFileSystemData(items);

      return { success: true, items: entries };
    } catch (error){
      log.error('Error fetching file explorer entries:', error);
      return { success: false, error: String(error) };
    }
  })

  ipcMain.handle('file-explorer:get-note', async (event, id: string) => {
    const db = dbManager.getDatabase();
    if (!db) throw new Error('Database not initialized');

    try {
      log.info(`Getting note content for ID: ${id}`);
      
      // First verify the item exists and is a note
      const stmt = db.prepare(`
        SELECT type
        FROM items
        WHERE id = ?
        LIMIT 1
      `);
      const item = stmt.get(id) as { type: string } | undefined;

      if (!item) {
        log.error(`Item not found for ID: ${id}`);
        return { success: false, error: 'Item not found' };
      }

      if (item.type !== 'note') {
        log.error(`Item is not a note: ${id}`);
        return { success: false, error: 'Item is not a note' };
      }
      
      const noteStmt = db.prepare(`
        SELECT content
        FROM notes
        WHERE item_id = ?
        LIMIT 1
      `);
      const note = noteStmt.get(id) as Note;

      if (!note) {
        log.error(`Note content not found for ID: ${id}`);
        return { success: false, error: 'Note content not found' };
      }

      return { success: true, note: {id, content: note.content} };
    } catch (error) {
      log.error('Error fetching note:', error);
      return { success: false, error: String(error) };
    }
  })

  ipcMain.handle('file-explorer:update-note-content', async (event, id: string, content: string) => {
    const db = dbManager.getDatabase();
    if (!db) throw new Error('Database not initialized');

    try {
      log.info(`Updating note content for ID: ${id}`);
      log.info(`Content to update: ${content}`);
      
      // Get the node to check if it's a note and get its path
      const stmt = db.prepare(`
        SELECT type, name
        FROM items
        WHERE id = ?
        LIMIT 1
      `);
      const node = stmt.get(id) as { type: string, name: string } | undefined;

      if (!node) {
        log.error('Node not found for ID:', id);
        return { success: false, error: 'Node not found' };
      }

      if (node.type !== 'note') {
        log.error('Cannot update content for non-note item:', id, node.type);
        return { success: false, error: 'Item is not a note' };
      }

      // Use a transaction to ensure both updates succeed or fail together
      const transaction = db.transaction(() => {
        // Update the note content
        const updateStmt = db.prepare(`
          UPDATE notes
          SET content = ?
          WHERE item_id = ?
        `);
        updateStmt.run(content, id);
        
        // Update the updated_at timestamp for the item
        const updateTimestampStmt = db.prepare(`
          UPDATE items
          SET updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `);
        updateTimestampStmt.run(id);
      });

      log.info(`Running update transaction for note ID: ${id}`);
      transaction();

      // Generate embeddings asynchronously after saving the note
      // This is non-blocking, so it won't affect the note saving process
      log.info(`Starting asynchronous embedding generation for note ${id}`);
      
      generateEmbeddingsForNote(id, content, node.name)
        .then(() => {
          log.info(`Asynchronous embedding generation completed for note ${id}`);
        })
        .catch(error => {
          log.error(`Non-blocking embedding generation failed for note ${id}:`, error);
          // We catch errors here so they don't affect the main promise chain
        });

      return { success: true };
    } catch (error) {
      log.error('Error updating note content:', error);
      return { success: false, error: String(error) };
    }
  });

  // Add the rename item handler for file-explorer namespace
  ipcMain.handle('file-explorer:rename-item', async (event, itemPath: string, newName: string) => {
    try {
      const db = dbManager.getDatabase();
      if (!db) {
        log.error('Database not initialized when file-explorer:rename-item was called');
        return { success: false, error: 'Database not initialized' };
      }

      // Get the item to check if it exists and get its parent path
      const getItemStmt = db.prepare(`
        SELECT id, parent_path, type, name
        FROM items
        WHERE path = ?
      `);
      const item = getItemStmt.get(itemPath) as Item | undefined;

      if (!item) {
        log.error(`Item not found for path: ${itemPath}`);
        return { success: false, error: 'Item not found' };
      }

      // Create the new path
      const newPath = path.join(item.parent_path, newName);
      
      // Check if an item with the new path already exists
      const checkExistingStmt = db.prepare(`
        SELECT COUNT(*) as count
        FROM items
        WHERE path = ?
      `);
      const existingCount = (checkExistingStmt.get(newPath) as { count: number }).count;
      
      if (existingCount > 0) {
        log.error(`An item already exists at path: ${newPath}`);
        return { success: false, error: 'An item with this name already exists in this location' };
      }

      // Use a transaction to update the item and its children (if it's a folder)
      const transaction = db.transaction(() => {
        // Update the item's name and path
        const updateStmt = db.prepare(`
          UPDATE items
          SET name = ?, path = ?, updated_at = CURRENT_TIMESTAMP
          WHERE path = ?
        `);
        updateStmt.run(newName, newPath, itemPath);

        // If it's a folder, update all child paths
        if (item.type === 'folder') {
          const updateChildrenStmt = db.prepare(`
            UPDATE items
            SET path = replace(path, ?, ?), updated_at = CURRENT_TIMESTAMP
            WHERE path LIKE ? || '%' AND path != ?
          `);
          updateChildrenStmt.run(itemPath, newPath, itemPath, itemPath);
        }
      });

      log.info(`Renaming item from ${itemPath} to ${newPath}`);
      transaction();

      // Also rename on disk if it's a folder or a file
      if (item.type === 'folder' || item.type === 'file') {
        try {
          await fs.rename(itemPath, newPath);
        } catch (fsError) {
          log.error(`Error renaming item on disk: ${fsError}`);
          // We don't return an error here because the database update was successful
          // The file system and database might be out of sync now, but that's better than failing the operation
        }
      }

      return { success: true, newPath };
    } catch (error) {
      log.error('Error renaming item:', error);
      return { success: false, error: String(error) };
    }
  });

  // First order of business
  // When a user selects a top level folder, we need to recursively load all of the items
  // in the folder and add them to the database. 
  ipcMain.handle(
    "add-root-folder",
    async (
      event,
      folderPath: string
    ): Promise<{ success: boolean; error?: string }> => {
      const db = dbManager.getDatabase();
      if (!db) throw new Error("Database not initialized");

      // Recursively clone directory in virtual database
      async function processDirectory(
        dirPath: string,
        parentPath: string | null = null
      ) {
        const items = await fs.readdir(dirPath, { withFileTypes: true });
        for (const item of items) {
          const itemPath = path.join(dirPath, item.name);
          const id = uuidv4();
          if (item.isDirectory()) {
            const sql = `
            INSERT INTO items (id, type, path, parent_path, name)
            VALUES (?, 'folder', ?, ?, ?)
          `;
            const stmt = db.prepare(sql);
            const parentPath = path.join(dirPath, item.name);
            stmt.run(id, itemPath, parentPath, item.name);
            await processDirectory(itemPath, parentPath);
          } else if (item.isFile()) {
            console.log("item is file");
            const stats = await fs.stat(itemPath);
            const stmt = db.prepare(`
            INSERT INTO items (id, type, path, parent_path, name, size)
            VALUES (?, 'file', ?, ?, ?, ?)
          `);
            stmt.run(
              id,
              itemPath,
              parentPath || dirPath,
              item.name,
              stats.size
            );
          }
        }
      }

      try {
        // Create virtual copy of the directory
        const sql = `
          INSERT INTO items (id, type, path, parent_path, name)
          VALUES (?, 'folder', ?, NULL, ?)
        `;
        const stmt = db.prepare(sql);
        stmt.run(uuidv4(), folderPath, path.basename(folderPath));

        log.info("Starting recursive process for folder: ", folderPath);

        // Start the recursive process
        await processDirectory(folderPath);

        return { success: true };
      } catch (error) {
        log.error("Error adding top-level folder:", error);
        return { success: false, error: String(error) };
      }
    }
  );




  // --- Item Creation ---

  ipcMain.handle('create-folder', async (event, parentPath: string, folderName: string) => {
    try {
      const db = dbManager.getDatabase();
      if (!db) {
        log.error('Database not initialized when create-folder was called');
        return { success: false, error: 'Database not initialized' };
      }

      const id = uuidv4();
      const newPath = path.join(parentPath, folderName);

      const stmt = db.prepare(`
        INSERT INTO items (id, type, path, parent_path, name)
        VALUES (?, 'folder', ?, ?, ?)
      `);
      stmt.run(id, newPath, parentPath, folderName);

      // Also create the folder on disk.  Use newPath directly.
      await fs.mkdir(newPath, { recursive: true });

      return { success: true, id, path: newPath };
    } catch (error) {
      log.error('Error creating folder:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('create-note', async (event, parentPath: string, noteName: string, initialContent: string) => {
    try {
      const db = dbManager.getDatabase();
      if (!db) {
        log.error('Database not initialized when create-note was called');
        return { success: false, error: 'Database not initialized' };
      }

      const id = uuidv4();
      log.info(`Generated UUID for new note: ${id}`);
      const newPath = path.join(parentPath, noteName);

      const transaction = db.transaction(() => {
        const itemStmt = db.prepare(`
          INSERT INTO items (id, type, path, parent_path, name)
          VALUES (?, 'note', ?, ?, ?)
        `);
        itemStmt.run(id, newPath, parentPath, noteName);

        const noteStmt = db.prepare(`
          INSERT INTO notes (item_id, content)
          VALUES (?, ?)
        `);
        noteStmt.run(id, initialContent);
      });
      transaction();

      return { success: true, id, path: newPath };
    } catch (error) {
      log.error('Error creating note:', error);
      return { success: false, error: String(error) };
    }
  });

    // --- Item Management ---

    ipcMain.handle(
      "list-items",
      async (
        event,
        directoryPath: string
      ): Promise<{ success: boolean; items?: Item[]; error?: string }> => {
        try {
          const db = dbManager.getDatabase();
          if (!db) {
            log.error("Database not initialized when list-items was called");
            return { success: false, error: "Database not initialized" };
          }

          const stmt = db.prepare(`
              SELECT id, type, path, parent_path, name, created_at, updated_at, size
              FROM items
              WHERE parent_path = ?
            `);
          const rows: Item[] = stmt.all(directoryPath) as Item[];
          return { success: true, items: rows };
        } catch (error) {
          log.error("Error listing items:", error);
          return { success: false, error: String(error) };
        }
      }
    );

    ipcMain.handle('get-item-by-path', async (event, itemPath: string): Promise<{ success: boolean; item?: Item; error?: string }> => {
        try {
            const db = dbManager.getDatabase();
            if (!db) {
                log.error('Database not initialized when get-item-by-path was called');
                return { success: false, error: 'Database not initialized' };
            }

            const stmt = db.prepare(`
        SELECT id, type, path, parent_path, name, created_at, updated_at, size
        FROM items
        WHERE path = ?
      `);
            const item: Item | undefined = stmt.get(itemPath) as Item | undefined;

            if (!item) {
                return { success: false, error: 'Item not found' };
            }
            return { success: true, item };

        } catch (error) {
            log.error('Error getting item by path:', error);
            return { success: false, error: String(error) };
        }
    });

  ipcMain.handle('delete-item', async (event, itemPath: string) => {
    try {
      const db = dbManager.getDatabase();
      if (!db) {
        log.error('Database not initialized when delete-item was called');
        return { success: false, error: 'Database not initialized' };
      }

      const getItemTypeStmt = db.prepare('SELECT type FROM items WHERE path = ?');
      const itemTypeResult = getItemTypeStmt.get(itemPath) as Item | undefined;

      if (!itemTypeResult) {
        return { success: false, error: 'Item not found' };
      }

      const itemType = itemTypeResult.type as 'folder' | 'file' | 'note';

      const transaction = db.transaction(() => {
        const deleteStmt = db.prepare('DELETE FROM items WHERE path = ?');
        deleteStmt.run(itemPath);
      });
      transaction();

      // If it's a folder, also delete it from the disk (and its contents). Use itemPath directly.
      if (itemType === 'folder') {
        await fs.rm(itemPath, { recursive: true, force: true });
      }

      return { success: true };
    } catch (error) {
      log.error('Error deleting item:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('rename-item', async (event, itemPath: string, newName: string) => {
    try {
      const db = dbManager.getDatabase();
      if (!db) {
        log.error('Database not initialized when rename-item was called');
        return { success: false, error: 'Database not initialized' };
      }

      const getItemStmt = db.prepare('SELECT parent_path, type FROM items WHERE path = ?');
      const item = getItemStmt.get(itemPath) as Item | undefined;

      if (!item) {
        return { success: false, error: 'Item not found' };
      }

      const newPath = path.join(item.parent_path, newName);

      const transaction = db.transaction(() => {
        const updateStmt = db.prepare('UPDATE items SET name = ?, path = ? WHERE path = ?');
        updateStmt.run(newName, newPath, itemPath);

        // Update child paths for folders
        if (item.type === 'folder') {
          const updateChildrenStmt = db.prepare(`
            UPDATE items
            SET path = replace(path, ?, ?)
            WHERE path LIKE ? || '%'
          `);
          updateChildrenStmt.run(itemPath, newPath, itemPath);
        }
      });
      transaction();

      // Also rename on disk if it's a folder or a file. Use paths directly.
      if (item.type === 'folder' || item.type === 'file') {
          await fs.rename(itemPath, newPath);
      }

      return { success: true, newPath };
    } catch (error) {
      log.error('Error renaming item:', error);
      return { success: false, error: String(error) };
    }
  });

    ipcMain.handle('move-item', async (event, oldPath: string, newParentPath: string) => {
        try {
            const db = dbManager.getDatabase();
            if (!db) {
                log.error('Database not initialized when move-item was called');
                return { success: false, error: 'Database not initialized' };
            }

            const getItemStmt = db.prepare('SELECT name, type FROM items WHERE path = ?');
            const item = getItemStmt.get(oldPath) as Item | undefined ;

            if (!item) {
                return { success: false, error: 'Item not found' };
            }

            const newPath = path.join(newParentPath, item.name);

            const transaction = db.transaction(() => {
                const updateStmt = db.prepare('UPDATE items SET path = ?, parent_path = ? WHERE path = ?');
                updateStmt.run(newPath, newParentPath, oldPath);

                // Update child paths for folders
                if (item.type === 'folder') {
                    const updateChildrenStmt = db.prepare(`
            UPDATE items
            SET path = replace(path, ?, ?)
            WHERE path LIKE ? || '%'
          `);
                    updateChildrenStmt.run(oldPath, newPath, oldPath);
                }
            });
            transaction();

            // Also move on disk if it's a folder or file. Use paths directly.
            if (item.type === 'folder' || item.type === 'file') {
                await fs.rename(oldPath, newPath); // Use rename for moving
            }

            return { success: true, newPath };
        } catch (error) {
            log.error('Error moving item:', error);
            return { success: false, error: String(error) };
        }
    });


  // --- Note Content ---

  ipcMain.handle('get-note-content', async (event, notePath: string): Promise<{ success: boolean; content?: string; error?: string }> => {
    try {
      const db = dbManager.getDatabase();
      if (!db) {
        log.error('Database not initialized when get-note-content was called');
        return { success: false, error: 'Database not initialized' };
      }

      const stmt = db.prepare(`
        SELECT content
        FROM notes
        INNER JOIN items ON notes.item_id = items.id
        WHERE items.path = ?
      `);
      const result = stmt.get(notePath) as Note | undefined;

      if (!result) {
        return { success: false, error: 'Note not found' };
      }
      return { success: true, content: result.content };
    } catch (error) {
      log.error('Error getting note content:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('update-note-content', async (event, notePath: string, newContent: string) => {
    try {
      const db = dbManager.getDatabase();
      if (!db) {
        log.error('Database not initialized when update-note-content was called');
        return { success: false, error: 'Database not initialized' };
      }

      // First check if the item exists and is a note
      const checkItemStmt = db.prepare(`
        SELECT id, type FROM items WHERE path = ?
      `);
      const item = checkItemStmt.get(notePath) as { id: string; type: string } | undefined;
      
      if (!item) {
        log.error(`Item not found for path: ${notePath}`);
        return { success: false, error: 'Item not found' };
      }
      
      if (item.type !== 'note') {
        log.error(`Cannot update content for non-note item: ${notePath}, type: ${item.type}`);
        return { success: false, error: 'Item is not a note' };
      }

      // Now update the note content
      const updateStmt = db.prepare(`
        UPDATE notes
        SET content = ?
        WHERE item_id = ?
      `);
      updateStmt.run(newContent, item.id);
      
      // Update the updated_at timestamp for the item
      const updateTimestampStmt = db.prepare(`
        UPDATE items
        SET updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      updateTimestampStmt.run(item.id);
      
      return { success: true };
    } catch (error) {
      log.error('Error updating note content:', error);
      return { success: false, error: String(error) };
    }
  });

    // --- File Handling ---
    ipcMain.handle('import-file', async (event, sourceFilePath: string, destinationPath: string) => {
        try {
            const db = dbManager.getDatabase();
            if (!db) {
                log.error('Database not initialized when import-file was called');
                return { success: false, error: 'Database not initialized' };
            }

            const fileName = path.basename(sourceFilePath);
            const id = uuidv4();
            const newPath = path.join(destinationPath, fileName);
            const fileSize = (await fs.stat(sourceFilePath)).size;

            const transaction = db.transaction(() => {
                const stmt = db.prepare(`
                    INSERT INTO items (id, type, path, parent_path, name, size)
                    VALUES (?, 'file', ?, ?, ?, ?)
                `);
                stmt.run(id, newPath, destinationPath, fileName, fileSize);
            });
            transaction();

            // Copy the file to the destination.  Use newPath directly.
            await fs.copyFile(sourceFilePath, newPath);

            return { success: true, id, path: newPath };
        } catch (error) {
            log.error('Error importing file:', error);
            return { success: false, error: String(error) };
        }
    });

  ipcMain.handle('trigger-migration', async () => {
    try {
      log.info('Manual migration triggered');
      await migrateNotesToDatabase();
      return { success: true, message: 'Migration completed successfully' };
    } catch (error) {
      log.error('Error during manual migration:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('cleanup-old-notes', async () => {
    try {
      log.info('Manual cleanup triggered');
      await cleanupOldNotes();
      return { success: true, message: 'Old notes cleaned up successfully' };
    } catch (error) {
      log.error('Error during cleanup:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('reset-database', async () => {
    try {
      log.info('Attempting to reset database...');
      
      // Get database path
      const userDataPath = app.getPath('userData');
      const dbPath = path.join(userDataPath, 'tread.db');
      
      // Close the database connection
      const dbManager = DatabaseManager.getInstance();
      if (dbManager.getDatabase()) {
        dbManager.close();
        log.info('Closed database connection');
      }
      
      // Create a backup of the database
      const backupPath = `${dbPath}.backup-${Date.now()}`;
      if (fsSync.existsSync(dbPath)) {
        await fs.copyFile(dbPath, backupPath);
        log.info(`Created database backup at ${backupPath}`);
        
        // Delete the database file
        await fs.unlink(dbPath);
        log.info('Deleted database file');
      }
      
      // Reinitialize the database
      const db = await dbManager.initialize(dbPath);
      
      if (!db) {
        throw new Error('Failed to reinitialize database');
      }
      
      // Load the schema
      const schemaPath = path.join(app.getAppPath(), 'src', 'main', 'database', 'schema.sql');
      let schemaSQL;
      
      try {
        schemaSQL = await fs.readFile(schemaPath, 'utf-8');
      } catch (err) {
        // Try packaged app path
        const resourcesPath = app.isPackaged ? process.resourcesPath : app.getAppPath();
        const prodSchemaPath = path.join(resourcesPath, 'schema.sql');
        schemaSQL = await fs.readFile(prodSchemaPath, 'utf-8');
      }
      
      // Execute the schema SQL
      db.exec(schemaSQL);
      log.info('Database schema reinitialized');
      
      // Re-register the VSS extension
      try {
        // Import dynamically to avoid require linter error
        const sqlite_vss = await import('sqlite-vss');
        sqlite_vss.default.load(db);
        
        // Create the vector index table
        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS vector_index USING vss0(
            embedding(1536), -- OpenAI's ada-002 embedding dimension
            item_id TEXT
          );
        `);
        
        log.info('Vector search (VSS) extension reloaded');
      } catch (vssError) {
        log.warn('Could not load sqlite-vss extension:', vssError);
      }
      
      log.info('Database reset complete');
      return { success: true, message: 'Database reset successfully' };
    } catch (error) {
      log.error('Error resetting database:', error);
      return { 
        success: false, 
        message: `Failed to reset database: ${error.message}`
      };
    }
  });

  // --- Chat Functionality ---
  ipcMain.handle('chat:get-conversation', async (event, conversationId: string) => {
    try {
      const db = dbManager.getDatabase();
      if (!db) {
        log.error('Database not initialized when chat:get-conversation was called');
        return { success: false, error: 'Database not initialized' };
      }

      const stmt = db.prepare(`
        SELECT id, role, content, created_at
        FROM chat_messages
        WHERE conversation_id = ?
        ORDER BY sequence ASC
      `);
      const messages = stmt.all(conversationId);

      return { success: true, messages };
    } catch (error) {
      log.error('Error getting chat conversation:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('chat:get-all-conversations', async (event) => {
    try {
      const db = dbManager.getDatabase();
      if (!db) {
        log.error('Database not initialized when chat:get-all-conversations was called');
        return { success: false, error: 'Database not initialized' };
      }

      // Get all unique conversation IDs with their latest message and timestamp
      const stmt = db.prepare(`
        SELECT 
          c1.conversation_id as id,
          MIN(c1.created_at) as created_at,
          MAX(c1.created_at) as last_message_at,
          (
            SELECT content FROM chat_messages c2 
            WHERE c2.conversation_id = c1.conversation_id 
            AND c2.role = 'user'
            ORDER BY c2.sequence ASC 
            LIMIT 1
          ) as title,
          (
            SELECT COUNT(*) FROM chat_messages c3
            WHERE c3.conversation_id = c1.conversation_id
          ) as message_count
        FROM chat_messages c1
        GROUP BY c1.conversation_id
        ORDER BY MAX(c1.created_at) DESC
      `);
      
      // Type the database result
      interface RawConversation {
        id: string;
        created_at: string;
        last_message_at: string;
        title: string | null;
        message_count: number;
      }
      
      const rawConversations = stmt.all() as RawConversation[];
      
      const conversations = rawConversations.map(conv => {
        return {
          id: conv.id,
          created_at: new Date(conv.created_at).toISOString(),
          last_message_at: new Date(conv.last_message_at).toISOString(),
          title: conv.title ? (conv.title.length > 30 ? conv.title.substring(0, 30) + '...' : conv.title) : null,
          message_count: conv.message_count
        };
      });
      
      return { success: true, conversations };
    } catch (error) {
      log.error('Error getting all chat conversations:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('chat:add-message', async (event, conversationId: string, role: string, content: string) => {
    try {
      const db = dbManager.getDatabase();
      if (!db) {
        log.error('Database not initialized when chat:add-message was called');
        return { success: false, error: 'Database not initialized' };
      }

      // Get the next sequence number for this conversation
      const seqStmt = db.prepare(`
        SELECT COALESCE(MAX(sequence), -1) + 1 as next_seq
        FROM chat_messages
        WHERE conversation_id = ?
      `);
      const { next_seq } = seqStmt.get(conversationId) as { next_seq: number };

      // Insert the new message
      const insertStmt = db.prepare(`
        INSERT INTO chat_messages (id, conversation_id, role, content, sequence)
        VALUES (?, ?, ?, ?, ?)
      `);
      const messageId = uuidv4();
      insertStmt.run(messageId, conversationId, role, content, next_seq);

      return { success: true, messageId };
    } catch (error) {
      log.error('Error adding chat message:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('chat:perform-rag', async (event, conversationId: string, query: string) => {
    try {
      const db = dbManager.getDatabase();
      if (!db) {
        log.error('Database not initialized when chat:perform-rag was called');
        return { success: false, error: 'Database not initialized' };
      }

      // Get conversation history - but limit it to last 10 messages to save tokens
      const historyStmt = db.prepare(`
        SELECT role, content
        FROM chat_messages
        WHERE conversation_id = ?
        ORDER BY sequence DESC
        LIMIT 10
      `);
      const recentHistory = historyStmt.all(conversationId) as { role: string; content: string }[];
      // Reverse to get chronological order
      const history = recentHistory.reverse();

      // Use FTS to find most relevant notes based on the query
      const notesStmt = db.prepare(`
        SELECT n.content, i.name, i.id, i.path
        FROM notes n
        JOIN items i ON n.item_id = i.id
        WHERE i.type = 'note'
        ORDER BY (
          CASE WHEN n.content LIKE ? THEN 3
          WHEN i.name LIKE ? THEN 2
          ELSE 1 END
        ) DESC
        LIMIT 5
      `);
      
      const searchTerm = `%${query}%`;
      const notes = notesStmt.all(searchTerm, searchTerm) as { content: string; name: string; id: string; path: string }[];

      // Prepare context from relevant notes but limit each note content
      let contextText = '';
      for (const note of notes) {
        // Extract just the first 300 chars of content for context to save tokens
        const truncatedContent = note.content.slice(0, 300) + (note.content.length > 300 ? '...' : '');
        contextText += `Note ID: ${note.id}\nTitle: ${note.name}\nPath: ${note.path}\nSnippet:\n${truncatedContent}\n\n`;
      }
      
      // Limit overall context length
      if (contextText.length > 2000) {
        contextText = contextText.slice(0, 2000) + '...';
      }

      // Build messages for OpenAI API with token-saving strategy
      const messages = [
        { 
          role: 'system', 
          content: 'You are a helpful assistant. Use only the provided note snippets to answer questions. When you refer to a note, include a clickable link in the format [Note Title](note://noteId). Keep responses concise.' 
        },
        { 
          role: 'user', 
          content: `Here are some relevant note snippets that might help answer my question:\n\n${contextText}\n\nMy question is: ${query}` 
        }
      ];
      
      // Only include most recent conversation history if we have room
      if (history.length > 0) {
        // Add just the last few messages from history to save tokens
        messages.push(...history.slice(-4));
      }

      // Get OpenAI API key
      const openaiApiKey = await getOpenAIKey();
      const openai = new OpenAI({ apiKey: openaiApiKey });

      // Get response from OpenAI with explicit token limit
      const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: messages as any,
        max_tokens: 1000, // Limit response length
      });

      const assistantMessage = completion.choices[0].message;

      // Save the assistant's response
      const seqStmt = db.prepare(`
        SELECT COALESCE(MAX(sequence), -1) + 1 as next_seq
        FROM chat_messages
        WHERE conversation_id = ?
      `);
      const { next_seq } = seqStmt.get(conversationId) as { next_seq: number };

      const insertStmt = db.prepare(`
        INSERT INTO chat_messages (id, conversation_id, role, content, sequence)
        VALUES (?, ?, ?, ?, ?)
      `);
      const messageId = uuidv4();
      insertStmt.run(messageId, conversationId, 'assistant', assistantMessage.content, next_seq);

      return { success: true, message: assistantMessage };
    } catch (error) {
      log.error('Error performing RAG chat:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('chat:perform-rag-streaming', async (event, conversationId: string, query: string, responseChannel: string) => {
    try {
      log.info(`Starting streaming RAG chat on channel ${responseChannel}`);
      
      const db = dbManager.getDatabase();
      if (!db) {
        log.error('Database not initialized when chat:perform-rag-streaming was called');
        event.sender.send(responseChannel, "Error: Database not initialized");
        event.sender.send(responseChannel, null); // Signal completion with error
        return { success: false, error: 'Database not initialized' };
      }

      // Get OpenAI API key and validate it
      const openaiApiKey = await getOpenAIKey();
      if (!openaiApiKey) {
        log.error('OpenAI API key is missing or empty');
        event.sender.send(responseChannel, "Error: OpenAI API key is missing. Please add your API key in settings.");
        event.sender.send(responseChannel, null); // Signal completion
        return { success: false, error: 'OpenAI API key is missing' };
      }
      
      // Create the OpenAI client with the API key
      try {
        const openai = new OpenAI({ apiKey: openaiApiKey });
        
        // Test that the API key is valid by making a small request
        try {
          // Create a quick test to validate the API key
          await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: 'test' }],
            max_tokens: 5
          });
        } catch (apiKeyError) {
          log.error('Invalid OpenAI API key:', apiKeyError);
          event.sender.send(responseChannel, "Error: Invalid OpenAI API key. Please check your API key in settings.");
          event.sender.send(responseChannel, null); // Signal completion
          return { success: false, error: 'Invalid OpenAI API key' };
        }
        
        // Get conversation history - but limit it to last 10 messages to save tokens
        const historyStmt = db.prepare(`
          SELECT role, content
          FROM chat_messages
          WHERE conversation_id = ?
          ORDER BY sequence DESC
          LIMIT 10
        `);
        const recentHistory = historyStmt.all(conversationId) as { role: string; content: string }[];
        // Reverse to get chronological order
        const history = recentHistory.reverse();

        // Use FTS to find most relevant notes based on the query
        const notesStmt = db.prepare(`
          SELECT n.content, i.name, i.id, i.path
          FROM notes n
          JOIN items i ON n.item_id = i.id
          WHERE i.type = 'note'
          ORDER BY (
            CASE WHEN n.content LIKE ? THEN 3
            WHEN i.name LIKE ? THEN 2
            ELSE 1 END
          ) DESC
          LIMIT 5
        `);
        
        const searchTerm = `%${query}%`;
        const notes = notesStmt.all(searchTerm, searchTerm) as { content: string; name: string; id: string; path: string }[];

        // Prepare context from relevant notes but limit each note content
        let contextText = '';
        for (const note of notes) {
          // Extract just the first 300 chars of content for context to save tokens
          const truncatedContent = note.content.slice(0, 300) + (note.content.length > 300 ? '...' : '');
          contextText += `Note ID: ${note.id}\nTitle: ${note.name}\nPath: ${note.path}\nSnippet:\n${truncatedContent}\n\n`;
        }
        
        // Limit overall context length
        if (contextText.length > 2000) {
          contextText = contextText.slice(0, 2000) + '...';
        }

        // Build messages for OpenAI API with token-saving strategy
        const messages = [
          { 
            role: 'system', 
            content: 'You are a helpful assistant. Use only the provided note snippets to answer questions. When you refer to a note, include a clickable link in the format [Note Title](note://noteId). Keep responses concise.' 
          },
          { 
            role: 'user', 
            content: `Here are some relevant note snippets that might help answer my question:\n\n${contextText}\n\nMy question is: ${query}` 
          }
        ];
        
        // Only include most recent conversation history if we have room
        if (history.length > 0) {
          // Add just the last few messages from history to save tokens
          messages.push(...history.slice(-4));
        }

        // Setup for tracking full response
        let fullResponse = '';
        
        // Create a streaming completion
        const stream = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: messages as any,
          max_tokens: 1000, // Limit response length
          stream: true, // Enable streaming
        });

        // Process each chunk as it arrives
        for await (const chunk of stream) {
          try {
            // Check if this is a completion signal (empty delta with finish_reason: "stop")
            if (chunk.choices?.[0]?.finish_reason === "stop") {
              break; // Exit the loop as we're done receiving content
            }
            
            // In newer OpenAI API versions, the content might be in different places
            const content = chunk.choices?.[0]?.delta?.content || '';
            
            if (content) {
              // Send the chunk to the renderer process
              event.sender.send(responseChannel, content);
              // Append to full response
              fullResponse += content;
            }
          } catch (error) {
            log.error(`Error processing chunk: ${error}`);
            event.sender.send(responseChannel, `Error: Failed to process chunk - ${error}`);
          }
        }
        
        log.info(`Streaming complete, saving response of length ${fullResponse.length}`);

        // Save the assistant's response
        const seqStmt = db.prepare(`
          SELECT COALESCE(MAX(sequence), -1) + 1 as next_seq
          FROM chat_messages
          WHERE conversation_id = ?
        `);
        const { next_seq } = seqStmt.get(conversationId) as { next_seq: number };

        const insertStmt = db.prepare(`
          INSERT INTO chat_messages (id, conversation_id, role, content, sequence)
          VALUES (?, ?, ?, ?, ?)
        `);
        const messageId = uuidv4();
        insertStmt.run(messageId, conversationId, 'assistant', fullResponse, next_seq);

        // Signal completion
        event.sender.send(responseChannel, null);
        
        return { success: true };
      } catch (openaiError) {
        log.error('Error creating OpenAI client:', openaiError);
        event.sender.send(responseChannel, `Error: Failed to initialize OpenAI client - ${openaiError.message}`);
        event.sender.send(responseChannel, null);
        return { success: false, error: `OpenAI client initialization failed: ${openaiError.message}` };
      }
    } catch (error) {
      log.error('Error performing streaming RAG chat:', error);
      // Send error message to client
      event.sender.send(responseChannel, `Error: ${String(error)}`);
      // Signal completion
      event.sender.send(responseChannel, null);
      return { success: false, error: String(error) };
    }
  });

  // Add the mount folder handler
  ipcMain.handle('file-explorer:mount-folder', async (event, targetPath: string, realFolderPath: string) => {
    try {
      const db = dbManager.getDatabase();
      if (!db) {
        log.error('Database not initialized when mount-folder was called');
        return { success: false, error: 'Database not initialized' };
      }

      log.info(`Mounting folder "${realFolderPath}" at "${targetPath}"`);
      console.log(`Mounting folder "${realFolderPath}" at "${targetPath}"`);

      // First verify the target path exists and is a folder
      const targetStmt = db.prepare(`
        SELECT id, type
        FROM items
        WHERE path = ?
        LIMIT 1
      `);
      const targetItem = targetStmt.get(targetPath) as { id: string, type: string } | undefined;

      if (!targetItem) {
        log.error(`Target path not found: ${targetPath}`);
        console.error(`Target path not found: ${targetPath}`);
        return { success: false, error: 'Target path not found' };
      }

      if (targetItem.type !== 'folder') {
        log.error(`Target path is not a folder: ${targetPath}`);
        console.error(`Target path is not a folder: ${targetPath}`);
        return { success: false, error: 'Target path must be a folder' };
      }

      // Make sure the real folder exists
      if (!fsSync.existsSync(realFolderPath)) {
        log.error(`Real folder path does not exist: ${realFolderPath}`);
        console.error(`Real folder path does not exist: ${realFolderPath}`);
        return { success: false, error: 'The selected folder does not exist' };
      }

      console.log('Target and source folders verified, proceeding with mount');

      // Check if folder is already mounted
      const mountedStmt = db.prepare(`
        SELECT COUNT(*) as count
        FROM items
        WHERE parent_path = ? AND real_path = ? AND is_mounted = 1
      `);
      const { count } = mountedStmt.get(targetPath, realFolderPath) as { count: number };
      
      if (count > 0) {
        log.error(`Folder is already mounted: ${realFolderPath}`);
        console.error(`Folder is already mounted: ${realFolderPath}`);
        return { success: false, error: 'This folder is already mounted' };
      }

      // Generate an ID for the mounted folder
      const mountedFolderId = uuidv4();
      const mountedFolderName = path.basename(realFolderPath);
      const mountedFolderPath = path.join(targetPath, mountedFolderName);

      console.log(`Mounting ${realFolderPath} as ${mountedFolderPath} with ID ${mountedFolderId}`);

      // Add the mounted folder to the database
      const insertStmt = db.prepare(`
        INSERT INTO items (id, type, path, parent_path, name, is_mounted, real_path)
        VALUES (?, 'folder', ?, ?, ?, 1, ?)
      `);
      insertStmt.run(mountedFolderId, mountedFolderPath, targetPath, mountedFolderName, realFolderPath);

      console.log('Mounted folder added to database, now syncing contents');

      // Clone the contents of the real folder into the virtual file system
      await syncMountedFolder(realFolderPath, mountedFolderPath, mountedFolderId);

      console.log('Folder contents synced, setting up watcher');

      // Set up a watcher for the real folder to keep things in sync
      setupFolderWatcher(realFolderPath, mountedFolderPath);

      console.log('Mount complete, returning success');

      return { success: true, id: mountedFolderId, path: mountedFolderPath };
    } catch (error) {
      log.error('Error mounting folder:', error);
      console.error('Error mounting folder:', error);
      return { success: false, error: String(error) };
    }
  });

  // Add the unmount folder handler
  ipcMain.handle('file-explorer:unmount-folder', async (event, mountedFolderPath: string) => {
    try {
      const db = dbManager.getDatabase();
      if (!db) {
        log.error('Database not initialized when unmount-folder was called');
        return { success: false, error: 'Database not initialized' };
      }

      // Get the mounted folder information
      const folderStmt = db.prepare(`
        SELECT id, real_path, is_mounted
        FROM items
        WHERE path = ? AND is_mounted = 1
        LIMIT 1
      `);
      const folder = folderStmt.get(mountedFolderPath) as { id: string, real_path: string, is_mounted: number } | undefined;

      if (!folder) {
        log.error(`Mounted folder not found: ${mountedFolderPath}`);
        return { success: false, error: 'Mounted folder not found' };
      }

      // Stop watching the folder
      if (mountedFolderWatchers.has(folder.real_path)) {
        const watcher = mountedFolderWatchers.get(folder.real_path);
        if (watcher) {
          await watcher.close();
          mountedFolderWatchers.delete(folder.real_path);
          log.info(`Stopped watching folder: ${folder.real_path}`);
        }
      }

      // Use a transaction to delete the mounted folder and all its children
      const transaction = db.transaction(() => {
        // Delete all children of the mounted folder
        const deleteChildrenStmt = db.prepare(`
          DELETE FROM items
          WHERE path LIKE ? || '%' AND path != ?
        `);
        deleteChildrenStmt.run(mountedFolderPath, mountedFolderPath);

        // Delete the mounted folder itself
        const deleteFolderStmt = db.prepare(`
          DELETE FROM items
          WHERE path = ?
        `);
        deleteFolderStmt.run(mountedFolderPath);
      });

      log.info(`Unmounting folder: ${mountedFolderPath}`);
      transaction();

      return { success: true };
    } catch (error) {
      log.error('Error unmounting folder:', error);
      return { success: false, error: String(error) };
    }
  });

  // Add the get image data handler
  ipcMain.handle('file-explorer:get-image-data', async (event, imagePath: string) => {
    try {
      // Check if path is a real_path from the database or a direct file path
      const db = dbManager.getDatabase();
      if (!db) {
        log.error('Database not initialized when get-image-data was called');
        return { success: false, error: 'Database not initialized' };
      }

      log.info(`Attempting to load image data for path: ${imagePath}`);
      
      // Get file info from database if available
      let realPath = imagePath;
      if (!fsSync.existsSync(imagePath)) {
        log.info(`Path doesn't exist directly, looking up in database: ${imagePath}`);
        const fileStmt = db.prepare(`
          SELECT id, real_path, path, type
          FROM items
          WHERE path = ? OR real_path = ?
          LIMIT 1
        `);
        const fileInfo = fileStmt.get(imagePath, imagePath) as { id: string, real_path?: string, path: string, type: string } | undefined;
        
        if (fileInfo) {
          log.info(`Found file info in database: ${JSON.stringify(fileInfo)}`);
          if (fileInfo.real_path) {
            realPath = fileInfo.real_path;
            log.info(`Using real_path from database: ${realPath}`);
          } else {
            realPath = fileInfo.path;
            log.info(`Using path from database: ${realPath}`);
          }
        } else {
          log.error(`No database entry found for image path: ${imagePath}`);
        }
      } else {
        log.info(`Path exists directly, using it: ${imagePath}`);
      }

      // Check if the file exists and is accessible
      if (!fsSync.existsSync(realPath)) {
        log.error(`Image file not found at path: ${realPath}`);
        return { success: false, error: `Image file not found at path: ${realPath}` };
      }

      log.info(`Reading image file: ${realPath}`);
      
      // Read the file as binary data
      const data = await fs.readFile(realPath);
      
      // Convert to base64 string with appropriate mime type
      const extension = path.extname(realPath).toLowerCase().substring(1);
      let mimeType;
      
      switch (extension) {
        case 'jpg':
        case 'jpeg':
          mimeType = 'image/jpeg';
          break;
        case 'png':
          mimeType = 'image/png';
          break;
        case 'gif':
          mimeType = 'image/gif';
          break;
        case 'webp':
          mimeType = 'image/webp';
          break;
        case 'svg':
          mimeType = 'image/svg+xml';
          break;
        case 'bmp':
          mimeType = 'image/bmp';
          break;
        default:
          mimeType = 'application/octet-stream';
      }
      
      log.info(`Successfully read image file (${data.length} bytes) with mime type: ${mimeType}`);
      
      const dataUrl = `data:${mimeType};base64,${data.toString('base64')}`;
      return { success: true, dataUrl };
    } catch (error) {
      log.error('Error getting image data:', error);
      return { success: false, error: String(error) };
    }
  });

  // Add the embedded items handlers
  ipcMain.handle('file-explorer:create-embedded-item', async (event, noteId: string, embeddedItemId: string, positionData: any) => {
    try {
      const db = dbManager.getDatabase();
      if (!db) {
        log.error('Database not initialized when file-explorer:create-embedded-item was called');
        return { success: false, error: 'Database not initialized' };
      }

      // Ensure the embedded_items table exists with the right schema
      await ensureEmbeddedItemsTableExists(db);

      // Check if both the note and the item to embed exist
      const checkNoteStmt = db.prepare('SELECT id, type FROM items WHERE id = ?');
      const note = checkNoteStmt.get(noteId) as { id: string, type: string } | undefined;
      
      if (!note) {
        log.error('Note not found for ID:', noteId);
        return { success: false, error: 'Note not found' };
      }
      
      if (note.type !== 'note') {
        log.error('Item is not a note:', noteId);
        return { success: false, error: 'Target item is not a note' };
      }
      
      const checkItemStmt = db.prepare('SELECT id FROM items WHERE id = ?');
      const item = checkItemStmt.get(embeddedItemId) as { id: string } | undefined;
      
      if (!item) {
        log.error('Item to embed not found for ID:', embeddedItemId);
        return { success: false, error: 'Item to embed not found' };
      }

      // Create a new embedded item entry
      const embeddedId = uuidv4();
      const positionJSON = JSON.stringify(positionData || {});
      
      const insertStmt = db.prepare(`
        INSERT INTO embedded_items (id, note_id, embedded_item_id, position_in_note)
        VALUES (?, ?, ?, ?)
      `);
      insertStmt.run(embeddedId, noteId, embeddedItemId, positionJSON);
      
      return { 
        success: true, 
        embeddedId, 
        embeddingCode: `{{embedded:${embeddedId}}}` 
      };
    } catch (error) {
      log.error('Error creating embedded item:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('file-explorer:get-embedded-item', async (event, embeddedId: string) => {
    try {
      const db = dbManager.getDatabase();
      if (!db) {
        log.error('Database not initialized when file-explorer:get-embedded-item was called');
        return { success: false, error: 'Database not initialized' };
      }
      
      // Ensure the embedded_items table exists with the right schema
      await ensureEmbeddedItemsTableExists(db);

      const stmt = db.prepare(`
        SELECT 
          e.id as embedded_id,
          e.note_id,
          e.embedded_item_id,
          e.position_in_note,
          i.type as item_type,
          i.path as item_path,
          i.name as item_name,
          i.real_path
        FROM embedded_items e
        JOIN items i ON e.embedded_item_id = i.id
        WHERE e.id = ?
      `);
      
      const embeddedItem = stmt.get(embeddedId) as {
        embedded_id: string;
        note_id: string;
        embedded_item_id: string;
        position_in_note: string;
        item_type: string;
        item_path: string;
        item_name: string;
        real_path?: string;
      } | undefined;
      
      if (!embeddedItem) {
        log.error('Embedded item not found for ID:', embeddedId);
        return { success: false, error: 'Embedded item not found' };
      }
      
      // Parse the position data
      if (embeddedItem.position_in_note) {
        embeddedItem.position_in_note = JSON.parse(embeddedItem.position_in_note);
      }
      
      return { success: true, embeddedItem };
    } catch (error) {
      log.error('Error getting embedded item:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('file-explorer:get-note-embedded-items', async (event, noteId: string) => {
    try {
      const db = dbManager.getDatabase();
      if (!db) {
        log.error('Database not initialized when file-explorer:get-note-embedded-items was called');
        return { success: false, error: 'Database not initialized' };
      }

      // Ensure the embedded_items table exists with the right schema
      await ensureEmbeddedItemsTableExists(db);

      const stmt = db.prepare(`
        SELECT 
          e.id as embedded_id,
          e.embedded_item_id,
          e.position_in_note,
          i.type as item_type,
          i.path as item_path,
          i.name as item_name,
          i.real_path
        FROM embedded_items e
        JOIN items i ON e.embedded_item_id = i.id
        WHERE e.note_id = ?
      `);
      
      const embeddedItems = stmt.all(noteId) as Array<{
        embedded_id: string;
        embedded_item_id: string;
        position_in_note: string;
        item_type: string;
        item_path: string;
        item_name: string;
        real_path?: string;
      }>;
      
      // Parse the position data for each item
      embeddedItems.forEach(item => {
        if (item.position_in_note) {
          item.position_in_note = JSON.parse(item.position_in_note);
        }
      });
      
      return { success: true, embeddedItems };
    } catch (error) {
      log.error('Error getting note embedded items:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('file-explorer:update-embedded-item', async (event, embeddedId: string, positionData: any) => {
    try {
      const db = dbManager.getDatabase();
      if (!db) {
        log.error('Database not initialized when file-explorer:update-embedded-item was called');
        return { success: false, error: 'Database not initialized' };
      }

      // Ensure the embedded_items table exists with the right schema
      await ensureEmbeddedItemsTableExists(db);

      const positionJSON = JSON.stringify(positionData || {});
      
      const updateStmt = db.prepare(`
        UPDATE embedded_items
        SET position_in_note = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      
      const result = updateStmt.run(positionJSON, embeddedId);
      
      if (result.changes === 0) {
        log.error('Embedded item not found for ID:', embeddedId);
        return { success: false, error: 'Embedded item not found' };
      }
      
      return { success: true };
    } catch (error) {
      log.error('Error updating embedded item:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('file-explorer:delete-embedded-item', async (event, embeddedId: string) => {
    try {
      const db = dbManager.getDatabase();
      if (!db) {
        log.error('Database not initialized when file-explorer:delete-embedded-item was called');
        return { success: false, error: 'Database not initialized' };
      }

      // Ensure the embedded_items table exists with the right schema
      await ensureEmbeddedItemsTableExists(db);

      const deleteStmt = db.prepare('DELETE FROM embedded_items WHERE id = ?');
      const result = deleteStmt.run(embeddedId);
      
      if (result.changes === 0) {
        log.error('Embedded item not found for ID:', embeddedId);
        return { success: false, error: 'Embedded item not found' };
      }
      
      return { success: true };
    } catch (error) {
      log.error('Error deleting embedded item:', error);
      return { success: false, error: String(error) };
    }
  });
}

/**
 * Recursively syncs a mounted folder from the real filesystem to the virtual database
 */
async function syncMountedFolder(realFolderPath: string, virtualFolderPath: string, parentId: string): Promise<void> {
  try {
    const db = DatabaseManager.getInstance().getDatabase();
    if (!db) {
      throw new Error('Database not initialized');
    }

    // Read directory contents
    const items = await fs.readdir(realFolderPath, { withFileTypes: true });
    
    for (const item of items) {
      const realItemPath = path.join(realFolderPath, item.name);
      const virtualItemPath = path.join(virtualFolderPath, item.name);
      const itemId = uuidv4();
      
      if (item.isDirectory()) {
        // Add folder to the database
        const stmt = db.prepare(`
          INSERT INTO items (id, type, path, parent_path, name, is_mounted, real_path)
          VALUES (?, 'folder', ?, ?, ?, 1, ?)
        `);
        stmt.run(itemId, virtualItemPath, virtualFolderPath, item.name, realItemPath);
        
        // Recursively sync subfolders
        await syncMountedFolder(realItemPath, virtualItemPath, itemId);
      } else if (item.isFile()) {
        // Add file to the database
        const stats = await fs.stat(realItemPath);
        const stmt = db.prepare(`
          INSERT INTO items (id, type, path, parent_path, name, size, is_mounted, real_path)
          VALUES (?, 'file', ?, ?, ?, ?, 1, ?)
        `);
        stmt.run(
          itemId,
          virtualItemPath,
          virtualFolderPath,
          item.name,
          stats.size,
          realItemPath
        );
      }
    }
  } catch (error) {
    log.error('Error syncing mounted folder:', error);
    throw error;
  }
}

/**
 * Sets up a file watcher for a mounted folder to keep it in sync with the database
 */
function setupFolderWatcher(realFolderPath: string, virtualFolderPath: string): void {
  try {
    // Stop any existing watcher for this path
    if (mountedFolderWatchers.has(realFolderPath)) {
      const existingWatcher = mountedFolderWatchers.get(realFolderPath);
      if (existingWatcher) {
        existingWatcher.close();
      }
    }
    
    // Set up a new watcher
    const watcher = chokidar.watch(realFolderPath, {
      persistent: true,
      ignoreInitial: true,
      depth: 99, // Watch nested folders deeply
      awaitWriteFinish: true, // Helps with file editors that do atomic saves
    });
    
    // Handle file/folder creation
    watcher.on('add', async (filePath) => {
      await handleFileCreated(filePath, realFolderPath, virtualFolderPath);
    });
    
    watcher.on('addDir', async (dirPath) => {
      // Skip if it's the root folder we're already watching
      if (dirPath === realFolderPath) return;
      await handleFolderCreated(dirPath, realFolderPath, virtualFolderPath);
    });
    
    // Handle file/folder deletion
    watcher.on('unlink', async (filePath) => {
      await handleFileDeleted(filePath, realFolderPath, virtualFolderPath);
    });
    
    watcher.on('unlinkDir', async (dirPath) => {
      await handleFolderDeleted(dirPath, realFolderPath, virtualFolderPath);
    });
    
    // Handle file/folder changes
    watcher.on('change', async (filePath) => {
      await handleFileChanged(filePath, realFolderPath, virtualFolderPath);
    });
    
    // Store the watcher reference
    mountedFolderWatchers.set(realFolderPath, watcher);
    
    log.info(`Started watching mounted folder: ${realFolderPath}`);
  } catch (error) {
    log.error('Error setting up folder watcher:', error);
    throw error;
  }
}

/**
 * Handler for when a file is created in a watched folder
 */
async function handleFileCreated(filePath: string, realFolderPath: string, virtualFolderPath: string): Promise<void> {
  try {
    const db = DatabaseManager.getInstance().getDatabase();
    if (!db) return;
    
    const relativePath = path.relative(realFolderPath, filePath);
    const virtualItemPath = path.join(virtualFolderPath, relativePath);
    const parentPath = path.dirname(virtualItemPath);
    const fileName = path.basename(filePath);
    
    // Check if parent virtual folder exists
    const parentStmt = db.prepare(`
      SELECT id FROM items WHERE path = ? LIMIT 1
    `);
    const parent = parentStmt.get(parentPath) as { id: string } | undefined;
    
    if (!parent) {
      log.warn(`Parent virtual folder not found for new file: ${parentPath}`);
      return;
    }
    
    // Check if the file already exists in the database
    const existingStmt = db.prepare(`
      SELECT COUNT(*) as count FROM items WHERE path = ? LIMIT 1
    `);
    const { count } = existingStmt.get(virtualItemPath) as { count: number };
    
    if (count > 0) {
      log.warn(`File already exists in the database: ${virtualItemPath}`);
      return;
    }
    
    // Add the new file to the database
    const stats = await fs.stat(filePath);
    const insertStmt = db.prepare(`
      INSERT INTO items (id, type, path, parent_path, name, size, is_mounted, real_path)
      VALUES (?, 'file', ?, ?, ?, ?, 1, ?)
    `);
    insertStmt.run(
      uuidv4(),
      virtualItemPath,
      parentPath,
      fileName,
      stats.size,
      filePath
    );
    
    log.info(`Added new file to database: ${virtualItemPath}`);
  } catch (error) {
    log.error('Error handling file creation:', error);
  }
}

/**
 * Handler for when a folder is created in a watched folder
 */
async function handleFolderCreated(dirPath: string, realFolderPath: string, virtualFolderPath: string): Promise<void> {
  try {
    const db = DatabaseManager.getInstance().getDatabase();
    if (!db) return;
    
    const relativePath = path.relative(realFolderPath, dirPath);
    const virtualItemPath = path.join(virtualFolderPath, relativePath);
    const parentPath = path.dirname(virtualItemPath);
    const folderName = path.basename(dirPath);
    
    // Check if parent virtual folder exists
    const parentStmt = db.prepare(`
      SELECT id FROM items WHERE path = ? LIMIT 1
    `);
    const parent = parentStmt.get(parentPath) as { id: string } | undefined;
    
    if (!parent) {
      log.warn(`Parent virtual folder not found for new folder: ${parentPath}`);
      return;
    }
    
    // Check if the folder already exists in the database
    const existingStmt = db.prepare(`
      SELECT COUNT(*) as count FROM items WHERE path = ? LIMIT 1
    `);
    const { count } = existingStmt.get(virtualItemPath) as { count: number };
    
    if (count > 0) {
      log.warn(`Folder already exists in the database: ${virtualItemPath}`);
      return;
    }
    
    // Add the new folder to the database
    const insertStmt = db.prepare(`
      INSERT INTO items (id, type, path, parent_path, name, is_mounted, real_path)
      VALUES (?, 'folder', ?, ?, ?, 1, ?)
    `);
    insertStmt.run(
      uuidv4(),
      virtualItemPath,
      parentPath,
      folderName,
      dirPath
    );
    
    log.info(`Added new folder to database: ${virtualItemPath}`);
    
    // Recursively sync the new folder's contents
    await syncMountedFolder(dirPath, virtualItemPath, '');
  } catch (error) {
    log.error('Error handling folder creation:', error);
  }
}

/**
 * Handler for when a file is deleted in a watched folder
 */
async function handleFileDeleted(filePath: string, realFolderPath: string, virtualFolderPath: string): Promise<void> {
  try {
    const db = DatabaseManager.getInstance().getDatabase();
    if (!db) return;
    
    const relativePath = path.relative(realFolderPath, filePath);
    const virtualItemPath = path.join(virtualFolderPath, relativePath);
    
    // Delete the file from the database
    const deleteStmt = db.prepare(`
      DELETE FROM items WHERE path = ? AND is_mounted = 1
    `);
    const result = deleteStmt.run(virtualItemPath);
    
    log.info(`Deleted file from database (changes: ${result.changes}): ${virtualItemPath}`);
  } catch (error) {
    log.error('Error handling file deletion:', error);
  }
}

/**
 * Handler for when a folder is deleted in a watched folder
 */
async function handleFolderDeleted(dirPath: string, realFolderPath: string, virtualFolderPath: string): Promise<void> {
  try {
    const db = DatabaseManager.getInstance().getDatabase();
    if (!db) return;
    
    const relativePath = path.relative(realFolderPath, dirPath);
    const virtualItemPath = path.join(virtualFolderPath, relativePath);
    
    // Delete the folder and all its children from the database
    const deleteStmt = db.prepare(`
      DELETE FROM items
      WHERE (path = ? OR path LIKE ? || '/%') AND is_mounted = 1
    `);
    const result = deleteStmt.run(virtualItemPath, virtualItemPath);
    
    log.info(`Deleted folder and contents from database (changes: ${result.changes}): ${virtualItemPath}`);
  } catch (error) {
    log.error('Error handling folder deletion:', error);
  }
}

/**
 * Handler for when a file is changed in a watched folder
 */
async function handleFileChanged(filePath: string, realFolderPath: string, virtualFolderPath: string): Promise<void> {
  try {
    const db = DatabaseManager.getInstance().getDatabase();
    if (!db) return;
    
    const relativePath = path.relative(realFolderPath, filePath);
    const virtualItemPath = path.join(virtualFolderPath, relativePath);
    
    // Update the file metadata in the database
    const stats = await fs.stat(filePath);
    const updateStmt = db.prepare(`
      UPDATE items
      SET size = ?, updated_at = CURRENT_TIMESTAMP
      WHERE path = ? AND is_mounted = 1
    `);
    const result = updateStmt.run(stats.size, virtualItemPath);
    
    if (result.changes === 0) {
      // File might have been created while we weren't looking
      await handleFileCreated(filePath, realFolderPath, virtualFolderPath);
    } else {
      log.info(`Updated file in database: ${virtualItemPath}`);
    }
  } catch (error) {
    log.error('Error handling file change:', error);
  }
}

// Add this near the top of the file
export async function ensureAllTablesExist() {
  try {
    const dbManager = DatabaseManager.getInstance();
    const db = dbManager.getDatabase();
    if (!db) {
      log.error('Database not initialized when ensureAllTablesExist was called');
      return false;
    }
    
    // Check and create the embedded_items table if needed
    await ensureEmbeddedItemsTableExists(db);
    
    // Add more table checks here as needed
    
    return true;
  } catch (error) {
    log.error('Error ensuring all tables exist:', error);
    return false;
  }
}
