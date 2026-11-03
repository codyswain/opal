# Project: Opal

A desktop app for reading and editing the Markdown pages in a folder on disk.
Pages come first. There is no chat and no Today screen: "Daily" opens a
stream of daily pages at the day's page (`Library/daily/YYYY-MM-DD.md`), the
earlier ones below it and pages made for later days above it, creating the
day's page from the vault's template when it does not exist. Activity logs
are separate, read-only files in `Library/logs/`. Until the cleanup commit,
Daily opens an existing `Inbox/Logs/YYYY-MM-DD.md` when the daily page does
not exist.

## Stack

- **Runtime:** Electron 31 (main + preload + renderer processes)
- **Frontend:** React 18 + TypeScript + Tailwind CSS
- **State:** Zustand for global state, React hooks for local state
- **Editor:** CodeMirror 6; the file's Markdown body is the document, so
  untouched bytes never change (`components/editor/` in `disk-explorer`)
- **Storage:** the user's folders are the store; authored metadata lives in
  frontmatter or `.opal.yaml` sidecars; personal state (activity)
  lives under `<userData>/library/` as JSON
- **Build:** Vite (3 configs: main, preload, renderer) + Electron Forge
- **Testing:** Vitest + Testing Library + Happy DOM
- **Linting:** ESLint with TypeScript plugin
- **Pre-commit:** Husky + lint-staged (ESLint fix + the full vitest suite)

## Architecture

- **Vault days:** `src/main/vault/` knows the vault layout. `VaultService`
  creates the daily page and ticks a digest's checkboxes
  (`vault:check-digest-item`, one line through the editor's write queue);
  `DayService` answers `vault:day` with a day's page,
  log, documents (the files its log links to), chats, recordings, people
  (person notes the log links to, and meeting speakers who have one) and
  digest, and sends `vault:day-changed`. The parsing
  is in `src/common/dayModel.ts`
- **IPC bridge:** Main <-> Preload <-> Renderer via context bridge
  - Exposed APIs: `systemAPI`, `credentialAPI`, `diskAPI`, `activityAPI`,
    `collectionsAPI`, `markdownAPI`, `vaultAPI`, `pinsAPI`
- **Pins:** each opened folder keeps its pinned files in `.opal/pins.json`
  (paths from the folder's top), so git syncs them across Macs. `PinsService`
  in `src/main/pins` reads and writes it (`pins:list`, `pins:set`, which
  keeps what the file gained or lost since the renderer read it);
  `pinsStore` in `disk-explorer` follows renames, moves and Move to Trash
  through `pathMutationCoordinator`, and `PinnedSection` shows the pins
  under the sidebar's nav
- **Feature-based structure:** Self-contained modules under `src/renderer/features/`
  (`disk-explorer` is the Files feature; `shell` is the workspace frame;
  `day-sidebar` is the right sidebar, one vault day beside the page)
- **Stacks:** a tab can show several Markdown files in one scroll, each its
  own editor that saves and merges on its own (`components/stack/`). The
  main process lists the files (`StackService`, `vault:stack`); `canonical()`
  in the tabs store decides by path which opens become stacks. Three kinds:
  the stream of daily pages, a recording (the summary file, then
  `transcripts/<stem> transcript.md`) and a chat (the thread card, then its
  sessions, newest first). Sections near the view have a live editor and the
  rest are placeholders
- **Main area:** each tab shows one file, a stack or Recent. Markdown opens in the
  editor; other files open in a minimal viewer (`FileViewer`: images, PDFs,
  plain text, otherwise "Open in default app"). There is no folder view:
  folders are browsed in the sidebar tree, which also holds the file actions.
  The tree shows `Library/daily` by year ("2026", then "10-30 Fri"); the
  year rows are not folders on disk (`src/common/dailyTree.ts`)
  A page's footer line ("N properties · N words") toggles a read-only
  properties block under the title: the frontmatter, then the file's path,
  times and size from `markdown:properties`
- **Links in:** `opal://open?path=<path>` (relative to the vault, or
  absolute) opens that file in a new tab, or switches to the tab showing it.
  macOS hands the link to `open-url`; `OpalLinks` in `src/main/protocol`
  checks it against the allowed roots and holds it until the renderer's
  `PageLinks` listens. The scheme is declared in `packagerConfig.protocols`,
  so only a packaged build receives links
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
    collections/       # Disposable index of file names behind the palette's file search
    library/           # The <userData>/library layout
    services/          # Credentials, system
    window/            # Window state, navigation guard
  renderer/            # React renderer
    features/          # disk-explorer, shell, day-sidebar, settings, theme, commands
    shared/            # Reusable components, hooks, utils, types
    store/             # Zustand stores
    styles/            # Global CSS
  types/               # Shared contracts (disk, metadata, activity, queries)
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
- Editor features are CodeMirror extensions that keep the text as written;
  never re-serialize a note
- Keep main process and renderer process code strictly separated
