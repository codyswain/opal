# Opal Vault Architecture — Design Spec

**Date:** 2026-08-16
**Status:** Superseded in part by Revision 2 (2026-08-17) — read that section first
**Scope:** The storage-model rewrite that turns Opal into a metadata layer + UX over a real filesystem. Sub-project 1 (vault engine + migration) is specified in detail; sub-projects 2–5 are outlined for sequencing.

> **⚠️ Read [Revision 2](#revision-2--2026-08-17) before implementing.** The technical
> decisions in Part III still hold. The *product framing* and *build order* in Part I
> changed after further design work: Opal browses the real filesystem rather than owning
> a single vault, and the SQLite→markdown migration is demoted from first to fifth.

---

## Part I — The Big Picture

### What Opal is becoming

Opal today is a notes app whose data lives inside a SQLite database. Opal tomorrow is something different and bigger:

> **A rich metadata layer over a real directory tree, plus a UX that merges the two.** A notes app falls out as a special case.

The whole system is built from four primitives:

1. **Files** — a plain directory tree you choose to care about (a *vault*). Any modality — markdown, images, PDFs, video, data — infinitely nested. The vault is just a folder: greppable, Finder-browsable, and fully legible without Opal.
2. **Links** — authored pointers from anything to anything. Wikilinks and embeds inside markdown; sidecar references for binaries. Today the best you can do is write notes containing file paths; links make those pointers first-class.
3. **Properties** — key/value metadata attachable to anything. YAML frontmatter for `.md` files, sparse sidecar files for binaries. Tags, ratings, annotations, notes-about-a-file.
4. **The index** — everything derived: backlinks, full-text search, embeddings, thumbnails. Stored in a local cache, rebuildable from primitives 1–3 at any time, deletable at any time, never a source of truth.

One rule keeps the whole system consistent:

> **Authored in one direction, derived in the other.** You author forward pointers (a note embeds an album; a photo's sidecar references a note). Reverse views — "which notes mention this photo?" — are always computed by the index, never stored twice.

And one property keeps it simple:

> **Simplicity by absence.** No database as source of truth, no proprietary format, no sync protocol. A snapshot is a git commit. A vault opened in ten years with no Opal installed is still a legible folder of files and YAML.

### The end state, concretely

```
~/OpalVault/                      ← the vault is just a folder (and a git repo)
├── .git/                         ← snapshot history
├── .gitattributes                ← routes binaries to Git LFS
├── .gitignore                    ← excludes .opal/cache/
├── .opal/
│   ├── manifest.json             ← app version + code hash, schema version, timestamp
│   ├── config.json               ← vault-level settings
│   └── cache/                    ← THE INDEX (gitignored, rebuildable)
│       ├── index.db              ← SQLite: files, links, properties, FTS, embeddings
│       └── thumbs/               ← generated thumbnails
├── Inbox/
│   └── Logs/
│       └── 2026-08-16.md         ← plain markdown, YAML frontmatter, [[wikilinks]]
├── Photos/
│   └── Rwanda/
│       ├── IMG_2041.jpg
│       └── IMG_2041.jpg.opal.yaml  ← sparse sidecar: tags, annotations, links
└── Projects/
    └── Tempo/
        └── design.md
```

A note can embed a photo album inline (`![[Photos/Rwanda/]]`); opening a photo shows every note that references it (computed backlinks); an agent can traverse the entire knowledge structure by reading plain files — no API required.

**Restore story:** `git clone` the repo, open the folder in Opal, and the index rebuilds itself. That is the entire disaster-recovery procedure.

### Why change: current state in one paragraph

All note content currently lives in SQLite as TipTap-serialized **HTML** — there is no disk representation of any note. Images dropped into notes are inlined as **base64 blobs inside the note HTML** in the database. The "sync" API is actually a one-directional folder-mount mirror with several dead IPC channels; full-text search tables exist but are never queried; embeddings are stored in three places and keyed fragilely to SQLite rowids. Nothing about the current storage model is worth carrying forward, and very little of it works as designed. (Full findings in Part II.)

### What we do next: five sub-projects, in order

| # | Sub-project | Outcome | Size |
|---|------------|---------|------|
| 1 | **Vault engine + migration** | Disk is the source of truth. Markdown notes, extracted images, file watcher, rebuildable index. Existing SQLite data exported losslessly. | L |
| 2 | **Snapshot/backup engine** | Vault is a git repo. Auto-commit + push to GitHub, LFS for binaries, self-describing manifest. Restore = clone. | M |
| 3 | **Metadata layer** | Sidecars, properties, and links become first-class in the UX: tag anything, annotate anything, link anything to anything. | M |
| 4 | **Search & indexing** | Real FTS (today's is dead code), quick switcher (Cmd+O), embeddings keyed by content hash, backlinks panel. | M |
| 5 | **UX pass** | The merged explorer: inline album embeds, per-modality viewers, editor polish. | L |

Each sub-project gets its own implementation plan and ships something usable. This spec fully designs #1 and defines the contracts that #2–#5 depend on, so later work doesn't force rework.

---

## Part II — Current State (Examination Findings)

What examination of the codebase found, and what it implies for the design:

**Storage.**
- The entire VFS is virtual: an `items` table (id, type, path, parent_path, name) plus a `notes` table whose single `content` column holds each note's full body as TipTap HTML (`src/main/database/schema.sql`).
- Paths are already POSIX-style strings with a uniqueness constraint and parent links — they map cleanly onto a real directory tree.
- Runtime migrations bolt on `is_mounted`/`real_path` columns; a `mounted_folders` table is referenced but never created; a third, drifted copy of the schema is hardcoded as a fallback in `src/main/database/index.ts`.

**Content format.**
- Saves go through `editor.getHTML()` (`ExploreCenterPanel.tsx:62`). The `tiptap-markdown` extension is installed but only used for paste transformation — markdown serialization is never invoked.
- Dropped images become base64 data URLs inlined in the note HTML and stored in SQLite. There is no paste-image handler at all. There is no blob store of any kind.

**Mount system (the closest thing to prior art).**
- `syncAPI` mounts a real folder: chokidar watches it and mirrors metadata rows (never content) into SQLite. Strictly one-directional disk→DB; the app never writes back to disk. Watchers are not re-established on restart. Folder rename on disk was never implemented (`itemRepository.ts:150` TODO).
- The chokidar configuration (`depth: 99`, `awaitWriteFinish`) is reusable prior art for the vault watcher.

**Search.**
- FTS5 tables and triggers exist but `items_fts` is never `MATCH`ed anywhere — full-text search is dead code. Renderer "search" is a Zustand string with no backend.
- OpenAI embeddings (ada-002) are generated on note save and stored **three times** (base64 JSON in `ai_metadata`, base64 JSON in `embeddings_backup`, Float32 in a `vss0` table). The vector index is keyed to `items.rowid`, so any table rebuild invalidates every vector.

**Broken surface (affects testing during migration).**
- Nine preload IPC channels (`move-note`, `delete-note`, the embed CRUD set, `vfs:move-folder`, `vfs:get-folder`) are invoked but never registered in main — drag-to-embed and move are non-functional today.
- `import-file` writes files to the *virtual* path on the real filesystem root. The DB filename has an `Opal.db`/`opal.db` case mismatch across call sites.
- `userData/workspace/` is created on every launch and used by nothing.

**Implications.**
1. This is a genuine one-time **export**, not a re-pointing — content must be converted (HTML→markdown) and blobs extracted (base64→files).
2. There is little to preserve: the clean-swap approach (build the new engine, migrate, retire the old) costs less than evolving the half-working mount system.
3. Embedding keys must move from rowids to content hashes.
4. The dead IPC surface means several "features" can be retired without loss — they never worked.

---

## Part III — Detailed Design

### 3.1 The vault

- A vault is any real directory. Opal opens **one vault at a time** (recent-vaults list for switching). Multi-vault windows are out of scope for v1.
- Default location for the migrated vault: a **visible** folder the user picks at migration time (suggested default `~/OpalVault`). Not `~/Library/Application Support` — the user must be able to find, grep, and move their data. The vestigial `userData/workspace/` is retired.
- `.opal/` at the vault root holds vault-scoped state. `.opal/cache/` is gitignored and deletable; everything else in the vault is durable and travels with it.
- Everything Opal knows must be recoverable from the vault directory alone. **Acceptance test: delete `.opal/cache/`, reopen the vault, and Opal reconstructs identical state.**

### 3.2 Notes

- Canonical format: **markdown with YAML frontmatter**, UTF-8, Obsidian-compatible where markdown allows: `[[wikilinks]]`, `![[embeds]]`, `#tags`, frontmatter properties.
- The TipTap editor stays, but becomes a *view* over markdown: parse markdown on load, serialize to markdown on save (debounced, atomic write). `tiptap-markdown` is already a dependency; a **round-trip fidelity harness is the first task of implementation** (see 3.10) because serialization fidelity is the biggest technical risk in the project.
- Opal extensions beyond Obsidian's dialect (e.g. folder/album embeds `![[Photos/Rwanda/]]`) must degrade gracefully: in any other markdown tool they render as a visible, intelligible link — never as data loss.
- No mandatory IDs in frontmatter. Links are path/name-based; Opal rewrites links on rename/move performed inside the app (Obsidian's model). External renames are handled by the index via content-hash matching (3.5).

### 3.3 Properties and sidecars

- **Markdown files:** properties live in YAML frontmatter. Tags may live in frontmatter or inline as `#tag`.
- **Binary files:** properties live in an adjacent, sparse sidecar: `IMG_2041.jpg` → `IMG_2041.jpg.opal.yaml`. Created only when metadata exists; most files never have one.
  - *Why adjacent rather than a central `.opal/meta/` mirror:* copying or moving a folder in Finder keeps files and their metadata together; the vault stays self-describing at every subtree. The cost — tree clutter — is a UX problem Opal solves by folding sidecars into their parent file in the explorer.
- Sidecar schema (v1, intentionally minimal):
  ```yaml
  schema: 1
  tags: [rwanda, field-visit]
  annotation: "Best shot of the delivery site"
  links:
    - target: "Projects/Tempo/design.md"
      rel: "related"
  ```
- Orphan handling: if a file is moved externally without its sidecar, the index flags the orphan and offers repair by content-hash match.

### 3.4 Links

- Forward pointers are authored and stored where the author is: wikilinks/embeds in markdown bodies, `links:` entries in sidecars.
- Reverse pointers (backlinks, "linked mentions" for any file type) are **always derived** by the index. Never persisted in durable files. This is the "authored forward, derived reverse" rule as a hard invariant.
- Link resolution order: exact vault-relative path → unique filename match → fuzzy (with UI disambiguation). Same semantics for `[[...]]` targets and sidecar `target:` values.

### 3.5 The index

One SQLite database at `.opal/cache/index.db` (better-sqlite3, as today). Schema:

| Table | Contents |
|---|---|
| `files` | vault-relative path, type, size, mtime, **content hash (sha256)** |
| `links` | source path, resolved target path, raw target text, link kind (wikilink/embed/sidecar), source position |
| `properties` | file path, key, value (flattened from frontmatter + sidecars) |
| `fts` | FTS5 over markdown body text + annotations — actually queried this time |
| `embeddings` | **keyed by content hash**, not rowid — survives renames, moves, and index rebuilds without re-embedding |

- **Incremental updates:** on watcher events, re-hash only files whose mtime/size changed; re-parse only changed files.
- **Full rebuild:** a `rebuildIndex()` operation walks the vault and reconstructs everything. Exposed in settings; also runs automatically when `index.db` is missing or its schema version bumps.
- Rename detection: an unlink+add pair with matching content hash is treated as a move — link targets are updated, embeddings and properties carried over.
- Embeddings and chat (RAG) remain **optional**: with no API key, everything except semantic search works. This is the "AI is a layer, not the foundation" decision made explicit in the architecture.

### 3.6 The write path and the watcher

Two writers exist — Opal itself and the outside world (Finder, other apps, `git pull`). The design must not let them fight:

- **All app writes go through one `VaultWriter` service** in the main process: atomic write (temp file + rename), then a synchronous index update, then an *echo suppression* entry so the watcher ignores the event Opal itself just caused. No renderer code ever touches `fs`.
- **The chokidar watcher** (salvaged config from the mount system) covers the vault root, ignores `.git/` and `.opal/cache/`, survives restarts (started on vault open, not on a mount action), and drives incremental indexing for all external changes.
- Conflict policy v1: last-writer-wins with mtime comparison; if a file changed on disk while an unsaved editor buffer holds it, Opal surfaces a non-destructive choice (keep mine / take disk / save-as). No silent overwrites, no merge engine.

### 3.7 Snapshots and backup (sub-project 2 — contract defined here)

- The vault root is a git repository; Opal shells out to the **system `git` + `git-lfs`** binaries (bundling git in Electron is not worth it; Opal detects absence and guides installation).
- **Auto-snapshot:** debounce (a few minutes after last change, plus on quit), then: write `.opal/manifest.json` → `git add -A` → `git commit`. Push to the GitHub remote on a background interval with backoff. History is a time machine, not a curated log.
- **Manifest** (what makes snapshots *rich* — a snapshot captures filesystem + metadata + the code that produced it):
  ```json
  {
    "opalVersion": "0.4.0",
    "opalCommit": "1088dd7…",
    "vaultSchemaVersion": 1,
    "createdAt": "2026-08-16T15:24:00Z"
  }
  ```
- **LFS routing** via `.gitattributes` by extension (images, video, audio, PDF). Cost reality: GitHub LFS is free to 1 GiB, then $5/mo per 50 GiB pack — fine for the near term. The blob question is isolated in `.gitattributes` + remote config, so moving blobs to R2/S3 later is a config change, not a data migration.
- Multi-device is explicitly **out of scope for v1** (single-writer assumption; pull/merge handling is its own future sub-project). The architecture doesn't preclude it: git is already the transport.

### 3.8 Migration (one-time, from SQLite)

A guided, idempotent exporter that runs when the user opts in:

1. Snapshot the existing `Opal.db` (copy aside, untouched — it remains the rollback).
2. Walk the `items` tree → create the real directory structure; name-collision handling mirrors the DB's uniqueness rules.
3. Convert each note: TipTap HTML → markdown (headless TipTap parse + `tiptap-markdown` serialize, validated against the round-trip harness).
4. Extract every inline base64 image → `attachments/` files (content-hash filenames), rewrite as embeds.
5. Convert `ai_metadata` tags/summaries → frontmatter properties. Surviving `embedded_items` → embeds where resolvable.
6. Mounted-folder rows: offer copy-into-vault or drop (the vault subsumes mounting).
7. Produce a migration report (files written, links rewritten, anything unconvertible flagged with the original HTML preserved in a `_migration/` folder — nothing is ever silently dropped).

### 3.9 Retirements

Removed outright once migration ships: the virtual VFS (`VFSManager`, path-string surgery in `ItemRepository`), the `notes`/`embedded_items` tables, the mount system and `syncAPI` (subsumed by the vault), the nine dead IPC channels, the triple embedding storage, the hardcoded schema fallback, the `Opal.db`/`opal.db` case split, and the unused `userData/workspace/`. The IPC surface is re-derived from the new services (`vaultAPI`: read/write/move/watch; `indexAPI`: search/links/properties).

### 3.10 Testing strategy

- **Round-trip harness first** (before any editor integration): corpus of markdown fixtures — headings, lists, tables, code, wikilinks, frontmatter, Obsidian exports — asserting `markdown → TipTap → markdown` is byte-stable or whitelisted-normalization-only. This is the project's riskiest bet; it gets proven or disproven in week one, and failure re-scopes the editor plan (e.g. CodeMirror for source-mode fallback).
- **Migration golden tests:** HTML fixtures (from real current DB shapes, including base64 images and embed divs) → expected on-disk trees.
- **Index determinism:** build index → delete → rebuild → assert byte-identical query results. Watcher integration tests: mutate the vault externally (add/change/move/delete), assert index convergence.
- **E2E:** extend the existing Playwright infra (create/edit flow) to run against a temp vault; assert the *disk* state, not the DB. (Note: better-sqlite3 must be rebuilt for Electron before E2E runs.)

### 3.11 Risks and open questions

| Risk | Mitigation |
|---|---|
| TipTap markdown round-trip loses formatting | Harness first (3.10); fallback plan is a source-mode editor for affected constructs |
| Large vaults (10k+ files) index slowly | Hash only on mtime change; parse only markdown/sidecars; thumbnails lazy |
| LFS cost/bandwidth at scale | Isolated behind `.gitattributes` + remote config; R2/S3 escape hatch documented |
| External tools move files without sidecars | Orphan detection + content-hash repair (3.3) |
| git edge cases (huge repos, interrupted pushes) | Snapshots are local-first; push failure is retryable and never blocks editing |

Open (deferred, non-blocking): folder-embed syntax details; property schema conventions beyond v1 keys; multi-device merge policy; whether chat history belongs in the vault or stays app-local (v1: app-local).

---

## Revision 2 — 2026-08-17

Further design dialogue changed the product framing. Part III's technical decisions
survive intact; Part I's positioning and the build order in "five sub-projects" do not.

### What the product actually is

The earlier framing — "a better Obsidian" — produced a design where Opal *owns* a vault
and everything valuable lives inside it. The sharper framing:

> **A fast, local Notion that is a view into your existing filesystem.**
> Closer to a better Finder than to a notes app.

Notion's real feature is the database view: a collection of things carrying properties,
flippable between table / gallery / board / list, filterable and sortable. Notion's fatal
flaw is that everything must be uploaded *into* Notion, and every interaction round-trips
to a server. Opal's version: **the collection is a folder that already exists on your
disk.** Files are the rows, frontmatter and sidecars are the properties, Opal supplies the
views. Nothing is uploaded, nothing is locked in, and it is fast because it is local.

Notes remain in scope, but as one modality among many rather than the center.

### Browse everything, index what you mark

Opal **browses** anywhere — navigate the real filesystem like Finder, with no crawl and no
precondition. Opal **indexes** only what the user explicitly marks. Marked regions are
where the expensive machinery lights up: full-text search, embeddings, chat, backlinks.

This is not a compromise. Scoped retrieval is better RAG than total retrieval; indexing an
entire disk mostly means retrieving irrelevant results with confidence. It also means the
app is useful from the first second, before anything has been indexed at all.

### The distinction that governs storage

"Metadata layer" was doing two jobs with opposite requirements. They are now separated by
name, and the separation is a hard rule:

| | **Authored** | **Derived** |
|---|---|---|
| Examples | tags, annotations, links you drew, view config | embeddings, FTS, thumbnails, extracted text, backlinks |
| Recomputable | **No — irreplaceable** | Yes, always |
| Lives in | next to the file (frontmatter / `*.opal.yaml`) | `.opal/cache/`, gitignored |
| On loss | data loss | rebuild it |

Putting authored data in the index makes the index precious, which reinvents Notion.
Putting derived data on disk litters the tree and bloats backups. The storage *locations*
in Part III §3.3 and §3.5 are therefore fixed now, on day one, even though the *feature
set* built on top is deliberately left to grow from use. Format is expensive to change
later; features are not.

### New architectural decisions

- **Allowed roots.** Opal holds an explicit list of folders the user has opened. Every
  filesystem IPC call and every asset request is validated against it. Without this, a
  compromised renderer reads the entire disk. Roots persist across restarts as JSON in
  `userData` (not `electron-store` — its v10 ESM-only packaging is a build risk in the
  main-process bundle, and the need is a dozen lines of `fs`).
- **Assets stream, never serialize.** A custom `opal-file://` protocol registered via
  Electron's `protocol.handle` lets `<img src>` and `<video src>` read straight off disk.
  This replaces the current `syncAPI.getImageData` path, which reads a file, base64-encodes
  it (+33%), ships it across the process boundary as a string, and decodes it in the
  renderer — unusable for a folder of photos, and directly opposed to the "fast" premise.
  The scheme is registered as `standard`, `secure`, `stream`, `supportFetchAPI`,
  `corsEnabled`, and added to the CSP `img-src`/`media-src` rather than bypassing CSP.
- **Directory reads are lazy.** Children are read on expand. No recursive walk on open.
- **Custom rendered blocks live in the file,** as fenced blocks with a language tag
  (```` ```opal-album ````, YAML body). They parse trivially, hold arbitrary structure,
  travel inside the document, and degrade to a legible code block in GitHub, Obsidian, and
  any other renderer. This is how Mermaid and Dataview solve the same problem. Rejected:
  storing block definitions in SQLite (separates definition from document, so the file dies
  on any other machine) and HTML-comment carriers (degrade to invisible).
- **Note files keep the `.md` extension.** A custom extension (`.mdo` was considered)
  grants no syntax freedom that `.md` lacks — Obsidian ships wikilinks, embeds, callouts,
  and block refs inside plain `.md` — while forfeiting GitHub rendering of the pushed
  vault, default agent/RAG tooling that filters `*.md`, Quick Look, and the ability to open
  the tree in another editor. A genuinely non-markdown data type would earn its own
  extension later, the way Obsidian's `.canvas` does.
- **Disk wins.** SQLite may cache anything, including parsed ASTs keyed by content hash,
  but when cache and disk disagree the disk is authoritative and the cache is discarded.
  Two caches is an optimization; two writable truths is a reconciler that must stay correct
  forever. `git pull` rewrites mtimes to checkout time, so a reconciler's primary freshness
  signal is unreliable exactly when snapshots are restored — the case that matters most.

### Revised build order

| # | Slice | Outcome | Status |
|---|-------|---------|--------|
| 1 | **Disk explorer** | Open a real folder; lazy tree; `opal-file://` streaming; gallery view. Read-only. | **Next** |
| 2 | Metadata write layer | Sidecars + frontmatter, format per §3.3. Tag and annotate anything. | |
| 3 | Persisted views | Per-folder view config (gallery/table/list, sort, columns) stored as authored metadata. | |
| 4 | Markdown editing on disk | TipTap as a view over on-disk `.md`; round-trip harness per §3.10 gates this. | |
| 5 | Migrate SQLite notes | The former sub-project 1, per §3.8. Demoted: existing notes work today. | |
| 6 | Index, search, AI | Opt-in per marked root. FTS + content-hash embeddings per §3.5. | |
| 7 | Git snapshots | The former sub-project 2, per §3.7. | |

Slice 1 is read-only and additive: the existing virtual VFS keeps running untouched
alongside it, so nothing regresses while the product thesis is tested. The retirements in
§3.9 happen at slice 5, not before.

---

## Appendix — Decision log

| Decision | Choice | Alternatives considered |
|---|---|---|
| Source of truth | Disk-native vault | SQLite + export mirror; hybrid per-folder |
| Migration strategy | Clean swap, one-time export | Evolve mount feature; standalone indexer daemon |
| Note format | Obsidian-compatible markdown + frontmatter | Opal-flavored markdown; HTML |
| Binary metadata | Adjacent sparse sidecars (`*.opal.yaml`) | Central `.opal/meta/` mirror |
| Reverse links | Always derived, never stored | Bidirectional link records |
| Embedding keys | Content hash | SQLite rowid (status quo — fragile) |
| Git integration | System `git`/`git-lfs` CLI | isomorphic-git (no real LFS support); libgit2 bindings |
| Snapshot cadence | Auto-commit debounced + background push | Manual push; full multi-device sync (deferred) |
| AI positioning | Optional derived layer | AI-native core |
| *Rev 2:* Product frame | Fast local Notion / better Finder over your real FS | Better Obsidian (notes-first) |
| *Rev 2:* Filesystem scope | Browse anywhere, index only what's marked | Index a single owned vault; crawl everything |
| *Rev 2:* Note extension | `.md` | `.mdo` (Opal-native) |
| *Rev 2:* Custom blocks | Fenced ` ```opal-* ` blocks in the file | Definitions in SQLite; HTML-comment carriers |
| *Rev 2:* Cache authority | Disk wins; cache is discardable | Bidirectional SQLite↔markdown reconciler |
| *Rev 2:* Asset delivery | `opal-file://` streaming protocol | base64 data URLs over IPC (status quo — unusable at scale) |
| *Rev 2:* Roots persistence | JSON in `userData` via `fs` | `electron-store` (ESM-only packaging risk) |
| *Rev 2:* Build order | Disk explorer first, notes migration fifth | Notes migration first |
