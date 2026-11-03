# Disposable acceptance scripts

These drive the built app through Playwright's Electron launcher against a
throwaway user-data directory and temp vault. `OPAL_TEST_USER_DATA_DIR` moves
Electron's own profile (localStorage, session storage, caches) there as well,
so a run never reads or writes the real profile's preferences. They are evidence
runs, not part of the Playwright suite (`playwright.config.ts` only collects
`e2e/tests`), so the ten-test budget is unaffected. Each script prints one
`PASS`/`FAIL` line per check and exits non-zero on any failure. Nothing touches
the real profile or opened folders.

Build first (produces `.vite/build`):

```bash
npm run test:e2e
```

Then, from the repository root:

```bash
node e2e/acceptance/editor-acceptance.mjs        # Markdown editing: autosave, external edits, conflicts, new note
node e2e/acceptance/stack-stress-acceptance.mjs  # The daily stream with 100 daily pages: frame times, memory, editor count, drift, Back and relaunch
node e2e/acceptance/git-autostash-acceptance.mjs # Autosave during vault-pull.sh's `git merge --autostash` in a 3,000-file repo: 30 runs, no saved, typed or upstream line lost
node e2e/acceptance/gallery.mjs [area] [--out dir] # The look gallery: each e2e/fixtures/gallery/*.mdo light and dark at 700 and 420px, into e2e/out/gallery/index.html
node e2e/acceptance/mdo-typing-acceptance.mjs [--shots dir] # Typing in a document with the real keyboard: 2*3*4, a wiki link, 3.14, Option+Arrow, Shift+Cmd+Left, Replace All with the floating Find bar; saved bytes and screenshots
node e2e/acceptance/ime-acceptance.mjs        # Input methods: a Japanese composition and a dead key at each caret cell land where a typed letter does; prints a result table
node e2e/acceptance/mdo-math-acceptance.mjs [--out dir] # Math in documents: drawing, the formula popover, one undo step, Backspace, ⇧⌘E, notes' source, light and dark screenshots
node e2e/acceptance/files-protocol-acceptance.mjs [--shots dir] # Files in the main process: opal-file:// ranges and headers, sandboxed HTML, a movie seeking to its end, read-only LFS opens, launchers shown in Finder, thumbnails and a HEIC copy (ffmpeg makes the test movie when it is installed)
```

The gallery writes to `--out`, then `OPAL_GALLERY_OUT`, then `e2e/out/gallery`.
Each area adds its own fixture document to `e2e/fixtures/gallery/`. Its
screenshots are for people to look at and are never compared.
