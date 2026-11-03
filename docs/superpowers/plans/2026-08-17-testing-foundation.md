# Testing Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Opal's test suite trustworthy — impossible to break by accident, impossible to bypass, and diagnosable when it fails — without adding meaningful ongoing maintenance burden.

**Architecture:** This plan adds exactly **one** new test. Everything else repairs the machinery around the tests that already exist. The suite's problem is not coverage; it is that the suite breaks itself, does not block bad commits, produces no diagnostics on failure, and never runs its most expensive tier in CI. Each of those is a one-time infrastructure fix.

**Tech Stack:** Vitest 3 + happy-dom, Playwright 1.58 (Electron driver), Husky 8 + lint-staged 15, GitHub Actions, better-sqlite3 (native module), electron-rebuild.

**Spec:** This document is self-contained. Background on the product direction lives in `docs/superpowers/specs/2026-08-16-opal-vault-architecture-design.md` (read Revision 2), but no part of this plan depends on it.

---

## Why this plan exists — the evidence

Every claim below was verified on `feat/disk-explorer` at commit `7ea1dfa`. Do not take them on faith; each task re-verifies the problem before fixing it.

### Finding 1 — Running E2E silently breaks the unit suite

`npm test` rebuilds `better-sqlite3` against **Node's** ABI. `npm run test:e2e` needs it built against **Electron's** ABI. Running either leaves the other broken.

Observed: after one E2E run, `npx vitest run` reported **13 failures across 5 files** — `db-operations`, `db-search`, `db-initialization`, `itemRepository`, `testDbHelper` — all with `Error: The module '.../better_sqlite3.node'`. Not one was a real defect. Running `npm test` (which force-rebuilds for Node) returned all 134 tests to green.

**Why it matters more than it looks:** the failures appear in files the developer never touched, with a cryptic native-module error, on a commit that is actually fine. That is the exact experience that teaches a person to stop trusting the suite.

### Finding 2 — The pre-commit hook does not block failing tests

`.husky/pre-commit` currently reads:

```sh
npm test
npm run lint
if [ $? -eq 0 ]; then
  echo "✅ Pre-commit checks passed!"
else
  exit 1
fi
```

`$?` holds the exit status of the **immediately preceding** command — `npm run lint`. The result of `npm test` is discarded. There is no `set -e` in `.husky/pre-commit` or in `.husky/_/husky.sh` (verified by grep), so a non-zero `npm test` does not abort the script either.

**Net effect: a commit with a failing test suite succeeds, printing "✅ Pre-commit checks passed!".** The gate is decorative.

### Finding 3 — The `lint-staged` config is dead

`package.json` configures `lint-staged` for `*.{ts,tsx}`, but `.husky/pre-commit` never invokes `npx lint-staged`. It calls `npm run lint` (whole repository) instead. The configuration has no effect on anything.

### Finding 4 — Playwright traces are never captured

`e2e/playwright.config.ts` sets `trace: 'on-first-retry'` alongside `retries: 0`. A trace under that setting is recorded only when a test is *retried*, and no retry ever happens. `screenshot` and `video` are unset, so both default to off, and the reporter is the default stdout list.

**Net effect: a failing UI test produces a stack trace and nothing else** — no DOM snapshot, no screenshot, no network log, no timeline. For frontend work that is the single most valuable artifact, and it is disabled by an interaction between two settings that each look reasonable alone.

### Finding 5 — CI never runs E2E

`.github/workflows/test.yml` runs `npm run lint` and `npm test`. `npm run test:e2e` appears nowhere. The E2E suite is a local-only ritual and can rot indefinitely while `main` stays green.

### Finding 6 — Nine IPC channels are invoked but never registered

The renderer calls nine channels through `preload.ts` that no main-process handler implements. Drag-to-embed, note move, and note delete have never worked. Verified by static analysis (the exact algorithm Task 3 implements):

```
create-embedded-item      get-note-embedded-items   vfs:get-folder
delete-embedded-item      move-note                 vfs:move-folder
delete-note               update-embedded-item
get-embedded-item
```

Four of these are namespace mismatches — main registers `file-explorer:get-embedded-item` while preload invokes `get-embedded-item`.

