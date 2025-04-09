import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';

// We'll use a test database in a temporary location
const tempDir = path.join(os.tmpdir(), 'opal-test-ops-' + Date.now());
const testDbPath = path.join(tempDir, 'test-ops.db');

// Define interfaces for our database tables
interface Item {
  id: string;
  type: string;
  path: string;
  parent_path: string | null;
  name: string;
  created_at: string;
  updated_at: string;
}

interface Note {
  item_id: string;
  content: string;
}

interface JoinResult {
  id: string;
  path: string;
  type: string;
  content: string;
}

describe('Database Operations Tests', () => {
  let db: BetterSqlite3.Database;

  beforeAll(() => {
    // Create temp directory
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Create and initialize database
    db = new BetterSqlite3(testDbPath);
    
    // Read the schema.sql file
    const schemaPath = path.resolve(process.cwd(), 'src', 'main', 'database', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    
    // Execute the schema SQL
    db.exec(schema);
  });

  afterAll(() => {
    // Clean up after tests
    if (db) {
      db.close();
    }
    
    // Delete test database file
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    
    // Remove temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmdirSync(tempDir, { recursive: true });
    }
  });

  beforeEach(() => {
    // Temporarily disable foreign key constraints for test setup
    db.pragma('foreign_keys = OFF');
    
    // Clear tables before each test
    db.exec('DELETE FROM notes');
    db.exec('DELETE FROM ai_metadata');
    db.exec('DELETE FROM items');
    
    // Re-enable foreign key constraints
    db.pragma('foreign_keys = ON');
    
    // Create root folder first
    const rootId = uuidv4();
    db.prepare(`
      INSERT INTO items (id, type, path, parent_path, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(rootId, 'folder', '/', null, 'root');
    
    // Create test folder
    const testFolderId = uuidv4();
    db.prepare(`
      INSERT INTO items (id, type, path, parent_path, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(testFolderId, 'folder', '/test', '/', 'test');
  });

  it('should be able to insert items into the database', () => {
    const itemId = uuidv4();
    const itemPath = `/test/item-${itemId}`;
    
    // Insert an item
    const insertItem = db.prepare(`
      INSERT INTO items (id, type, path, parent_path, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);
    
    const result = insertItem.run(itemId, 'note', itemPath, '/test', `item-${itemId}`);
    expect(result.changes).toBe(1);
    
    // Verify the item was inserted
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as Item;
    expect(item).toBeDefined();
    expect(item.id).toBe(itemId);
    expect(item.path).toBe(itemPath);
  });

  it('should be able to insert and query notes', () => {
    const itemId = uuidv4();
    const itemPath = `/test/note-${itemId}`;
    const noteContent = 'This is a test note content';
    
    // Insert an item first
    const insertItem = db.prepare(`
      INSERT INTO items (id, type, path, parent_path, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);
    insertItem.run(itemId, 'note', itemPath, '/test', `note-${itemId}`);
    
    // Insert a note
    const insertNote = db.prepare(`
      INSERT INTO notes (item_id, content)
      VALUES (?, ?)
    `);
    const result = insertNote.run(itemId, noteContent);
    expect(result.changes).toBe(1);
    
    // Verify the note was inserted
    const note = db.prepare('SELECT * FROM notes WHERE item_id = ?').get(itemId) as Note;
    expect(note).toBeDefined();
    expect(note.item_id).toBe(itemId);
    expect(note.content).toBe(noteContent);
    
    // Join query to get item and note
    const joinQuery = db.prepare(`
      SELECT i.id, i.path, i.type, n.content
      FROM items i
      JOIN notes n ON i.id = n.item_id
      WHERE i.id = ?
    `);
    const joinResult = joinQuery.get(itemId) as JoinResult;
    expect(joinResult).toBeDefined();
    expect(joinResult.id).toBe(itemId);
    expect(joinResult.content).toBe(noteContent);
  });

  it('should be able to update existing notes', () => {
    const itemId = uuidv4();
    const itemPath = `/test/update-note-${itemId}`;
    const noteContent = 'Original content';
    const updatedContent = 'Updated content';
    
    // Insert an item
    const insertItem = db.prepare(`
      INSERT INTO items (id, type, path, parent_path, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);
    insertItem.run(itemId, 'note', itemPath, '/test', `update-note-${itemId}`);
    
    // Insert a note
    const insertNote = db.prepare(`
      INSERT INTO notes (item_id, content)
      VALUES (?, ?)
    `);
    insertNote.run(itemId, noteContent);
    
    // Update the note
    const updateNote = db.prepare(`
      UPDATE notes SET content = ? WHERE item_id = ?
    `);
    const result = updateNote.run(updatedContent, itemId);
    expect(result.changes).toBe(1);
    
    // Verify the note was updated
    const note = db.prepare('SELECT content FROM notes WHERE item_id = ?').get(itemId) as { content: string };
    expect(note.content).toBe(updatedContent);
  });

  it('should be able to delete items and cascade to notes', () => {
    const itemId = uuidv4();
    const itemPath = `/test/delete-note-${itemId}`;
    
    // Insert an item
    const insertItem = db.prepare(`
      INSERT INTO items (id, type, path, parent_path, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);
    insertItem.run(itemId, 'note', itemPath, '/test', `delete-note-${itemId}`);
    
    // Insert a note
    const insertNote = db.prepare(`
      INSERT INTO notes (item_id, content)
      VALUES (?, ?)
    `);
    insertNote.run(itemId, 'Note to be deleted');
    
    // Verify the note exists
    let note = db.prepare('SELECT * FROM notes WHERE item_id = ?').get(itemId) as Note | undefined;
    expect(note).toBeDefined();
    
    // Delete the item
    const deleteItem = db.prepare('DELETE FROM items WHERE id = ?');
    const result = deleteItem.run(itemId);
    expect(result.changes).toBe(1);
    
    // Verify the item was deleted
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as Item | undefined;
    expect(item).toBeUndefined();
    
    // Verify the note was cascade deleted
    note = db.prepare('SELECT * FROM notes WHERE item_id = ?').get(itemId) as Note | undefined;
    expect(note).toBeUndefined();
  });
}); 