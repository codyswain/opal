# Properties and Related verification

Worktree: `/Users/codyswain/code/opal/.worktrees/core-ux`  
Branch: `codex/core-ux`  
Starting point for this milestone: `3b3f705`

## Storage evidence

`5809991` implements durable properties and author-once Related connections. `e5e2223` fixes explicit hidden-root indexing after independent review.

Backend verification: **669 tests pass in 68 files**. Type checking reports the same 13 legacy renderer errors; lint reports the same 15 warnings and no errors. The native dependency was built for Node for these tests.

Real temporary-file tests cover Markdown, binary, and directory persistence across service instances; body/BOM/CRLF preservation; unknown YAML fields/comments; malformed, oversized, alias/custom-tag, invalid UTF-8, symlink, collision, and read-only failures; stale revision protection; forward/reverse connections and removal; missing and copied identities; overlapping and explicitly opened hidden roots; paired rename rollback, cross-filesystem rejection, staged trash, and carrier folding.

The review caught an explicit hidden folder being omitted when its visible ancestor was also open. Two regressions reproduced missing connections and missed duplicate IDs. The fix and scoped re-review are complete.

The catalog retains only identity and connection summaries, without parsed YAML documents or Markdown buffers. Ordinary browsing does not build the catalog.

## Interface and app acceptance

`fadacb6` implements Details/Related UI, main/preload wiring, explicit metadata loading, error recovery, draft protection, and frontmatter preview. **696 unit/contract tests pass in 69 files**. One preceding run missed a timing-sensitive existing watcher event; its isolated rerun passed 7/7, followed by two passing full runs including precommit. Type/lint baselines remain unchanged.

**Nine Electron tests pass in 27.1 seconds**, including metadata read/save/add/reverse/remove through the real IPC boundary and refusal outside opened roots. These assertions extend existing sessions, preserving the test-count budget.

Disposable Electron acceptance **passed** through native controls: save binary tags/description; create a connection in the chooser; follow and inspect its reverse; Back restores the browse URL; rename the binary through Opal and retain properties/links; remove from the reverse endpoint while preserving both files; connect and follow a directory; reopen with a fresh profile and rebuild from disk; replace a target with an untracked same-name file and retain Missing status; remove the missing connection. No renderer errors occurred. The temporary profile and library were removed. The user's running app and existing files remain untouched.

Screenshots were visually inspected for Details, the chooser, and Missing state. Local evidence: `/tmp/opal-metadata-acceptance.log`, `/tmp/opal-metadata-screenshots/{reopened,chooser,missing,reverse}.png`. These are acceptance captures, not screenshot regression tests. Independent UI review remains in progress.

## Deliberate first-slice limits

- The first explicit Details request scans opened roots for reverse connections. Later requests reuse an in-memory index until invalidated; incremental and persistent indexing remain later work.
- Copying an item and its metadata preserves its UUID. Multiple copies are reported as ambiguous rather than resolved arbitrarily.
- Binary identity belongs to its adjacent metadata file. Replacing content while retaining that metadata retains the logical identity.
- Metadata-aware binary moves across filesystems and Markdown/non-Markdown format-changing renames fail before mutation with explanatory errors.
- Paired binary trash uses one recoverable bundle containing the file and its metadata.
- Metadata revisions detect stale edits, but external processes can race the final replacement. Multi-process synchronization and power-loss transactions are outside this slice.
- Markdown properties use frontmatter; other files use adjacent `.opal.yaml` carriers; directories use internal `.opal.yaml`. External tools must carry those sidecars when moving or copying managed binary files.

Typed relationships, graph views, bulk tagging, and sync remain future milestones.