No test catches this class of bug, and E2E is the wrong tool for it: catching all nine would require an E2E test exercising every feature in the app. A static check finds them in milliseconds.

### Finding 7 — `npm run test:all` is broken

`test:all` chains `test:unit && test:integration && test:e2e`. `test:integration` runs `vitest run src/tests/integration/`, and that directory does not exist, so vitest exits non-zero and the chain never reaches E2E.

### Finding 8 — Playwright output directories are not gitignored

`.gitignore` has no entry for `playwright-report/` or `test-results/`. Task 4 starts producing both.

---

## The testing policy this plan establishes

One rule governs everything:

> **Test at the cheapest tier that can actually fail.**

| Tier | Scope | Cost | Runs |
|---|---|---|---|
| **Unit** (vitest) | Anything that does not require a live Electron process | ~15ms/test; 134 tests in 2.3s | pre-commit + CI |
| **Contract** (vitest) | Cross-process agreements that no single unit can verify | ~50ms total | pre-commit + CI |
| **E2E** (Playwright) | *Only* what is impossible to verify any other way | ~4.5s/test | CI + on demand |

**What genuinely requires a real Electron process** — the complete list for Opal today:

1. The app boots at all
2. `opal-file://` streams bytes and Chromium actually decodes them
3. CSP does not block the custom scheme
4. IPC genuinely crosses the process boundary
5. The allowed-roots guard holds at the protocol layer, not merely in the registry

That is five things, and the repository has five E2E tests. **The E2E suite is already correctly sized.** The work is to resist growing it.

**E2E budget: ≤10 tests, ≤60 seconds total.** Exceeding the budget is a signal that something is being tested at the wrong tier, not that CI needs a bigger machine.

**Worked example of the rule.** The disk-explorer's view-mode toggle, empty states, and error banner are already covered by `diskFolderView.test.tsx` and `diskExplorer.test.tsx` at ~15ms each. Re-testing them through Playwright would cost ~4.5s each — roughly 300× the price for identical confidence. Do not do it.

**Explicitly rejected: visual regression testing.** Screenshot diffing is OS- and font-dependent and produces false failures. False failures destroy trust in the suite, which is the precise thing this plan exists to build. Revisit only when the UI has stabilized and there is a single pinned CI runner.

## Global Constraints

- **This plan adds exactly one new test** (Task 3). If you find yourself writing a second, stop and re-read the policy above.
- **Do not fix the nine dead IPC channels.** They are retired wholesale in a later slice. Task 3 freezes them as a documented baseline; repairing them is out of scope and would create merge conflicts with that work.
- **Do not modify any existing test's assertions.** Several tasks change *infrastructure* around tests; none change what a test asserts.
- **Every task ends green.** Run the stated verification before committing. Never commit on the assumption that a change is obviously correct.
- **Bash `$?` reads only the immediately preceding command.** This is the root cause of Finding 2; do not reintroduce the pattern anywhere.
- **After any E2E run, the unit suite needs a Node-ABI rebuild, and vice versa.** Until Task 2 lands, run `npm test` (not `npx vitest run`) to recover. After Task 2, both commands self-heal.

---

### Task 1: Make the pre-commit hook actually gate

The enforcement mechanism for everything else. Do this first — until it works, nothing below is enforced.

**Files:**
- Modify: `.husky/pre-commit`
- Modify: `package.json` (the `lint-staged` block)

**Interfaces:**
- Consumes: nothing.
- Produces: a pre-commit hook that exits non-zero if either lint or tests fail.

- [ ] **Step 1: Reproduce the bug**

Confirm the gate is open before fixing it, so you know the fix did something.

```bash
sh -c 'echo step1; false; echo step2; true; if [ $? -eq 0 ]; then echo "GATE OPEN (bug reproduced)"; else echo "gate closed"; fi'
```

Expected output ends with `GATE OPEN (bug reproduced)`. `false` stands in for a failing `npm test` and `true` for a passing `npm run lint`; the gate opens regardless of the failure.

- [ ] **Step 2: Rewrite the hook**

Replace the entire contents of `.husky/pre-commit`:

