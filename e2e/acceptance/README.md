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
node e2e/acceptance/stack-stress-acceptance.mjs  # Today's stream with 100 daily pages: frame times, memory, editor count
```
