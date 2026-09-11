# Opal: Recent activity and saved views

Product and engineering handoff · September 6, 2026

## 1. Purpose and status

Make Opal a place where people can return to their information without remembering its location. Folders remain the physical organization. Views provide useful, persistent ways to gather files and folders by their properties and by the user's activity.

The central loop is:

**Open a collection → narrow it with filters → preview or work on an item → return to the same context → save the collection when it is useful again.**

This document describes a proposed next milestone. Recent activity and saved views have not been implemented by this handoff. It is intended to give another agent enough context to design and implement them without reconstructing the conversation.

### User requirements

- Opal should be a store for multimodal information, usable directly from disk and on a person's own machine, with eventual self-hosting possible.
- Folders are sufficient as the starting structure, with rich associations between items alongside them.
- Recently touched items should be easy to find.
- People should be able to create arbitrary filtered views around files and save those views, using Linear as an interaction reference.

### Proposed defaults

The filter semantics, activity rules, storage layout, and delivery order below are recommendations made concrete for implementation. They have not each received separate user approval. Linear is a reference for the filter-to-saved-view interaction; this document does not assert feature parity or depend on its current implementation.

## 2. Product model

| Concept | Meaning |
|---|---|
| Item | A file or folder, optionally carrying tags, a description, and connections |
| Folder | A physical directory on disk |
| View | A named query plus presentation preferences; membership is computed |
| Recent | A built-in view of meaningful activity in Opal |
| Saved view | An authored definition that can be reopened, edited, duplicated, and removed |
| Result | A reference to an existing item; it is never another copy of that item |

A file can appear in many views. Saving or deleting a view does not move, copy, or delete its results. Editing a file from a view edits the same file seen in its folder.

“Arbitrary views” means useful combinations of supported filters, not executable scripts, SQL, or an unrestricted schema builder in the first release. The query model should accommodate later fields without rebuilding navigation.

## 3. Core experience

### Navigation

Expose Recent and a Views section alongside the existing folder navigation. Keep folders readily accessible. A view should feel like another collection within the existing browser, sharing selection, Preview, Details, and explicit Open behavior.

Suggested structure:

```text
Recent
Views
  Project references
  Needs organizing
  This week's notes
  + New view
Folders
  Research
  Projects
```

Use the existing app's visual language. This outline specifies hierarchy, not a new sidebar design system.

### Create a view while browsing

1. Open a folder, Recent, or New view.
2. Set the scope: this folder, selected folders, or all opened folders.
3. Add readable filter chips and choose sorting and layout.
4. Results update without a separate Apply action.
5. Choose **Save view**, enter a name, and save.
6. The named view appears in the sidebar and opens with the same query and presentation.

New view starts with all opened folders as scope. Turning a folder collection into a view defaults to that folder with descendants included; the UI must show this scope explicitly because ordinary folder browsing lists direct children.

### Edit a saved view

Filter, scope, sort, and layout changes form a local draft. Mark the view **Edited**, with **Save changes**, **Save as new**, and **Reset**. Do not silently overwrite the durable definition on every click.

Keep a draft through opening an item and Back during the session. Switching collections can retain the draft in session state, but must not silently save it. Reset restores the last saved definition. Rename changes the view's name while preserving its ID. Duplicate creates a new ID. Removing a view removes only its definition and sidebar entry, with an undo affordance if consistent with existing UI.

Use **Save as new** to customize built-in Recent; built-in defaults themselves are not overwritten.

### Work within a view

- Single selection changes selection; it does not automatically open Preview or navigate away.
- Preview remains an explicit toggle and Details remains available for each item.
- Open enters the existing focused file experience. Opening a folder enters that folder.
- Back restores the originating view, including draft query, layout, scroll anchor, selection, and keyboard focus where still valid.
- Show a location column or secondary path so identically named results from different folders are distinguishable.
- Offer **Show in folder** as a separate action. It deliberately navigates to the physical parent and selects the item.
- Never invent a destination directory for creation or paste into a multi-folder view. Ask for a concrete destination through a chooser when that action is supported; otherwise omit the collection-level action in this milestone.

## 4. Recently touched: exact meaning

Recently touched should represent the person's work in Opal. Filesystem modification time is a separate property: viewing a PDF makes it relevant again without changing its bytes.