```sh
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

# Abort on the first failing command.
#
# Without this, `npm test` failing is simply ignored: the old hook checked $?
# after `npm run lint`, and $? only ever reflects the command immediately
# before it. Commits landed with a red suite and printed a success message.
set -e

echo "🎨 Linting staged files..."
npx lint-staged

echo "🧪 Running tests..."
npm test

echo "✅ Pre-commit checks passed!"
```

- [ ] **Step 3: Make `lint-staged` lint only, not test**

`lint-staged` appends the staged filenames to every command it runs. `npm test` would therefore become `npm test <file> <file>`, which vitest interprets as a filename filter — silently running a *subset* of the suite, or none of it. The hook runs the full suite explicitly in Step 2, so `lint-staged` must handle linting only.

In `package.json`, replace the `lint-staged` block:

```json
  "lint-staged": {
    "*.{ts,tsx}": [
      "eslint --fix"
    ]
  }
```

- [ ] **Step 4: Verify the gate now closes**

Create a deliberately failing test, attempt a commit, and confirm it is rejected.

```bash
cat > src/tests/unit/gate-check.test.ts <<'EOF'
import { it, expect } from 'vitest';
it('deliberately fails to prove the pre-commit gate works', () => {
  expect(1).toBe(2);
});
EOF
git add src/tests/unit/gate-check.test.ts
git commit -m "chore: this commit must be rejected"
```

Expected: the commit **fails**. You should see vitest report the failing test and the commit be aborted; `git log -1` must still show the previous commit.

- [ ] **Step 5: Remove the deliberate failure**

```bash
git reset HEAD src/tests/unit/gate-check.test.ts
rm src/tests/unit/gate-check.test.ts
```

Confirm it is gone: `test -f src/tests/unit/gate-check.test.ts && echo "STILL PRESENT — delete it" || echo "removed"`

- [ ] **Step 6: Verify a good commit still passes**

```bash
npm test
```
Expected: 134 passed.

- [ ] **Step 7: Commit**

```bash
git add .husky/pre-commit package.json
git commit -m "fix(ci): make pre-commit actually block on failing tests

The hook checked \$? after \`npm run lint\`, so \`npm test\`'s exit status was
discarded and commits landed with a red suite while printing a success
message. Adds \`set -e\` and routes linting through the previously-unused
lint-staged config so only staged files are linted."
```

---

### Task 2: Eliminate the native-module ABI trap

Makes both test commands self-healing so neither can leave the other broken.

**Files:**
- Modify: `package.json` (the `scripts` block)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` and `npm run test:e2e` are each independently runnable in any order.

- [ ] **Step 1: Reproduce the trap**

```bash
npx electron-rebuild -f -w better-sqlite3
npx vitest run 2>&1 | tail -5
```

Expected: multiple failures mentioning `better_sqlite3.node`. This is the trap — the E2E prerequisite has broken the unit suite.

- [ ] **Step 2: Rewrite the test scripts**

In `package.json`, replace these entries in `scripts`. `test:integration` is deleted because `src/tests/integration/` does not exist, which is why `test:all` never reaches E2E today.

```json
    "test": "npm rebuild --build-from-source better-sqlite3 && vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
    "test:unit": "npm rebuild --build-from-source better-sqlite3 && vitest run src/tests/unit/",
    "test:coverage": "npm rebuild --build-from-source better-sqlite3 && vitest run --coverage",
    "test:e2e": "npx electron-rebuild -f -w better-sqlite3 && npx vite build --config vite.main.config.ts && npx vite build --config vite.preload.config.ts && npx vite build --config vite.renderer.config.ts && npx playwright test --config e2e/playwright.config.ts",
    "test:all": "npm test && npm run test:e2e",
