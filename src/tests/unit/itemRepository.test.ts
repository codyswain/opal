import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';

// Mock electron module before importing anything that depends on it
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return os.tmpdir();
      return os.tmpdir();
    },
  },
}));

// Mock electron-log which depends on electron
vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { ItemRepository } from '@/main/database/repositories/itemRepository';
import { createTestDb, cleanupTestDir, seedFolder } from '../helpers/testDb';
import type BetterSqlite3 from 'better-sqlite3';

function createMockDbManager(db: BetterSqlite3.Database) {
  return { getDatabase: () => db } as any;
}

describe('ItemRepository', () => {
  let db: BetterSqlite3.Database;
  let testDir: string;
  let repo: ItemRepository;

  beforeEach(async () => {
    const result = await createTestDb();
    db = result.db;
    testDir = result.testDir;
    repo = new ItemRepository({ dbManager: createMockDbManager(db) });
  });

  afterEach(async () => {
    db.close();
    await cleanupTestDir(testDir);
  });

  it('getItems returns empty array when no items exist', async () => {
    const items = await repo.getItems();
    expect(items).toEqual([]);
  });

  it('getItems returns seeded items', async () => {
    seedFolder(db, 'Test Folder');
    const items = await repo.getItems();
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Test Folder');
  });

  it('createFolder creates a folder at root', async () => {
    const result = await repo.createFolder(null, 'New Folder');
    expect(result.id).toBeDefined();
    expect(result.path).toBe('/New Folder');
    const items = await repo.getItems();
    expect(items).toHaveLength(1);
  });

  it('createFolder auto-increments name on conflict', async () => {
    await repo.createFolder(null, 'Folder');
    const second = await repo.createFolder(null, 'Folder');
    expect(second.path).toBe('/Folder 1');
  });

  it('renameItem changes name and path', async () => {
    const folder = seedFolder(db, 'Original');
    const result = await repo.renameItem(folder.id, 'Renamed');
    expect(result.newPath).toBe('/Renamed');
  });

  it('deleteItem removes the item', async () => {
    const folder = await repo.createFolder(null, 'ToDelete');
    await repo.deleteItem(folder.id);
    const items = await repo.getItems();
    expect(items).toEqual([]);
  });
});
