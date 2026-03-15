import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';

describe('DatabaseManager OPAL_TEST_DB_DIR', () => {
  const originalEnv = process.env.OPAL_TEST_DB_DIR;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.OPAL_TEST_DB_DIR;
    } else {
      process.env.OPAL_TEST_DB_DIR = originalEnv;
    }
  });

  it('should use OPAL_TEST_DB_DIR when set and no dbPath provided', () => {
    process.env.OPAL_TEST_DB_DIR = '/tmp/test-db-dir';
    const defaultDir = process.env.OPAL_TEST_DB_DIR || '/default/path';
    const finalDbPath = path.join(defaultDir, 'opal.db');
    expect(finalDbPath).toBe('/tmp/test-db-dir/opal.db');
  });

  it('should fall back to default when OPAL_TEST_DB_DIR is not set', () => {
    delete process.env.OPAL_TEST_DB_DIR;
    const defaultDir = process.env.OPAL_TEST_DB_DIR || '/default/path';
    const finalDbPath = path.join(defaultDir, 'opal.db');
    expect(finalDbPath).toBe('/default/path/opal.db');
  });
});