```

Leave every other script untouched.

The `-f` (force) flag on `electron-rebuild` is deliberate. Its skip-detection consults a cache that does not know about `npm rebuild --build-from-source` having just overwritten the binary, so without `-f` it can wrongly conclude no rebuild is needed and leave the Node-ABI build in place. A few seconds of rebuild is a fair price for a command that is always correct.

- [ ] **Step 3: Verify recovery in both directions**

```bash
npx electron-rebuild -f -w better-sqlite3   # break the unit suite
npm test 2>&1 | tail -4                      # must self-heal
```
Expected: `Test Files 21 passed (21)`, `Tests 134 passed (134)`.

```bash
npm run test:e2e 2>&1 | tail -4              # must self-heal in the other direction
```
Expected: `5 passed`.

```bash
npm test 2>&1 | tail -4                      # and back again
```
Expected: 134 passed.

- [ ] **Step 4: Confirm `test:all` works end to end**

```bash
npm run test:all 2>&1 | tail -6
```
Expected: the unit suite passes, then the E2E suite passes. Previously this chain died at `test:integration`.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "fix(test): make unit and e2e commands self-healing across ABIs

npm test builds better-sqlite3 for Node; e2e needs it built for Electron.
Running either used to leave the other failing with a cryptic native-module
error in untouched files. Each command now rebuilds for the ABI it needs.
Also drops test:integration, which pointed at a directory that does not
exist and broke the test:all chain before it reached e2e."
```

---

### Task 3: The IPC contract test

The only new test in this plan, and the highest-value test in the repository. It guards the seam where this codebase has *demonstrably* shipped bugs: nine channels the renderer calls that main never implements.

**Files:**
- Create: `src/tests/unit/ipcContract.test.ts`

**Interfaces:**
- Consumes: the source text of `src/preload.ts` and `src/main/**/*.ts` + `src/main.ts`.
- Produces: no exports; a test that fails when a new dead channel appears **or** when a known-dead channel is fixed without updating the baseline.

**Design notes — read before writing the code:**

- **The scan must read whole files, not lines.** Handlers are frequently written as multi-line calls:
  ```ts
  this.deps.ipc.handle(
    `vfs:get-items`,
    async (): Promise<IPCResponse<...>> => { ... }
  );
  ```
  A line-oriented tool (`grep -E`) cannot see the channel name and reports every such handler as unregistered. During analysis this produced *dozens* of false positives. JavaScript regexes run against the full file string and do not have this problem.

- **Dynamic channel names are skipped on purpose.** `preload.ts` builds a per-request channel with `` `chat:rag-response:${Date.now()}:...` ``. The character class `[^'"\`$]+` excludes `$`, so any template literal containing an interpolation is ignored. A statically unknowable name cannot be statically checked.

- **The registration scan is deliberately permissive.** The pattern `\.(handle|on)\(` also matches non-IPC calls such as `app.on('before-quit')` and `mainWindow.on('closed')`, which adds spurious entries to the *registered* set. That can only ever cause a false **negative** (a dead channel slipping through), never a false **positive**. This is the correct trade: a test that cries wolf gets disabled, and a disabled test catches nothing.

- **The baseline is a two-way ratchet.** Asserting only "no new dead channels" lets the list silently go stale. Asserting only equality gives a poor failure message. Doing both gives precise diagnostics in each direction.

- **A self-check guards against the regex silently matching nothing.** Without it, a refactor of `preload.ts` could reduce the scan to zero matches and the test would pass forever while checking nothing. This is the most common way a test of this shape rots into a no-op.

- [ ] **Step 1: Write the test**

Create `src/tests/unit/ipcContract.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');

/**
 * Channels the renderer invokes that the main process has never implemented.
 *
 * These are pre-existing and deliberately NOT fixed here — the features they
 * belong to (drag-to-embed, note move, note delete) are retired wholesale in a
 * later slice. Freezing them as a baseline means the test passes today while
 * still catching any NEW dead channel the moment it is introduced.
 *
 * This list may only shrink. If you implement a handler, delete its entry.
 */
const KNOWN_DEAD_CHANNELS: readonly string[] = [
  'create-embedded-item',
  'delete-embedded-item',
  'delete-note',
  'get-embedded-item',
  'get-note-embedded-items',
  'move-note',
  'update-embedded-item',
  'vfs:get-folder',
  'vfs:move-folder',
];

/** Recursively collect .ts files. Hand-rolled so this works on any Node 18+. */
function collectTsFiles(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) collectTsFiles(full, found);
    else if (full.endsWith('.ts')) found.push(full);
  }
  return found;
}

/**
 * Matches ipcRenderer.invoke('x') and ipcRenderer.send('x') across newlines.
 * The [^'"`$] class excludes '$', which skips template literals containing an
 * interpolation — those channel names are dynamic and cannot be checked here.
 */
