// src/main/database/ipc-handlers.ts (New file for IPC handlers)
import { ipcMain } from 'electron';
import DatabaseManager from './db'; // Import DatabaseManager
import log from 'electron-log';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Item, ItemWithAIMetadata, Note } from './types';
import { migrateNotesToDatabase } from './migration';
import { cleanupOldNotes } from './cleanup';
import { transformFileSystemData } from './transforms';

// Example: Get all data from a table (replace 'your_table' with your actual table name)
export async function registerDatabaseIPCHandlers() {
  const dbManager = DatabaseManager.getInstance();

  // Eventually move the logic into its own service
  ipcMain.handle('file-explorer:get-entries', async () => {
    const db = dbManager.getDatabase();
    if (!db) throw new Error("Database not initialized");

    try {
      const items = await db.prepare(`
        SELECT  i.id, i.type, i.path, i.parent_path, i.name, i.created_at, i.updated_at, i.size, a.summary, a.tags
        FROM items i
        LEFT JOIN ai_metadata a ON i.id = a.item_id
      `).all() as ItemWithAIMetadata[];

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
      const note = await db.prepare(`
        SELECT content
        FROM notes
        WHERE item_id = '${id}'
        LIMIT 1
      `).get() as Note; 

      return { success: true, note: {id, content: note.content} };
    } catch (error) {
      log.error('Error fetching note:', error);
      return { success: false, error: String(error) };
    }
  })



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

      const stmt = db.prepare(`
        UPDATE notes
        SET content = ?
        WHERE item_id = (SELECT id FROM items WHERE path = ?)
      `);
      stmt.run(newContent, notePath);
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
      log.info('Database reset triggered');
      
      const dbManager = DatabaseManager.getInstance();
      const db = dbManager.getDatabase();
      
      // Temporarily disable foreign key constraints
      db.exec('PRAGMA foreign_keys = OFF;');
      
      let transactionStarted = false;
      
      try {
        // Start transaction
        db.exec('BEGIN TRANSACTION;');
        transactionStarted = true;
        
        // Drop tables in reverse order of dependencies
        db.exec('DROP TABLE IF EXISTS items_fts;');
        db.exec('DROP TABLE IF EXISTS ai_metadata;');
        db.exec('DROP TABLE IF EXISTS notes;');
        db.exec('DROP TABLE IF EXISTS items;');
        
        // Commit the transaction before reinitializing
        db.exec('COMMIT;');
        transactionStarted = false;
        
        // Re-enable foreign key constraints
        db.exec('PRAGMA foreign_keys = ON;');
        
        // Reinitialize the database schema
        await dbManager.initialize();
        
        return { success: true, message: 'Database reset successfully' };
      } catch (error) {
        // If there was an error and a transaction is active, roll it back
        if (transactionStarted) {
          try {
            db.exec('ROLLBACK;');
          } catch (rollbackError) {
            log.error('Error during rollback:', rollbackError);
          }
        }
        
        // Re-enable foreign key constraints
        try {
          db.exec('PRAGMA foreign_keys = ON;');
        } catch (pragmaError) {
          log.error('Error re-enabling foreign keys:', pragmaError);
        }
        
        throw error;
      }
    } catch (error) {
      log.error('Error during database reset:', error);
      return { success: false, error: String(error) };
    }
  });
}
