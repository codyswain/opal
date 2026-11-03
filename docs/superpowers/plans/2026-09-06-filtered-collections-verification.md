# Filtered collections verification

Worktree: `/Users/codyswain/code/opal/.worktrees/core-ux`
Branch: `codex/core-ux`
Starting point for this slice: `8672326` (Recent verified)
Spec: `docs/superpowers/specs/2026-09-06-filtered-collections-design.md`
Plan: `docs/superpowers/plans/2026-09-06-filtered-collections.md`

Status: slice 2 (filtered collections, transient definitions) complete. Work remains on the isolated branch; no merge or push was performed. The user's running app and real profile were not touched.

## What shipped

- `src/types/collectionQuery.ts` and `src/common/collectionQuery.ts`: the versioned query model (scope, conjunctive chips, sort), renderer-safe validation with the handoff's limits, local-day boundaries, duration presets and chip descriptions.
- `src/main/fs/rootTraversal.ts`: the one set of traversal rules, now shared by `MetadataCatalog` and the new index.
- `src/main/collections/`: `CollectionIndex` (lazy build, targeted re-summary of watcher directories, subtree removal, root rebuild, generation), `evaluateQuery` (pure predicates with unknown-metadata exclusion, scope, deterministic sort), `CollectionQueryService` (validation, scope resolution that never widens past a closed folder, activity join, paging) and `CollectionHandlers` (`collections:query`). `main.ts` feeds the index from the watcher and root changes and coalesces one `collections:changed` event across index, root and activity changes.
- Renderer: `FilesCollection` gained `{ kind: 'query'; id }`; `queryDraftsStore` (session drafts) and `collectionQueryStore` (debounced loads, stale-response guard, page appending); `QueryView` with scope control, filter chips, sort control, warnings, unavailable-scope banner, load more and empty states, rendered through the shared `CollectionView`; "New view" in a sidebar Views section and "Filter this folder" on the folder toolbar.

## Evidence

Unit and contract: **850 tests pass in 82 files** (`npm test`, Node ABI). Type check reports the same **13** pre-existing renderer errors; lint reports the same **15** warnings and no errors.

Electron: **9 tests pass in 15.4 s**; no new Electron tests.

Disposable acceptance against the built app (script at the session scratchpad `collections-acceptance.mjs`, overlapping roots `Vault` and `Vault/Projects`): **14/14 checks passed**, covering handoff criteria 4, 6, 8, 9 and 10:

- A view scoped to both overlapping folders with `Kind is one of PDF, Image` and `Tags has any of research, reference` lists `atlas.pdf` and `Deep/cover.png` exactly once each, and the results carry the incomplete label because one sidecar is malformed.
- `Tags is empty` lists the untagged `paper.pdf` and never the item with the malformed carrier; the count is labeled incomplete.
- Opening a result keeps `collection=query` in the focus URL; Back restores the same chips and the selected row without recording activity.
- Writing a matching file and its sidecar into a scoped folder adds a row without a navigation reset and without losing the selection; deleting it removes the row.
- Closing the `Vault` root while the view is scoped to it shows the unavailable-scope banner naming the folder and returns no rows; closing `Projects`, which stays inside the open `Vault`, correctly keeps that scope available.
- No renderer errors.

## Deliberate limits

- Definitions are session-only. A query URL from a previous launch resolves to the first root; slice 3 persists views and layers drafts over them.
- Scope chooses among opened roots and the folder a view was created from; a full folder tree chooser is later work.
- The index builds on the first query and is not persisted; a large library pays that cost once per launch.
- No nested groups, Related predicates, first-seen or bulk actions. Creation and paste stay unavailable inside a query collection.
- `after day` is stored as the next local midnight; the chip shows the chosen day by subtracting one millisecond, which is exact for whole days.

## Next

Slice 3 from the handoff: the library configuration layout gains `views/<id>.yaml`, saved views appear in the sidebar with Save, Save as new, Reset, rename, duplicate and delete, external-edit conflicts are detected, and `FilesCollection` gains `{ kind: 'view'; id }` reusing `QueryView` with a draft over the saved definition.
