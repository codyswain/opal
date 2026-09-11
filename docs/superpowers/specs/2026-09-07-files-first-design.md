# Files first: editing, chat and views

Date: 2026-09-07
Status: Approved direction from the user in conversation (2026-09-07): the Notes tab and its SQLite storage are removed; the disk-based Files feature is the product; Markdown files are edited in a first-class editor with autosave and conflict detection; chat is rebuilt as a chat over the files library; the saved-views surface gets a polish pass. This document fixes the design for each stream.

## Product model after this milestone

Opal is a fast information workspace over folders on disk. Every item is a file or folder the person opened. Notes are Markdown files; their authored metadata (tags, description, connections) lives in frontmatter or a sidecar as established by the properties design. Recent and saved views gather items by activity and properties. Chat answers questions from the library's text with citations that open the file. There is no second store of notes: the SQLite notes database, its VFS, its embeddings tables and the `/explorer` route are deleted.

## Stream A: remove the Notes feature

Delete `src/renderer/features/file-explorer-v2`, `src/main/services/vfs`, `src/main/database`, `src/main/embeddings`, the `/explorer` route, the `vfsAPI`, `chatAPI`, `adminAPI`, `fileExplorer` and `syncAPI` bridges, their handlers in `main.ts`, the database-admin controls in Settings, the `better-sqlite3` and `sqlite-vss` dependencies, and the native rebuild steps in the `test` scripts. `/` redirects to `/files`. The OpenAI credential stays; it is what chat uses. Tests and E2E specs that exercised Notes are deleted rather than kept green against dead code; the Electron suite keeps its boot, protocol, CSP, IPC and allowed-roots checks against the Files surface. `npm test` no longer needs a native rebuild, and `npm run test:e2e` keeps only the Vite builds.

## Stream B: Markdown editing

### Disk contract

A Markdown file is `[BOM][frontmatter][body]`. The editor edits the body only. Frontmatter bytes, BOM and newline style are preserved exactly; authored metadata keeps being edited through Details. Writes go through the shared mutation queue, replace the file atomically (temp file plus rename in the same directory) and require the revision the editor loaded. A differing revision means the file changed outside the editor: the write is refused and the person chooses.

`MarkdownDocumentService` in `src/main/fs`:

```ts
read(path): { body: string; revision: string; size: number; hasFrontmatter: boolean }   // 16 MiB limit, UTF-8 only
write(path, body: string, expectedRevision: string): { revision: string }               // conflict → MarkdownConflictError
create(parentDir, name): { path: string }                                               // "Untitled.md", "Untitled 2.md", …
```

`revision` is the SHA-256 of the whole file. A successful write records `edited` activity for the file (the `editedAt` field reserved in slice 1) and invalidates the metadata catalog and collection index for that directory through the existing watcher path. IPC: `markdown:read`, `markdown:write`, `markdown:create` under a `markdownAPI` bridge, validated in main like every other channel.

### Editor

`MarkdownEditor` in `src/renderer/features/disk-explorer/components/editor/` replaces the read-only Markdown preview in the focused-file surface and in the Preview pane for `.md` files (the pane stays read-only; the focused surface edits). It is TipTap with StarterKit, `tiptap-markdown` for the document format, task lists, tables, code blocks with lowlight, links, typography and a placeholder. A bubble menu offers bold, italic, code, link, and heading levels; `/` slash commands are not part of this pass. No embed nodes, no base64 images.

Typography follows the shell's tokens: a 68-character measure centered in the surface, the UI font for prose, 1.65 line height, heading scale 1.75 / 1.4 / 1.2 rem with generous top margins, tight list and task spacing, code in the mono token with a raised surface background, blockquotes with a subtle left rule, tables with hairline borders. Light and dark both come from the existing token layer; no hard-coded colors.

### Autosave and conflicts

`useMarkdownDocument(path)` owns the document lifecycle:

