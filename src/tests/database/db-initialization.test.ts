import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// We'll use a test database in a temporary location
const tempDir = path.join(os.tmpdir(), 'tread-test-' + Date.now());
const testDbPath = path.join(tempDir, 'test.db');

// Define table row type
interface TableRow {
  name: string;
}

describe('Database Initialization Tests', () => {
  let db: BetterSqlite3.Database;

  beforeAll(() => {
    // Create temp directory
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
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

  it('should create a new database file if it does not exist', () => {
    // Check that the file doesn't exist initially
    expect(fs.existsSync(testDbPath)).toBe(false);
    
    // Create a new database
    db = new BetterSqlite3(testDbPath);
    
    // Check that the file now exists
    expect(fs.existsSync(testDbPath)).toBe(true);
  });

  it('should be able to connect to an existing database', () => {
    // The database was created in the previous test
    expect(fs.existsSync(testDbPath)).toBe(true);
    
    // Try connecting to the existing database
    const existingDb = new BetterSqlite3(testDbPath);
    
    // Should not throw an error
    expect(existingDb).toBeDefined();
    
    // Close the connection
    existingDb.close();
  });

  it('should be able to execute schema creation SQL', () => {
    // Read the schema.sql file
    const schemaPath = path.resolve(process.cwd(), 'src', 'main', 'database', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    
    // Execute the schema SQL
    expect(() => {
      db.exec(schema);
    }).not.toThrow();
    
    // Verify that tables were created
    const tables = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' 
      ORDER BY name
    `).all() as TableRow[];
    
    // Check for essential tables
    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain('items');
    expect(tableNames).toContain('notes');
    expect(tableNames).toContain('ai_metadata');
  });
}); 