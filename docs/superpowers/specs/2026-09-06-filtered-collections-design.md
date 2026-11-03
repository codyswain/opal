# Filtered collections (saved views slice 2)

Date: 2026-09-06
Status: Design for the second vertical slice of `docs/superpowers/specs/2026-09-06-recent-and-saved-views-handoff.md`, building on `2026-09-06-recent-activity-design.md`. The handoff remains the product authority; this document fixes the query model, the index, and the slice boundary. Definitions stay transient in this slice; slice 3 persists them.

## Goal

Someone opens a folder or Recent, narrows it with readable filter chips, changes sort and layout, opens an item, and comes back to the same narrowed collection. The query is a structured value validated in main; results are pages of existing `DiskEntry` rows rendered through `CollectionView`. Ordinary folder browsing never triggers a scan.

## Query model

`src/types/collectionQuery.ts` (types) and `src/common/collectionQuery.ts` (renderer-safe validation and time helpers, reused by main):

```ts
type CollectionSortField = 'touched' | 'opened' | 'modified' | 'name';
interface CollectionSort { field: CollectionSortField; direction: 'asc' | 'desc' }
type CollectionScope =
  | { kind: 'all-roots' }
  | { kind: 'folders'; folders: string[]; includeDescendants: boolean };
type CollectionFilter =
  | { field: 'name'; op: 'contains' | 'not-contains'; value: string }
  | { field: 'kind'; op: 'in' | 'not-in'; values: FileKind[] }
  | { field: 'tags'; op: 'has-any' | 'has-all' | 'has-none'; values: string[] }
  | { field: 'tags'; op: 'is-empty' }
  | { field: 'description'; op: 'is-empty' | 'is-not-empty' }
  | { field: 'touched' | 'opened'; op: 'within'; durationMs: number }
  | { field: 'touched' | 'opened'; op: 'before' | 'after'; at: number }
  | { field: 'touched' | 'opened'; op: 'never' }
  | { field: 'modified'; op: 'within'; durationMs: number }
  | { field: 'modified'; op: 'before' | 'after'; at: number };
interface CollectionQuery { version: 1; scope: CollectionScope; filters: CollectionFilter[]; sort: CollectionSort }
```

Semantics, per the handoff:

- Every chip must match (conjunction). Multi-value operations are OR inside one chip. The UI labels this "Match all filters" and offers no "Match any".
- Name is a case-insensitive literal substring; never a regular expression.
- Kind uses the existing `FileKind` values; `directory` is the folder kind.
- Tags compare exact, case-sensitive strings. Blank tags are ignored, so an item whose only tags are blank is empty for `is-empty`. Filtering never rewrites stored tags.
- Description `is-empty` treats whitespace-only as empty.
- `within` is a trailing interval measured from evaluation time; "past 7 days" is 168 hours. `before` is `at < value`; `after` is `at >= value`. The UI converts a chosen local calendar day to `startOfLocalDay(day)` for `before` and `startOfLocalDay(day + 1)` for `after`, giving exclusive end boundaries.
- `touched` and `opened` come from Opal activity; `modified` is filesystem mtime. `never` matches items with no activity of that kind.
- Sorting: the chosen field, then case-insensitive name, then path. Missing timestamps sort last in both directions. Folders are not forced first.

Validation limits: at most 16 filters; name value at most 256 characters; at most 32 tag values of at most 64 characters; at most 32 scope folders; durations between one minute and ten years; `at` a finite epoch millisecond. Invalid queries are rejected by main with a plain error and never partially applied.

### Unknown values

An item whose metadata could not be read has `tags: null` and `descriptionEmpty: null`. Predicates on those fields exclude such items and the result reports `incomplete: true` with a count in `warnings`. Predicates on name, kind, modified, touched and opened never depend on metadata, so a name-only query includes the item and still carries the warning that its metadata is unreadable. Counts are labeled incomplete whenever any item was excluded.

## Index

`src/main/collections/CollectionIndex.ts` keeps disposable summaries for every item under the opened roots:

```ts
interface IndexedItem {
  path: string; name: string; kind: FileKind; isDirectory: boolean; size: number; mtimeMs: number;
  id: string | null; tags: string[] | null; descriptionEmpty: boolean | null; metadataWarning: string | null;
}
```

- Built lazily on the first query, never on folder browsing or Details. Uses the shared traversal extracted from `MetadataCatalog` into `src/main/fs/rootTraversal.ts`, so both scanners share one set of rules: hidden entries and symlinks skipped, valid adjacent carriers folded, overlapping roots deduplicated with the hidden-ancestor exception.
- Each item is summarized with `stat` plus the bounded single-item `readMetadata`; unreadable metadata records a warning and leaves the metadata fields null. No document bodies or media bytes are read.
- The watcher's changed-directory batches drive targeted updates: each changed directory is re-listed, its children re-summarized, vanished children removed with their subtrees, and new child directories walked. A vanished changed directory is removed with its subtree. Root additions and removals rebuild. Updates are coalesced and serialized; a query during a rebuild waits for it.
- A generation counter identifies snapshots; `state()` reports `idle`, `building` or `ready` so the renderer can label partial results and show progress.