Record successful, meaningful actions:

| Action | Activity effect |
|---|---|
| Explicitly open a file in Opal | Update last opened and last touched |
| Explicitly navigate into a folder | Update that folder's last opened and last touched |
| Successfully save file content | Update last edited and last touched |
| Successfully save changed tags or description | Update last organized and last touched |
| Add or remove a Related connection | Update last organized and last touched for the initiating item |
| Successfully rename or move through Opal | Update last organized and last touched for the operated item |
| Select a row, hover, render a thumbnail, read Details | No activity |
| Automatically restore the previous session | No activity |
| Automatic filesystem watcher refresh | No activity |
| Failed, cancelled, or no-op mutation | No activity |

Preview-only selection does not count initially: otherwise keyboard scanning can flood Recent. Browser Back/Forward restoration also does not count. Explicit user navigation through a breadcrumb or Related link does count. Descendants of a moved folder are not all touched. A relationship's reverse endpoint is not automatically touched just because the initiating item changed.

Recent shows one row per item, newest last-touched timestamp first. Display a reason such as “Opened 10 minutes ago” or “Organized yesterday.” Use deterministic tie-breaking. Optional Today/Yesterday grouping can follow; it is not required for the first slice.

Store timestamps in UTC; display in local time. Coalesce repeated open events within a short interval, proposed 30 seconds, to avoid redundant writes. Keep per-kind latest timestamps rather than an unbounded event log. Persist activity across restarts. Activity failure must not roll back an otherwise successful file save; surface a recoverable history-persistence error without a modal per event.

External file edits affect the Modified filter, not Last touched. A later explicit “include external changes” option could combine these, but should not blur the default meaning.

## 5. Filters and sorting

### Initial field set

| Field | Initial operations | Notes |
|---|---|---|
| Name | Contains, does not contain | Case-insensitive literal text; no regex |
| Location | Scope folders, include descendants | Scope is visible separately from other chips |
| Kind | Is one of, is not one of | Folder, note/text, PDF, image, audio, video, other; align with existing kinds |
| Tags | Has any, has all, has none, is empty | Preserve authored strings; do not normalize stored metadata implicitly |
| Description | Is empty, is not empty | Whitespace-only description counts as empty |
| Last touched | Within past duration, before, after, never | Opal activity |
| Last opened | Within past duration, before, after, never | Opal activity |
| Modified | Within past duration, before, after | Filesystem modification timestamp |

First implement conjunction across chips: every chip must match. Multi-value “any” operations provide OR within a chip. Example: `Kind is one of [PDF, Image]` AND `Tags has any [research, reference]`.

Make this rule visible with “Match all filters.” Do not expose a misleading “Match any” control until its semantics are implemented. Nested AND/OR groups are a follow-up; reserve a versioned query representation that can add them later.

Use exact, case-sensitive tag identity to avoid merging existing distinct authored values. The tag picker can search case-insensitively. Empty legacy tag strings are not useful tags: for filtering, zero nonblank tags counts as empty; filtering never rewrites their source representation.

Relative durations use the evaluation time, so a saved “past 7 days” remains rolling. Define it as a trailing 168-hour interval, not calendar-week boundaries. Refresh time-based results on app focus and at least once per minute while visible. Absolute dates chosen through the UI use local-day boundaries converted to UTC and an exclusive end boundary.

Sort options: Last touched, Last opened, Modified, Name. Support ascending or descending for each. Missing timestamps sort last in both directions. Apply stable secondary ordering by normalized display name and unique item reference. Do not force folders first for activity sorting; that would undermine recency.

### Unknown values

Unreadable or invalid metadata is unknown, not an empty tag list. An item with unknown tags must not quietly match “Tags is empty” or a negative tag test. Exclude it from predicates requiring the unknown field and report incomplete results. It may still appear in a name-only view with a warning. Never present partial counts as complete totals.

## 6. Example views

| View | Definition | Value |
|---|---|---|
| Recent | All opened folders; last touched exists; descending touched | Resume work |
| Project references | Project folder recursively; PDF or image; tag reference | Find source material across subfolders |
| Needs tags | Selected folders; tags empty | Organize uncategorized material |
| Needs descriptions | Selected folders; description empty | Add context where absent |
| This week's notes | All opened folders; note/text; touched within 7 days | Return to active writing |
| Recently changed images | Selected folders; image; modified within 7 days | Review images updated by any application |
| Research queue | All opened folders; tag to-read; PDF or note/text | Gather a reading list without relocating files |

