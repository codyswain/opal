import { mkdtemp, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import fs from 'fs';

export async function createTestDb() {
  const testDir = await mkdtemp(path.join(os.tmpdir(), 'opal-test-'));
  const dbPath = path.join(testDir, 'opal.db');
  const db = new Database(dbPath);

  // Apply schema using db.exec() which handles multi-statement SQL
  const schemaPath = path.resolve(__dirname, '../../main/database/schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  // Apply migrations (adds is_mounted, real_path columns)
  const tableInfo = db.prepare("PRAGMA table_info(items)").all() as { name: string }[];
  if (!tableInfo.some(col => col.name === 'is_mounted')) {
    db.exec("ALTER TABLE items ADD COLUMN is_mounted BOOLEAN DEFAULT 0");
  }
  if (!tableInfo.some(col => col.name === 'real_path')) {
    db.exec("ALTER TABLE items ADD COLUMN real_path TEXT");
  }

  return { db, dbPath, testDir };
}

export async function cleanupTestDir(testDir: string) {
  await rm(testDir, { recursive: true, force: true });
}

export function seedFolder(db: Database.Database, name: string, parentPath: string | null = null) {
  const id = crypto.randomUUID();
  const folderPath = parentPath ? `${parentPath}/${name}` : `/${name}`;
  db.prepare('INSERT INTO items (id, type, path, parent_path, name) VALUES (?, ?, ?, ?, ?)')
    .run(id, 'folder', folderPath, parentPath, name);
  return { id, path: folderPath };
}

export function seedNote(db: Database.Database, name: string, parentPath: string, content = '') {
  const id = crypto.randomUUID();
  const notePath = `${parentPath}/${name}`;
  db.prepare('INSERT INTO items (id, type, path, parent_path, name) VALUES (?, ?, ?, ?, ?)')
    .run(id, 'note', notePath, parentPath, name);
  db.prepare('INSERT INTO notes (item_id, content) VALUES (?, ?)')
    .run(id, content);
  return { id, path: notePath };
}
