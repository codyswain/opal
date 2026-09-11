# Properties and Related

Opal's next usable slice makes every file and folder an information item. In the existing Preview pane, an explicit Details tab lets someone save tags and a description, connect another item, see the same connection from either endpoint, and follow it using existing navigation. Opening folders and selecting items remain fast and do not scan the workspace or write metadata.

## Disk contract

Authored data travels with the item. Markdown uses YAML frontmatter: top-level `tags` and `annotation`, with `opal: {schema: 1, id, links}`. Other files use adjacent `<filename>.opal.yaml`; directories use internal `.opal.yaml`, with top-level `schema`, `id`, `tags`, `annotation`, `links`. Existing unrelated YAML fields are preserved. UUIDs are allocated on first save or connection, never on read. A connection is authored once as `{id, targetId, pathHint}` in its source's links. Reverse connections are derived. UUID lookup is authoritative; a path hint alone never resolves a missing identity. Duplicate copied IDs are ambiguous, not silently resolved. A binary item's identity belongs to its sidecar; replacing bytes while retaining its sidecar retains that logical identity.

A disposable in-memory catalog scans only explicitly opened roots, on first Details/Related request. It is rebuilt after invalidation; no catalog data is authored truth. Root overlap is deduplicated. Skip symlink traversal and hidden trees except recognized metadata. Reads are bounded. Scan failures are surfaced as incomplete results. No scan runs on normal folder browsing. This first slice favors correctness over incremental indexing; large-root indexing and persistent acceleration follow later.

Metadata mutation is guarded by allowed roots, rejects symlink carriers, preserves Markdown body bytes/BOM/newlines, and fails clearly on malformed, unsupported, or oversized metadata. YAML aliases and custom tags are rejected. Existing unrecognized sidecar collisions are never overwritten. Same-directory atomic replacement plus expected revision checks protects stale edits; all app metadata and file mutations share a queue. Concurrent external writers can still race the final replacement; multi-process synchronization is outside this slice.

App rename/move carries metadata with files and whole folder subtrees. Paired file/sidecar changes preflight both destinations and roll back the primary if the second rename fails. Managed binary moves across filesystems fail safely with an explanatory error for now; existing unpaired moves keep their behavior. Trash a managed binary and sidecar in one staged directory, rolling back staging or a failed trash operation; the pair is recoverable together in Trash. No unrelated source or destination is overwritten. Invalid carriers remain visible and actionable rather than silently folded into an item. Valid adjacent carriers are hidden from ordinary listings; directory metadata is hidden normally.

## UX contract

Preview remains the default tab. Details loads explicitly, with loading, error, empty, and incomplete-index states. Tags and description save together with an explicit Save button and conflict error; unsaved changes do not leak into another item. Related has an Add action opening an accessible folder chooser rooted in allowed folders, with browse/up controls and explicit Connect. It supports files and folders. Each connection shows available, missing, or ambiguous status; available endpoints can be opened and all connections can be removed from either end. Removing a connection never deletes a file. Navigation uses the existing file/folder actions, preserving Back. Saving properties or making a connection does not open another file or close the pane.

Typed relations, graph views, bulk tagging, global search, sync, remembered property views, and full incremental indexing are later work.

## Acceptance

Real temporary files prove fresh-service persistence, forward/reverse lookup, rename/subtree move preservation, missing and duplicate identities, malformed/collision/symlink rejection, stale revisions, paired rollback, and safe trash staging. Component tests prove explicit Details loading, save/error handling, target-switch protection, choosing and following related items. Existing tests retain browse/resume behavior. A disposable Electron session proves IPC and visible workflow without altering the user's open workspace.