Later examples:

- **Related to Project Atlas:** all items connected to a chosen file or folder, in either direction. Requires identity-aware query operands and missing/ambiguous target handling.
- **Recently added:** items first discovered in this Opal library. Requires a defined first-seen timestamp; filesystem creation time is not a reliable substitute. First import must not pretend all old files were newly authored.
- **Needs organizing:** tags empty OR description empty. Requires disjunction; initially offer the two separate examples above.

Do not advertise these later examples as available in the first filter release.

## 7. Presentation and live updates

Initially reuse the existing list and gallery presentations. Save the selected layout and sort with the view. Do not add boards, calendars, custom columns, or graph layouts to this milestone.

Result membership updates after relevant filesystem, metadata, root, or activity changes. Coalesce updates and discard stale query responses. Avoid rebuilding the entire list on each event when a targeted update is sufficient.

If editing an item makes it stop matching, keep its active editor and unsaved state stable until the user leaves it. The collection can remove the row and show a small explanation that the item no longer matches. Returning must reconcile the selection; it must not select a different item merely because it occupies the old row number.

Use stable item keys and scroll anchors. A recency reorder must not remount a row between mouse-down and double-click or move keyboard focus to another item. Defer disruptive reorder while an interaction is active, then reconcile by item identity.

Empty-state distinctions:

- Recent has no activity: “Items you open or work on will appear here.”
- Query has no matches: “No items match these filters,” with Clear filters.
- A scoped folder is unavailable: name it and offer Reconnect or Edit scope.
- Index is building: show progress and label any partial results.
- Index has read errors: show incomplete status and a way to inspect/retry.
- View definition is invalid or from an unsupported version: explain the issue; preserve the file.

Keyboard navigation, accessible filter names, dialog focus trapping, Escape behavior, and existing file shortcuts must remain consistent. Form inputs must not trigger global file actions.

## 8. Persistence and identity

Separate three classes of data:

1. **Authored information:** files, item metadata, and saved-view definitions. These are durable disk truth.
2. **Personal activity:** durable local state used by Recent; it cannot be reconstructed from files after deletion.
3. **Index/cache:** disposable summaries used to accelerate queries; deleting it loses no authored information or activity.

Do not store personal open history in each file's frontmatter or sidecar. Opening a file must not modify the file, create an identity, or generate sync churn throughout a library.

### Proposed storage arrangement

Introduce an explicit Opal configuration directory for the current library, with one versioned human-readable file per saved view, for example `views/<view-id>.yaml`. Keep durable activity separately from the rebuildable query database, whether as a small database or another bounded persistent representation.

The existing app opens multiple roots and does not yet establish the portable library configuration model assumed here. Resolve that narrowly before implementing view persistence: the configuration directory may default to a documented app-managed local location, but it must be exportable/movable. Do not silently write a `.opal` folder into every opened root, and do not collide with existing `.opal.yaml` item metadata.

Relative scope paths resolve against a defined library base. Absolute external-root references require explicit remapping after moving to another machine. “All opened folders” is intentionally dynamic: newly opened roots join it. Explicit folder scope remains fixed; removing authorization for a root makes that scope unavailable, never broadens it to all roots.

A view file needs: schema version, stable view ID, display name, scope, filter expression, sort, and layout. It must not contain cached results, transient selections, absolute scroll offsets, or activity history. Sidebar order can live in separate library preferences. Use atomic writes and revision/conflict checks; do not overwrite an externally edited definition with a stale UI draft.

### Item references

Use an existing metadata UUID when uniquely resolvable. Duplicate UUIDs remain ambiguous; do not collapse two physical results or merge their activity simply because their UUIDs match. Use distinct physical references for result rendering while showing the identity issue.

Unannotated items need root-relative path references in activity state. App-controlled moves and renames can remap these through the existing mutation coordinator. External moves of an unannotated file cannot be reliably followed; document that limitation. Where replacement is detected, drop the old reference rather than assign its history to a new same-name item. Do not claim complete replacement detection on filesystems without reliable evidence.

