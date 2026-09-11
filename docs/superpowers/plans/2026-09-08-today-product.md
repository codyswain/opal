# Today product refinement implementation plan

**Goal:** A composed daily homepage with durable writing and an explicit vault engine.
**Spec:** ../specs/2026-09-08-today-product-design.md
**Contract:** src/types/vault.ts
**Workspace:** existing codex/core-ux checkout, clean at 19683be.

- [x] Engine: main-process VaultService and recovery-draft repository, typed IPC/preload registration, isolated tests. Own src/main/vault, new types, service registration, preload.
- [x] Writing: TipTap journal surface with source mode, versioned durable recovery in journalStore, startup guard/hydration, tests. Own JournalPanel, journalStore, JournalDraftGuard, journal editor CSS.
- [x] Product UI: Today route and data hook use vaultAPI, focus list, short expandable brief, backlog drawer, collapsed activity, adaptive layout and photo treatment. Own TodayRoute and accompanying components/styles/tests.
- [x] Integration: global privacy shield, shell navigation polish, service wiring verification, removal of obsolete renderer file adapter, full tests and visual QA. Root agent owns integration.
- [x] Review all work for integrity, accessibility, races, and clarity; repair material findings. Build, inspect actual app, commit each completed slice and leave the product open.

Ruling: Focus completion is an authored daily record, not an implicit update to Linear or another source. Surface source context in the queue and avoid claiming bidirectional sync.
Ruling: Add a universal screen shield instead of trying to infer and redact private passages inside arbitrary files. Keep Today journal hiding as the less disruptive option.


## Verification

- 993 unit and contract tests passed across 104 files.
- Eight Electron tests passed in 25.8 seconds, including Today boot and vault IPC.
- Type check passed. Full lint has no errors; seven existing warnings remain outside this work. Changed production modules lint cleanly.
- Main, preload, and renderer production builds passed.
- Actual app reviewed with the mounted vault: rich template rendering, light/dark themes, collapsed activity, journal hiding, and global privacy shield/reveal.
- Review fixes cover atomic creation failure, idempotent save recovery, late-opened vault recovery, protected-draft quitting, source-mode focus retention, and retained task context.
- No journal, task, or focus test data was written to the personal vault. Scheduled routines, automatic source completion, and new thought-thread workflows remain outside this slice.

- The default high-concurrency commit run exposed an unrelated query-view timeout; the isolated test and controlled full suite pass. The runner now uses four workers consistently without weakening test timeouts.
