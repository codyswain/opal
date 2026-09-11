# Files First A: Remove the Notes Feature

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the SQLite-backed Notes feature and everything that only existed for it, leaving the disk-based Files feature as the product and a test pipeline without native rebuilds.

**Spec:** `docs/superpowers/specs/2026-09-07-files-first-design.md`, Stream A. Dependency map from the survey of 2026-09-07 (App routes, sidebar link, Settings admin controls, preload bridges, main wiring, build configs, tests, E2E).

## Global Constraints

- Worktree `/Users/codyswain/code/opal/.worktrees/core-ux`, branch `codex/core-ux`; no merge or push.
- Keep: `credentialAPI`, `CredentialManager`, the OpenAI key field in Settings, `openai`, `chokidar`, `react-resizable-panels`, TipTap packages, `hooks/rebuild.js` (keytar).
- After the change: `npm test` runs vitest with no rebuild; `npm run test:e2e` runs the three Vite builds then Playwright; type errors drop below the 13 baseline only by deleting files that held them; lint has no new warnings.

### Task 1: Delete legacy code, tests and tooling

- [ ] `git rm -r` `src/renderer/features/file-explorer-v2`, `src/renderer/features/navbar`, `src/main/services/vfs`, `src/main/database`, `src/main/embeddings`, `src/main/file-system`, `src/types/index.ts`, `tools/fix-embeddings.js`, `src/tests/database`, `src/tests/helpers/testDb.ts`, `src/tests/unit/testDbHelper.test.ts`, `src/tests/unit/itemRepository.test.ts`, `src/tests/unit/transforms.test.ts`, `src/tests/unit/dbEnvOverride.test.ts`, `e2e/tests/critical-path.spec.ts`.

### Task 2: Repoint the app

- [ ] `App.tsx`: drop the Explorer import, `NotesRoute`, `NOTES_ROUTE`; `/` and `*` redirect to `/files`; keep the command registrations.
- [ ] `WorkspaceSidebar.tsx`: remove the Notes item.
- [ ] `Settings.tsx`: only the OpenAI key field, restyled with shell tokens; drop the database and embeddings controls.
- [ ] `src/renderer/shared/types/index.ts`: keep the `systemAPI` and `credentialAPI` window declarations only.
- [ ] `preload.ts`: keep `systemAPI`, `credentialAPI`, `diskAPI`, `metadataAPI`, `activityAPI`, `collectionsAPI`, `viewsAPI`.
- [ ] `main.ts` and `main/index.ts`: remove database, VFS and embeddings wiring; `main/index.ts` exports the logger only.

### Task 3: Build and test pipeline

- [ ] `package.json`: scripts without `better-sqlite3` rebuilds; `npm uninstall better-sqlite3 sqlite-vss @types/better-sqlite3 node-html-parser`.
- [ ] `vite.base.config.ts`: drop the `better-sqlite3` external. `forge.config.ts`: drop the `schema.sql` extra resource.
- [ ] `e2e/fixtures/electronApp.ts` and `e2e/acceptance/*`: drop `OPAL_TEST_DB_DIR`; README loses the rebuild note.
- [ ] `src/tests/unit/ipcContract.test.ts`: empty the known-dead list, recount the floors, point the hint at `MetadataHandlers`.
- [ ] `appShell.test.tsx`, `workspaceSidebar.test.tsx`, `paneLayout.test.tsx`: fixtures and assertions without Notes.
- [ ] New `e2e/tests/boot.spec.ts`: the app launches and shows the workspace shell and Files surface (one test; the suite stays at eight).
- [ ] `CLAUDE.md`: stack, architecture, directory structure, commands and testing sections describe the files-only app.

### Task 4: Verify and commit

- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:e2e`; record counts; commit `refactor: remove the Notes feature and its SQLite storage`.
