# Task 2 report: Details and Related workflow

## Status

Implemented the complete Task 2 main/preload/renderer slice on `codex/core-ux` from backend base `e5e2223879236772c7913f07f2c44ecaf2196004`. Normal folder browsing, selection, resume, and Preview do not request metadata. Details is the only renderer entry point that loads it.

## Changes

- Added `MetadataHandlers` with four separately namespaced IPC handlers, renderer payload shape checks, `DiskResult`-compatible responses, and actionable `MetadataError`/allowed-root failures.
- Created one module-scope `MetadataService` in main, injected it into `FileWriter`, connected watcher invalidation, and registered the metadata handlers after roots load. The service and file writer share the service queue.
- Added the preload `metadataAPI` and matching global `MetadataAPI` type.
- Updated `DiskHandlers` to surface exported metadata-aware file-operation errors rather than replacing them with generic text.
- Added Preview and Details tabs to `DetailPane`, with Preview selected on first mount. Details preserves the selected tab across item changes while keying all editor state and async work to the selected path.
- Added explicit Details loading, tags, description, Save/Saving/Saved/error states, deliberate Reload Details, incomplete-catalog warnings, and Related rows.
- Available Related files open through `openFile`; available folders open through `navigateDirectory`. Missing and ambiguous targets are visibly labeled, have no path fallback, and cannot be opened. Removal always uses the current Details path plus the edge ID and never deletes an item.
- Property drafts block Add/Remove with visible guidance, so relation refreshes cannot silently discard unsaved edits. Relation success uses the returned full `ItemMetadata` and preserves chooser browsing state.
- Added a controlled Related chooser using the shared Radix Dialog: opened roots, current folder, bounded Up navigation, current-list filter, explicit radio selection, separate folder Browse controls, Connect/Cancel, loading/empty/error states, submit suppression, and stale/unmount guards. No recursive search or mutation occurs before Connect.
- Details and chooser async paths handle both `success: false` and rejected bridge promises without leaving loading or busy states active. StrictMode effect replay is covered.
- Marked tabs, Details, and chooser surfaces to opt out of the explorer's global file shortcuts.
- Nested chooser Escape closes the chooser without closing Quick Look.
- Added a renderer-only valid-YAML-frontmatter stripper for Markdown Preview. It accepts the same opening and closing delimiter shapes used by authored Markdown metadata, leaves invalid/unclosed blocks visible, and does not enable raw HTML.

## Shared interfaces

`window.metadataAPI` exposes exactly:

```ts
read(path: string): Promise<DiskResult<ItemMetadata>>
saveProperties(path: string, properties: ItemProperties,
               expectedRevision: string): Promise<DiskResult<ItemMetadata>>
addRelated(path: string, targetPath: string): Promise<DiskResult<ItemMetadata>>
removeRelated(path: string, edgeId: string): Promise<DiskResult<ItemMetadata>>
```

IPC channels are `metadata:read`, `metadata:save-properties`, `metadata:add-related`, and `metadata:remove-related`.

## Accessible labels for Electron acceptance

- Tabs: `Preview`, `Details` within tablist `Item view`.
- Properties: `Tags`, `Description`, `Save`, `Reload Details`.
- Related: `Add related item`, `Open <target name>`, `Remove related item <target name>`.
- Chooser dialog/title: `Add related item`.
- Chooser roots and navigation: `Opened folders`, `Browse opened folder <root name>`, `Up one folder`, `Current folder <folder name>`, `Filter items`.
- Chooser entries: radio label is the item name; directories also expose `Browse <folder name>`.
- Chooser actions: `Cancel`, `Connect`, and the shared dialog `Close dialog`.
- Quick Look remains labeled by the selected entry name and `Close preview`.

Visible states include `Loading Details…`, `Saving…`, `Saved`, `Loading folder…`, `Connecting…`, `Missing`, `Ambiguous`, `Related results may be incomplete.`, `No related items.`, `No opened folders.`, and `No items in this folder.`

## TDD evidence

All test commands used `npm test`, including its native Node ABI rebuild. No Electron rebuild, E2E run, app restart, merge, or push was performed.

1. Initial UI RED:
   `npm test -- src/tests/unit/detailPane.test.tsx src/tests/unit/textPreview.test.tsx src/tests/unit/quickLook.test.tsx src/tests/unit/fs/diskHandlers.test.ts`
   produced **12 failed / 43 passed**. Failures covered absent Details tabs/load/save/stale protection/Related UX, nested chooser Escape, visible Markdown frontmatter, and hidden metadata-aware file errors. Log: `/tmp/opal-task2-red-ui.log`.
2. First focused implementation run:
   `npm test -- src/tests/unit/detailPane.test.tsx src/tests/unit/textPreview.test.tsx src/tests/unit/quickLook.test.tsx src/tests/unit/fs/diskHandlers.test.ts src/tests/unit/fs/metadataHandlers.test.ts`
   produced **54 passed / 1 failed**, plus one handler-suite setup error. This isolated Quick Look's capture-phase Escape ordering and a missing test logger mock. Log: `/tmp/opal-task2-green1.log`.
