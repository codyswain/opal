# Files First C: Chat over the Library

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the deleted notes chat with a `/chat` route that answers from the opened folders' Markdown and text, with an explicit, incremental embedding index and citations that open the file.

**Spec:** `docs/superpowers/specs/2026-09-07-files-first-design.md`, Stream C.

## Global Constraints

- Nothing is sent to OpenAI without an explicit Index or Update click, or a question typed into chat. The key comes from `CredentialManager`; no key means a clear notice, never a silent failure.
- Index and conversations live under `<userData>/library/index/` and `<userData>/library/chat/`; never in opened roots.
- Models are single constants: `text-embedding-3-small` at 512 dimensions, `gpt-4o-mini`.
- Baselines after Stream B: 873 tests, 0 type errors, 8 lint warnings, 8 Electron tests.

### Task 1: Main process

**Files:** create `src/types/chat.ts`, `src/main/chat/chunkText.ts`, `src/main/chat/EmbeddingProvider.ts`, `src/main/chat/LibraryTextIndex.ts`, `src/main/chat/ChatService.ts`, `src/main/chat/ChatHandlers.ts`, `src/renderer/shared/types/chatApi.d.ts`, `src/tests/helpers/chatApi.ts`; modify `src/main/library/libraryPaths.ts`, `src/preload.ts`, `src/main.ts`; tests under `src/tests/unit/chat/`.

**Produces:**

```ts
chunkText(text, { size: 1200, overlap: 200 }): TextChunk[]                 // paragraph-aware, deterministic
interface EmbeddingProvider { dimensions: number; embed(texts: string[]): Promise<Float32Array[]> }
class LibraryTextIndex {
  status(): LibraryIndexStatus;                 // files, chunks, staleFiles, indexing, lastIndexedAt, error, skipped
  update(): Promise<LibraryIndexStatus>;        // walks roots, embeds new or changed files, drops removed, persists
  markChanged(directories: string[]): void;     // watcher hook: counts stale until the next update
  search(vector: Float32Array, k: number, floor: number): IndexHit[];
  load(): Promise<void>;
}
class ChatService {
  list(): Promise<ConversationSummary[]>; get(id): Promise<Conversation | null>; create(): Promise<Conversation>; remove(id): Promise<void>;
  ask(conversationId, question, onDelta: (text) => void): Promise<ChatAnswer>;   // sources resolved before streaming
}
```

IPC: `chat:list`, `chat:get`, `chat:create`, `chat:remove`, `chat:ask` (per-request response channel, `null` sentinel, `{ error }` frames), `chat:index-status`, `chat:index-update`; events `chat:index-changed`. `chatAPI` mirrors these with an `ask(conversationId, question, onDelta)` that returns a cancel function.

- [ ] Tests: chunker boundaries and overlap; index build/incremental/removal/persistence/search with a fake provider over temp files, skipped files reported, stale counting; chat service with a fake OpenAI client (numbered sources, streaming deltas, persisted messages, no-key error, empty-library answer); handler validation.
- [ ] Commit `feat(chat): index the library and answer with citations`.

### Task 2: Renderer

**Files:** create `src/renderer/features/chat/` (`ChatRoute.tsx`, `store/chatStore.ts`, `components/ConversationList.tsx`, `MessageThread.tsx`, `Composer.tsx`, `IndexStatusBar.tsx`, `Citation.tsx`); modify `App.tsx` (route), `WorkspaceSidebar.tsx` (Chat item); tests `src/tests/unit/chat/chatStore.test.ts`, `src/tests/unit/chatRoute.test.tsx`, `workspaceSidebar.test.tsx`.

- [ ] Store: conversations, active conversation, messages, streaming text, index status, send/cancel, index update; subscribes to `chat:index-changed`.
- [ ] Route: conversation list, thread with Markdown rendering and numbered citations that open the file (records `opened`), composer with Enter to send and Shift+Enter for newline, index status bar with Index library / Update index and the no-key notice linking to Settings.
- [ ] Commit `feat(chat): chat route with citations and index controls`.

### Task 3: Verification

- [ ] `npm test`, type check, lint, E2E; verification note. A manual run with a real key is the user's; unit tests cover the service with a fake client.
