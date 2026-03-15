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

## Conventions

- Commit after completing each discrete task
- Don't ask for confirmation on file creation or refactors — just do it
- When creating new UI features, follow the feature-based structure under `src/renderer/features/`
- New data access logic goes in a repository under `src/main/database/repositories/`
- New IPC channels must be registered in `preload.ts` and exposed via the appropriate API namespace
- Use Zustand for global state that spans components; use `useLocalStorage` hook for UI preferences
- Use TipTap extensions for editor enhancements
- Keep main process and renderer process code strictly separated
