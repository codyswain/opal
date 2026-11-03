# Filtered Collections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship transient filtered collections: a validated query model, a disposable main-process index with targeted watcher updates, a pure evaluator, paged IPC, and a query surface with scope, chips and sort that keeps Open/Back continuity.

**Architecture:** Main owns `CollectionIndex` (summaries built through the traversal shared with `MetadataCatalog`), `evaluateCollectionQuery` (pure) and `CollectionQueryService` (validation, scope resolution, activity join, paging). The renderer keeps session drafts in `queryDraftsStore`, results in `collectionQueryStore`, adds `{ kind: 'query'; id }` to `FilesCollection`, and renders `QueryView` over the existing `CollectionView`.

**Tech Stack:** Electron 31, TypeScript, React 18, Zustand, react-window, Radix primitives already wrapped in `src/renderer/shared/ui`, Vitest + Testing Library, real temp directories for main tests.

**Spec:** `docs/superpowers/specs/2026-09-06-filtered-collections-design.md`

## Global Constraints

- Worktree `/Users/codyswain/code/opal/.worktrees/core-ux`, branch `codex/core-ux`; no merge, push, or restart of the user's app.
- Baseline after slice 1: 778 tests in 76 files; 13 pre-existing TypeScript errors; 15 lint warnings, 0 errors. No new errors or warnings.
- `npm test` for unit/contract; never alongside a commit or E2E. Pre-commit runs the full suite; retry once on a pre-existing timing flake.
- No scan on folder browsing, Details, or Recent. The index builds on the first collection query only.
- Main validates every query with the shared validator; the renderer never sends an unvalidated draft.
- E2E stays at nine tests. Commit after each task with the `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer.

---

## File map

| File | Responsibility |
|---|---|
| `src/types/collectionQuery.ts` (create) | Query, row and result contracts |
| `src/common/collectionQuery.ts` (create) | `validateCollectionQuery`, `emptyQuery`, `DURATION_PRESETS`, `startOfLocalDay`, `dayBoundary` |
| `src/main/fs/rootTraversal.ts` (create) | `scanRootsFor(roots)` and `walkRoot(registry, root, visitor)` shared by catalog and index |
| `src/main/fs/MetadataCatalog.ts` (modify) | Use the shared traversal |
| `src/main/collections/CollectionIndex.ts` (create) | Summaries, lazy build, targeted updates, generation |
| `src/main/collections/evaluateQuery.ts` (create) | Pure predicates, scope, sort |
| `src/main/collections/CollectionQueryService.ts` (create) | Validate, resolve scope, join activity, page |
| `src/main/collections/CollectionHandlers.ts` (create) | `collections:query` |
| `src/main.ts`, `src/preload.ts` (modify) | Wiring, `collectionsAPI`, watcher → index, change event |
| `src/renderer/shared/types/collectionsApi.d.ts`, `src/tests/helpers/collectionsApi.ts` (create) | Typing and fake |
| `navigation/filesLocation.ts` (modify) | `{ kind: 'query'; id }` |
| `store/diskStore.ts` (modify) | `navigateToCollection` |
| `store/queryDraftsStore.ts`, `store/collectionQueryStore.ts` (create) | Session drafts; results with debounce and paging |
| `components/query/QueryView.tsx`, `ScopeControl.tsx`, `FilterChips.tsx`, `SortControl.tsx` (create) | Surface |
| `components/DiskExplorer.tsx`, `FilesRoute.tsx`, `Toolbar.tsx` (modify) | Render, apply, "Filter this folder" |
| `shell/components/WorkspaceSidebar.tsx` (modify) | Views section with New view |

---

### Task 1: Query contracts and validation

**Files:** create `src/types/collectionQuery.ts`, `src/common/collectionQuery.ts`; test `src/tests/unit/collections/collectionQuery.test.ts`.

**Produces:** the types from the spec plus `CollectionRow`, `CollectionQueryResult`, `CollectionPage { offset; limit }`, `COLLECTION_PAGE_DEFAULT = 200`, `COLLECTION_PAGE_MAX = 1000`; `validateCollectionQuery(value: unknown): CollectionQuery` (throws `CollectionQueryError` with a plain message; returns a normalized copy with trimmed name values, blank tags dropped, folders normalized with `normalizeFsPath` and deduplicated); `emptyQuery(scope?)`; `DURATION_PRESETS` (`1h`, `24h`, `7d`, `30d`, `90d` in ms); `startOfLocalDay(dayIso: 'YYYY-MM-DD'): number`; `dayBoundary(op: 'before' | 'after', dayIso): number`; `describeFilter(filter): string` for chip summaries and tests.

- [ ] Tests: accepts the spec example (`kind in [pdf, image]` and `tags has-any [research, reference]`); rejects unknown fields/ops, >16 filters, regex-looking name is still accepted as literal, empty tag list for has-any, 33 tags, unknown kinds, non-finite `at`, duration outside bounds, >32 folders, relative folders; normalizes case of nothing (tags keep case); `dayBoundary('before','2026-09-06')` equals local midnight and `'after'` equals the next midnight; `describeFilter` renders "Kind is one of PDF, Image".
- [ ] Implement, run `npx vitest run src/tests/unit/collections`, commit `feat(collections): add query contracts and validation`.

### Task 2: Shared traversal

**Files:** create `src/main/fs/rootTraversal.ts`; modify `src/main/fs/MetadataCatalog.ts`; test `src/tests/unit/fs/rootTraversal.test.ts`.

**Produces:**

```ts
export function scanRootsFor(roots: readonly string[]): string[]; // hidden-aware overlap dedupe, moved from MetadataCatalog
export interface TraversalVisitor {
  onDirectory(path: string): Promise<void> | void;
  onFile(path: string): Promise<void> | void;   // never called for valid adjacent carriers
  onError(path: string, error: unknown): void;
}
export async function walkRoot(registry: RootRegistry, root: string, visitor: TraversalVisitor): Promise<void>;
export async function listChildren(registry: RootRegistry, directory: string): Promise<{ directories: string[]; files: string[] }>; // same rules, one level
```

- [ ] Tests with temp dirs: skips hidden entries and symlinks, folds valid carriers but reports colliding ones as files, reports errors without aborting, `scanRootsFor` keeps an explicitly opened hidden descendant.
- [ ] Refactor `MetadataCatalog.get` to use `scanRootsFor` and `walkRoot`; existing `metadataService.test.ts` stays green. Commit `refactor(fs): share root traversal between catalog and index`.

### Task 3: CollectionIndex

**Files:** create `src/main/collections/CollectionIndex.ts`; test `src/tests/unit/collections/collectionIndex.test.ts`.

**Produces:**

```ts
export type IndexState = 'idle' | 'building' | 'ready';
export interface IndexedItem { path; name; kind; isDirectory; size; mtimeMs; id; tags; descriptionEmpty; metadataWarning }
export interface IndexSnapshot { items: readonly IndexedItem[]; generation: number; warnings: string[]; complete: boolean }
export class CollectionIndex {
  constructor(deps: { registry: RootRegistry; onChanged?: () => void; changeDebounceMs?: number });
  state(): IndexState;
  get(): Promise<IndexSnapshot>;                 // builds when idle or roots changed; awaits an in-flight build
  invalidateDirectories(directories: string[]): void; // targeted update, coalesced, serialized after any build
  invalidateAll(): void;
}
```

- [ ] Tests: builds summaries with tags/description/id from Markdown, sidecar and directory carriers; unreadable metadata yields nulls plus a warning and `complete` stays true; a changed directory re-summarizes children, drops vanished ones with subtrees, and walks a new subdirectory; a renamed folder moves its subtree; a removed root drops its items and a new root adds them; `onChanged` fires once per coalesced update; `state()` transitions; `get()` during a build returns the finished build.
- [ ] Implement, run, commit `feat(collections): add disposable collection index with targeted updates`.

### Task 4: Evaluator

**Files:** create `src/main/collections/evaluateQuery.ts`; test `src/tests/unit/collections/evaluateQuery.test.ts`.

**Produces:**

```ts
export interface EvaluationInput {
  items: readonly IndexedItem[];
  activity: (path: string) => ActivityRecord | null;
  touchedOf: (record: ActivityRecord) => { at: number; kind: ActivityKind };
  allowedRoots: readonly string[];
  query: CollectionQuery;
  now: number;
}
export interface Evaluation { rows: CollectionRow[]; excludedUnknown: number }
export function evaluateCollectionQuery(input: EvaluationInput): Evaluation;
```

- [ ] Tests: scope all-roots vs folders with and without descendants (direct children only when off; the folder itself is not a row); items outside allowed roots never appear; each predicate positive and negative; blank tags ignored; whitespace description empty; `within` trailing window uses `now`; `before`/`after` boundaries; `never`; unknown tags excluded only for tag predicates and counted; conjunction; sorting per field both directions with missing last and name/path tie-break; folders not forced first.
- [ ] Implement, run, commit `feat(collections): evaluate collection queries`.

### Task 5: Service, IPC, wiring

**Files:** create `CollectionQueryService.ts`, `CollectionHandlers.ts`, `collectionsApi.d.ts`, `src/tests/helpers/collectionsApi.ts`; modify `src/main.ts`, `src/preload.ts`; tests `collectionQueryService.test.ts`, `collectionHandlers.test.ts`.

**Produces:** `CollectionQueryService.query(query: unknown, page?: unknown): Promise<CollectionQueryResult>` (validates both; page limit clamped to `[1, 1000]`, offset ≥ 0); `collections:query`; `collections:changed` (index or activity change, coalesced 150 ms); `window.collectionsAPI { query(query, page?): Promise<DiskResult<CollectionQueryResult>>; onChanged(cb): () => void }`; `installCollectionsApi`, `collectionRow`, `collectionResult` helpers.

- [ ] Tests: unavailable scope reports the folder and returns no rows without widening; all-roots uses the registry; paging offset/limit/total; incomplete and warnings pass through; index state reported; handler rejects invalid query/page and hides internal failures.
- [ ] Wire in `main.ts`: `collectionIndex` fed by `diskWatcher.onChanged` (call `invalidateDirectories` before sending `disk:changed`) and root add/remove through `DiskHandlers` (`invalidateAll` after `registry.add`/`remove` — add optional `onRootsChanged` to `DiskHandlerDependencies`); `activityService.onChanged` also triggers `collections:changed`. Run the fs handler tests and the IPC contract test. Commit `feat(collections): expose paged collection queries over IPC`.

### Task 6: Navigation and stores

**Files:** modify `filesLocation.ts`, `diskStore.ts`, `diskPathState.ts`, `FilesRoute.tsx` (compile-level); create `queryDraftsStore.ts`, `collectionQueryStore.ts`; tests `filesLocation.test.ts` (extend), `queryStores.test.ts`.

**Produces:** `{ kind: 'query'; id: string }` with `collection=query&id=…` (id: `[A-Za-z0-9_-]{1,64}`); `queryCollection(id)`; `diskStore.navigateToCollection(collection)` (Recent and query set `currentDirectory: null`); `useQueryDraftsStore { drafts; create(initial?: Partial<CollectionQuery>, origin?: string): string; update(id, patch); remove(id); get(id) }`; `useCollectionQueryStore { results: Record<id, QueryResultState>; load(id, query, { append?, immediate? }); reset(id) }` where `QueryResultState { rows; total; incomplete; warnings; indexState; unavailableScopes; loading; error }`.

- [ ] Tests: URL round trip and rejection of bad ids; draft create/update/remove; load debounces two rapid edits into one request, discards stale, appends pages, keeps last rows on error.
- [ ] Implement, run navigation + store suites, commit `feat(files): add query collections and session drafts`.

### Task 7: QueryView surface and route integration

**Files:** create `components/query/QueryView.tsx`, `ScopeControl.tsx`, `FilterChips.tsx`, `SortControl.tsx`; modify `DiskExplorer.tsx`, `FilesRoute.tsx`; test `src/tests/unit/queryView.test.tsx`.

- [ ] `FilesRoute` applies a query collection: `navigateToCollection`, `collectionQueryStore.load(id, draft.query, { immediate: true })`, visible paths from rows; an unknown draft id resolves to the first root (treat like an invalid location in `resolveFilesLocation` by passing a `knownQueryIds` predicate). `collectionForFile` returns the query collection unchanged.
- [ ] `DiskExplorer` renders `QueryView` when the collection is a query; `visibleEntries`/`selectedEntry` include query rows.
- [ ] `QueryView`: scope control (all roots vs chosen among roots + origin folder, include-subfolders switch), chips with add menu and per-field controls, "Match all filters", Clear filters, sort select and direction, results via `CollectionView` decorated with parent folder and sort detail, Load more, and the five states from the spec. All form controls carry `data-disk-shortcuts-ignore`.
- [ ] Tests: adding a kind chip and a tags chip sends one validated query after debounce; rows render with folder and detail; unavailable scope banner; load more appends; building label; no-match state clears filters; open a row, Return and Back restore the draft with selection and the same chips; typing in a chip input does not trigger rename.
- [ ] Commit `feat(files): add the filtered collection surface`.

### Task 8: Entry points

**Files:** modify `WorkspaceSidebar.tsx`, `Toolbar.tsx`; tests `workspaceSidebar.test.tsx`, `toolbar.test.tsx` (extend).

- [ ] Sidebar: a "Views" section listing session drafts as "Untitled view" (active when current) with a "New view" action that creates an all-roots draft and navigates. Toolbar: "Filter this folder" creates a draft scoped to the folder with descendants and navigates; the scope control shows the folder checked with subfolders on.
- [ ] Tests for both entry points, commit `feat(files): add view entry points`.

### Task 9: Verification

- [ ] `npm test`, `npx tsc --noEmit | grep -c "error TS"` = 13, `npm run lint` = 15 warnings, `npm run test:e2e` = 9 passing.
- [ ] Disposable acceptance extending the slice 1 script: create a view scoped to two folders with PDF-or-image and a tag filter over overlapping roots (criterion 4, once per item), change filters, open a result and Back (criterion 6), watcher add/remove updates results (criterion 8), invalid carrier does not match untagged and results are labeled incomplete (criterion 9), closed root reports unavailable scope (criterion 10).
- [ ] Write `docs/superpowers/plans/2026-09-06-filtered-collections-verification.md`, commit.