When an item first gains a UUID, migrate its known local path history only after verifying that it is the same item. Closed roots do not expose results. Missing items are omitted from ordinary Recent results; stale activity can be cleaned up without deleting files. Provide Clear recent activity, which leaves files, tags, connections, and views intact.

## 9. Existing implementation to build upon

Working implementation is on branch `codex/core-ux`, worktree `/Users/codyswain/code/opal/.worktrees/core-ux`, inspected at commit `44b52f8`. The main checkout at `/Users/codyswain/code/opal` may not contain these changes. Verify branch state before implementation; do not work from the older checkout accidentally.

Existing capabilities:

- Route-owned folder browsing and focused file navigation, with selection and scroll restoration.
- Explicit Preview and Details tabs.
- Disk-authored tags/descriptions and Related connections between files and folders.
- UUID resolution, reverse connections, safe metadata-aware app renames, missing/ambiguous states.
- Allowed-root enforcement, watcher invalidation, and serialized mutations.

Relevant code, relative to that worktree:

| Area | Starting points |
|---|---|
| Collection navigation | `src/renderer/features/disk-explorer/components/FilesRoute.tsx` and `navigation/` |
| Browse UI | `DiskExplorer.tsx`, `DiskFolderView.tsx`, `Toolbar.tsx` in the same components directory |
| Renderer state | `src/renderer/features/disk-explorer/store/diskStore.ts` |
| Item UI | `src/renderer/features/disk-explorer/components/detail/DetailsPanel.tsx` |
| Metadata and catalog | `src/main/fs/MetadataService.ts`, `MetadataCatalog.ts`, `MetadataCodec.ts` |
| Filesystem lifecycle | `src/main/fs/DiskWatcher.ts`, `FileWriter.ts`, `RootRegistry.ts`, `MutationQueue.ts` |
| IPC | `src/main/fs/MetadataHandlers.ts`, `src/main.ts`, `src/preload.ts` |
| Shared schema | `src/types/metadata.ts`, `src/common/metadataValidation.ts` |

Use the production `disk-explorer` feature, not the legacy `file-explorer-v2`.

The current catalog lazily scans opened roots for Details/Related, retaining identity/link summaries. It does not yet provide a general tag/activity query index. Normal folder browsing must remain fast and must not begin scanning the entire library merely because this feature exists.

Navigation currently assumes a directory-backed collection. Extend its location model to represent folder, built-in Recent, and saved-view collections explicitly. Opening a result needs to preserve an originating collection reference; substituting the file's parent directory would lose view context on Back.

Read the existing properties design and verification documents in `docs/superpowers/` before changing identity, watcher, or metadata contracts.

## 10. Architecture recommendation and alternatives

**Recommended:** a main-process collection query service backed by disposable indexed summaries, with separate view-definition and activity persistence. The renderer sends structured queries and renders bounded result pages. Reuse existing filesystem guards, metadata validation, and watcher knowledge.

An on-demand full scan is simpler for a prototype, but a scan per filter change or metadata save will make views feel slow. The prior synthetic 5,001-file sample took approximately one second for an initial metadata catalog read and 1.2 seconds for save plus catalog refresh. These are historical measurements on one machine, not a performance guarantee.

A new all-purpose database containing the authoritative files and properties would simplify queries but contradict the disk-first product. A database is appropriate as acceleration and separately designated personal state, not as a replacement for authored files.

Suggested boundaries:

- **View repository:** validated definitions, atomic save, revisions, rename/duplicate/delete.
- **Activity service:** explicit action recording, identity/path remapping, persistence, clearing.
- **Collection index:** bounded file/metadata summaries, initial scan, watcher updates, reconciliation after missed events.
- **Query evaluator:** typed predicates, sorting, clock-dependent evaluation, pagination, completeness metadata.
- **Collection UI/navigation:** draft queries, filter controls, results, origin snapshots, saved-view actions.

Keep filesystem work out of the renderer. Validate IPC operands, page limits, paths, schema versions, and scope authorization in main. No view file may grant access to an unopened directory. Do not load whole document bodies or media bytes into the index. Reuse current symlink/hidden-root rules, including explicitly opened hidden descendant roots and root-overlap deduplication.

