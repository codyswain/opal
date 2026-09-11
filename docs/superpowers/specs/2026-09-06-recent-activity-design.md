# Recent activity (saved views slice 1)

Date: 2026-09-06
Status: Design for the first vertical slice of `docs/superpowers/specs/2026-09-06-recent-and-saved-views-handoff.md`. The handoff is the product authority; this document resolves the two decisions it leaves to the implementer and fixes the slice boundary.

## Goal

Someone opens Opal tomorrow and finds what they were working on. Recent is a built-in collection listing items the person explicitly opened or organized in Opal, newest first, with a readable reason. Opening a result and going Back returns to Recent with selection, focus and scroll intact. Activity survives restart, follows app renames and moves, and never appears for items outside opened folders.

Filtered collections, saved-view persistence, sort options and the filter builder are later slices. This slice must leave a collection abstraction those slices extend rather than replace.

## Decision 1: library configuration directory

Opal gets one app-managed configuration directory for the current library:

```
<userData>/library/
  activity.json          # personal activity (this slice)
  views/<view-id>.yaml   # saved views (slice 3)
  library.json           # sidebar order and other preferences (slice 3)
```

`<userData>` honors `OPAL_TEST_USER_DATA_DIR` exactly as `disk-roots.json`, `window-state.json` and `thumbnails/` already do, so tests and disposable profiles never touch a real library. The directory is one folder, so it can be copied or moved as a unit. Nothing is written into opened roots, and nothing collides with `.opal.yaml` item metadata. `src/main/library/libraryPaths.ts` is the single place that knows this layout.

Activity is personal, per-machine state and is not meant to travel between machines. It therefore stores absolute canonical paths, the same form `RootRegistry` and every IPC payload already use. Root-relative references and remapping on relocation are a saved-view concern and are deferred to slice 3, where they matter.

## Decision 2: result identity

An activity record is keyed by absolute canonical path and carries the item's metadata UUID when one was readable at record time:

```ts
interface ActivityRecord {
  path: string;            // absolute, canonical
  id: string | null;       // UUID from the item's carrier, or null when unannotated or unreadable
  openedAt: number | null; // epoch ms, UTC
  organizedAt: number | null;
  editedAt: number | null; // reserved; no disk-backed editor exists yet
}
```

Rules:

- Recording reads the item's own carrier with the existing bounded `readMetadata`. It never builds the catalog, never allocates an identity, and never writes to the item. Unreadable or malformed metadata yields `id: null`.
- App renames and moves through `FileWriter` remap the record path (subtree remap for directories) and refresh the record's `id` from the destination. Path is the key, so a renamed annotated item remains the same result with its history (acceptance 11).
- Two physical copies with the same UUID are two records and two rows. Nothing is merged on UUID.
- At query time a record is dropped from results when its path no longer exists, lies outside an opened root, or carries a UUID that differs from the record's non-null `id`. That last check is replacement detection: a same-name file that replaced an annotated item does not inherit its history. A record with `id: null` cannot detect replacement; that limitation is documented, not papered over.
- External moves of any item cannot be followed. The record becomes missing and is omitted until cleared or until the path is used again.
- Closed roots hide their records without deleting them; reopening the root reveals them again.

## Activity model

Meaningful, successful actions record activity. Everything else does not.

| Trigger | Where recorded | Effect |
|---|---|---|
| Explicit open of a file: double-click, Cmd+Down, Open, tab activation, Related "Open" | Renderer navigation action → `activity:record` | `openedAt` |
| Explicit navigation into a folder: double-click, breadcrumb, sidebar tree, Cmd+Down, Related "Open" of a folder, Show in folder | Renderer navigation action → `activity:record` | `openedAt` on the folder |
| Successful `saveProperties`, `addRelated`, `removeRelated` | Main, inside `MetadataService` after the write succeeds | `organizedAt` on the initiating item only |
| Successful rename or move through Opal | Main, inside `FileWriter` after the rename succeeds | remap path, then `organizedAt` on the operated item at its new path |
| Trash through Opal | Main, inside `FileWriter` | record removed |
| Selection, hover, thumbnail, Quick Look, Details read, Preview pane | none | none |
| Startup restoration, Back/Forward, fallback navigation, closing a tab | none | none |
| Watcher refresh, failed or no-op mutation | none | none |

