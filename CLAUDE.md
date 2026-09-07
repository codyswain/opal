# Project: Opal

A desktop information workspace over folders on disk: browse files, edit
Markdown, organize items with tags, descriptions and connections, gather them
in Recent and saved views, and chat over the library.

## Stack

- **Runtime:** Electron 31 (main + preload + renderer processes)
- **Frontend:** React 18 + TypeScript + Tailwind CSS
- **State:** Zustand for global state, React hooks for local state
- **Editor:** TipTap with `tiptap-markdown` (Markdown files on disk)
- **Storage:** the user's folders are the store; authored metadata lives in
  frontmatter or `.opal.yaml` sidecars; personal state (activity, saved views,
  chat index) lives under `<userData>/library/` as JSON and YAML
- **AI:** OpenAI SDK for chat over the library (key in the system keychain)
- **Build:** Vite (3 configs: main, preload, renderer) + Electron Forge
- **Testing:** Vitest + Testing Library + Happy DOM
- **Linting:** ESLint with TypeScript plugin
- **Pre-commit:** Husky + lint-staged (ESLint fix + the full vitest suite)

## Architecture

- **IPC bridge:** Main <-> Preload <-> Renderer via context bridge
  - Exposed APIs: `systemAPI`, `credentialAPI`, `diskAPI`, `metadataAPI`,
    `activityAPI`, `collectionsAPI`, `viewsAPI`
- **Feature-based structure:** Self-contained modules under `src/renderer/features/`
  (`disk-explorer` is the Files feature; `shell` is the workspace frame)
- **Allowed roots:** `RootRegistry` in `src/main/fs` is the security boundary;
  every path that crosses IPC is resolved and checked against opened folders
- **Path alias:** `@/*` maps to `src/*`

## Directory Structure

```
src/
  main.ts              # Electron main process entry
  preload.ts           # IPC bridge
  renderer.tsx         # React entry point
  main/                # Main process
    fs/                # Roots, listings, watcher, metadata, file mutations
    activity/          # Personal activity behind Recent
    collections/       # Disposable index and query evaluation for views
    views/             # Saved view definitions on disk
    library/           # The <userData>/library layout
    services/          # Credentials, system
    window/            # Window state, navigation guard
  renderer/            # React renderer
    features/          # disk-explorer, shell, settings, theme, kbar, commands
    shared/            # Reusable components, hooks, utils, types
    store/             # Zustand stores
    styles/            # Global CSS
  types/               # Shared contracts (disk, metadata, activity, queries, views)
  common/              # Renderer-safe shared logic (validation, paths, formatting)
  tests/               # Vitest tests
e2e/                   # Playwright Electron suite and acceptance scripts
```

## Commands

- `npm run dev` — Start in dev mode (Electron Forge)
- `npm run lint` — Run ESLint
- `npm test` — Run unit and contract tests
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

- `npm test` — unit + contract (vitest).
- `npm run test:e2e` — builds the three Vite bundles, then Playwright.
- `npm run test:all` — both.
- `node e2e/acceptance/<name>-acceptance.mjs` — disposable acceptance runs against
  the built app; see `e2e/acceptance/README.md`.

### When a UI test fails

Traces and screenshots are captured on failure. Run
`npx playwright show-report` for a browsable DOM snapshot and timeline.

## Conventions

- Commit after completing each discrete task
- Don't ask for confirmation on file creation or refactors — just do it
- When creating new UI features, follow the feature-based structure under `src/renderer/features/`
- Filesystem work stays in main behind `RootRegistry`; the renderer never touches paths it has not been handed
- New IPC channels must be registered in `preload.ts`, exposed via the appropriate API namespace, validated in main, and typed under `src/renderer/shared/types/*.d.ts`
- Use Zustand for global state that spans components; use the prefs helpers for UI preferences
- Use TipTap extensions for editor enhancements
- Keep main process and renderer process code strictly separated
