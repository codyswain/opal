# Opal core information workspace

Date: 2026-09-05
Status: Approved direction in conversation; first implementation slice authorized.

## Product contract

Opal is a fast information workspace over files on disk. A folder is sufficient
as the first collection. Notes, images, PDFs, recordings, and other files are
first-class items. Organization is useful without writing a note.

Folders give items a location. Properties describe them. Associations connect
them across locations and media types. A file can participate in multiple
relationships without being moved or copied. The first relationship is a plain
"related to" connection, visible from either endpoint. Typed relationships and
saved cross-folder collections can grow from actual use.

The user authorized creating a plan and beginning implementation, with subagents
as needed. This document records that direction, not a new approval gate.

## Delivery sequence

1. **Browse and resume:** selection does not navigate; explicit open does;
   previews do not create tabs; Back restores the collection's selection and
   scroll. This is the implementation scope of the accompanying first-slice plan.
2. **Organize and associate:** add portable authored metadata, a small set of
   properties, bulk property edits, remembered folder views, and Related UI.
   Start with connecting two existing items, seeing the connection from either
   end, and following it through the navigation established in slice 1.
3. **Create in context:** disk-backed note creation/editing and references to
   source material, with save/conflict feedback. Retire legacy storage only after
   a verified export path exists.
4. **Retrieve and extend:** indexed content search, saved cross-folder
   collections, richer relationship types, then optional hosted access/sync.

Slices 2–4 are roadmap boundaries, not work claimed by the first-slice plan.
They each need their own storage/UI implementation plan. Their ordering keeps
rich associations in the first organizing milestone rather than relegating them
to a graph visualization project.

## Association design constraints for the next slice

- Author each relationship once; derive its reverse presentation.
- Keep authored properties and relationships on disk, outside disposable caches.
- File operations performed by Opal must preserve associations. Renaming a
  directory must preserve links to its descendants too.
- A missing or inaccessible target remains legible and can be disconnected;
  never silently redirect an association to an unrelated replacement file.
- Decide stable identity and portable reference resolution before implementing
  metadata writes. Existing path-remap events are useful for live navigation but
  are not durable identity.
- An inspector's Related section supports adding, following, and removing a
  connection with inline errors. No graph view is required.

## Slice 1: browse and resume

The existing workspace shell and pure navigation model are retained. The main
gap is that rendered components still infer directory from selection and create
preview tabs, while FilesRoute only applies URL state in one direction.

### Interaction contract

| Action | Result |
| --- | --- |
| Single click a file or folder in collection | Select; stay in current directory; do not open a tab |
| Cmd/Ctrl click or Shift click | Existing multi-selection behavior, including folders |
| Double click folder | Navigate into it and add a history entry |
| Double click file / Cmd+Down | Explicitly open the file in a real tab and focused main surface |
| Activate sidebar folder / breadcrumb | Navigate to directory through the same route history |
| Space on selected file | Modeless Quick Preview; no navigation or tab creation |
| Return on selected item | Rename, retaining existing Finder-style convention |
| Back/Forward | Restore route, collection selection/focus, view and scroll position |
| Select another item / scroll | No push or replace in route history |

The focused main surface reuses existing per-modality DetailPane renderers.
Provide an explicit return-to-folder action. Browse shows the collection and a
contextual selected-item preview, never an unrelated formerly active tab.
Opened tabs remain real files and can be activated or closed through history-
aware actions. A missing opened file shows a truthful unavailable state rather
than falling back to the selected item's contents.

### Architecture

React Router is the navigation authority. Use the existing FilesLocation,
filesLocationSnapshots, and pathMutationCoordinator. Introduce a small Files
navigation context/hook if needed to share actions across collection, breadcrumb,
tabs and focus controls. Standalone DiskExplorer tests may use a local adapter;
the production route must not acquire a second competing history stack.

Collection snapshots are non-routing state. Capture before departure, restore
after the destination listing is ready, and avoid restoration being overwritten
by mount-time scroll-to-selection or filter effects. Preserve the distinction
between gallery and details offsets. Do not recursively load a disk to resolve a
focused file: use cached entry or guarded diskAPI.stat with stale-request handling.

App rename/move remaps the live route using replace, plus existing selection,
tab and snapshot participants. External deletion clears stale state without
guessing identity. Closed roots must not remain live in navigation. Browser
history entries referring to old/missing paths must resolve safely when revisited.

Keep existing buffered collection typeahead and prevent shortcuts from acting
inside inputs, editors, dialogs, menus, or other independent controls. Do not add
an accessibility redesign or styling overhaul to this slice.

### Verification

Use component/store tests for actual pointer, keyboard, route, snapshot and
mutation behavior. No visual regression tests. Run npm test, TypeScript and lint
against a recorded baseline; fix regressions introduced by this slice. Run the
existing Electron E2E suite without adding tests for appearance. Any manual
visual checks use temporary folders and isolated app data, never the user's
information library.

### Deferred from older UX plan

The 2026-09-04 plan remains useful design reference, but is not a mandate to
finish all 19 tasks before demonstrating the information-workspace product.
This slice takes navigation continuity and a minimal focused surface from Tasks
7/11/12. It does not claim completion of their full ARIA, typeahead-tree,
responsive inspector, display options, command registry, or visual polish scope.

