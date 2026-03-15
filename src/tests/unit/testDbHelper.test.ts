import { describe, it, expect, afterEach } from 'vitest';
import { createTestDb, cleanupTestDir, seedFolder, seedNote } from '../helpers/testDb';
import fs from 'fs';

describe('testDb helper', () => {
  let testDir: string;

  afterEach(async () => {
    if (testDir) {
      await cleanupTestDir(testDir);
    }
  });

  it('createTestDb creates a database with schema applied', async () => {
    const result = await createTestDb();
    testDir = result.testDir;
    expect(fs.existsSync(result.dbPath)).toBe(true);
    const tables = result.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='items'"
    ).all();
    expect(tables).toHaveLength(1);
    const columns = result.db.prepare("PRAGMA table_info(items)").all() as { name: string }[];
    const columnNames = columns.map(c => c.name);
    expect(columnNames).toContain('is_mounted');
    expect(columnNames).toContain('real_path');
    result.db.close();
  });

  it('seedFolder creates a folder in the database', async () => {
    const result = await createTestDb();
    testDir = result.testDir;
    const folder = seedFolder(result.db, 'Test Folder');
    expect(folder.id).toBeDefined();
    expect(folder.path).toBe('/Test Folder');
    const row = result.db.prepare('SELECT * FROM items WHERE id = ?').get(folder.id) as any;
    expect(row.name).toBe('Test Folder');
    expect(row.type).toBe('folder');
    result.db.close();
  });

  it('seedNote creates a note with content', async () => {
    const result = await createTestDb();
    testDir = result.testDir;
    const folder = seedFolder(result.db, 'Parent');
    const note = seedNote(result.db, 'My Note', folder.path, '# Hello');
    expect(note.path).toBe('/Parent/My Note');
    const noteRow = result.db.prepare('SELECT * FROM notes WHERE item_id = ?').get(note.id) as any;
    expect(noteRow.content).toBe('# Hello');
    result.db.close();
  });

  it('cleanupTestDir removes the directory', async () => {
    const result = await createTestDb();
    testDir = result.testDir;
    result.db.close();
    await cleanupTestDir(testDir);
    expect(fs.existsSync(testDir)).toBe(false);
    testDir = '';
  });
});
