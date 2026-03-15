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
- **First test target:** Critical user path (launch -> create folder -> create note -> edit -> save -> verify)
- **App change:** `OPAL_TEST_DB_DIR` env var in `DatabaseManager.initialize()` default path
- **Selector strategy:** `data-testid` attributes on interactive elements for E2E stability
- **New dependencies:** `@playwright/test` (devDependency)

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

One modification to `src/main/database/db.ts`. The existing `DatabaseManager.initialize()` already accepts an optional `dbPath` parameter. We modify the default path fallback to check for the test env var:

```typescript
// In DatabaseManager.initialize()
// Before:
const finalDbPath = dbPath || path.join(app.getPath('userData'), `${APP_NAME}.db`);

// After:
const defaultDir = process.env.OPAL_TEST_DB_DIR || app.getPath('userData');
const finalDbPath = dbPath || path.join(defaultDir, `${APP_NAME}.db`);
```

This preserves the existing `dbPath` parameter for callers that use it directly, while allowing E2E tests to override the default via environment variable. The env var is never set outside of test runs. Electron Forge does not forward arbitrary env vars to packaged apps, so this cannot be triggered in production.

## Ephemeral Database Factory

Shared helper used by all test layers:

```typescript
// src/tests/helpers/testDb.ts
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
  // (including triggers with semicolons in their bodies)
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

## Selector Strategy for E2E

Tests use `data-testid` attributes for stable element selection. This avoids coupling tests to CSS classes or DOM structure which change frequently during UI work.

**Attributes to add to production components:**

| Component | Attribute | Element |
|-----------|----------|---------|
| Navbar | `data-testid="navbar"` | Nav container |
| ExplorerLeftPanel | `data-testid="create-note-btn"` | FilePlus button |
| ExplorerLeftPanel | `data-testid="create-folder-btn"` | FolderPlus button |
| ExplorerLeftPanel | `data-testid="file-tree"` | Tree container |
| File tree items | `data-testid="tree-item-{id}"` | Each tree node |
| ExploreCenterPanel | `data-testid="editor-panel"` | Editor container |
| TipTap editor | `data-testid="editor-content"` | Editor content area |

Tests select elements via `page.getByTestId('create-folder-btn')` which is Playwright's recommended approach.

## Playwright Electron Fixture

```typescript
// e2e/fixtures/electronApp.ts
import { test as base, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import fs from 'fs';

const MAIN_JS_PATH = path.join(__dirname, '../../.vite/build/main.js');

export const test = base.extend({
  electronApp: async ({}, use) => {
    // Verify build exists
    if (!fs.existsSync(MAIN_JS_PATH)) {
      throw new Error(
        `Built main.js not found at ${MAIN_JS_PATH}. Run the Vite builds first:\n` +
        `  npx vite build --config vite.main.config.ts && npx vite build --config vite.preload.config.ts && npx vite build --config vite.renderer.config.ts`
      );
    }

    const testDbDir = await mkdtemp(path.join(os.tmpdir(), 'opal-test-'));

    const app = await electron.launch({
      args: [MAIN_JS_PATH],
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

test('app launches and renders correctly', async ({ page }) => {
  // Verify core UI elements are visible
  await expect(page.getByTestId('navbar')).toBeVisible();
  await expect(page.getByTestId('create-folder-btn')).toBeVisible();
  await expect(page.getByTestId('create-note-btn')).toBeVisible();
});

test('create folder, create note, edit and save', async ({ page }) => {
  // Create a folder
  await page.getByTestId('create-folder-btn').click();
  await expect(page.getByTestId('file-tree').locator('[data-testid^="tree-item-"]')).toHaveCount(1);

  // Create a note inside the folder
  await page.getByTestId('create-note-btn').click();
  const noteItem = page.getByTestId('file-tree').locator('[data-testid^="tree-item-"]').last();
  await expect(noteItem).toBeVisible();

  // Open the note in the editor
  await noteItem.click();
  await expect(page.getByTestId('editor-content')).toBeVisible();

  // Type content
  await page.getByTestId('editor-content').click();
  await page.keyboard.type('Hello from E2E test');

  // Verify content persists: click away to the folder, then back to the note
  await page.getByTestId('file-tree').locator('[data-testid^="tree-item-"]').first().click();
  await noteItem.click();
  await expect(page.getByTestId('editor-content')).toContainText('Hello from E2E test');
});
```

## npm Scripts

```json
{
  "test:unit": "vitest run src/tests/unit/",
  "test:integration": "vitest run src/tests/integration/",
  "test:e2e": "npx vite build --config vite.main.config.ts && npx vite build --config vite.preload.config.ts && npx vite build --config vite.renderer.config.ts && npx playwright test --config e2e/playwright.config.ts",
  "test:all": "npm run test:unit && npm run test:integration && npm run test:e2e"
}
```

Note: `test:all` runs unit and integration tests directly (avoiding the `npm test` script's slow `npm rebuild --build-from-source better-sqlite3` step). The existing `npm test` script is unchanged and continues to run all Vitest tests including existing database and build suites.

### AI Feedback Loop

| Command | When to Use | Speed |
|---------|------------|-------|
| `npm run test:unit` | After editing a utility, repository, or transform | ~2s |
| `npm run test:integration` | After changing IPC handlers or VFS logic | ~5s |
| `npm run test:e2e` | After any UI change or before claiming done | ~30-45s |
| `npm run test:all` | Final verification before commit | ~45s |

## Out of Scope

- CI/CD pipeline (GitHub Actions) — future work, scripts are ready for it
- Component tests (Vitest + Testing Library rendering React components) — good future addition
- Visual regression testing (screenshot comparison) — future layer
- VSCode-like UI overhaul — separate design spec, will use this test infrastructure
