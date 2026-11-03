# Saved views (saved views slice 3)

Date: 2026-09-06
Status: Design for the third vertical slice of `docs/superpowers/specs/2026-09-06-recent-and-saved-views-handoff.md`, building on the Recent and filtered-collections designs. The handoff remains the product authority; this document fixes the file format, the draft model and the conflict rules.

## Goal

A narrowed collection that is useful again can be saved by name. It appears in the sidebar, reopens with the same scope, filters, sort and layout, survives restart, and can be renamed, duplicated and removed. Editing a saved view never silently overwrites its durable definition: changes form a draft with Save changes, Save as new and Reset. An external edit is detected at save time and both states stay recoverable.

## Storage

Definitions live in the library configuration directory established in slice 1:

```
<userData>/library/views/<id>.yaml     one view per file, human-readable
<userData>/library/views/.trash/       removed definitions, kept for undo
<userData>/library/library.json        { version: 1, viewOrder: [ids] }
```

A view file:

```yaml
schema: 1
id: 6f1c…                      # UUID; must equal the file name
name: Project references
layout: list                   # list | gallery
query:
  version: 1
  scope: { kind: folders, folders: ["/Users/…/Projects"], includeDescendants: true }
  filters:
    - { field: kind, op: in, values: [pdf, image] }
    - { field: tags, op: has-any, values: [reference] }
  sort: { field: name, direction: asc }
```

Rules:

- The file holds only the definition: no cached results, selections, scroll offsets or activity. Sidebar order lives in `library.json`.
- Reading validates `schema`, the id/file-name match, `layout`, `name`, and the query through the shared validator. A file that fails is listed as unreadable with its error and left untouched; it never breaks the other views.
- Writes are atomic (temp file plus rename in the same directory). Every stored view carries a `revision`, the SHA-256 of its file bytes. `save` requires the caller's expected revision to equal the current file's revision; otherwise it fails with a conflict and writes nothing.
- Remove moves the file into `.trash/` with a timestamp; `restore` moves it back while the session's undo window lasts. Trash is bounded to the last 20 removals.
- Scope folders stay absolute. A view whose folder is no longer inside an opened root shows the existing unavailable-scope banner with the existing scope control to remap it; that is the explicit remapping the handoff asks for, and nothing searches elsewhere.
- The `views/` directory is watched; external creates, edits and deletes refresh the sidebar list within a moment. They never touch an open draft.

## Draft model

`viewDraftsStore` (the generalized slice 2 draft store) holds one draft per collection id:

```ts
interface ViewDraft {
  id: string;                  // transient draft id or saved view id
  name: string;
  query: CollectionQuery;
  layout: 'list' | 'gallery';
  origin: string | null;
  saved: { name; query; layout; revision } | null;  // baseline for a saved view; null for transient
}
```

- A transient draft (`{ kind: 'query' }`) has no baseline. **Save view** asks for a name, creates the file, navigates to `{ kind: 'view'; id }` and drops the transient draft.
- Opening a saved view creates a draft from its definition if none exists; an existing draft keeps its edits. `edited` is true when name, query or layout differ from the baseline; the header shows **Edited** with **Save changes**, **Save as new** and **Reset**.
- **Save changes** sends the draft with the baseline revision. On success the baseline updates. On conflict the UI says the view changed on disk and offers **Reload from disk** (replace the draft with the file, discarding edits) or **Save as new** (write the draft under a new id, leaving the external file intact). Both states remain recoverable until the person chooses.
- **Reset** restores the baseline. **Rename** edits the name inline and is saved like any other change. **Duplicate** creates a new file from the saved definition and opens it. **Remove** deletes the definition after a confirmation, shows an Undo toast for a short window, and navigates to Recent or the first root.
- Drafts survive opening an item and Back, and switching collections, for the session. They are never persisted; slice 3 does not add a draft file.
- Layout is part of the definition. The list/gallery toggle inside a view edits the draft's layout; the snapshot store still restores the scroll position.

## Navigation

`FilesCollection` gains `{ kind: 'view'; id: string }`, serialized as `collection=view&id=…`. A view id is valid when the saved-views list contains it. Focus locations opened from a view keep the view collection, so Return and Back land on the same draft. `collectionForFile` treats views like queries.

## IPC

`viewsAPI` on the preload bridge, `ViewHandlers` in main:

| Channel | Payload |
|---|---|
| `views:list` | → `SavedViewsListing { views: SavedView[]; unreadable: { file; error }[] }` |
| `views:create` | `(definition)` → `SavedView` |
| `views:save` | `(id, definition, expectedRevision)` → `SavedView`; conflict returns `{ success: false, error, conflict: true }` |
| `views:duplicate` | `(id)` → `SavedView` |
| `views:remove` | `(id)` → `{ undoToken }` |
| `views:restore` | `(undoToken)` → `SavedView` |
| `views:changed` | main → renderer after any list change, coalesced 150 ms |

Main validates names (1 to 120 characters after trimming), layouts, ids (UUID), and queries through the shared validator.

## Surface

- Sidebar Views section: saved views in stored order, then transient drafts; unreadable files appear as a disabled row with the error in its title. New view stays.
- `QueryView` header for a view: editable name, **Edited** badge, and the action row described above. For a transient draft: **Save view**.
- Save as new and Save view use a small name dialog built on the existing `Dialog`.

## Testing

Unit with temp directories: repository create/list/save/conflict/duplicate/remove/restore/order/unreadable-preservation/atomic write; handler validation and conflict shape. Renderer: view collection URL round trip; draft baseline, edited flag, reset, save success, conflict path offering both recoveries, save as new from a transient draft, remove with undo, sidebar listing and activation, restart-shaped reload (fresh store from a listing). No new Electron tests; the disposable acceptance covers handoff criteria 5, 12 and 13 plus a restart.

## Out of scope

Reordering views by drag, sharing or exporting views as a bundle, per-view custom columns, nested groups, draft persistence across launches, and remapping scopes automatically.
