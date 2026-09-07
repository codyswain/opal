# Files First D verification: views polish

Worktree: `/Users/codyswain/code/opal/.worktrees/core-ux`
Branch: `codex/core-ux`
Spec: `docs/superpowers/specs/2026-09-07-files-first-design.md`, Stream D
Plan: `docs/superpowers/plans/2026-09-07-files-first-d-views.md`

Status: complete, commit `2eb215a`.

## What shipped

- `collections:tags`: `CollectionQueryService.tags()` counts meaningful tags across items inside the opened roots, most used first, ties broken alphabetically. Unreadable metadata contributes nothing. Exposed as `collectionsAPI.tags`.
- `useTagSuggestions` loads the counts on mount and again on every `collections:changed`. `FilterChips` binds a `<datalist>` of those tags to the tags chip input, so typing offers known tags without preventing new ones.
- Rows in views show up to three tag pills after the name (`data-testid="row-tag"`); folders and untagged items show none.
- `ScopeControl` lists the chosen folders as removable pills and adds folders through `FolderPickerDialog`, which browses opened roots one level at a time over the guarded `diskAPI.readDirectory` (directories only, Up and Choose). Removing the last folder widens the scope to all opened folders instead of leaving an empty scope.
- Cmd+F (Ctrl+F) inside a view focuses the first text chip input, or adds a Name chip and focuses it.

## Evidence

Unit and contract: **897 tests pass in 88 files** (`npm test`). Type check: **0 errors**. Lint: **8 warnings**, 0 errors (unchanged). Electron: **8 tests pass in 21.2 s**.

New coverage: tag counting and the new channel (`collectionQueryService.test.ts`); pills, datalist contents and refresh on change, the picker flow including the widen-on-last-removal rule, and the Cmd+F shortcut (`queryView.test.tsx`).

## Deliberate limits

- Tag suggestions are the platform's native datalist: no fuzzy matching or counts in the dropdown.
- The picker lists only folders under opened roots; opening a new root still happens from the sidebar.
- Cmd+F is scoped to views; folder browsing keeps its existing filter box.

## Next

Manual review in the running app. Main-process changes (the tags channel) need an app restart to take effect; the renderer picks up the rest through HMR.
