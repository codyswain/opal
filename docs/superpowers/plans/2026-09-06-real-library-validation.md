# Real-library validation (saved views slice 4)

Worktree: `/Users/codyswain/code/opal/.worktrees/core-ux`
Branch: `codex/core-ux`
Handoff: `docs/superpowers/specs/2026-09-06-recent-and-saved-views-handoff.md`, section 11, slice 4.

Status: first pass complete. The polish below shipped; measurements are from one loaded machine (load average 25 to 35 from other sessions) and are not release guarantees.

## Polish shipped after slices 1 to 3

- Show in folder works from every view, landing in the parent folder with the item selected (`bad3e95`).
- Views with a rolling time window (`within`) re-evaluate on window focus and once a minute while visible, as section 5 of the handoff asks (`bad3e95`).
- A selected item whose row stops matching keeps its preview and Details until the selection changes, with a short explanation in the view header (`bad3e95`, handoff criterion 7).
- Sorting uses one shared `Intl.Collator` in collection queries, folder listings and Recent (`87ddef2`).

## Performance sample

Synthetic library of **10,420 items**: 400 project folders under 20 areas, a quarter Markdown notes with frontmatter tags, a quarter PDFs with sidecars carrying two tags, a quarter images and a quarter text files, a third of folders carrying a `.opal.yaml`. Measured with the main-process classes directly through `vite-node`, no renderer, using `e2e/acceptance`-style temp directories.

| Operation | Before collator | After collator |
|---|---|---|
| Cold query: index build plus evaluate | 3,008 ms | 2,772 ms |
| Warm query, no filters, name sort, 10,420 rows | 261 ms | 38 ms |
| Warm query, kind in [PDF, image] and tags has any [research, reference], touched desc | 72 ms | 34 ms |
| Warm query, name contains "note-1" | 40 ms | 31 ms |
| Targeted refresh of one changed directory plus an unfiltered query | 242 ms | 37 ms |

Warm filter changes now settle well inside the handoff's proposed 100 ms on a 10,000-item library. The cold build is dominated by per-item metadata reads; each read re-walks the item's ancestors for symlinks through the shared codec. A trusted read path for items reached through the index's own symlink-checked traversal would roughly halve the build, but it touches security-sensitive code and is deliberately left for a separate change.

## Evidence artifacts

The three acceptance scripts now live in `e2e/acceptance/` with a README. They are not collected by Playwright, so the Electron budget stays at nine tests.

## Remaining friction noted

- Cold index build on a large library shows the skeleton with an "Indexing your folders…" label but is not cancellable mid-scan; a query issued during the build waits for it.
- Scope chooser offers opened roots and the origin folder only; choosing an arbitrary subfolder means filtering from that folder's toolbar.
- Recent has no Today/Yesterday grouping.
- View drafts do not survive a restart.
