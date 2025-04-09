import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';

// We'll use a test database in a temporary location
const tempDir = path.join(os.tmpdir(), 'opal-test-search-' + Date.now());
const testDbPath = path.join(tempDir, 'test-search.db');

// Define interfaces for our database tables
interface SearchResult {
  id: string;
  path: string;
  content: string;
  rank: number;
}

describe('Database Search Tests', () => {
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

  it('should be able to insert multiple notes for testing search', () => {
    // Insert several test notes
    const notes = [
      { title: 'Meeting notes', content: 'Discussed project deadlines and resource allocation' },
      { title: 'Shopping list', content: 'Apples, bananas, milk, eggs, bread' },
      { title: 'Project ideas', content: 'AI-powered notes app with semantic search capabilities' },
      { title: 'Programming tips', content: 'Always write tests for your database operations' }
    ];
    
    for (const note of notes) {
      const itemId = uuidv4();
      const itemPath = `/test/${note.title.toLowerCase().replace(/\s+/g, '-')}-${itemId}`;
      
      // Insert item
      const insertItem = db.prepare(`
        INSERT INTO items (id, type, path, parent_path, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `);
      insertItem.run(itemId, 'note', itemPath, '/test', note.title);
      
      // Insert note
      const insertNote = db.prepare(`
        INSERT INTO notes (item_id, content)
        VALUES (?, ?)
      `);
      insertNote.run(itemId, note.content);
    }
    
    // Verify all notes were inserted
    const count = db.prepare('SELECT COUNT(*) as count FROM notes').get() as { count: number };
    expect(count.count).toBe(notes.length);
  });

  it('should be able to search notes using LIKE query', () => {
    // Insert test data
    const noteWithSearchTerms = {
      id: uuidv4(),
      path: '/test/searchable-note',
      title: 'Searchable Note',
      content: 'This note contains important keywords like database and testing'
    };
    
    // Insert item
    db.prepare(`
      INSERT INTO items (id, type, path, parent_path, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(noteWithSearchTerms.id, 'note', noteWithSearchTerms.path, '/test', noteWithSearchTerms.title);
    
    // Insert note
    db.prepare(`
      INSERT INTO notes (item_id, content)
      VALUES (?, ?)
    `).run(noteWithSearchTerms.id, noteWithSearchTerms.content);
    
    // Search for 'database' term using LIKE query
    const searchTerm = 'database';
    
    // We'll use a simple LIKE query for test purposes
    const searchQuery = db.prepare(`
      SELECT i.id, i.path, n.content, 1 as rank
      FROM items i
      JOIN notes n ON i.id = n.item_id
      WHERE n.content LIKE ?
      ORDER BY i.updated_at DESC
    `);
    
    const results = searchQuery.all(`%${searchTerm}%`) as SearchResult[];
    
    // Verify the search works
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain(searchTerm);
    expect(results[0].id).toBe(noteWithSearchTerms.id);
  });

  it('should maintain proper indices for quick path lookup', () => {
    // Insert a folder structure
    const folderId = uuidv4();
    const folderPath = '/test/folder';
    
    // Create parent folder
    db.prepare(`
      INSERT INTO items (id, type, path, parent_path, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(folderId, 'folder', folderPath, '/test', 'folder');
    
    // Insert multiple notes in the folder
    const noteCount = 5;
    for (let i = 0; i < noteCount; i++) {
      const noteId = uuidv4();
      const notePath = `${folderPath}/note-${i}`;
      
      db.prepare(`
        INSERT INTO items (id, type, path, parent_path, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(noteId, 'note', notePath, folderPath, `Note ${i}`);
    }
    
    // Query with index on parent_path
    const pathQuery = db.prepare(`
      SELECT * FROM items WHERE parent_path = ?
    `);
    const results = pathQuery.all(folderPath);
    
    // Verify index is working
    expect(results.length).toBe(noteCount);
    
    // Verify the execution plan uses the index
    // This checks that the database is using the proper index for this query
    const explainQuery = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT * FROM items WHERE parent_path = ?
    `);
    const plan = explainQuery.all(folderPath) as { detail: string }[];
    
    // Check that the plan mentions using an index
    // This is an approximation - SQLite's exact output format could vary
    const planText = plan.map(p => p.detail).join(' ');
    expect(planText.toLowerCase()).toContain('index');
  });
}); 