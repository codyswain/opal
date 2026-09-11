# Properties and Related implementation plan

Spec: `docs/superpowers/specs/2026-09-06-properties-related-design.md`

Completed 2026-09-06. Evidence: `docs/superpowers/plans/2026-09-06-properties-related-verification.md`.

- [x] Durable metadata and safe file operations, reviewed and corrected.
- [x] Details and Related workflow, reviewed and corrected.
- [x] Full suite, Electron boundary checks, real workflow/persistence acceptance, and final branch review.

## Global Constraints

- Work only in `/Users/codyswain/code/opal/.worktrees/core-ux`, branch `codex/core-ux`. Do not merge, push, or restart the user's running app.
- Authored metadata lives on disk, not SQLite/cache; reads never assign identities. UUIDs, not filenames, resolve connections. Invalid metadata is never silently overwritten.
- Preserve existing browse/resume behavior. No scan on ordinary browsing; Details is explicit.
- Use main/preload/renderer boundaries and allowed-roots checks. Inject filesystem failure seams for meaningful tests.
- Use `npm test` (native ABI rebuild), never concurrently with Electron rebuild/E2E. Baseline: 619 tests pass in 66 files, 13 pre-existing TypeScript errors, 15 lint warnings. No new errors or warnings. E2E budget remains at most 10 tests/60 seconds; no visual regression tests.
- Commit each completed task. Do not dispatch subagents from an implementation worker.

### Task 1: Durable metadata and safe file operations

Read the spec as authority and relevant existing fs classes. Implement a cohesive main-process metadata layer under `src/main/fs/`, shared contracts in `src/types/metadata.ts`, and meaningful real-temp-files unit tests in `src/tests/unit/fs/`. Add explicit dependency `yaml` version `2.7.1` (already installed transitively), using its document API to preserve unknown fields/comments. Keep Markdown body bytes untouched, and expose a small shared frontmatter splitter for preview use later if useful.

Implement the disk formats, bounded strict parsing, stable IDs, revision-checked atomic property updates, author-once symmetric Related add/remove, on-demand disposable catalog, and truthful resolution statuses from the spec. Suggested public service operations: `read(path)`, `saveProperties(path, {tags, description}, expectedRevision)`, `addRelated(path, targetPath)`, `removeRelated(path, edgeId)`, `invalidate()`. Read result should provide properties, revision, related rows (edge ID, owner identity/path for removal as needed, target path/name/kind, status), and warnings. Choose exact shared types and document them in the report for Task 2. Use limits 64 KiB metadata/frontmatter, 16 MiB writable Markdown, 32 tags of 64 characters each, 8 KiB description. Identity resolution must not rebind a missing ID to same-name replacement; duplicate IDs are ambiguous. Read-only or malformed unrelated items should produce warnings without taking down all results. Deduplicate overlapping roots, reject symlink traversal, and invalidate catalog on root list changes.

Integrate FileWriter with the same mutation queue and metadata-aware rename/move/trash. Keep existing call sites compatible via optional dependency if necessary. Preserve whole subtree metadata. For non-Markdown files, preflight sidecar destination even if source has none, carry valid sidecar, reject invalid colliding carriers without overwriting. Paired rename failure rolls back; managed binary EXDEV fails safely. Stage paired trash in a unique hidden folder under the same parent and trash the bundle once; roll back if staging/trash fails. A rollback failure must be reported with surviving paths. Keep primary/sidecar identity intact when extension changes: either migrate carrier formats safely or reject format-changing renames clearly before mutation for this slice. Fold valid adjacent carriers in DiskReader listings, but keep invalid/colliding files visible. Watcher must observe `.opal.yaml` changes and invalidate metadata; service exposes invalidation hook for wiring in Task 2. Do not build the renderer or IPC yet.

Test properties on Markdown/binary/directory and fresh instance reload; body/BOM/CRLF preservation and unrelated YAML fields; malformed/oversize/alias/custom-tag/symlink/collision errors; stale revision no overwrite; forward/reverse add/remove; stale/missing/duplicate target IDs; overlap roots; rename and subtree move; paired failure rollback and managed EXDEV; staged trash success/failure; browse listing folds only valid sidecars. Run focused tests first, then npm test and type/lint checks. Report exact interfaces and any limitations. Commit.

### Task 2: Details and Related workflow

Consume Task 1's shared contracts and service. Wire service in main, FileWriter shared queue, root/watcher invalidation; create separate `MetadataHandlers`, preload `metadataAPI`, global typing, and renderer helper following diskAPI conventions. Validate payloads in main. Add IPC contract and handler tests as needed without raising E2E count beyond budget.

In `DetailPane`, add Preview/Details tabs with Preview initially selected. Details explicitly loads the selected item. Provide editable tags (comma-separated is sufficient), description, Save/status/error, and Related rows with Add, Open (available endpoints), and Remove. Missing/ambiguous rows must be labeled and disabled for opening. Show catalog warnings as incomplete results. Protect against stale async read/save responses when targets switch; never apply another item's state. Use existing FilesNavigationContext to navigate linked files/folders. Strip valid frontmatter from Markdown previews so saved UUIDs and metadata do not appear as document body.

Add an accessible Related chooser using existing Dialog: list allowed roots, current folder with Up, directory browsing, current-list name filter, explicit item selection and Connect. Directories must be selectable as targets separately from browsing into them. No recursive search, no writes until Connect, no file deletion through Related removal. Keep controls simple and consistent with existing components. Handle loading, empty roots/folder, errors, double-submit and unmount races. A successful action refreshes Details without resetting folder navigation or preview geometry.

Test Details loading only when explicit; property save and error/conflict; stale selected-item responses; related choose/connect/remove/follow for both files and folders; missing/ambiguous rows; frontmatter preview. Run full npm test, lint, type comparison to baseline. Commit.

### Task 3: Verify the complete experience

Review the branch and fix confirmed findings through scoped implementation/review. Run the existing Electron suite sequentially after unit tests, within its budget. Build/launch a disposable Electron profile and temporary root and manually automate save tags/description, connect binary to Markdown, inspect reverse connection, rename through Opal, follow and return, and fresh-profile/service disk persistence. Do not touch the user's real files or stop their running app. Record evidence, material limitations, and next step in a verification document. Leave the branch clean and Electron native dependency ready for launch; no merge/push.