Renderer recording happens in the explicit navigation actions exposed by `FilesNavigationContext` (`navigateDirectory`, `openFile`) and in the sidebar's explicit activation. `FilesRoute`'s URL-application effect, its fallbacks, `returnToFolder` and `closeFile` call the router directly and therefore never record. This is what makes Back/Forward and session restore silent without special cases.

Main records organize events itself because only main knows a mutation succeeded. `activity:record` from the renderer accepts only `opened`; a renderer cannot claim it organized something.

Repeated opens of the same item within 30 seconds do not rewrite the record. Timestamps are epoch milliseconds, which are UTC by definition, and are rendered in local time. `touchedAt` is derived as the maximum of the three timestamps; the reason shown is the kind that produced it.

## Persistence

`ActivityStore` owns `activity.json`:

```json
{ "version": 1, "items": [ { "path": "...", "id": null, "openedAt": 1757200000000, "organizedAt": null, "editedAt": null } ] }
```

- Loaded once at startup. A missing file is an empty store. An unreadable or wrong-version file is moved aside to `activity.json.invalid-<timestamp>` and reported as a warning; the store starts empty and the original bytes are preserved.
- Write-through: every mutation persists the whole file through a temp file plus rename in the same directory, serialized on a promise chain so writes never interleave. This is the same atomic-replace pattern `MetadataService.write` uses. There is no shutdown flush to forget.
- Bounded at 2,000 records; the oldest `touchedAt` is evicted first.
- A persistence failure keeps the in-memory change, is logged, and is exposed as `lastPersistenceError` on the next query so Recent can show a dismissable notice. It never fails the file save or navigation that caused it.

## Query

`ActivityService.recent({ limit })` returns:

```ts
interface RecentItem {
  entry: DiskEntry;                 // fresh stat; reused by every existing renderer
  touchedAt: number;
  touchedKind: 'opened' | 'organized' | 'edited';
  openedAt: number | null;
  organizedAt: number | null;
  editedAt: number | null;
}
interface RecentResult {
  items: RecentItem[];
  total: number;        // records considered before the limit
  truncated: boolean;
  warnings: string[];   // persistence or read problems; never silently partial
}
```

Rows are ordered by `touchedAt` descending, then case-insensitive name, then path. Folders are not forced first. The limit defaults to 200 and main caps it at 1,000. Each candidate is checked against `RootRegistry.assertAllowed` and stat'd; only records with a non-null `id` also read metadata for replacement detection. Results are computed from the in-memory store, never from a scan.

## IPC surface

`activityAPI` on the preload bridge, `ActivityHandlers` in main:

| Channel | Direction | Payload |
|---|---|---|
| `activity:record` | invoke | `(path: string, kind: 'opened')` → `DiskResult` |
| `activity:recent` | invoke | `({ limit?: number })` → `DiskResult<RecentResult>` |
| `activity:clear` | invoke | `()` → `DiskResult` |
| `activity:changed` | main → renderer event | `{}` after any record, remap, removal or clear, coalesced within 100 ms |

Main validates every argument: non-empty string paths, the literal kind `'opened'`, a finite positive limit. Paths are resolved through `RootRegistry` before use. Rejections return `success: false` like every other disk channel.

## Navigation model

`FilesLocation` gains an explicit collection:

```ts
type FilesCollection =
  | { kind: 'directory'; directory: string }
  | { kind: 'recent' };

interface FilesBrowseLocation { mode: 'browse'; collection: FilesCollection }
interface FilesFocusLocation  { mode: 'focus';  collection: FilesCollection; file: string }
```

Serialization keeps existing URLs stable: a directory collection still serializes as `mode=browse&dir=…` and `mode=focus&dir=…&file=…`. Recent adds `mode=browse&collection=recent` and `mode=focus&collection=recent&file=…`. Parsing rejects a focus location whose file is outside every opened root regardless of collection. Slice 3 adds `{ kind: 'view'; id }` to the same union.

Consequences:

- A focus location remembers the collection it was opened from. Return to folder and Back both land on that collection, so opening from Recent never substitutes the file's parent folder.
- `filesLocationSnapshots` is already keyed by the serialized location, so Recent gets selection, focus and scroll snapshots for free. Path scoping inside snapshots applies only to directory collections.
- `remapFilesLocation` remaps file and directory paths and leaves the recent collection alone. Removal of the focused file inside a recent collection falls back to browsing Recent.
- `diskStore` gains `currentCollection: FilesCollection | null`. `currentDirectory` remains and is always the directory of the current collection or null, so every existing consumer (tree highlight, sidebar root, toolbar, keyboard handlers) keeps working unchanged. A new `navigateToRecent()` sets the recent collection, clears `currentDirectory` and selection.
- `FilesRoute` applies a recent location by calling `navigateToRecent()`, loading Recent through `recentStore`, then restoring the snapshot's selection filtered to visible paths, exactly as it does for directories.

## Renderer

- `recentStore` (Zustand): `result`, `loading`, `error`, `load()` with a request token so a stale response never replaces a newer one, and a subscription to `activity:changed` and `disk:changed` that reloads only while a recent collection is current.
- `DiskFolderView`'s virtualized list and gallery become `CollectionView`, taking a browse location, entries and optional per-row decoration (reason and secondary location text). `DiskFolderView` remains as the folder wrapper that loads the listing. Row keys stay the entry path so a reorder never remounts a row or moves keyboard focus.
- `RecentView` renders `CollectionView` with rows decorated by "Opened 10 minutes ago" or "Organized yesterday" and the parent folder path, refreshing labels once a minute. It offers Show in folder per row, which patches the parent folder's snapshot with the item selected and then navigates there. It shows the handoff's empty state, a loading state, and the warnings banner.
- `DiskExplorer` renders Recent when the current collection is recent and `openedPath` is null; the Preview pane, Quick Look, Details, rename, trash and the existing shortcuts keep working because they are path-based and `selectedEntry` also resolves against Recent rows. Cmd+Up and New folder are unavailable in Recent because there is no directory. Selecting all selects the visible Recent rows.
- The Recent header replaces breadcrumb and folder toolbar with the title, count, the existing name filter, the Preview toggle and Clear recent activity behind an inline confirmation. Clearing removes activity only.
- The workspace sidebar gains a Recent item in the primary navigation, active when the current collection is recent.

## Error handling

- Recording failures in the renderer are fire-and-forget with a console warning; navigation is never blocked on activity.
- Main recording failures after a successful metadata or file mutation are caught and logged; the mutation result is returned unchanged.
- Recent query failures show the existing error banner with Retry.
- Persistence warnings appear as a non-modal notice inside Recent, dismissable, and reappear only if a new failure occurs.

## Testing

Unit and contract tests carry this slice. No new Electron tests: the budget stays at nine, and an existing spec may gain an assertion if the IPC boundary needs proof.

- `ActivityStore`: real temp files; record, coalescing, eviction, remap of file and subtree, removal, clear, reload in a fresh instance, corrupt-file preservation, write-failure reporting.
- `ActivityService`: allowed-root filtering, missing paths, replacement detection by UUID, duplicate UUIDs kept separate, ordering and tie-break, limit and truncation.
- `ActivityHandlers`: channel set, argument validation, kind restriction.
- `MetadataService` and `FileWriter`: successful mutations record organized activity and remap; failed mutations record nothing.
- `filesLocation` and snapshots: parse, serialize, normalize, remap and removal for recent and directory collections; existing directory URLs unchanged.
- `FilesRoute` and components: opening from Recent and Back restores Recent with selection and scroll; Return to folder from a Recent-opened file returns to Recent; startup restoration and Back record nothing; explicit actions record once; the sidebar Recent item navigates; Show in folder lands selected.
- IPC contract test picks up the new channels automatically.

Baseline before this slice: 726 tests in 69 files, 13 pre-existing TypeScript errors, 15 lint warnings. No new errors or warnings are acceptable.

## Out of scope for this slice

Filter chips, scope, sort options other than recency, saved-view files, Today/Yesterday grouping, first-seen tracking, edited activity (no disk-backed editor exists yet), root-relative activity references, and any scan or index. The renderer never receives more than the capped page of Recent rows.