const INVOCATION = /ipcRenderer\s*\.\s*(?:invoke|send)\s*\(\s*(['"`])([^'"`$]+)\1/g;

/**
 * Matches .handle('x') and .on('x') on any receiver, which covers ipcMain
 * directly as well as the injected `this.deps.ipc` used by the handler classes.
 * Deliberately permissive: it also matches app.on('before-quit') and similar,
 * which can only mask a dead channel, never invent one.
 */
const REGISTRATION = /\.\s*(?:handle|on)\s*\(\s*(['"`])([^'"`$]+)\1/g;

function matchAll(source: string, pattern: RegExp): string[] {
  // Fresh lastIndex per call — these are module-level /g regexes.
  pattern.lastIndex = 0;
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) found.push(match[2]);
  return found;
}

const preloadSource = readFileSync(path.join(REPO_ROOT, 'src/preload.ts'), 'utf-8');
const invokedChannels = [...new Set(matchAll(preloadSource, INVOCATION))].sort();

const mainSourceFiles = [
  ...collectTsFiles(path.join(REPO_ROOT, 'src/main')),
  path.join(REPO_ROOT, 'src/main.ts'),
];
const registeredChannels = new Set(
  mainSourceFiles.flatMap((file) => matchAll(readFileSync(file, 'utf-8'), REGISTRATION))
);

const deadChannels = invokedChannels
  .filter((channel) => !registeredChannels.has(channel))
  .sort();

describe('IPC contract between preload and main', () => {
  it('finds channels on both sides (guards against a silently broken scan)', () => {
    // If a refactor made these regexes match nothing, every other assertion in
    // this file would pass vacuously forever. Fail loudly instead.
    expect(invokedChannels.length).toBeGreaterThan(30);
    expect(registeredChannels.size).toBeGreaterThan(30);
  });

  it('introduces no new dead channels', () => {
    const introduced = deadChannels.filter((c) => !KNOWN_DEAD_CHANNELS.includes(c));
    expect(
      introduced,
      `preload.ts invokes ${introduced.length} channel(s) that no main-process ` +
        `handler registers:\n  ${introduced.join('\n  ')}\n\n` +
        `Register a handler (see src/main/services/vfs/VfsHandlers.ts for the ` +
        `pattern), or remove the call from preload.ts.`
    ).toEqual([]);
  });

  it('keeps the known-dead baseline from going stale', () => {
    const nowImplemented = KNOWN_DEAD_CHANNELS.filter((c) => !deadChannels.includes(c));
    expect(
      nowImplemented,
      `These channels are listed as known-dead but now HAVE handlers:\n  ` +
        `${nowImplemented.join('\n  ')}\n\n` +
        `Delete them from KNOWN_DEAD_CHANNELS in this file — the list may only shrink.`
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/tests/unit/ipcContract.test.ts`
Expected: PASS, 3 tests.

If the second test fails listing channels beyond the nine in the baseline, the scan is over-reporting — most likely the `REGISTRATION` regex is not matching multi-line handler calls. Re-read the design notes above before changing the baseline. **Never add a channel to `KNOWN_DEAD_CHANNELS` to make the test pass.**

- [ ] **Step 3: Prove the test actually catches a regression**

Temporarily add a fake dead channel to `src/preload.ts`, inside the `systemAPI` block:

```ts
  __contractCheck: () => ipcRenderer.invoke("system:definitely-not-registered"),
```

Run: `npx vitest run src/tests/unit/ipcContract.test.ts`
Expected: **FAIL** — "introduces no new dead channels", naming `system:definitely-not-registered`.

- [ ] **Step 4: Remove the fake channel**

Delete the line added in Step 3. Verify `src/preload.ts` is clean:

```bash
git diff --exit-code src/preload.ts && echo "preload.ts is clean"
```
Expected: `preload.ts is clean`.

- [ ] **Step 5: Confirm the full suite is green**

Run: `npm test`
Expected: `Tests 137 passed (137)` — the previous 134 plus these 3.

- [ ] **Step 6: Commit**

```bash
git add src/tests/unit/ipcContract.test.ts
git commit -m "test: assert every invoked IPC channel has a main-process handler

This repo has shipped nine channels that preload invokes and main never
registers, so drag-to-embed, note move, and note delete silently do nothing.
E2E cannot catch this class of bug efficiently — it would need a test
exercising every feature. A static scan finds all nine in milliseconds and
catches the next one the day it appears.

The nine are frozen as a documented baseline that may only shrink, so the
test passes today while still failing on any new occurrence."
```

---

### Task 4: Restore Playwright diagnostics

Turns a failing UI test from a bare stack trace into a browsable DOM snapshot, screenshot, and timeline.

**Files:**
- Modify: `e2e/playwright.config.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `playwright-report/` (HTML) and `test-results/` (traces, screenshots, video) on failure.

- [ ] **Step 1: Confirm no trace is produced today**

```bash
rm -rf test-results playwright-report
npm run test:e2e >/dev/null 2>&1
ls test-results 2>/dev/null || echo "no test-results directory — traces are off"
```
Expected: `no test-results directory — traces are off`.

- [ ] **Step 2: Rewrite the config**

Replace the entire contents of `e2e/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,

  // Each test launches a real Electron process, so environmental flakiness is
  // real. Locally a flake is noise worth seeing; in CI it blocks a merge.
  retries: isCI ? 2 : 0,

  // Electron instances hold exclusive locks on their userData directory. Each
  // test already gets its own, but keeping concurrency modest avoids
  // machine-level contention on CI runners.
  workers: isCI ? 1 : 2,

  // Fail the run if a test was left focused with .only.
  forbidOnly: isCI,

  reporter: isCI
    ? [['html', { open: 'never' }], ['github']]
    : [['html', { open: 'never' }], ['list']],

  use: {
    // Was 'on-first-retry' while retries was 0 — which meant never. A failing
    // UI test must leave behind something you can actually look at.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
```

- [ ] **Step 3: Gitignore the output**

Append to `.gitignore`:

```
# Playwright
playwright-report/
test-results/
```

- [ ] **Step 4: Verify a failure now produces a trace**

Temporarily break an assertion. In `e2e/tests/critical-path.spec.ts`, change the first assertion of the first test:

```ts
  await expect(page.getByTestId('navbar-does-not-exist')).toBeVisible({ timeout: 5000 });
```

Run: `npm run test:e2e`
Expected: the test fails, and afterwards:

```bash
ls test-results/**/trace.zip && ls playwright-report/index.html
```
Both must exist. Open the report to confirm it is usable: `npx playwright show-report`

- [ ] **Step 5: Revert the deliberate break**

```bash
git checkout e2e/tests/critical-path.spec.ts
git diff --exit-code e2e/tests/critical-path.spec.ts && echo "spec restored"
```
Expected: `spec restored`.

- [ ] **Step 6: Confirm E2E is green and untracked output stays untracked**

```bash
npm run test:e2e 2>&1 | tail -4
git status --short
```
Expected: `5 passed`, and `git status` shows no `playwright-report/` or `test-results/` entries.

- [ ] **Step 7: Commit**

```bash
git add e2e/playwright.config.ts .gitignore
git commit -m "test(e2e): capture traces, screenshots, and video on failure

trace was set to 'on-first-retry' while retries was 0, so no trace was ever
recorded and a failing UI test produced a stack trace and nothing else.
Adds retries and single-worker execution under CI, an HTML report, and
gitignores the generated output."
```

---

### Task 5: Run E2E in CI

Without this the E2E suite rots — CI currently runs vitest only.

**Files:**
- Modify: `.github/workflows/test.yml`

**Interfaces:**
- Consumes: `npm run test:e2e` (self-healing after Task 2).
- Produces: an `e2e` CI job that uploads its report on failure.

**Why macOS only:** Opal is developed and shipped on macOS, Electron needs a display server on Linux (`xvfb`), and this tier exists to catch integration regressions rather than cross-platform differences. The existing `test` job keeps its `macos-latest` + `ubuntu-latest` matrix; only the new E2E job is macOS-only. Reconsider if Opal ever ships a Linux build.

- [ ] **Step 1: Add the job**

Append to `.github/workflows/test.yml`, at the same indentation level as the existing `test:` job (two spaces, under `jobs:`):

```yaml

  e2e:
    # Opal ships on macOS, and Electron needs xvfb on Linux. This tier catches
    # integration regressions, not cross-platform differences, so one OS is
    # sufficient and keeps the job simple.
    runs-on: macos-latest

    steps:
      - uses: actions/checkout@v3

      - name: Use Node.js 18.x
        uses: actions/setup-node@v3
        with:
          node-version: 18.x
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright
        run: npx playwright install --with-deps chromium

      # Rebuilds better-sqlite3 for Electron's ABI, builds all three Vite
      # bundles, then runs the suite. See package.json scripts.
      - name: Run E2E tests
        run: npm run test:e2e

      - name: Upload Playwright report
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: |
            playwright-report/
            test-results/
          retention-days: 7
```

- [ ] **Step 2: Validate the YAML parses**

```bash
python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/test.yml')); print('jobs:', list(d['jobs'].keys()))"
```
Expected: `jobs: ['test', 'e2e']`

- [ ] **Step 3: Confirm the command the job runs works locally**

```bash
CI=1 npm run test:e2e 2>&1 | tail -6
```
Expected: `5 passed`. Setting `CI=1` exercises the CI branch of the Playwright config (retries, single worker, github reporter), so a config error surfaces here rather than on a runner.

- [ ] **Step 4: Restore the local ABI**

`test:e2e` left `better-sqlite3` built for Electron.

```bash
npm test 2>&1 | tail -4
```
Expected: 137 passed.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: run the e2e suite and upload its report on failure

CI ran vitest only, so the Playwright suite could rot indefinitely while
main stayed green. macOS-only: Opal ships there, and Electron needs xvfb
on Linux for no benefit at this tier."
```

---

### Task 6: Write the policy down

Infrastructure decays when the reasoning behind it is only in a commit message. This puts the rule where every future contributor — human or agent — reads it automatically.

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a `## Testing` section in the project instructions.

- [ ] **Step 1: Add the section**

In `CLAUDE.md`, insert this immediately **before** the existing `## Conventions` heading:

```markdown
## Testing

**One rule: test at the cheapest tier that can actually fail.**

| Tier | Scope | Runs |
|---|---|---|
| Unit (vitest) | Anything not requiring a live Electron process | pre-commit + CI |
| Contract (vitest) | Cross-process agreements no single unit can verify | pre-commit + CI |
| E2E (Playwright) | Only what is impossible to verify any other way | CI + on demand |

Only five things genuinely require a real Electron process: the app boots,
`opal-file://` streams and decodes, CSP allows the custom scheme, IPC crosses
the process boundary, and the allowed-roots guard holds at the protocol layer.

**E2E budget: ≤10 tests, ≤60s.** Exceeding it means something is being tested at
the wrong tier. A component behaviour costs ~15ms as a unit test and ~4.5s
through Playwright — roughly 300× for identical confidence.

**Do not add visual regression tests.** Screenshot diffing is OS- and
font-dependent; its false failures destroy trust in the suite.

### Commands

- `npm test` — unit + contract. Rebuilds better-sqlite3 for **Node**.
- `npm run test:e2e` — Playwright. Rebuilds better-sqlite3 for **Electron**.
- `npm run test:all` — both, in the correct order.

Both commands rebuild the native module for the ABI they need, so they are safe
to run in any order. Use `npm test` rather than a bare `npx vitest run`, which
skips the rebuild and will fail confusingly after an E2E run.

### When a UI test fails

Traces, screenshots, and video are captured on failure. Run
`npx playwright show-report` for a browsable DOM snapshot and timeline.
```

- [ ] **Step 2: Verify the file still reads correctly**

```bash
grep -n "^## " CLAUDE.md
```
Expected: `## Testing` appears between `## Commands` and `## Conventions`, with no duplicated or orphaned headings.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record the testing policy in project instructions"
```

---

### Task 7: Final verification

No new code. Confirms every finding is resolved and nothing regressed.

**Files:** none.

- [ ] **Step 1: Unit and contract suites**

```bash
npm test 2>&1 | tail -4
```
Expected: `Test Files 22 passed (22)`, `Tests 137 passed (137)`.

- [ ] **Step 2: E2E suite**

```bash
npm run test:e2e 2>&1 | tail -4
```
Expected: `5 passed`.

- [ ] **Step 3: The full chain, in one command**

```bash
npm run test:all 2>&1 | tail -6
```
Expected: unit suite passes, then E2E passes. Confirms Finding 7 is fixed.

- [ ] **Step 4: Lint and types**

```bash
npm run lint && npx tsc --noEmit
```
Expected: no errors. Pre-existing warnings are acceptable; there were 7 before this plan.

- [ ] **Step 5: Re-confirm every finding is closed**

Work down this list and tick each:

| # | Finding | How to confirm |
|---|---|---|
| 1 | ABI trap | `npx electron-rebuild -f -w better-sqlite3 && npm test` → 137 pass |
| 2 | Pre-commit gate open | Task 1 Step 4 rejected the bad commit |
| 3 | lint-staged dead | `.husky/pre-commit` contains `npx lint-staged` |
| 4 | No traces | `test-results/**/trace.zip` existed after Task 4 Step 4 |
| 5 | No E2E in CI | `.github/workflows/test.yml` has an `e2e` job |
| 6 | Dead IPC channels | `ipcContract.test.ts` passes with a 9-entry baseline |
| 7 | `test:all` broken | Step 3 above completed both tiers |
| 8 | Output not ignored | `git status --short` is clean after an E2E run |

- [ ] **Step 6: Confirm the change is small**

```bash
git diff main --stat -- . ':(exclude)docs'
```

Expected: roughly 7 files touched — `package.json`, `.husky/pre-commit`, `.gitignore`, `e2e/playwright.config.ts`, `.github/workflows/test.yml`, `CLAUDE.md`, and one new test file. **Exactly one new test file.** If more tests were added, re-read the Global Constraints.

- [ ] **Step 7: Push**

```bash
git push -u origin $(git branch --show-current)
```

---

## Explicitly out of scope

Recorded so they are not mistaken for oversights:

- **Fixing the nine dead IPC channels.** They are retired wholesale in a later slice; repairing them now would conflict with that work. Task 3 freezes them as a baseline instead.
- **Visual regression / screenshot diffing.** Rejected on purpose — see the policy section.
- **New E2E tests.** The suite is already correctly sized at five. Growing it is the failure mode this plan guards against.
- **Testing the `registered-but-never-invoked` direction.** 64 channels are registered against 43 invoked, so ~21 appear unused. Some are legitimately reachable by other means, and failing on this would generate noise rather than signal. Worth a one-off manual audit during the slice-5 retirements, not an automated gate.
- **Raising unit coverage.** Coverage is not the constraint; trust is. Revisit once the suite is reliably run and reliably green.
- **The `Failed to configure file logger` stderr noise** in unit runs. Cosmetic — `src/main/logger.ts` expects Electron's `app` object, which is absent under vitest. Harmless, but worth silencing when someone next touches that file.
- **React `act(...)` warnings** from `diskTree.test.tsx` and `diskExplorer.test.tsx`. Both components kick off an async `loadRoots()` in a `useEffect`, and the resulting state update lands outside an `act()` wrapper. The tests pass and their assertions are correct, so this is noise rather than a defect — but it is the kind of noise people learn to scroll past, which is how a real warning eventually gets missed. Fixing it means changing existing tests, which this plan's Global Constraints forbid. Worth a follow-up.

## Expected console noise during this plan

A `npm test` run is green but not silent. Do **not** treat any of the following as a failure or try to fix them:

- `Failed to configure file logger: TypeError: Cannot read properties of undefined (reading 'file')` — from `src/main/logger.ts` under vitest, twice per run.
- `Warning: An update to DiskTree inside a test was not wrapped in act(...)` — several times, from the two disk-explorer component test files.
- `DeprecationWarning: fs.rmdir(path, { recursive: true })` — from the database test helpers.
- `npm warn Unknown cli config "--build-from-source"` — from the `npm rebuild` step.
- 7 eslint **warnings**, 0 errors. That count was 7 before this plan and must still be 7 after.

The only signal that matters is the final summary lines: `Test Files N passed` and `Tests N passed`.