3. Focused GREEN after those fixes: the same command produced **63 passed / 5 files**. Log: `/tmp/opal-task2-green2.log`.
4. StrictMode RED: `npm test -- src/tests/unit/detailPane.test.tsx` produced **2 failed / 16 passed**, proving the initial liveness refs remained false after effect replay. Log: `/tmp/opal-task2-strict-red.log`.
5. StrictMode GREEN: the same command produced **18 passed / 1 file**. Log: `/tmp/opal-task2-strict-green.log`.
6. Rejected-IPC RED: the same component command produced **3 failed / 18 passed** and three matching unhandled rejections for load, save, and chooser roots. Log: `/tmp/opal-task2-ipc-reject-red.log`.
7. Rejected-IPC GREEN: the same command produced **21 passed / 1 file**. Log: `/tmp/opal-task2-ipc-reject-green.log`.
8. Removal RED: with the current-path removal behavior withheld, the component command produced **1 failed / 22 passed** because `removeRelated('/V/note.md', 'edge-1')` was never called. Log: `/tmp/opal-task2-remove-red.log`.
9. Final focused GREEN including the IPC source contract:
   `npm test -- src/tests/unit/detailPane.test.tsx src/tests/unit/textPreview.test.tsx src/tests/unit/quickLook.test.tsx src/tests/unit/fs/diskHandlers.test.ts src/tests/unit/fs/metadataHandlers.test.ts src/tests/unit/ipcContract.test.ts`
   produced **73 passed / 6 files**. Log: `/tmp/opal-task2-focused-final-candidate.log`.

## Full verification

- Final `npm test`: **696 passed / 69 files**, exit 0, 8.83 s Vitest duration. Baseline was 669 / 68; Task 2 adds **27 tests and one test file**. Log: `/tmp/opal-task2-full-final.log`.
- The preceding full run had one timing-sensitive `DiskWatcher` nested-directory miss (**695 passed / 1 failed**); the isolated watcher rerun passed **7/7**, and the fresh final full run passed **696/696**. Logs: `/tmp/opal-task2-full.log`, `/tmp/opal-task2-watcher-rerun.log`.
- `npm run lint`: exit 0 with **0 errors / 15 pre-existing warnings**, zero new warnings. Log: `/tmp/opal-task2-lint.log`.
- `npx tsc --noEmit`: expected exit 2 with exactly **13 pre-existing errors** in legacy `FolderView`, `NoteView`, and styled-theme code; zero new errors. Log: `/tmp/opal-task2-types-final.log`.
- `git diff --check`: clean.

## Self-review and concerns

Reviewed the main/preload/renderer boundary, handler payload validation, allowed-root delegation, shared mutation queue, watcher invalidation, explicit-only metadata reads, absence of path-hint navigation, incoming-row display semantics, current-path relation removal, stale read/save/mutation responses, StrictMode replay, rejected IPC promises, dirty drafts, chooser directory selection versus browsing, bounded Up navigation, filter scope, modal Escape ownership, file-shortcut isolation, frontmatter parsing, and accessible names.

No unresolved Task 2 implementation concern was found. The repository retains its documented 13 TypeScript errors and 15 lint warnings. Existing tests also emit known React act, router-future, logger-mock, and Node deprecation warnings. Parent owns the disposable Electron acceptance and final Electron ABI rebuild; those were intentionally not run here.

## Review fix round 1

- Extracted the full YAML and authored-metadata schema parser into renderer-safe `src/common/metadataValidation.ts`. Main's `MetadataCodec` delegates to it and translates validation failures back into the existing exported `MetadataError`; Preview uses the same parser to decide whether frontmatter may be hidden. Aliases, custom tags, invalid tags/annotation/identity/links, unclosed blocks, and metadata over 64 KiB remain visible. Valid ordinary and comment-only metadata is stripped.
- Reset chooser selection and listing state on every close/open cycle. Connect is disabled and guarded until the selected target belongs to the freshly loaded current listing. Failed or empty root refreshes clear stale directories and entries; a prior folder is retained only when refreshed roots still authorize it, and it must be re-read before selection or submission.

RED command:
`npm test -- src/tests/unit/textPreview.test.tsx src/tests/unit/detailPane.test.tsx src/tests/unit/fs/metadataService.test.ts`

RED output: **2 failed files / 1 passed file; 10 failed tests / 63 passed tests**. The failures were the seven invalid/oversized Preview cases and three delayed/failed/empty chooser refresh cases. Duration: 2.92 s. Log: `/tmp/opal-task2-fix1-red.log`.

GREEN command:
`npm test -- src/tests/unit/textPreview.test.tsx src/tests/unit/detailPane.test.tsx src/tests/unit/fs/metadataService.test.ts`

GREEN output: **3 passed files; 73 passed tests**. Duration: 2.86 s. Log: `/tmp/opal-task2-fix1-green-final2.log`.

Review-fix verification:

- Full `npm test`: **69 passed files / 708 passed tests**, exit 0. Duration: 11.37 s. Log: `/tmp/opal-task2-fix1-full.log`.
- Full `npm run lint`: exit 0 with **0 errors / 15 pre-existing warnings**. Log: `/tmp/opal-task2-fix1-full-lint.log`.
- `npx tsc --noEmit`: expected exit 2 with the same **13 pre-existing errors** and no errors in changed files. Log: `/tmp/opal-task2-fix1-types.log`.
- `git diff --check`: clean.
