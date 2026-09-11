# Files First C verification: chat over the library

Worktree: `/Users/codyswain/code/opal/.worktrees/core-ux`
Branch: `codex/core-ux`
Spec: `docs/superpowers/specs/2026-09-07-files-first-design.md`, Stream C
Plan: `docs/superpowers/plans/2026-09-07-files-first-c-chat.md`

Status: complete for unit and contract verification. A conversation against the real OpenAI API needs the user's key and is theirs to run.

## What shipped

- `src/main/chat/`: `chunkText` (paragraph-aware, overlapping, deterministic), `OpenAIEmbeddingProvider` (`text-embedding-3-small`, 512 dimensions, batched, normalized), `LibraryTextIndex` (Markdown bodies without frontmatter and text files under 1 MiB, embedded only when their content hash changed, persisted as `chunks.json` plus a flat `vectors.f32` under `<userData>/library/index/`, stale counting from the watcher, brute-force cosine search), `ChatService` (JSON conversations under `<userData>/library/chat/`, question embedding, numbered sources, streamed `gpt-4o-mini` answer with a citation instruction, failures recorded on the assistant message) and `ChatHandlers` (per-question stream channel with a `null` sentinel).
- Renderer: `/chat` route with a conversation list, Markdown-rendered thread whose assistant messages list numbered sources that open the file and record an open, a composer (Enter sends, Shift+Enter breaks a line), and an index status bar. Indexing is an explicit click; without a key the bar links to Settings. Chat joins the sidebar.

## Evidence

Unit and contract: **893 tests pass in 88 files**. Type check: **0 errors**. Lint: **8 warnings**, 0 errors, unchanged from Stream A.

Electron: **8 tests pass in 16.8 s**.

Covered by tests with fakes: chunk boundaries and overlap; index build, incremental re-embedding of changed files only, removal, persistence and reload, skipped large files, stale marks, provider failure without losing the previous index, serialized concurrent updates; answers with numbered sources and inline citations, the unindexed-library instruction, missing-key and completion failures preserving the question; handler channel validation and stream framing; store load, send, error and index refresh flows; route rendering for unindexed, indexed, missing-key, sending, cited-answer and source-open paths.

Not verified here: real embedding quality and real streaming latency. Both depend on the OpenAI account and are best checked by the user with their key.

## Deliberate limits

- Markdown and plain text only; PDF text extraction is a later addition.
- Retrieval is top-eight chunks by cosine similarity with a fixed floor; no reranking, no per-folder scoping yet.
- Conversations are capped at thirty; the index is rebuilt in full when the embedding dimensions change.
- Cancel stops listening to the stream; the request itself completes in main.

## Next

Stream D: views polish (tag suggestions, a real folder picker for scope, tag pills in rows, Cmd+F in a view).
