# Disposable acceptance scripts

These drive the built app through Playwright's Electron launcher against a
throwaway user-data directory and temp vault. They are evidence
runs for the handoff's acceptance criteria, not part of the Playwright suite
(`playwright.config.ts` only collects `e2e/tests`), so the ten-test budget is
unaffected. Each script prints one `PASS`/`FAIL` line per check and exits
non-zero on any failure. Nothing touches the real profile or opened folders.

Build first (produces `.vite/build`):

```bash
npm run test:e2e
```

Then, from the repository root:

```bash
node e2e/acceptance/recent-acceptance.mjs        # Recent: criteria 1, 2, 3, 6, 11, 13
node e2e/acceptance/collections-acceptance.mjs   # Filtered collections: criteria 4, 6, 8, 9, 10
node e2e/acceptance/views-acceptance.mjs         # Saved views: criteria 5, 12, 13 and a restart
```