- Load through `markdown:read`; the editor is seeded once per path and never re-seeded while dirty.
- Every editor update marks the document dirty; a write is scheduled 800 ms after the last change and flushed immediately on blur, on leaving the file, on window close and on Cmd+S. Nothing is written for a file the person did not change, so loading never rewrites a file.
- A successful write updates the revision and shows "Saved"; in flight shows "Saving…"; dirty shows "Unsaved changes".
- A refused write (revision mismatch) shows a conflict banner with **Reload from disk** (discard the editor's text) and **Keep mine** (write again against the current revision). No automatic merge.
- A `disk:changed` event for the file's folder while the editor is clean re-reads the file and refreshes silently when the revision differs; while dirty it only checks and arms the conflict banner on the next save.
- Write failures other than conflicts keep the text, show the error inline and retry on the next change.

"New note" appears on the folder toolbar and creates `Untitled.md` in the current folder, opens it and focuses the editor with the title line selected. Rename keeps using the existing dialog.

## Stream C: chat over the files library

### Index

`LibraryTextIndex` in `src/main/chat/` builds text chunks for Markdown and plain-text items under the opened roots, using the shared root traversal. Each file is chunked to about 1,200 characters with 200 of overlap, on paragraph boundaries where possible, and each chunk is embedded with OpenAI `text-embedding-3-small` at 512 dimensions. Chunks and vectors persist in `<userData>/library/index/chunks.json` (metadata) and `vectors.f32` (a flat Float32 array), keyed by file path and a content revision, so unchanged files are never re-embedded. Files above 1 MiB, unreadable files and non-text kinds are skipped and reported. PDF text is a later addition and is listed as such in the UI.

Indexing is explicit: the chat surface shows how many files are indexed and offers **Index library** / **Update index**; watcher changes mark files stale for the next update. Nothing is sent to OpenAI without that click or an existing index. Similarity is brute-force cosine over the in-memory vectors, which is well under 100 ms for tens of thousands of chunks.

### Answering

`ChatService.ask(conversationId, question)` embeds the question, takes the top eight chunks above a similarity floor, builds a system prompt that lists them as numbered sources with file names, and streams a completion from `gpt-4o-mini` (model name in one constant, overridable in Settings later) over an IPC event channel. The assistant is instructed to cite sources as `[n]` and to say when the library has nothing relevant. The response carries the resolved sources so the UI can render citations that open the file with the existing navigation. Conversations persist as `<userData>/library/chat/<id>.json` (title, messages, sources); the list shows the last thirty.

Without an OpenAI key the chat surface explains and links to Settings. Errors from the API are shown inline on the message; a failed answer never loses the question.

### Surface

A `/chat` route in the shell with a conversation list, the message thread with citations, and a composer. The sidebar's primary navigation shows Files, Recent, Chat and Settings. The index status and controls live at the top of the thread.

## Stream D: views surface polish

- Tag chips suggest existing tags from the collection index (`collections:tags` returns the distinct meaningful tags with counts) while typing.
- The scope control gains a folder picker that browses opened roots with the existing directory listing, so any subfolder can be a scope without leaving the view.
- List rows in views show tags as small pills after the name.
- Cmd+F inside a view focuses the first chip's text input or adds a Name chip.

## Testing

Unit and contract tests for the document service (BOM, CRLF, frontmatter preservation, conflicts, create naming), the editor hook (debounce, flush, conflict paths, no write when clean), the chunker and vector store (deterministic chunks, incremental update, skipped files), the chat service with a fake OpenAI client (source selection, citation mapping, streaming), the tags channel and the folder picker. Electron tests keep nine or fewer; the boot test moves from the Notes UI to the Files surface. The disposable acceptance scripts gain an editor script (type, autosave, external edit, conflict) and a chat script with a stubbed OpenAI endpoint is out of scope; chat is verified by unit tests and a manual run with a real key.

## Sequence

A (removal) first, because it simplifies the build and test pipeline. Then B (editing), then C (chat), then D (views polish). Each stream has its own plan and verification note.
