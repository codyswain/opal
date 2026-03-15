# Opal Testing Architecture — Design Spec

**Date:** 2026-03-15
**Status:** Approved
**Goal:** Layered test pyramid enabling confident AI-driven development

## Problem

Opal has minimal test coverage (a few database and build tests). There's no way to verify that UI changes work end-to-end, which blocks autonomous AI improvements. We need a testing architecture that gives fast feedback on small changes and high confidence on large ones.

## Decision Summary

- **Unit + Integration:** Vitest (existing runner, fast)
- **E2E:** Playwright with first-class Electron support (launches real app)
- **Database strategy:** Ephemeral temp directory per test suite, zero state leakage
- **First test target:** Critical user path (launch → create folder → create note → edit → save → verify)
- **App change:** Single env var (`OPAL_TEST_DB_DIR`) in `DatabaseManager`

## Architecture

### Test Pyramid

| Layer | Runner | What It Tests | Target Speed |
|-------|--------|--------------|-------------|
| Unit | Vitest | Transforms, utilities, repository methods against real temp SQLite | ~2s |
| Integration | Vitest | IPC handler logic + VFS operations with real database, mocked Electron APIs | ~5s |
| E2E | Playwright | Real Electron app launched, DOM interactions, full user journeys | ~30-45s |

### Why This Split

Vitest is already configured and handles fast feedback well. Playwright has first-class Electron support — it can launch the actual binary, interact with the renderer DOM, and assert on real state. Keeping them separate means unit tests stay sub-second and E2E tests provide true end-to-end confidence.

## File Structure

```
src/
  tests/
    helpers/
      testDb.ts              # createTestDb(), seedFolder(), seedNote(), cleanup()
      electronMocks.ts       # Mock ipcMain, dialog, BrowserWindow for integration tests
    unit/
      transforms.test.ts         # transformFileSystemData, data mappers
      itemRepository.test.ts     # CRUD against real temp SQLite
      vfsManager.test.ts         # VFS logic with real DB, no Electron
    integration/
      vfsHandlers.test.ts        # IPC handler -> VFSManager -> DB round-trips
      databaseHandlers.test.ts   # Database IPC handlers
      systemHandlers.test.ts     # System handlers with mocked dialog
    database/                    # (existing, untouched)
    build/                       # (existing, untouched)

e2e/
  fixtures/
    electronApp.ts           # Playwright fixture: build, launch, cleanup
  tests/
    critical-path.spec.ts    # Launch -> create folder -> create note -> edit -> save -> verify
    app-launch.spec.ts       # App starts, renders navbar, shows empty state
    file-operations.spec.ts  # Create, rename, delete folders and notes
  playwright.config.ts       # Electron-specific Playwright config
```

### Key Decisions

- **E2E tests in top-level `e2e/`** — they test the built app, not source modules
- **Unit/integration tests in `src/tests/`** — they import source directly via `@/` alias
- **Shared helpers in `src/tests/helpers/`** — used by both unit and integration layers
- **Existing tests untouched** — database and build tests continue to work as before

## App Change for Testability

One modification to `src/main/database/db.ts`:

```typescript
// DatabaseManager initialization
const dbDir = process.env.OPAL_TEST_DB_DIR || app.getPath('userData');
const dbPath = path.join(dbDir, 'opal.db');
```

This is the only change to production code. The env var is never set outside of test runs. Electron Forge does not forward arbitrary env vars to packaged apps, so this cannot be triggered in production.

## Ephemeral Database Factory

Shared helper used by all test layers:

```typescript
// src/tests/helpers/testDb.ts
import { mkdtemp, rm, cp } from 'fs/promises';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import fs from 'fs';

export async function createTestDb() {
  const testDir = await mkdtemp(path.join(os.tmpdir(), 'opal-test-'));
  const dbPath = path.join(testDir, 'opal.db');
  const db = new Database(dbPath);

  // Apply schema
  const schemaPath = path.resolve(__dirname, '../../../src/main/database/schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  const statements = schema.split(';').filter(s => s.trim());
  for (const stmt of statements) {
    db.exec(stmt);
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

export function seedNote(db: Database.Database, name: string, parentPath: string, content: string = '') {
  const id = crypto.randomUUID();
  const notePath = `${parentPath}/${name}`;
  db.prepare('INSERT INTO items (id, type, path, parent_path, name) VALUES (?, ?, ?, ?, ?)')
    .run(id, 'note', notePath, parentPath, name);
  db.prepare('INSERT INTO notes (item_id, content) VALUES (?, ?)')
    .run(id, content);
  return { id, path: notePath };
}
```

## Playwright Electron Fixture

```typescript
// e2e/fixtures/electronApp.ts
import { test as base, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'fs/promises';
import path from 'path';
import os from 'os';

export const test = base.extend({
  electronApp: async ({}, use) => {
    const testDbDir = await mkdtemp(path.join(os.tmpdir(), 'opal-test-'));

    const app = await electron.launch({
      args: [path.join(__dirname, '../../.vite/build/main.js')],
      env: { ...process.env, OPAL_TEST_DB_DIR: testDbDir },
    });

    await use(app);

    await app.close();
    await rm(testDbDir, { recursive: true, force: true });
  },

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await use(page);
  },
});

export { expect } from '@playwright/test';
```

## Critical Path Test (First E2E)

```typescript
// e2e/tests/critical-path.spec.ts
import { test, expect } from '../fixtures/electronApp';

test('create folder, create note, edit and save', async ({ page }) => {
  // App launches with empty state
  // Click folder+ button in left sidebar
  // Assert folder appears in tree
  // Click note+ button
  // Assert note appears in tree
  // Click note to open in editor
  // Type content in TipTap editor
  // Assert content persisted (navigate away and back, verify content)
});

test('app launches and renders correctly', async ({ page }) => {
  // Navbar visible with traffic light buttons
  // Left sidebar panel visible
  // Right sidebar panel visible
  // No console errors
});
```

## npm Scripts

```json
{
  "test:unit": "vitest run --testPathPattern=unit",
  "test:integration": "vitest run --testPathPattern=integration",
  "test:e2e": "npx vite build --config vite.main.config.ts && npx vite build --config vite.preload.config.ts && npx vite build --config vite.renderer.config.ts && npx playwright test --config e2e/playwright.config.ts",
  "test:all": "npm run test && npm run test:e2e"
}
```

### AI Feedback Loop

| Command | When to Use | Speed |
|---------|------------|-------|
| `npm run test:unit` | After editing a utility, repository, or transform | ~2s |
| `npm run test:integration` | After changing IPC handlers or VFS logic | ~5s |
| `npm run test:e2e` | After any UI change or before claiming done | ~30-45s |
| `npm run test:all` | Final verification before commit | ~45s |

Existing `npm test` is unchanged — runs all Vitest tests including existing database and build tests.

## Out of Scope

- CI/CD pipeline (GitHub Actions) — future work, scripts are ready for it
- Component tests (Vitest + Testing Library rendering React components) — good future addition
- Visual regression testing (screenshot comparison) — future layer
- VSCode-like UI overhaul — separate design spec, will use this test infrastructure
