# Core UX: Browse and Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make multimodal folder browsing, explicit file opening, and returning to context behave coherently before adding properties and associations.

**Architecture:** React Router owns browse/focus locations. Existing Zustand stores own selection and opened files, with non-routing snapshots preserving collection context. Reuse the path mutation coordinator and existing file viewers.

**Tech Stack:** Electron, React 18, TypeScript, Zustand, React Router 6, react-window, Vitest/Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-05-core-information-workspace-design.md`

## Global Constraints

- A folder is the first collection; every supported file modality is an item.
- Selection and scrolling must not push or replace route entries.
- Explicit file opens create real tabs; peeking does not create tabs.
- React Router is the navigation authority; do not add another history stack.
- Reuse existing preview renderers and guarded diskAPI access.
- No visual regression tests. Existing Electron E2E budget remains ≤10 tests, ≤60s.
- Preserve existing authored data. This slice makes no metadata or legacy-note storage changes.
- Run npm test rather than bare vitest to rebuild the native module for Node.
- Record baseline TypeScript/lint failures and introduce none.

## Product roadmap

1. Complete this browse/resume slice.
2. Plan and implement disk-backed properties, folder views, and bidirectional
   presentation of an authored "related to" connection. Resolve durable identity
   and move/rename semantics before writes. Reuse this slice's focus navigation.
3. Add disk-backed note creation/editing and references; verified legacy export.
4. Add content retrieval, cross-folder saved collections and richer associations.

Only milestone 1 is executed by this plan. Each later milestone is a separately
reviewable subsystem, not an implicit obligation to implement a complete Notion
replacement in this change.

## File responsibilities

- `components/FilesRoute.tsx`: URL bootstrap, route application, location changes
  and non-routing snapshot lifecycle.
- `navigation/FilesNavigationContext.tsx` (new if needed): shared browse/open/return
  actions; explicit route intents instead of implicit selection effects.
- `components/DiskExplorer.tsx`: current-directory browse surface, selected-item
  peek, explicit focused main surface, guarded keyboard actions and stat fallback.
- `components/DiskFolderView.tsx`: selection, activation, and virtualized scroll
  capture/restoration; list/gallery viewport semantics.
- `components/Breadcrumb.tsx`, `DiskTreeItem.tsx`, shell `DirectoryTree.tsx`:
  directory navigation via the same route contract.
- `components/TabStrip.tsx`, `store/tabsStore.ts`: real tabs and explicit activation;
  remove preview-tab production behavior.
- `store/diskStore.ts`, `store/diskPathState.ts`: directory independent of selection;
  preserve existing mutation/removal invariants.
- `navigation/filesLocationSnapshots.ts`: extend only if needed for restored view
  configuration; do not duplicate route state.
- `src/tests/unit/filesNavigation.test.tsx`: new end-to-end-in-React interaction
  coverage using a real MemoryRouter and stores, with mocked disk IPC only.
- Existing unit tests: update assertions only where the approved interaction
  contract intentionally changes behavior.

Paths above are relative to `src/renderer/features/disk-explorer/` except where
the shell or test path is stated explicitly.

## Task 1: Deliver the complete browse/open/return interaction

**Files:** Files listed above, plus directly affected unit tests and small focused
helpers needed to keep route logic out of presentation components.

**Interfaces consumed:**

```ts
type FilesLocation =
  | { mode: 'browse'; directory: string }
  | { mode: 'focus'; directory: string; file: string };
