# Saved Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist named views as human-readable YAML under the library directory with atomic writes, revisions and conflict detection; surface them in the sidebar; and give saved views a draft model with Save changes, Save as new, Reset, rename, duplicate and remove with undo.

**Architecture:** Main gains `ViewRepository` (files, order, trash, watcher) and `ViewHandlers`. The renderer generalizes the slice 2 draft store into `viewDraftsStore` with a saved baseline, adds `savedViewsStore` for the listing, adds `{ kind: 'view'; id }` to `FilesCollection`, and extends `QueryView` with the view actions. `CollectionView` accepts a controlled layout so a view's layout is part of its definition.

**Tech Stack:** as before, plus the `yaml` package already used for item metadata.

**Spec:** `docs/superpowers/specs/2026-09-06-saved-views-design.md`

## Global Constraints

- Same worktree, branch, baselines and hook rules as the filtered-collections plan. Baseline now: 850 tests in 82 files; 13 TypeScript errors; 15 lint warnings; 9 E2E tests.
- View files hold definitions only; never results, selection, scroll or activity. Never write into opened roots.
- Every save carries an expected revision; main never overwrites a changed file.
- Commit after each task with the usual trailer.

---

### Task 1: `ViewRepository`

**Files:** create `src/types/savedView.ts`, `src/main/views/ViewRepository.ts`; modify `src/main/library/libraryPaths.ts` (`viewsDirectory`, `libraryPreferencesPath`); test `src/tests/unit/views/viewRepository.test.ts`.

**Produces:**

```ts
type ViewLayout = 'list' | 'gallery';
interface SavedViewDefinition { name: string; query: CollectionQuery; layout: ViewLayout }
interface SavedView extends SavedViewDefinition { id: string; revision: string; file: string }
interface SavedViewsListing { views: SavedView[]; unreadable: { file: string; error: string }[] }
class ViewConflictError extends Error
class ViewRepository {
  constructor(deps: { libraryDirectory: string; onChanged?: () => void; changeDebounceMs?: number; now?: () => number });
  list(): Promise<SavedViewsListing>;           // in stored order, unknown ids appended by file name
  create(definition: SavedViewDefinition): Promise<SavedView>;
  save(id: string, definition: SavedViewDefinition, expectedRevision: string): Promise<SavedView>;
  duplicate(id: string): Promise<SavedView>;     // "<name> copy"
  remove(id: string): Promise<{ undoToken: string }>;
  restore(undoToken: string): Promise<SavedView>;
  watch(): Promise<void>; close(): Promise<void>;
}
```

- [ ] Tests: create writes a readable YAML file and appends order; list round-trips and reports a malformed file, a wrong-schema file and an id/file mismatch as unreadable while keeping them on disk; save with the right revision rewrites atomically and changes the revision; save with a stale revision throws `ViewConflictError` and leaves the file untouched; duplicate copies the definition under a new id; remove moves to `.trash/` and restore brings it back with the same id; trash is bounded; watcher reports an external write (poll, bounded retry).
- [ ] Implement with `yaml`'s `stringify`/`parse`, SHA-256 revisions, temp-file-plus-rename writes, and `library.json` for order. Commit `feat(views): add the saved view repository`.

### Task 2: IPC and bridge

**Files:** create `src/main/views/ViewHandlers.ts`, `src/renderer/shared/types/viewsApi.d.ts`, `src/tests/helpers/viewsApi.ts`; modify `src/preload.ts`, `src/main.ts`; test `src/tests/unit/views/viewHandlers.test.ts`.

- [ ] Channels from the spec; conflict responses carry `conflict: true`; ids must be UUIDs; names trimmed to 1..120 characters. Main wiring: repository under `libraryDirectory(userDataDir)`, `watch()` after load, `views:changed` on change, `close()` on quit. IPC contract test passes. Commit `feat(views): expose saved views over IPC`.

### Task 3: Navigation, stores and controlled layout

**Files:** modify `filesLocation.ts` (`{ kind: 'view'; id }`, `viewCollection(id)`, `isKnownView` option), `CollectionView.tsx` (`mode`/`onModeChange` props), rename `queryDraftsStore.ts` to `viewDraftsStore.ts` with the baseline model, create `savedViewsStore.ts`; tests `filesLocation.test.ts`, `queryStores.test.ts` (extend).

- [ ] `viewDraftsStore`: `createTransient`, `openSaved(view)`, `update(id, patch: Partial<{ name; query; layout }>)`, `markSaved(id, view)`, `reset(id)`, `remove(id)`, `isEdited(draft)`. `savedViewsStore`: `views`, `order`, `unreadable`, `load()`, `has(id)`. `FilesRoute` resolves views through `savedViewsStore.has`, opens the draft with `openSaved` before loading results, and treats views like queries for `collectionForFile`.
- [ ] Commit `feat(files): add view collections and drafts with a saved baseline`.

### Task 4: View actions in `QueryView` and the sidebar

**Files:** modify `QueryView.tsx`, create `components/query/ViewActions.tsx`, `components/query/NameViewDialog.tsx`; modify `WorkspaceSidebar.tsx`; tests `queryView.test.tsx`, `workspaceSidebar.test.tsx`.

- [ ] Header: inline name input (blur or Enter commits to the draft), Edited badge, actions per spec, conflict banner with Reload from disk and Save as new, Remove with confirmation and an Undo toast (sonner) for ten seconds. Layout toggle edits the draft. Sidebar lists saved views then transient drafts; unreadable files are disabled rows.
- [ ] Tests: save a transient draft as a view and land on it; edited badge and Reset; Save changes success; conflict path shows both recoveries and Save as new produces a second view; duplicate; remove and undo; sidebar lists and activates; restart-shaped reload keeps definitions.
- [ ] Commit `feat(files): save, edit and manage views`.

### Task 5: Verification

- [ ] `npm test`, type count 13, lint 15 warnings, E2E 9 passing.
- [ ] Disposable acceptance: save a view from a filtered draft, restart, confirm name/scope/filters/sort/layout; edit the YAML externally while a draft exists, Save changes reports the conflict and both states survive; delete a view leaves files and metadata intact; undo restores it.
- [ ] Write `docs/superpowers/plans/2026-09-06-saved-views-verification.md`, commit.
