# Core UX browse and resume — verification

Date: 2026-09-05
Branch: `codex/core-ux`
Base: `ae61938`
Implementation: `d21e7e9`, `5507896`, `2e26271`

The first implementation slice in
`2026-09-05-core-ux-browse-resume.md` is complete. The larger information-workspace
roadmap is recorded in `../specs/2026-09-05-core-information-workspace-design.md`.

## Delivered behavior

- Files and folders select without navigating or creating tabs.
- Double-click and Cmd/Ctrl+Down explicitly open folders/files; Return renames;
  Space opens independent modeless Quick Preview.
- Opened files occupy the main workspace using the existing modality viewers.
- Back/Forward and Return to folder restore browse context, including actual
  virtualized list/gallery scroll offsets and selection.
- Preview starts closed and has an explicit toggle. An open preview keeps its
  allocated space through selection and directory changes until explicitly closed.
- Tabs and live routes follow app rename/move operations and clear removed roots
  or missing targets conservatively. Unrelated deletion does not reopen a tab.
- Delayed folder/file reads cannot substitute stale content into the current view.

## Automated verification

| Check | Baseline | Final result |
| --- | --- | --- |
| Unit/contract suite | 590 tests, 65 files passed | 619 tests, 66 files passed in final implementation precommit |
| TypeScript | 13 legacy errors | Exact same baseline, no new errors |
| ESLint | 0 errors, 15 warnings | Same baseline |
| Existing Electron suite | 9 passed, 17.9 seconds | 9 passed, 12.7 seconds after final source fix |

The 29 added navigation regressions cover actual routed interaction, selection,
tab activation/closure, viewport restoration, mutation/removal, delayed reads,
native user-event double-click sequences, and explicit preview allocation.

One full-suite run hit the existing disk-watcher timing sensitivity. The six
watcher tests passed in isolation, and the final full precommit passed all 619
tests. No watcher code or tests were changed for that failure.

TypeScript baseline files are legacy `file-explorer-v2/components/FolderView.tsx`,
`file-explorer-v2/components/NoteView.tsx`, and `styles/common/components.ts`.
They remain follow-up maintenance, not concealed by this feature's result.

## Real Electron acceptance and visual inspection

A disposable project folder and isolated application/database directories were
used at 1440×900. The acceptance script exercised native pointer clicks through
folder selection/opening, Back, note selection, explicit Preview, focused note
opening, returning, and opening the rightmost initial gallery tile. It passed
with no renderer errors. Browse, focus, and returned-state screenshots were
visually inspected. No user library was used or changed.

The real-window check caught two issues beyond the original synthetic tests:
inline react-window renderers remounted click targets, and automatic preview
opening moved gallery tiles between clicks. Stable renderers and explicit preview
allocation fix those problems; focused regressions cover both.

This was not a comprehensive responsive, dark-theme, accessibility, or modality
visual audit. No visual regression tests were added.

## Review and scope

Independent task review identified the native double-click defect. The final
branch review confirmed its fix and found the unrelated-deletion tab activation
defect. Scoped re-review of the final correction found both remaining findings
addressed and no new important regressions.

Some deprecated store adapters remain for compatibility; production selection no
longer creates preview tabs. The old 19-task visual redesign is not claimed
complete. Properties, associations and durable item identity, disk note editing,
legacy migration, and self-hosting remain subsequent roadmap slices.

Next milestone: design durable disk-backed identity and authored metadata, then
deliver properties and a Related section that can connect two multimodal items,
show the connection from either end, and navigate through the flow built here.