The index is cache class data: deleting it loses nothing. It is not persisted in this slice.

## Query evaluation and service

`src/main/collections/evaluateQuery.ts` is pure: items, an activity lookup, allowed roots, the query and `now` in; rows, total and excluded-unknown count out. `CollectionQueryService.query(query, page)` validates the query, resolves scope through `RootRegistry`, joins the in-memory `ActivityStore`, evaluates, and returns one page:

```ts
interface CollectionRow {
  entry: DiskEntry; tags: string[] | null; descriptionEmpty: boolean | null;
  touchedAt: number | null; touchedKind: ActivityKind | null; openedAt: number | null;
}
interface CollectionQueryResult {
  rows: CollectionRow[]; total: number; offset: number; limit: number;
  incomplete: boolean; warnings: string[]; indexState: 'building' | 'ready';
  unavailableScopes: string[]; generation: number;
}
```

A scoped folder that is no longer inside an opened root is reported in `unavailableScopes` and the query returns no rows; it never widens to other roots. Pages default to 200 rows and are capped at 1,000; the renderer appends pages on demand rather than receiving the whole library.

IPC: `collections:query (query, page)`; event `collections:changed` after index updates, root changes and activity changes, coalesced within 150 ms. `collectionsAPI` on the preload bridge mirrors this.

## Navigation and renderer state

`FilesCollection` gains `{ kind: 'query'; id: string }`, serialized as `collection=query&id=…`. The definition lives in a session-only `queryDraftsStore` keyed by id; a URL whose id is unknown (a stale history entry after restart) resolves to the first root like any invalid location. Slice 3 adds `{ kind: 'view'; id }` for durable definitions and reuses the same surface with a draft layered over the saved definition.

`diskStore.navigateToCollection(collection)` replaces the recent-specific action; `currentDirectory` stays derived. `collectionQueryStore` holds per-draft results with a 150 ms debounce on query edits, a request token that discards stale responses, page appending, and a reload on `collections:changed` for the current draft only.

Opening a result records `opened` and the focus location keeps the query collection, so Return and Back land on the same draft with selection, focus and scroll from the snapshot store. Editing the draft does not touch history.

## Surface

`QueryView` replaces the folder header when the current collection is a query:

- Scope row: a segmented choice between all opened folders and chosen folders; chosen folders are the opened roots plus the folder the view was created from, each toggled on or off, with an "Include subfolders" switch. The scope is always visible, separate from filter chips, because a view created from a folder starts recursive while folder browsing shows direct children.
- Filter row: an "Add filter" menu of fields; each chip shows the field, an operator select, a value control (text, kind toggles, comma-separated tags, duration presets, or a date input) and a remove button; a "Match all filters" label; "Clear filters".
- Sort row: field select and direction toggle; the list/gallery toggle already lives in `CollectionView`.
- Results through `CollectionView` with rows decorated by their parent folder and a detail for the sort field (activity reason, modified date, or size). A "Load more" control appends the next page when rows are fewer than total.
- States: building index (progress label, results marked partial), incomplete metadata banner with the excluded count, unavailable scope banner naming the folder with an Edit scope action, "No items match these filters" with Clear filters, and the query error banner with Retry.

Entry points: "New view" in a sidebar Views section (transient drafts are listed there as "Untitled view" while the session lasts) and a "Filter this folder" toolbar action that creates a draft scoped to the current folder with descendants.

Keyboard, Preview, Details, Quick Look, rename and trash keep working because rows are `DiskEntry` values selected by path. Form controls inside the query header carry the existing shortcut-ignore marker so typing never triggers file actions. Creation and paste stay unavailable in a query collection.

## Error handling

- Invalid queries cannot leave the renderer: the draft store only produces values `validateCollectionQuery` accepts, and main re-validates.
- Index scan errors become warnings on every result and never abort the scan.
- A failed query shows the error with Retry and keeps the last good rows.
- Changing metadata so the active item stops matching keeps the Details editor mounted (it is keyed by the selected path, not the row); the row disappears on the next reload and the selection is reconciled by path.

## Testing

Unit: query validation and time helpers; traversal rules shared with the catalog; index build, targeted update, subtree removal, root rebuild, carrier folding; evaluator scope, each predicate, compound conjunction, unknown exclusion, sorting and tie-breaks, `never`; service scope resolution and paging; handler validation. Component: draft edits debounce into one query, stale responses dropped, chips add/remove, unavailable scope, load more, open and Back restoring the draft, folder-to-view entry point, sidebar New view. Contract: the IPC scan picks up the new channels. No new Electron tests.

## Out of scope

Persisted views, naming, Save/Reset, nested groups, Related predicates, first-seen, bulk tagging, a full folder tree chooser for scope, and index persistence across launches.
