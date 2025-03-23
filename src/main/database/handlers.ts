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
import { OpenAI } from 'openai';
import { getOpenAIKey } from '../file-system/loader';

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
        SELECT type
        FROM items
        WHERE id = ?
        LIMIT 1
      `);
      const node = stmt.get(id) as { type: string } | undefined;

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

      return { success: true };
    } catch (error) {
      log.error('Error updating note content:', error);
      return { success: false, error: String(error) };
    }
  })

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
}