Avoid two independent recursive scanners with inconsistent rules. Extend or extract shared catalog traversal where appropriate, without destabilizing existing Related correctness. Metadata-aware queries can start indexing on first use; ordinary folder browsing continues through the existing fast path.

Proposed performance goals: warm filter changes visibly settle within 100 ms on a representative 10,000-item library; cold queries show a loading state promptly and remain cancellable; no scan blocks interaction. Measure before treating these as release guarantees. Bound memory and use virtualization plus pagination rather than sending an entire large library over IPC per keystroke.

## 11. Delivery sequence

### Slice 1: Recent end to end

Define activity persistence and event hooks, implement one built-in collection, and extend navigation so Open/Back retains that collection. Cover unannotated items, annotated identities, rename/move, closed roots, and restart persistence. This proves the collection abstraction through an immediately useful experience.

### Slice 2: Filtered collections

Add scoped queries, initial fields, deterministic sorting, index completeness, and existing list/gallery rendering. Keep definitions transient initially. Test compound semantics and live updates without sacrificing folder browsing speed.

### Slice 3: Durable saved views

Finalize the library configuration location; add view persistence, sidebar entries, Save/Save as new/Reset, rename, duplicate, delete, external-change conflicts, and relocation behavior. Verify a fresh profile can load exported definitions when roots are remapped.

### Slice 4: Retrieval polish and real-library validation

Exercise the complete loop with a representative mixed folder: notes, PDFs, images, audio, video, nested folders, duplicate names, and missing roots. Tune update behavior, keyboard flow, errors, and performance based on observed friction.

Bulk tagging, nested Boolean filters, Related predicates, first-seen tracking, and richer layouts follow this milestone. They are useful extensions but not prerequisites for delivering Recent and saved views.

## 12. Acceptance criteria

1. Explicitly open a PDF, then a note. Recent lists the note first with a readable activity reason. Hovering/selecting other files does not reorder it.
2. Restart Opal. Recent remains; startup restoration does not give restored items new timestamps.
3. Save a changed description. The initiating item becomes recently organized. A failed save does not create activity.
4. Create a view scoped to two folders with PDF-or-image and a tag filter. Matching descendants appear once even where opened roots overlap.
5. Save it, reopen it, and restart. Name, scope, predicates, sort, and layout persist without moving files.
6. Change filters, open a result, and go Back. The edited query, selection, focus, and scroll context are restored.
7. Modify tags so an active item stops matching. Its editor stays stable; the result list and returned selection reconcile correctly.
8. A watcher event adds or removes a matching item. Results update without a full navigation reset or a stale response replacing a newer query.
9. An invalid metadata carrier does not make an item falsely match “untagged.” Incomplete results are labeled.
10. Disconnect a scoped root. Its view reports unavailable scope without silently searching somewhere else.
11. Rename an item through Opal. It remains the same logical result and retains supported activity. Copied duplicate IDs are not silently merged.
12. Edit a saved definition externally while a local draft exists. Saving detects the conflict and preserves both recoverable states.
13. Delete a view or clear recent activity. All underlying files and authored item metadata remain unchanged.
14. Delete only the disposable index. Rebuilding restores view results without losing definitions or personal activity.
15. Existing folder selection, explicit Preview/Open, Related navigation, and allowed-root protections retain their behavior.

Use unit tests for query/time semantics, identity mapping, and persistence; component tests for draft/filter/navigation interactions; contract tests for IPC validation. Use real Electron only for behavior that requires the process boundary. Follow `CLAUDE.md`: run `npm test` for the correct native dependency rebuild, keep Electron tests at no more than ten and under sixty seconds, do not add visual regression tests, and never run Node/Electron native rebuilds concurrently in the same worktree.

Historical baseline from the completed milestone: 726 unit/contract tests and nine Electron checks passed; 13 existing TypeScript errors and 15 lint warnings remained. Recheck current state rather than treating these as fresh results. Do not restart the user's running app without considering unsaved work.

## 13. First steps for the receiving agent

Verify the worktree and current changes. Read the existing browse/Related design and relevant navigation code. Resolve the library configuration ownership and result identity representation with a small concrete design. Then implement Recent as the first vertical slice before generalizing the filter builder.

The product test is whether someone can return tomorrow, find what they were working on, and create a useful collection that continues to work as their files change. Optimize the implementation and review around that outcome.
