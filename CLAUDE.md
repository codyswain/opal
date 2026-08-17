# Project: Opal

A desktop note-taking and file management app.

## Stack

- **Runtime:** Electron 31 (main + preload + renderer processes)
- **Frontend:** React 18 + TypeScript + Tailwind CSS
- **State:** Zustand for global state, React hooks for local state
- **Editor:** TipTap (rich text with Markdown)
- **Database:** Better-SQLite3 (synchronous, singleton `DatabaseManager`)
- **Embeddings:** SQLite VSS for vector search
- **AI:** OpenAI SDK for RAG/chat features
- **Build:** Vite (3 configs: main, preload, renderer) + Electron Forge
- **Testing:** Vitest + Testing Library + Happy DOM
- **Linting:** ESLint with TypeScript plugin
- **Pre-commit:** Husky + lint-staged (ESLint fix + tests on *.ts/*.tsx)

## Architecture

- **IPC bridge:** Main <-> Preload <-> Renderer via context bridge
  - Exposed APIs: `systemAPI`, `vfsAPI`, `chatAPI`, `credentialAPI`, `syncAPI`, `adminAPI`
- **Feature-based structure:** Self-contained modules under `src/renderer/features/`
- **Repository pattern:** Data access through `src/main/database/repositories/`
- **Service layer:** Business logic in `src/main/services/` (VFS, Credentials, System)
- **Path alias:** `@/*` maps to `src/*`

## Directory Structure

```
src/
  main.ts              # Electron main process entry
  preload.ts           # IPC bridge
  renderer.tsx         # React entry point
  main/                # Main process
    database/          # Schema, handlers, repositories, transforms
    embeddings/        # Vector search
    file-system/       # FS operations
    services/          # VFS, credentials, system
  renderer/            # React renderer
    features/          # Feature modules (file-explorer-v2, navbar, settings, theme, kbar, commands)
    shared/            # Reusable components, hooks, utils, types
    store/             # Zustand stores
    styles/            # Global CSS
  types/               # Shared types (IPC, credentials)
  common/              # Shared constants
  tests/               # Vitest tests
```

## Commands

- `npm run dev` — Start in dev mode (Electron Forge)
- `npm run lint` — Run ESLint
- `npm test` — Run tests (rebuilds better-sqlite3 first)
- `npm run test:watch` — Tests in watch mode
- `npm run test:coverage` — Tests with coverage report
- `npx tsc --noEmit` — Type check without emitting
- `npm run package` — Package the app
- `npm run make` — Build distributable

## Testing

**One rule: test at the cheapest tier that can actually fail.**

| Tier | Scope | Runs |
|---|---|---|
| Unit (vitest) | Anything not requiring a live Electron process | pre-commit + CI |
| Contract (vitest) | Cross-process agreements no single unit can verify | pre-commit + CI |
| E2E (Playwright) | Only what is impossible to verify any other way | CI + on demand |

Only five things genuinely require a real Electron process: the app boots,
`opal-file://` streams and decodes, CSP allows the custom scheme, IPC crosses
the process boundary, and the allowed-roots guard holds at the protocol layer.

**E2E budget: ≤10 tests, ≤60s.** Exceeding it means something is being tested at
the wrong tier. A component behaviour costs ~15ms as a unit test and ~4.5s
through Playwright — roughly 300× for identical confidence.

**Do not add visual regression tests.** Screenshot diffing is OS- and
font-dependent; its false failures destroy trust in the suite.

### Commands

- `npm test` — unit + contract. Rebuilds better-sqlite3 for **Node**.
- `npm run test:e2e` — Playwright. Rebuilds better-sqlite3 for **Electron**.
- `npm run test:all` — both, in the correct order.

Both commands rebuild the native module for the ABI they need, so they are safe
to run in any order. Use `npm test` rather than a bare `npx vitest run`, which
skips the rebuild and will fail confusingly after an E2E run.

### When a UI test fails

Traces, screenshots, and video are captured on failure. Run
`npx playwright show-report` for a browsable DOM snapshot and timeline.

## Conventions

- Commit after completing each discrete task
- Don't ask for confirmation on file creation or refactors — just do it
- When creating new UI features, follow the feature-based structure under `src/renderer/features/`
- New data access logic goes in a repository under `src/main/database/repositories/`
- New IPC channels must be registered in `preload.ts` and exposed via the appropriate API namespace
- Use Zustand for global state that spans components; use `useLocalStorage` hook for UI preferences
- Use TipTap extensions for editor enhancements
- Keep main process and renderer process code strictly separated
