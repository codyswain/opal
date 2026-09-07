# Files First B verification: Markdown editing

Worktree: `/Users/codyswain/code/opal/.worktrees/core-ux`
Branch: `codex/core-ux`
Spec: `docs/superpowers/specs/2026-09-07-files-first-design.md`, Stream B
Plan: `docs/superpowers/plans/2026-09-07-files-first-b-editing.md`

Status: complete. Preceded by Stream A (`70531ff`), which removed the Notes feature, the SQLite storage and the native rebuild from the test pipeline.

## What shipped

- `MarkdownDocumentService` (`src/main/fs`): reads the body after any frontmatter block, writes it back atomically with BOM, frontmatter bytes and newline style preserved, refuses stale revisions, records `edited` activity, and creates uniquely named `Untitled.md` notes. `MarkdownHandlers` and `markdownAPI` expose read, write and create; conflicts return a distinct recoverable outcome.
- `useMarkdownDocument`: loads once per path, debounces writes 800 ms after the last change, flushes on blur, Cmd+S, leaving the file and window close, never writes a clean document, follows external edits silently while clean, and turns an external edit while dirty into a conflict with Reload from disk and Keep mine. Keep mine waits for a write already in flight before overwriting against the fresh revision.
- `MarkdownEditor`: TipTap with StarterKit, `tiptap-markdown`, task lists, tables, lowlight code blocks, links, typography and a placeholder; a selection toolbar positioned from the selection itself (no popper library); token-based typography for light and dark; a status line with save state and word count. The focused-file surface uses it for Markdown; the Preview pane stays read-only.
- New note on the folder toolbar creates and opens an Untitled note.

## Evidence

Unit and contract: **872 tests pass in 83 files** (`npm test`, no native rebuild). Type check: **0 errors** (was 13 before Stream A removed the styled-components theme). Lint: **8 warnings**, 0 errors (was 15).

Electron: **8 tests pass in 21.1 s**, including the new boot smoke test that replaced the Notes critical path.

Disposable acceptance (`e2e/acceptance/editor-acceptance.mjs`): **14/14 checks**: opens a note without showing frontmatter; starts clean; autosaves typed text with the frontmatter bytes and earlier text intact; Cmd+S saves immediately; follows an external edit while clean; a dirty editor reports a conflict, leaves the external file untouched and keeps the local text; Keep mine overwrites with the editor text and preserves frontmatter; New note creates `Untitled.md`, opens it and autosaves; no renderer errors.

Two defects were found and fixed during verification: the conflict banner's buttons stole focus from the editor, so the blur-triggered save swapped the banner out under the click; and Keep mine could bail while that blur write was in flight.

## Deliberate limits

- `tiptap-markdown` normalizes Markdown it serializes (list markers, emphasis style); an unchanged file is never rewritten, but the first edit to a file formats it that way.
- Images are not embedded or uploaded; links to `http(s)` and `mailto` only.
- No slash commands or table editing controls beyond what TipTap provides by keyboard.
- Editing large files up to 16 MiB is allowed but not tuned.

## Next

Stream C: chat over the files library.
