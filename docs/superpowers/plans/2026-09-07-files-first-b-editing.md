# Files First B: Markdown Editing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit Markdown files on disk in a first-class TipTap editor with autosave, revision-checked writes that preserve frontmatter, a conflict banner, and New note.

**Spec:** `docs/superpowers/specs/2026-09-07-files-first-design.md`, Stream B.

## Global Constraints

- Same worktree and branch; baselines after stream A: 856 tests in 80 files, 0 type errors, 8 lint warnings, 8 Electron tests.
- The editor edits the body only; BOM, frontmatter bytes and newline style are preserved; nothing is written for an unchanged file.
- Writes go through the shared mutation queue, replace atomically, and require the loaded revision.

### Task 1: `MarkdownDocumentService`, IPC and bridge

**Files:** create `src/main/fs/MarkdownDocumentService.ts`, `src/main/fs/MarkdownHandlers.ts`, `src/types/markdown.ts`, `src/renderer/shared/types/markdownApi.d.ts`, `src/tests/helpers/markdownApi.ts`; modify `src/main/fs/MetadataCodec.ts` (export the frontmatter splitter), `src/main/activity/ActivityService.ts` (`noteEdited`), `src/preload.ts`, `src/main.ts`; tests `src/tests/unit/fs/markdownDocumentService.test.ts`, `src/tests/unit/fs/markdownHandlers.test.ts`.

**Produces:**

```ts
interface MarkdownDocument { path: string; body: string; revision: string; size: number; hasFrontmatter: boolean }
class MarkdownDocumentService {
  read(target): Promise<MarkdownDocument>;                                   // 16 MiB limit, UTF-8, allowed roots, no symlinks
  write(target, body, expectedRevision): Promise<{ revision: string }>;      // MarkdownConflictError on mismatch
  create(parentDir, baseName = 'Untitled'): Promise<{ path: string }>;      // Untitled.md, Untitled 2.md, …
}
```

- [ ] Tests: read splits BOM/frontmatter/body for LF and CRLF; write preserves BOM, frontmatter bytes and CRLF, ends with the original trailing newline rule, changes the revision, records `edited`, refuses a stale revision without touching the file, refuses paths outside roots and symlinks, refuses non-Markdown, refuses oversized files; create picks unique names and refuses invalid names; handlers validate arguments and map conflicts to `{ conflict: true }`.
- [ ] Commit `feat(files): edit Markdown bodies on disk with revision checks`.

### Task 2: Editor, autosave hook and focused surface

**Files:** create `src/renderer/features/disk-explorer/components/editor/MarkdownEditor.tsx`, `editorExtensions.ts`, `editor.css`, `useMarkdownDocument.ts`, `EditorStatus.tsx`; modify `DiskExplorer.tsx` (focused surface picks the editor for Markdown), `Toolbar.tsx` (New note), `FilesNavigationContext` unchanged; tests `src/tests/unit/useMarkdownDocument.test.ts`, `src/tests/unit/markdownEditor.test.tsx`, `toolbar.test.tsx`.

- [ ] Hook: load once per path; `onChange` marks dirty and schedules a write 800 ms later; `flush` on blur, Cmd+S, unmount and before-unload; conflict state with `reloadFromDisk` and `keepMine`; `disk:changed` for the file's folder refreshes a clean document silently.
- [ ] Editor: StarterKit, `tiptap-markdown`, task lists, tables, lowlight code blocks, links, typography, placeholder, bubble menu; seeded once; `getMarkdown()` on update; status line; conflict banner.
- [ ] Toolbar New note creates `Untitled.md` and opens it.
- [ ] Commit `feat(files): Markdown editor with autosave and conflict handling`.

### Task 3: Verification

- [ ] `npm test`, type check, lint, E2E; an editor acceptance script (type, autosave, external edit, conflict, new note) under `e2e/acceptance/`; verification note.
