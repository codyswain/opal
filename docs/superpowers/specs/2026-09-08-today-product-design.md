# A daily home worth returning to

User authorized a substantial autonomous product pass after reviewing the first Today implementation. Keep the warmth of “a little space for your day.” Give attention to chosen priorities and writing; activity is a collapsed secondary record. Preserve existing vault files and external routines.

## Product

Today has a quiet editorial header, navigable date, restrained source freshness, and a two-column reading layout. The main writing surface is generous and renders Markdown with TipTap; source mode remains available for arbitrary file syntax. A concise briefing exposes a few items with expansion. A daily Focus list is distinct from the current backlog. Users can add a personal intention or bring a task into focus; focus choices are authored, date-scoped, durable vault data. Backlog and collected suggestions are available on demand. Activity is closed by default. Photos appear without an empty placeholder card dominating the page. No invented content, generated photo backgrounds, or unnecessary illustrations.

## Reliability

Move file-layout knowledge to an Electron-main vault service. The renderer receives a typed VaultDay from src/types/vault.ts. Existing allowed roots and revision-checked Markdown writes remain authoritative. Validate all IPC inputs and contain every vault-owned path, including symlinks. Missing optional sources are normal; malformed/unreadable existing sources produce readable warnings.

Focus metadata lives under .opal/days/YYYY-MM-DD.json with stable IDs, serialized atomic writes, and no write on read. Preserve source tasks; completion of a daily focus item records completion for that day (no implied third-party writeback). Existing source references travel with task IDs. Journals retain their existing log paths and activity sections. Creation must use an exact filename atomically; never silently allocate a suffixed daily log. Saving journals merges fresh activity but refuses concurrent authored changes.

Recovery drafts live in private application data as 0600 atomic JSON files, keyed by a hash of the canonical path. Persistence is versioned: clearing an old saved draft must not delete a newer draft. On startup recover unsaved writing, visibly label recovery, and retain conflict drafts. Do not send any real vault content to an AI service during implementation/testing.

## Privacy

Keep the journal/photo hide preference. Add a global screen-shield shortcut and control that removes app content from view on any route, closes overlays, and requires explicit reveal. This is a display shield, not encryption or semantic redaction of every file. Clearly distinguish it from hiding the Today journal. No auto-reveal on navigation or restart.

## Scope and validation

No new scheduler, external MCP connection, automatic indexing, vault migration, or AI background activity. Existing Chat remains accessible. Test the main service with temporary roots; test durable draft recovery, conflicts and in-flight edits; test focus persistence/date isolation, invalid IPC and symlink containment. Test key component interactions, meaningful empty/error states, and privacy. Run full unit/contract suite, type checking, lint, builds, code review, and actual app visual checks. Never test edits against personal vault content.
