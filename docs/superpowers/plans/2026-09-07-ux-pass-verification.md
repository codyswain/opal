# UX pass verification: deferred items and polish

Worktree: `/Users/codyswain/code/opal/.worktrees/core-ux`
Branch: `codex/core-ux`

Status: complete. Commits `0ead7fe`, `88202b6`, `2db4ea6`.

## What shipped

- **PDF text in the chat index.** `pdfjs-dist` (ESM only, marked external and imported by Node at run time; verified inside Electron 31) extracts the text layer of PDFs up to 25 MiB. Pages are tracked as form feeds in the extracted text, so every chunk knows its page and sources cite `atlas.pdf · page 3`; the model sees the page too. Scanned PDFs without text and unreadable PDFs are listed as skipped with the reason.
- **Progress and cancellation.** An index update reports scanning, reading and embedding phases with counts and the current file; embeddings go out in batches of 64 passages; each file is committed as soon as its vectors arrive and the index is saved every 15 s. Stop cancels after the current request. What was embedded is kept, the rest is counted as pending changes, and the next update finishes them. The status bar shows a progress bar, a Stop button, a "stopped early" note and a popover of skipped files.
- **Drafts across launches.** Unsaved view drafts and unsaved edits to saved views are written through to the prefs store on every change and revived at launch after full validation of every field; clean saved-view drafts and invalid entries are dropped, and the newest 20 transient drafts are kept. Unsaved drafts gained a Discard action that returns to the folder they came from.
- **Polish from a screenshot tour** (`e2e/acceptance/ux-tour.mjs`, disposable): Save view pre-fills a name derived from the definition ("PDFs tagged research in Projects"); the folder picker shows "Vault › Projects › Atlas" rather than an absolute path; the focused file's return control is a button with a back arrow and the folder's name.

## Evidence

Unit and contract: **913 tests pass in 90 files**. Type check: **0 errors**. Lint: **0 errors, 8 warnings** (unchanged). Electron: **8 tests pass in 28.9 s**. pdf.js import probed inside Electron: `PDFJS_OK 6.3.289`. The tour ran with zero renderer errors.

## Deliberate limits

- PDF extraction runs in the main process; a very large PDF blocks other main-process work for its extraction time. A worker would fix this if it shows up in practice.
- Tag suggestions in the datalist have no counts; the picker only browses opened roots.
- The launch route itself is not restored; drafts reappear in the sidebar instead.

## Addendum: tab strip (`27814a6`)

The open-files strip was rebuilt to behave like a browser or editor tab bar:

- Kind-tinted file icons; the active tab shares the content background under a 2 px accent line; inactive tabs separate with hairlines and reveal their close glyph on hover.
- An unsaved file shows a dot in place of the close glyph (amber for a conflict or error); the dot yields to the glyph on hover. The Markdown editor publishes its save state through `documentStatusStore`.
- Middle-click and Delete close a tab; arrow keys, Home and End move between tabs; Enter activates.
- Tabs drag to reorder with a drop indicator; the wheel scrolls the strip sideways; the active tab is kept in view.
- Right-click: Close, Close others, Close to the right, Close all, Keep open (preview tabs), Show in folder, Reveal in Finder, Copy path.
- An overflow menu lists every tab once the strip is crowded (eight tabs or a measured overflow).
- Ctrl+Tab / Ctrl+Shift+Tab cycle; Cmd+Shift+T reopens the most recently closed tab (the store remembers the last twenty).

Evidence: 927 tests in 91 files, 0 type errors, 0 lint errors, 8 Electron tests; screenshot tour shows the strip with five tabs, an unsaved dot, the hover state and the context menu in light and dark.