// Existing helpers from navigation/filesLocation.ts:
// browseFiles(directory, history?), focusFile(directory, file, history?),
// serializeFilesLocation(location), resolveFilesLocation(search, roots)
// Existing snapshots: capture(location, snapshot), read(location), patch(...)
// Existing mutation coordinator: register(participant)
```

**Behavior produced:** route-backed `navigateDirectory(path)` and `openFile(path)`
actions (through a new context or equivalent existing shell adapter); explicit
return-to-folder; stores remain usable without Router. Use existing signatures
for public stores unless retiring a deprecated preview adapter and its consumers.

- [ ] Record current npm test, npx tsc --noEmit and npm run lint results before code.
- [ ] Add failing component regressions in `filesNavigation.test.tsx` using this
  fixture shape and real router/store integration:

```tsx
const ROOT = '/Vault';
const FOLDER = '/Vault/References';
const NOTE = '/Vault/brief.md';
const fixtures = {
  [ROOT]: [
    entry({ path: FOLDER, name: 'References', kind: 'directory', isDirectory: true }),
    entry({ path: NOTE, name: 'brief.md', kind: 'markdown' }),
  ],
  [FOLDER]: [],
};
// installDiskApi({ listRoots: ..., readDirectory: ... }) from tests/helpers/diskApi.
// Render FilesRoute inside MemoryRouter with a location output and real
// navigate(-1)/navigate(1) buttons, as in filesRoute.test.tsx.
// After a single click on the References collection item:
expect(useDiskStore.getState().currentDirectory).toBe(ROOT);
expect(useDiskStore.getState().selectedPaths).toEqual([FOLDER]);
expect(useTabsStore.getState().openPaths).toEqual([]);
// After explicit open and Back:
expect(useDiskStore.getState().currentDirectory).toBe(ROOT);
expect(useDiskStore.getState().selectedPaths).toEqual([FOLDER]);
```

- [ ] Run `npm test -- src/tests/unit/filesNavigation.test.tsx` and record the
  missing-behavior failures. Add separate cases for single-click file peek with
  no tabs, multi-folder selection, double-click and Cmd+Down open, Space preview,
  Return rename, breadcrumb navigation, focused-tab activation/close, and Back.
- [ ] Make `currentDirectory` the only browse-directory source. Remove
  directory-from-selection behavior and the selection-driven openPreview effect.
  Collection click selects folders as well as files; explicit activation calls
  browse/open actions. Render focused file in the main surface using DetailPane.

```ts
// Required event distinction; use actual shared action names from implementation.
function activate(entry: DiskEntry) {
  if (entry.isDirectory) navigateDirectory(entry.path);
  else openFile(entry.path);
}
// Selection remains useDiskStore.getState().select(entry.path).
```

- [ ] Connect sidebar/breadcrumb/tab/open/return actions to URL intents. Apply
  POP location changes without issuing another PUSH. Capture departure snapshot
  before clearing selection and restore destination snapshot after listing load.
  Keep route and snapshot responsibilities explicit to avoid subscription loops.
- [ ] Add and run failing list/gallery restoration tests, then connect react-window
  `onScroll` and `initialScrollOffset`/`initialScrollTop` or controlled ref restoration.
  Test an actual offset through a navigation round trip; a snapshot-map assertion
  alone is insufficient. Prevent mount scroll-to-selection from clobbering it.

```ts
// Persisted in the existing non-routing snapshot API:
filesLocationSnapshots.patch({ mode: 'browse', directory: ROOT }, {
  scroll: { view: 'details', offset: 480 },
});
// The integration test must additionally observe the restored viewport offset.
```

- [ ] Add failing mutation and async cases, then integrate route remap/removal:
  app rename and subtree move replace the live URL; external removal and closed
  roots clear stale views; rapid focus A→B ignores A's delayed stat response;
  unavailable focused file never displays a different selected file's content.
- [ ] Remove deprecated preview-tab production consumers. Transitional selection
  mirrors may remain if removing them is unrelated mechanical scope; document
  any remaining adapters accurately rather than claiming old Task 7 complete.
- [ ] Guard all relevant shortcuts from text input, contenteditable, menus,
  dialogs, independent buttons and handled events. Keep typeahead working.
- [ ] Run focused tests for files navigation, route, disk store/path state,
  tabs, folder view, breadcrumbs, multi-selection, keyboard and shell behavior.
  Preserve tests for unrelated file operations and existing modality renderers.
- [ ] Commit the slice with `feat(files): make browsing and returning preserve context`.
- [ ] Independent review checks spec compliance and code quality; fix concrete
  regressions with failing tests before rerunning relevant checks.

## Completion checks

- [ ] `npm test` passes, or any reproduced baseline-only failure is documented.
- [ ] `npx tsc --noEmit` and `npm run lint` introduce no failures beyond baseline.
- [ ] `npm run test:e2e` passes using existing tests; native ABI rebuilds run serially.
- [ ] Review a temporary-data Electron launch if available; clearly distinguish
  automated checks from any manual checks that could not be performed.
- [ ] Record delivered behavior, tests and deferred roadmap in a verification note.

## Plan self-review

The single implementation task spans route and collection components deliberately:
changing selection without route continuity is not an independently usable result.
It consumes existing pure location/snapshot/mutation interfaces and tests the DOM
integration those utilities previously lacked. No new storage/association writes
are hidden in this scope. Minimal focus rendering is included because explicit
open otherwise has no distinct user-visible destination.
