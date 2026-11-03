# Elevation pass verification

Worktree: `/Users/codyswain/code/opal/.worktrees/core-ux`
Branch: `codex/core-ux`

Status: complete. Commits `27814a6` (tab strip) through `d793b8b` (focused-file breadcrumb), plus this note.

## Method

Two disposable screenshot tours (`e2e/acceptance/ux-tour.mjs`, `ux-tour-2.mjs`) launch the built app against a fixture library in a throwaway profile and capture every surface in light and dark. Each change was made, rebuilt, re-shot and re-read before moving on. The tours also found one real bug (below).

## What shipped

- **Tab strip** rebuilt to browser/editor conventions: tinted kind icons, accent line on the active tab, hover close, unsaved dot, middle-click, drag reorder, right-click menu, overflow list, Ctrl+Tab and Cmd+Shift+T.
- **Files toolbar** reduced to one calm row: sort in a menu with a direction arrow, an icon density toggle, and a Finder-style status bar carrying the item count, selection count and layout toggles. **Gallery tiles** gained a bordered 4:3 thumbnail area with tinted kind icons and a size or detail line.
- **Command palette** replaces kbar: one box searches files across the opened folders (collections query, recent files when empty) and ranks every registered command; `>` limits to commands; Cmd+K, Cmd+P, Cmd+Shift+P; shortcuts as platform glyphs. Commands grew to sixteen, registered in `AppCommands` inside the theme and shell providers; the native menu still receives the same list.
- **First run** shows a welcome panel: what Opal does, one Open folder action, ⌘O hint, three feature cards.
- **Settings** gained Appearance (system/light/dark), Library (opened folders with close and add) and Chat index (state, progress, Index/Update/Stop gated on a key) alongside the OpenAI key.
- **Chat** empty state offers starter questions that fill and focus the composer.
- **Focused file header** shows a back arrow, the live folder trail and the file with its kind icon.

## Bug found by the tour

`credentials:get` answers with an IPC envelope while the renderer typing promised a bare string, so the settings store kept an object and the key field could never show the saved key. Fixed in `6db8ab3` with store tests; the typing now matches the handler.

## Evidence

Unit and contract: **941 tests pass in 95 files**. Type check: **0 errors**. Lint: **0 errors**. Electron: **8 tests pass** (boot spec now asserts the welcome panel). Both tours run with zero renderer errors.

## Deliberate limits

- Recent is not grouped by day; the relative time on each row carries that information.
- The palette searches by file name only; content search stays in Chat.
- The details inspector toggle exists as a command but the pane still opens only from the Preview toggle in Files.
