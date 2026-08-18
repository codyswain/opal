# Native Context Menus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Right-clicking anywhere in `/files` opens a real macOS menu whose items act on the files you actually clicked, including a multi-selection.

**Architecture:** The renderer sends a `ContextRequest` (`{kind, targets}`) to main over `menu:show-context`. A pure builder turns it into a template, `Menu.popup` shows it, and the chosen `{actionId, targets}` comes back over `menu:context-invoke` to a flat dispatch table in the renderer. Targets travel with the message in both directions, so no code reads a "currently right-clicked" global. Underneath, `FileWriter` gains a copy operation and a batch layer that reports per-target outcomes instead of throwing.

**Tech Stack:** Electron 31.3.1 (`Menu.popup`, `clipboard`, `shell`), Node 20, React 18, Zustand 5, Vitest + happy-dom. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-17-context-menus-design.md` — read it first.

**Prior work:** `2026-08-17-native-shell-polish.md` (shipped, `8b531c1`) established `menuTemplate.ts`, `AppMenu.ts`, `commandIds.ts`, the `menu:commands` / `menu:invoke` channel pair, and `tabsStore`. This plan mirrors those patterns rather than inventing new ones.

---

## Nothing new to install

| Need | Use | Already present |
|---|---|---|
| Native popup menu | `Menu.buildFromTemplate`, `menu.popup()` | Electron 31.3.1 |
| Clipboard | `clipboard.writeText` | Electron 31.3.1 |
| Recursive copy | `copyRecursive`, the module-level helper in `src/main/fs/FileWriter.ts` already used by `move`'s EXDEV branch | present |
| Toasts | `toast` from `sonner` | present, used in `DiskExplorer.tsx` |

---

## Global Constraints

- **Do not add an E2E test.** The suite holds **9** of the **10** the policy allows. A native menu is drawn by the OS and Playwright cannot see it. If something here seems to need an E2E test, it is being tested at the wrong tier.
- **Never emit an empty menu.** `Menu.buildFromTemplate` **stalls the app at startup** when handed a menu whose submenu is empty — this cost an hour during the shell-polish work and is why `buildMenuTemplate` filters empty menus today. `buildContextTemplate` must never return `[]`, and `ContextMenu.show` must refuse to pop an empty template. Both are test cases in this plan, not comments.
- **Do not fix the 13 pre-existing `tsc` errors.** They live in `file-explorer-v2` and `styles/common/components.ts`. `npx tsc --noEmit` exits non-zero before you start and will after you finish. Judge your work by not *adding* errors.
- **Do not touch `file-explorer-v2`.** It has its own context menu and is being retired. Leave it alone.
- **Renderer never imports `electron`, `fs`, or `path`.** Anything shared by both processes goes in `src/common/`.
- **Handler classes follow the DI pattern** in `src/main/fs/DiskHandlers.ts`: a `Dependencies` interface, constructor takes `deps`, public `registerAll()`, one private `registerX()` per channel.
- **Every new IPC channel is added to `preload.ts`, to `src/renderer/shared/types/index.ts`, and to a main-process handler in the same task.** `src/tests/unit/ipcContract.test.ts` fails on any channel invoked from preload with no registered handler.
- **Batch operations never throw.** They return per-target outcomes. A rejected batch promise is a bug.
- **`npm test` before every commit.** The pre-commit hook enforces it. If `npm run better-dev` was run since the last `npm test`, the first `npm test` rebuilds `better-sqlite3` for Node — that is expected and takes a few seconds.
- **Do not test CSS.** happy-dom computes no layout. Assert behaviour and roles, not class names.
- **Add a `data-testid` to every new interactive element**, matching the existing `disk-*` / `tab-*` conventions.

---

## File Structure

```
MAIN                                        RENDERER
──────────────────────────────────          ────────────────────────────────────
src/main/menu/                              src/renderer/features/disk-explorer/
  contextMenuTemplate.ts  (NEW, pure)         hooks/useContextMenu.ts    (NEW)
  ContextMenu.ts          (NEW)               contextActions.ts         (NEW)
  menuTemplate.ts         (unchanged)         components/DiskFolderView.tsx (MODIFY)
                                              components/DiskTreeItem.tsx   (MODIFY)
src/main/fs/                                  components/TabStrip.tsx       (MODIFY)
  copyNames.ts            (NEW, pure)         components/detail/DetailPane.tsx (MODIFY)
  FileWriter.ts           (MODIFY)            components/dialogs/NameDialog.tsx (MODIFY)
  DiskHandlers.ts         (MODIFY)            components/dialogs/ConfirmDeleteDialog.tsx (MODIFY)
                                              store/diskStore.ts        (MODIFY)
src/main.ts               (MODIFY)            store/tabsStore.ts        (MODIFY)
src/preload.ts            (MODIFY)          src/renderer/shared/types/index.ts (MODIFY)

SHARED
src/common/contextActionIds.ts  (NEW, pure)
src/common/batch.ts             (NEW, pure — BatchOutcome, summarizeBatch)
```

**Responsibilities:**

- `contextActionIds.ts` — the string constants both processes import. A typo becomes a compile error instead of a dead menu item.
- `batch.ts` — the `BatchOutcome` shape and the pure function that turns a result array into the sentence a toast shows. Shared because main produces the outcomes and the renderer describes them.
- `copyNames.ts` — pure duplicate-name generation (`report.pdf` → `report copy.pdf` → `report copy 2.pdf`). Separate from `FileWriter` so it tests without a filesystem.
- `contextMenuTemplate.ts` — pure. `ContextRequest` in, menu items out. No Electron import.
- `ContextMenu.ts` — builds and pops the menu, sends the choice back. The only untestable line is `popup()`.
- `useContextMenu.ts` — the renderer's right-click handler: reconciles the selection, assembles the request, sends it.
- `contextActions.ts` — `actionId → (targets) => void`. One flat table, no conditionals.

---

## Phase boundaries

| Phase | Tasks | Delivers | Risk |
|---|---|---|---|
| 1 | 0–4 | Capabilities the menu needs: duplicate, batch mutations, copy-path, new file | medium — touches `FileWriter`, the audited mutation layer |
| 2 | 5–7 | The menu itself: template, popup, IPC round-trip | low — mirrors `AppMenu` exactly |
| 3 | 8–11 | Wiring: dispatch table, hook, every surface, dialogs | medium — touches heavily-tested `DiskFolderView` |
| 4 | 12 | Final verification | none |

Each phase ends with the app working. Stop after any phase if priorities change.

---

# PHASE 1 — The capabilities behind the menu

---

### Task 0: Establish the baseline

**Files:**
- Create: `docs/superpowers/plans/baseline-context-menus.txt`

- [ ] **Step 1: Record the numbers**

```bash
{
  echo "Baseline before context-menus, against $(git rev-parse --short HEAD)"
  echo "tsc errors (pre-existing, do not fix): $(npx tsc --noEmit 2>&1 | grep -c 'error TS')"
  echo "e2e tests: $(npx playwright test --config e2e/playwright.config.ts --list 2>/dev/null | tail -1)"
} > docs/superpowers/plans/baseline-context-menus.txt
npm test 2>&1 | grep -E "Tests |Test Files " >> docs/superpowers/plans/baseline-context-menus.txt
cat docs/superpowers/plans/baseline-context-menus.txt
```

Expected: `13` tsc errors, `Total: 9 tests in 5 files`, `Tests 452 passed (452)`, `Test Files 54 passed (54)`.

If any number differs, record what you actually see and use that as your baseline. A *lower* test count means something was deleted — stop and ask.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/baseline-context-menus.txt
git commit -m "docs: record baseline before context menus"
```

---

### Task 1: Duplicate-name generation

Pure string logic, split from `FileWriter` so it tests without a filesystem.

**Files:**
- Create: `src/main/fs/copyNames.ts`
- Test: `src/tests/unit/fs/copyNames.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `nextCopyName(name: string, existing: string[]): string`

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/fs/copyNames.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nextCopyName } from '@/main/fs/copyNames';

describe('nextCopyName', () => {
  it('appends "copy" before the extension', () => {
    expect(nextCopyName('report.pdf', [])).toBe('report copy.pdf');
  });

  it('appends "copy" to a name with no extension', () => {
    expect(nextCopyName('Notes', [])).toBe('Notes copy');
  });

  it('numbers the second copy', () => {
    expect(nextCopyName('report.pdf', ['report copy.pdf'])).toBe('report copy 2.pdf');
  });

  it('keeps counting past the second copy', () => {
    expect(
      nextCopyName('report.pdf', ['report copy.pdf', 'report copy 2.pdf'])
    ).toBe('report copy 3.pdf');
  });

  it('duplicates a copy rather than re-numbering it', () => {
    // Finder's behaviour: duplicating "report copy.pdf" gives "report copy 2.pdf",
    // not "report copy copy.pdf".
    expect(nextCopyName('report copy.pdf', ['report copy.pdf'])).toBe('report copy 2.pdf');
  });

  it('fills a gap left by a deleted copy', () => {
    expect(
      nextCopyName('report.pdf', ['report copy.pdf', 'report copy 3.pdf'])
    ).toBe('report copy 2.pdf');
  });

  it('treats a dotfile as having no extension', () => {
    // ".gitignore" is a name, not an extension — "copy.gitignore" would be wrong.
    expect(nextCopyName('.gitignore', [])).toBe('.gitignore copy');
  });

  it('uses only the last extension of a double extension', () => {
    expect(nextCopyName('archive.tar.gz', [])).toBe('archive.tar copy.gz');
  });

  it('ignores unrelated names in the directory', () => {
    expect(nextCopyName('report.pdf', ['other.pdf', 'report2.pdf'])).toBe('report copy.pdf');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/fs/copyNames.test.ts`
Expected: FAIL — cannot resolve `@/main/fs/copyNames`.

- [ ] **Step 3: Implement**

Create `src/main/fs/copyNames.ts`:

```ts
/**
 * Duplicate naming, matching Finder: "report.pdf" becomes "report copy.pdf",
 * then "report copy 2.pdf".
 *
 * Pure and filesystem-free — the caller supplies the directory's existing
 * names — so every collision case tests without touching disk.
 */

/** Splits "archive.tar.gz" into ["archive.tar", ".gz"], and ".gitignore" into [".gitignore", ""]. */
function splitExtension(name: string): [string, string] {
  const dot = name.lastIndexOf('.');
  // dot <= 0 covers both "no extension" and a leading-dot name like ".gitignore".
  if (dot <= 0) return [name, ''];
  return [name.slice(0, dot), name.slice(dot)];
}

/** Strips a trailing " copy" or " copy N" so duplicating a copy does not stack the word. */
function stripCopySuffix(stem: string): string {
  return stem.replace(/ copy(?: \d+)?$/, '');
}

export function nextCopyName(name: string, existing: string[]): string {
  const [stem, extension] = splitExtension(name);
  const base = stripCopySuffix(stem);
  const taken = new Set(existing);

  const candidate = `${base} copy${extension}`;
  if (!taken.has(candidate)) return candidate;

  // Start at 2: "copy" is conceptually the first, so the next is the second.
  for (let counter = 2; ; counter += 1) {
    const numbered = `${base} copy ${counter}${extension}`;
    if (!taken.has(numbered)) return numbered;
  }
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/fs/copyNames.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/fs/copyNames.ts src/tests/unit/fs/copyNames.test.ts
git commit -m "feat(files): add Finder-style duplicate naming"
```

---

### Task 2: Copy and duplicate in `FileWriter`

**Files:**
- Modify: `src/main/fs/FileWriter.ts`
- Test: `src/tests/unit/fs/fileWriter.test.ts` (append; **do not rewrite the existing 35 tests**)

**Interfaces:**
- Consumes: `nextCopyName` (Task 1).
- Produces:
  - `FileWriter.copy(target: string, destinationDir: string): Promise<string>`
  - `FileWriter.duplicate(target: string): Promise<string>`

- [ ] **Step 1: Write the failing test**

Append to `src/tests/unit/fs/fileWriter.test.ts`. Reuse whatever `beforeEach` fixture that file already builds — read the top of the file first and follow it exactly rather than inventing a second fixture.

```ts
describe('copy', () => {
  it('copies a file into a destination directory', async () => {
    await writeFile(path.join(root, 'a.txt'), 'hello', 'utf-8');
    await mkdir(path.join(root, 'sub'));

    const created = await writer.copy(path.join(root, 'a.txt'), path.join(root, 'sub'));

    expect(created).toBe(path.join(root, 'sub', 'a.txt'));
    expect(await readFile(created, 'utf-8')).toBe('hello');
    // The original must survive — this is a copy, not a move.
    expect(await readFile(path.join(root, 'a.txt'), 'utf-8')).toBe('hello');
  });

  it('copies a directory and its contents', async () => {
    await mkdir(path.join(root, 'src', 'nested'), { recursive: true });
    await writeFile(path.join(root, 'src', 'nested', 'deep.txt'), 'deep', 'utf-8');
    await mkdir(path.join(root, 'dest'));

    await writer.copy(path.join(root, 'src'), path.join(root, 'dest'));

    expect(await readFile(path.join(root, 'dest', 'src', 'nested', 'deep.txt'), 'utf-8'))
      .toBe('deep');
  });

  it('refuses to copy over an existing name', async () => {
    await writeFile(path.join(root, 'a.txt'), 'one', 'utf-8');
    await mkdir(path.join(root, 'sub'));
    await writeFile(path.join(root, 'sub', 'a.txt'), 'two', 'utf-8');

    await expect(
      writer.copy(path.join(root, 'a.txt'), path.join(root, 'sub'))
    ).rejects.toThrow(DestinationExistsError);
  });

  it('refuses a source outside every root', async () => {
    await expect(writer.copy('/etc/hosts', root)).rejects.toThrow();
  });

  it('refuses a destination outside every root', async () => {
    await writeFile(path.join(root, 'a.txt'), 'hello', 'utf-8');
    await expect(writer.copy(path.join(root, 'a.txt'), '/tmp')).rejects.toThrow();
  });

  it('refuses to copy a directory into itself', async () => {
    await mkdir(path.join(root, 'folder'));
    await expect(
      writer.copy(path.join(root, 'folder'), path.join(root, 'folder'))
    ).rejects.toThrow();
  });
});

describe('duplicate', () => {
  it('creates a sibling named "copy"', async () => {
    await writeFile(path.join(root, 'report.pdf'), 'pdf', 'utf-8');

    const created = await writer.duplicate(path.join(root, 'report.pdf'));

    expect(created).toBe(path.join(root, 'report copy.pdf'));
    expect(await readFile(created, 'utf-8')).toBe('pdf');
  });

  it('numbers the second duplicate', async () => {
    await writeFile(path.join(root, 'report.pdf'), 'pdf', 'utf-8');
    await writer.duplicate(path.join(root, 'report.pdf'));

    const second = await writer.duplicate(path.join(root, 'report.pdf'));
    expect(second).toBe(path.join(root, 'report copy 2.pdf'));
  });

  it('duplicates a directory', async () => {
    await mkdir(path.join(root, 'folder'));
    await writeFile(path.join(root, 'folder', 'x.txt'), 'x', 'utf-8');

    const created = await writer.duplicate(path.join(root, 'folder'));

    expect(created).toBe(path.join(root, 'folder copy'));
    expect(await readFile(path.join(created, 'x.txt'), 'utf-8')).toBe('x');
  });

  it('refuses a target outside every root', async () => {
    await expect(writer.duplicate('/etc/hosts')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/fs/fileWriter.test.ts`
Expected: FAIL — `writer.copy is not a function`.

- [ ] **Step 3: Implement**

Add to `FileWriter`, after `move` and before `moveToTrash`. Note `copyRecursive` already exists as a module-level helper in this file — it is what the EXDEV branch of `move` uses. Do not write a second one.

```ts
  /**
   * Copies a file or directory into another directory, keeping its name.
   *
   * Deliberately refuses to overwrite: silently replacing a file the user
   * forgot about is the kind of data loss that is never noticed until later.
   */
  async copy(target: string, destinationDir: string): Promise<string> {
    const source = await assertMutableTarget(this.deps.registry, target);
    const parent = await this.deps.registry.assertAllowed(destinationDir);

    const parentInfo = await stat(parent);
    if (!parentInfo.isDirectory()) {
      throw new Error(`Cannot copy into ${destinationDir} because it is not a directory`);
    }

    // Copying a directory inside itself recurses forever.
    const sourceInfo = await stat(source);
    if (sourceInfo.isDirectory() && isInsideRoot(source, parent)) {
      throw new Error('Cannot copy a folder into itself');
    }

    const destination = normalizePath(path.join(parent, path.basename(source)));
    await assertAbsent(destination);

    await copyRecursive(source, destination);
    return destination;
  }

  /**
   * Copies a file or directory beside itself under a Finder-style name.
   *
   * The existing-name list comes from the parent directory rather than from a
   * loop of existence checks, so the whole naming decision is one pure call.
   */
  async duplicate(target: string): Promise<string> {
    const source = await assertMutableTarget(this.deps.registry, target);
    const parent = path.dirname(source);

    const siblings = await readdir(parent);
    const name = nextCopyName(path.basename(source), siblings);
    const destination = normalizePath(path.join(parent, name));

    await assertAbsent(destination);
    await copyRecursive(source, destination);
    return destination;
  }
```

Add the import at the top of `FileWriter.ts`:

```ts
import { nextCopyName } from '@/main/fs/copyNames';
```

`readdir` is already imported at the top of the file. Confirm before adding it again.

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/fs/fileWriter.test.ts`
Expected: PASS, 45 tests (35 existing + 10 new).

If the "copy a directory into itself" test fails, `isInsideRoot(source, parent)` has its arguments the wrong way round — check how `move` calls it and match.

- [ ] **Step 5: Commit**

```bash
git add src/main/fs/FileWriter.ts src/tests/unit/fs/fileWriter.test.ts
git commit -m "feat(files): add copy and duplicate to FileWriter"
```

---

### Task 3: The batch layer

Multi-target mutations that report per-target outcomes and never throw.

**Files:**
- Create: `src/common/batch.ts`
- Modify: `src/main/fs/FileWriter.ts`
- Test: `src/tests/unit/batch.test.ts`
- Test: `src/tests/unit/fs/fileWriterBatch.test.ts`

**Interfaces:**
- Consumes: `FileWriter.moveToTrash`, `.move`, `.duplicate` (Task 2).
- Produces:
  - `interface BatchOutcome { path: string; ok: boolean; error?: string }`
  - `type BatchResult = BatchOutcome[]`
  - `summarizeBatch(result: BatchResult, verb: { one: string; many: string }): string`
  - `FileWriter.trashMany(targets: string[]): Promise<BatchResult>`
  - `FileWriter.moveMany(targets: string[], destinationDir: string): Promise<BatchResult>`
  - `FileWriter.duplicateMany(targets: string[]): Promise<BatchResult>`

- [ ] **Step 1: Write the failing test for the shared shape**

Create `src/tests/unit/batch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { summarizeBatch, type BatchResult } from '@/common/batch';

const TRASH = { one: 'Moved to Trash', many: 'Moved {n} items to Trash' };

describe('summarizeBatch', () => {
  it('describes a single success', () => {
    const result: BatchResult = [{ path: '/V/a.md', ok: true }];
    expect(summarizeBatch(result, TRASH)).toBe('Moved to Trash');
  });

  it('describes several successes with a count', () => {
    const result: BatchResult = [
      { path: '/V/a.md', ok: true },
      { path: '/V/b.md', ok: true },
      { path: '/V/c.md', ok: true },
    ];
    expect(summarizeBatch(result, TRASH)).toBe('Moved 3 items to Trash');
  });

  it('names the failures when only some succeed', () => {
    const result: BatchResult = [
      { path: '/V/a.md', ok: true },
      { path: '/V/b.md', ok: false, error: 'Permission denied' },
    ];
    // The count of successes plus what actually broke — a bare "some failed"
    // leaves the user with no idea which file to go and look at.
    expect(summarizeBatch(result, TRASH)).toBe('Moved to Trash — b.md failed');
  });

  it('names several failures', () => {
    const result: BatchResult = [
      { path: '/V/a.md', ok: true },
      { path: '/V/b.md', ok: false, error: 'Permission denied' },
      { path: '/V/c.md', ok: false, error: 'Permission denied' },
    ];
    expect(summarizeBatch(result, TRASH)).toBe('Moved to Trash — b.md, c.md failed');
  });

  it('reports the error verbatim when everything failed', () => {
    const result: BatchResult = [{ path: '/V/a.md', ok: false, error: 'Permission denied' }];
    expect(summarizeBatch(result, TRASH)).toBe('Permission denied');
  });

  it('reports the first error when everything failed for different reasons', () => {
    const result: BatchResult = [
      { path: '/V/a.md', ok: false, error: 'Permission denied' },
      { path: '/V/b.md', ok: false, error: 'No such file' },
    ];
    expect(summarizeBatch(result, TRASH)).toBe('Permission denied');
  });

  it('handles an empty result without inventing a sentence', () => {
    expect(summarizeBatch([], TRASH)).toBe('');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/batch.test.ts`
Expected: FAIL — cannot resolve `@/common/batch`.

- [ ] **Step 3: Implement the shared shape**

Create `src/common/batch.ts`:

```ts
/**
 * The result shape for an operation applied to many files.
 *
 * There is no transaction across files: a batch that trashes five items can
 * genuinely succeed for three and fail for two, so the result reports each
 * target rather than collapsing to one boolean. Lives in common/ because main
 * produces these and the renderer describes them.
 */

export interface BatchOutcome {
  path: string;
  ok: boolean;
  /** Present only when ok is false. */
  error?: string;
}

export type BatchResult = BatchOutcome[];

function basename(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index === -1 ? filePath : filePath.slice(index + 1);
}

/**
 * One sentence for a toast.
 *
 * `verb.many` may contain `{n}`, replaced with the number that succeeded.
 */
export function summarizeBatch(
  result: BatchResult,
  verb: { one: string; many: string }
): string {
  if (result.length === 0) return '';

  const succeeded = result.filter((outcome) => outcome.ok);
  const failed = result.filter((outcome) => !outcome.ok);

  // Total failure is reported as the error itself: a summary sentence would
  // bury the only information the user can act on.
  if (succeeded.length === 0) {
    return failed[0].error ?? 'Failed';
  }

  const success =
    succeeded.length === 1
      ? verb.one
      : verb.many.replace('{n}', String(succeeded.length));

  if (failed.length === 0) return success;

  const names = failed.map((outcome) => basename(outcome.path)).join(', ');
  return `${success} — ${names} failed`;
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/batch.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the failing test for the batch methods**

Create `src/tests/unit/fs/fileWriterBatch.test.ts`. Build the fixture the same way `fileWriter.test.ts` does — read that file's `beforeEach` and copy its construction of `registry`, `writer`, and `root`.

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import os from 'os';
import { FileWriter } from '@/main/fs/FileWriter';
import { RootRegistry } from '@/main/fs/RootRegistry';

let root: string;
let tmp: string;
let writer: FileWriter;
let trashed: string[];

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-batch-'));
  root = path.join(tmp, 'Vault');
  await mkdir(root);

  const registry = new RootRegistry({ storePath: path.join(tmp, 'roots.json') });
  await registry.load();
  await registry.add(root);

  trashed = [];
  writer = new FileWriter({
    registry,
    trashItem: async (fullPath: string) => {
      if (fullPath.endsWith('locked.txt')) throw new Error('Permission denied');
      trashed.push(fullPath);
    },
  });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('trashMany', () => {
  it('reports an outcome for every target', async () => {
    await writeFile(path.join(root, 'a.txt'), 'a', 'utf-8');
    await writeFile(path.join(root, 'b.txt'), 'b', 'utf-8');

    const result = await writer.trashMany([
      path.join(root, 'a.txt'),
      path.join(root, 'b.txt'),
    ]);

    expect(result).toHaveLength(2);
    expect(result.every((outcome) => outcome.ok)).toBe(true);
  });

  it('keeps going after a failure rather than stopping', async () => {
    await writeFile(path.join(root, 'a.txt'), 'a', 'utf-8');
    await writeFile(path.join(root, 'locked.txt'), 'x', 'utf-8');
    await writeFile(path.join(root, 'c.txt'), 'c', 'utf-8');

    const result = await writer.trashMany([
      path.join(root, 'a.txt'),
      path.join(root, 'locked.txt'),
      path.join(root, 'c.txt'),
    ]);

    // The file after the failure must still have been attempted.
    expect(result.map((outcome) => outcome.ok)).toEqual([true, false, true]);
    expect(trashed).toHaveLength(2);
  });

  it('records the error message for a failed target', async () => {
    await writeFile(path.join(root, 'locked.txt'), 'x', 'utf-8');
    const result = await writer.trashMany([path.join(root, 'locked.txt')]);
    expect(result[0].error).toContain('Permission denied');
  });

  it('never rejects, even when every target fails', async () => {
    await writeFile(path.join(root, 'locked.txt'), 'x', 'utf-8');
    await expect(
      writer.trashMany([path.join(root, 'locked.txt'), '/etc/hosts'])
    ).resolves.toHaveLength(2);
  });

  it('rejects a target outside every root as a failed outcome, not a throw', async () => {
    const result = await writer.trashMany(['/etc/hosts']);
    expect(result[0].ok).toBe(false);
    // The guard still held: nothing outside a root was touched.
    expect(trashed).toHaveLength(0);
  });

  it('returns an empty result for no targets', async () => {
    await expect(writer.trashMany([])).resolves.toEqual([]);
  });
});

describe('duplicateMany', () => {
  it('duplicates every target', async () => {
    await writeFile(path.join(root, 'a.txt'), 'a', 'utf-8');
    await writeFile(path.join(root, 'b.txt'), 'b', 'utf-8');

    const result = await writer.duplicateMany([
      path.join(root, 'a.txt'),
      path.join(root, 'b.txt'),
    ]);

    expect(result.every((outcome) => outcome.ok)).toBe(true);
  });

  it('numbers duplicates when the same target is duplicated twice', async () => {
    await writeFile(path.join(root, 'a.txt'), 'a', 'utf-8');

    await writer.duplicateMany([path.join(root, 'a.txt')]);
    const second = await writer.duplicateMany([path.join(root, 'a.txt')]);

    expect(second[0].ok).toBe(true);
  });
});

describe('moveMany', () => {
  it('moves every target into the destination', async () => {
    await writeFile(path.join(root, 'a.txt'), 'a', 'utf-8');
    await writeFile(path.join(root, 'b.txt'), 'b', 'utf-8');
    await mkdir(path.join(root, 'dest'));

    const result = await writer.moveMany(
      [path.join(root, 'a.txt'), path.join(root, 'b.txt')],
      path.join(root, 'dest')
    );

    expect(result.every((outcome) => outcome.ok)).toBe(true);
  });

  it('reports a name collision as a failed outcome', async () => {
    await writeFile(path.join(root, 'a.txt'), 'a', 'utf-8');
    await mkdir(path.join(root, 'dest'));
    await writeFile(path.join(root, 'dest', 'a.txt'), 'existing', 'utf-8');

    const result = await writer.moveMany([path.join(root, 'a.txt')], path.join(root, 'dest'));
    expect(result[0].ok).toBe(false);
    expect(result[0].error).toBeTruthy();
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/fs/fileWriterBatch.test.ts`
Expected: FAIL — `writer.trashMany is not a function`.

- [ ] **Step 7: Implement the batch methods**

Add to `FileWriter`, after `moveToTrash`:

```ts
  async trashMany(targets: string[]): Promise<BatchResult> {
    return this.runBatch(targets, (target) => this.moveToTrash(target));
  }

  async moveMany(targets: string[], destinationDir: string): Promise<BatchResult> {
    return this.runBatch(targets, (target) => this.move(target, destinationDir));
  }

  async duplicateMany(targets: string[]): Promise<BatchResult> {
    return this.runBatch(targets, (target) => this.duplicate(target));
  }

  /**
   * Applies one operation to many targets, collecting an outcome each.
   *
   * Sequential rather than parallel: these are filesystem mutations whose
   * failures should be attributable to a target, and a parallel duplicate of
   * two files with the same base name would race on the "copy 2" decision.
   *
   * Never rejects. A caller receives per-target results and decides what to say.
   */
  private async runBatch(
    targets: string[],
    operation: (target: string) => Promise<unknown>
  ): Promise<BatchResult> {
    const outcomes: BatchResult = [];

    for (const target of targets) {
      try {
        await operation(target);
        outcomes.push({ path: target, ok: true });
      } catch (error) {
        outcomes.push({
          path: target,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      // Yield between targets so a large selection cannot lock the main
      // process for the whole operation.
      await new Promise((resolve) => setImmediate(resolve));
    }

    return outcomes;
  }
```

Add the import to `FileWriter.ts`:

```ts
import type { BatchResult } from '@/common/batch';
```

- [ ] **Step 8: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/fs/fileWriterBatch.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 9: Full suite and commit**

Run: `npm test`

```bash
git add src/common/batch.ts src/main/fs/FileWriter.ts src/tests/unit/batch.test.ts src/tests/unit/fs/fileWriterBatch.test.ts
git commit -m "feat(files): add batch mutations reporting per-target outcomes"
```

---

### Task 4: New IPC — batch mutations, duplicate, copy-path, new file

**Files:**
- Modify: `src/main/fs/DiskHandlers.ts`
- Modify: `src/main/fs/FileWriter.ts` (adds `createFile`)
- Modify: `src/preload.ts`
- Modify: `src/renderer/shared/types/index.ts`
- Modify: `src/main.ts` (passes `clipboard` into `DiskHandlers`)
- Test: `src/tests/unit/fs/diskHandlers.test.ts` (append)

**Interfaces:**
- Consumes: the batch methods (Task 3).
- Produces, on `window.diskAPI`:
  - `trashMany(targets: string[]): Promise<IPCResponse<BatchResult>>`
  - `moveMany(targets: string[], destinationDir: string): Promise<IPCResponse<BatchResult>>`
  - `duplicateMany(targets: string[]): Promise<IPCResponse<BatchResult>>`
  - `copyPath(targets: string[]): Promise<IPCResponse>`
  - `createFile(parentDir: string, name: string): Promise<IPCResponse<string>>`

- [ ] **Step 1: Write the failing test**

Append to `src/tests/unit/fs/diskHandlers.test.ts`, following that file's existing fixture for building `DiskHandlers` with a fake `ipc`:

```ts
describe('batch channels', () => {
  it('registers every batch channel', () => {
    expect(handlers.has('disk:trash-many')).toBe(true);
    expect(handlers.has('disk:move-many')).toBe(true);
    expect(handlers.has('disk:duplicate-many')).toBe(true);
  });

  it('returns the batch result as data', async () => {
    writer.trashMany = vi.fn(async () => [
      { path: '/V/a.md', ok: true },
      { path: '/V/b.md', ok: false, error: 'nope' },
    ]);

    const response = await invoke('disk:trash-many', ['/V/a.md', '/V/b.md']);

    expect(response.success).toBe(true);
    expect(response.data).toHaveLength(2);
    expect(response.data[1].ok).toBe(false);
  });

  it('reports success:true even when every target failed', async () => {
    // success describes whether the batch ran, not whether every file worked.
    // Collapsing these two would hide which files failed.
    writer.trashMany = vi.fn(async () => [{ path: '/V/a.md', ok: false, error: 'nope' }]);

    const response = await invoke('disk:trash-many', ['/V/a.md']);
    expect(response.success).toBe(true);
  });

  it('rejects a non-array target list rather than trusting the renderer', async () => {
    const response = await invoke('disk:trash-many', 'not-an-array');
    expect(response.success).toBe(false);
  });
});

describe('disk:copy-path', () => {
  it('writes a single path to the clipboard', async () => {
    const response = await invoke('disk:copy-path', ['/V/a.md']);
    expect(response.success).toBe(true);
    expect(clipboard.writeText).toHaveBeenCalledWith('/V/a.md');
  });

  it('joins several paths with newlines', async () => {
    await invoke('disk:copy-path', ['/V/a.md', '/V/b.md']);
    expect(clipboard.writeText).toHaveBeenCalledWith('/V/a.md\n/V/b.md');
  });

  it('refuses a path outside every root', async () => {
    const response = await invoke('disk:copy-path', ['/etc/hosts']);
    expect(response.success).toBe(false);
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });
});

describe('disk:create-file', () => {
  it('creates an empty file and returns its path', async () => {
    writer.createFile = vi.fn(async () => '/V/new.md');
    const response = await invoke('disk:create-file', '/V', 'new.md');
    expect(response.success).toBe(true);
    expect(response.data).toBe('/V/new.md');
  });
});
```

Add `clipboard` to the fake dependencies in that file's fixture:

```ts
const clipboard = { writeText: vi.fn() };
```

and pass `clipboard` into the `DiskHandlers` constructor there.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/fs/diskHandlers.test.ts`
Expected: FAIL — the new channels are not registered.

- [ ] **Step 3: Add `createFile` to `FileWriter`**

Add beside `createDirectory`:

```ts
  /**
   * Creates an empty file. Used by New File in the context menu.
   *
   * 'wx' fails when the path exists rather than truncating it — the same
   * no-silent-overwrite rule every other method here follows.
   */
  async createFile(parentDir: string, name: string): Promise<string> {
    assertValidName(name);
    const parent = await this.deps.registry.assertAllowed(parentDir);

    const target = normalizePath(path.join(parent, name));
    await assertAbsent(target);

    await writeFile(target, '', { encoding: 'utf-8', flag: 'wx' });
    return target;
  }
```

Add `writeFile` to the `fs/promises` import list at the top of `FileWriter.ts`.

- [ ] **Step 4: Register the channels**

In `src/main/fs/DiskHandlers.ts`, add to `DiskHandlerDependencies`:

```ts
  /** Electron's clipboard — injected so tests never touch the real one. */
  clipboard: { writeText: (text: string) => void };
```

Add to `registerAll()`:

```ts
    this.registerTrashMany();
    this.registerMoveMany();
    this.registerDuplicateMany();
    this.registerCopyPath();
    this.registerCreateFile();
```

Add the methods, following the file's existing shape exactly:

```ts
  private registerTrashMany(): void {
    this.deps.ipc.handle(
      'disk:trash-many',
      async (_, targets: string[]): Promise<IPCResponse<BatchResult>> => {
        if (!Array.isArray(targets)) {
          return { success: false, error: 'Expected a list of paths' };
        }
        const data = await this.deps.writer.trashMany(targets);
        return { success: true, data };
      }
    );
  }

  private registerMoveMany(): void {
    this.deps.ipc.handle(
      'disk:move-many',
      async (_, targets: string[], destinationDir: string): Promise<IPCResponse<BatchResult>> => {
        if (!Array.isArray(targets)) {
          return { success: false, error: 'Expected a list of paths' };
        }
        const data = await this.deps.writer.moveMany(targets, destinationDir);
        return { success: true, data };
      }
    );
  }

  private registerDuplicateMany(): void {
    this.deps.ipc.handle(
      'disk:duplicate-many',
      async (_, targets: string[]): Promise<IPCResponse<BatchResult>> => {
        if (!Array.isArray(targets)) {
          return { success: false, error: 'Expected a list of paths' };
        }
        const data = await this.deps.writer.duplicateMany(targets);
        return { success: true, data };
      }
    );
  }

  private registerCopyPath(): void {
    this.deps.ipc.handle(
      'disk:copy-path',
      async (_, targets: string[]): Promise<IPCResponse> => {
        if (!Array.isArray(targets) || targets.length === 0) {
          return { success: false, error: 'Expected a list of paths' };
        }
        try {
          // Validated even though nothing is written: a path the app will not
          // open should not leak out through the clipboard either.
          const resolved: string[] = [];
          for (const target of targets) {
            resolved.push(await this.deps.registry.assertAllowed(target));
          }
          this.deps.clipboard.writeText(resolved.join('\n'));
          return { success: true };
        } catch (error) {
          return { success: false, error: describeError(error, 'Failed to copy path') };
        }
      }
    );
  }

  private registerCreateFile(): void {
    this.deps.ipc.handle(
      'disk:create-file',
      async (_, parentDir: string, name: string): Promise<IPCResponse<string>> => {
        try {
          const created = await this.deps.writer.createFile(parentDir, name);
          return { success: true, data: created };
        } catch (error) {
          return { success: false, error: describeError(error, 'Failed to create file') };
        }
      }
    );
  }
```

Add the import:

```ts
import type { BatchResult } from '@/common/batch';
```

- [ ] **Step 5: Pass the clipboard in `src/main.ts`**

Add `clipboard` to the `electron` import, and to the `DiskHandlers` construction:

```ts
const diskHandlers = new DiskHandlers({
  // ...existing deps unchanged...
  clipboard,
});
```

- [ ] **Step 6: Expose the channels in `preload.ts`**

Add to the `diskAPI` object:

```ts
  trashMany: (targets: string[]) => ipcRenderer.invoke('disk:trash-many', targets),
  moveMany: (targets: string[], destinationDir: string) =>
    ipcRenderer.invoke('disk:move-many', targets, destinationDir),
  duplicateMany: (targets: string[]) => ipcRenderer.invoke('disk:duplicate-many', targets),
  copyPath: (targets: string[]) => ipcRenderer.invoke('disk:copy-path', targets),
  createFile: (parentDir: string, name: string) =>
    ipcRenderer.invoke('disk:create-file', parentDir, name),
```

Add the matching entries to the `diskAPI` interface in `src/renderer/shared/types/index.ts`:

```ts
      trashMany: (targets: string[]) => Promise<IPCResponse<BatchResult>>;
      moveMany: (targets: string[], destinationDir: string) => Promise<IPCResponse<BatchResult>>;
      duplicateMany: (targets: string[]) => Promise<IPCResponse<BatchResult>>;
      copyPath: (targets: string[]) => Promise<IPCResponse>;
      createFile: (parentDir: string, name: string) => Promise<IPCResponse<string>>;
```

with `import type { BatchResult } from '@/common/batch';` at the top of that file.

- [ ] **Step 7: Run the handler and contract tests**

Run: `npx vitest run src/tests/unit/fs/diskHandlers.test.ts src/tests/unit/ipcContract.test.ts`
Expected: PASS. A contract failure naming one of the new channels means Step 4 missed a `registerX()` call in `registerAll()`.

- [ ] **Step 8: Confirm no new type errors, then commit**

Run: `npx tsc --noEmit 2>&1 | grep -c 'error TS'` — expected: still `13`.
Run: `npm test`

```bash
git add src/main/fs/ src/preload.ts src/renderer/shared/types/index.ts src/main.ts src/tests/
git commit -m "feat(files): add batch, duplicate, copy-path, and create-file IPC"
```

---

# PHASE 2 — The menu

---

### Task 5: Action ids and the context template

Pure logic, no Electron import. This is what stops the menu and the dispatch table drifting apart.

**Files:**
- Create: `src/common/contextActionIds.ts`
- Create: `src/main/menu/contextMenuTemplate.ts`
- Test: `src/tests/unit/contextMenuTemplate.test.ts`

**Interfaces:**
- Consumes: `MenuTemplateItem` from `src/main/menu/menuTemplate.ts`.
- Produces:
  - `CONTEXT_ACTIONS` — frozen record of id constants
  - `type ContextKind = 'entry' | 'tree-item' | 'background' | 'tab'`
  - `interface ContextRequest { kind: ContextKind; targets: string[]; isDirectory?: boolean; isRoot?: boolean }`
  - `buildContextTemplate(request: ContextRequest): MenuTemplateItem[]`

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/contextMenuTemplate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  buildContextTemplate,
  type ContextRequest,
} from '@/main/menu/contextMenuTemplate';
import { CONTEXT_ACTIONS } from '@/common/contextActionIds';

function build(overrides: Partial<ContextRequest> = {}) {
  return buildContextTemplate({
    kind: 'entry',
    targets: ['/V/a.md'],
    isDirectory: false,
    ...overrides,
  });
}

function ids(items: ReturnType<typeof build>) {
  return items.map((item) => item.commandId).filter(Boolean);
}

describe('entry menu', () => {
  it('offers the core file actions', () => {
    const actions = ids(build());
    expect(actions).toContain(CONTEXT_ACTIONS.open);
    expect(actions).toContain(CONTEXT_ACTIONS.openInNewTab);
    expect(actions).toContain(CONTEXT_ACTIONS.quickLook);
    expect(actions).toContain(CONTEXT_ACTIONS.reveal);
    expect(actions).toContain(CONTEXT_ACTIONS.rename);
    expect(actions).toContain(CONTEXT_ACTIONS.duplicate);
    expect(actions).toContain(CONTEXT_ACTIONS.copyPath);
    expect(actions).toContain(CONTEXT_ACTIONS.trash);
  });

  it('omits per-item actions for a multi-selection', () => {
    // Rename and Open have no meaning for five files at once. Omitted rather
    // than disabled: grey reads as "not right now", not "not for this".
    const actions = ids(build({ targets: ['/V/a.md', '/V/b.md'] }));
    expect(actions).not.toContain(CONTEXT_ACTIONS.rename);
    expect(actions).not.toContain(CONTEXT_ACTIONS.open);
    expect(actions).toContain(CONTEXT_ACTIONS.trash);
    expect(actions).toContain(CONTEXT_ACTIONS.duplicate);
    expect(actions).toContain(CONTEXT_ACTIONS.copyPath);
  });

  it('pluralizes the trash label for a multi-selection', () => {
    const items = build({ targets: ['/V/a.md', '/V/b.md', '/V/c.md'] });
    const trash = items.find((item) => item.commandId === CONTEXT_ACTIONS.trash);
    expect(trash?.label).toBe('Move 3 Items to Trash');
  });

  it('uses the singular trash label for one target', () => {
    const trash = build().find((item) => item.commandId === CONTEXT_ACTIONS.trash);
    expect(trash?.label).toBe('Move to Trash');
  });

  it('offers Open With Default App only for a file', () => {
    expect(ids(build())).toContain(CONTEXT_ACTIONS.openExternal);
    expect(ids(build({ isDirectory: true }))).not.toContain(CONTEXT_ACTIONS.openExternal);
  });
});

describe('tree menu', () => {
  it('offers creation actions on a folder', () => {
    const actions = ids(build({ kind: 'tree-item', isDirectory: true }));
    expect(actions).toContain(CONTEXT_ACTIONS.newFolder);
    expect(actions).toContain(CONTEXT_ACTIONS.newFile);
  });

  it('offers Remove Root instead of Move to Trash for a root', () => {
    const actions = ids(build({ kind: 'tree-item', isDirectory: true, isRoot: true }));
    expect(actions).toContain(CONTEXT_ACTIONS.removeRoot);
    expect(actions).not.toContain(CONTEXT_ACTIONS.trash);
  });

  it('offers Move to Trash for a non-root folder', () => {
    const actions = ids(build({ kind: 'tree-item', isDirectory: true, isRoot: false }));
    expect(actions).toContain(CONTEXT_ACTIONS.trash);
  });
});

describe('background menu', () => {
  it('offers creation and view actions', () => {
    const actions = ids(build({ kind: 'background', targets: ['/V'] }));
    expect(actions).toContain(CONTEXT_ACTIONS.newFolder);
    expect(actions).toContain(CONTEXT_ACTIONS.newFile);
    expect(actions).toContain(CONTEXT_ACTIONS.sortByName);
    expect(actions).toContain(CONTEXT_ACTIONS.viewAsGallery);
  });

  it('offers no file actions, because nothing is targeted', () => {
    const actions = ids(build({ kind: 'background', targets: ['/V'] }));
    expect(actions).not.toContain(CONTEXT_ACTIONS.trash);
    expect(actions).not.toContain(CONTEXT_ACTIONS.rename);
  });
});

describe('tab menu', () => {
  it('offers the close variants', () => {
    const actions = ids(build({ kind: 'tab' }));
    expect(actions).toContain(CONTEXT_ACTIONS.closeTab);
    expect(actions).toContain(CONTEXT_ACTIONS.closeOtherTabs);
    expect(actions).toContain(CONTEXT_ACTIONS.closeTabsToRight);
    expect(actions).toContain(CONTEXT_ACTIONS.closeAllTabs);
  });
});

describe('every menu', () => {
  const REQUESTS: ContextRequest[] = [
    { kind: 'entry', targets: ['/V/a.md'], isDirectory: false },
    { kind: 'entry', targets: ['/V/a.md', '/V/b.md'] },
    { kind: 'entry', targets: ['/V/folder'], isDirectory: true },
    { kind: 'tree-item', targets: ['/V/folder'], isDirectory: true },
    { kind: 'tree-item', targets: ['/V'], isDirectory: true, isRoot: true },
    { kind: 'background', targets: ['/V'] },
    { kind: 'tab', targets: ['/V/a.md'] },
  ];

  it('never returns an empty menu', () => {
    // Electron STALLS THE APP building a menu with no items — this is the bug
    // that hung every launch during the shell-polish work.
    for (const request of REQUESTS) {
      expect(buildContextTemplate(request).length).toBeGreaterThan(0);
    }
  });

  it('never emits an item with neither a label nor a separator type', () => {
    for (const request of REQUESTS) {
      for (const item of buildContextTemplate(request)) {
        if (item.type === 'separator') continue;
        expect(item.label).toBeTruthy();
      }
    }
  });

  it('never emits a clickable item without an action id', () => {
    for (const request of REQUESTS) {
      for (const item of buildContextTemplate(request)) {
        if (item.type === 'separator') continue;
        expect(Boolean(item.commandId || item.role)).toBe(true);
      }
    }
  });

  it('never begins or ends with a separator', () => {
    // A leading or trailing separator draws a stray line in the popup.
    for (const request of REQUESTS) {
      const items = buildContextTemplate(request);
      expect(items[0].type).not.toBe('separator');
      expect(items[items.length - 1].type).not.toBe('separator');
    }
  });

  it('never emits two separators in a row', () => {
    for (const request of REQUESTS) {
      const items = buildContextTemplate(request);
      for (let index = 1; index < items.length; index += 1) {
        const both = items[index].type === 'separator' && items[index - 1].type === 'separator';
        expect(both).toBe(false);
      }
    }
  });
});

describe('CONTEXT_ACTIONS', () => {
  it('has no duplicate values', () => {
    const values = Object.values(CONTEXT_ACTIONS);
    expect(new Set(values).size).toBe(values.length);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/contextMenuTemplate.test.ts`
Expected: FAIL — cannot resolve `@/common/contextActionIds`.

- [ ] **Step 3: Implement the ids**

Create `src/common/contextActionIds.ts`:

```ts
/**
 * Context-menu action identifiers, shared by the main-process template builder
 * and the renderer's dispatch table.
 *
 * Separate from COMMAND_IDS because these are target-bound: every one of them
 * needs to know which files it applies to, whereas a palette command is global.
 * Mixing the two would mean inventing a "currently right-clicked" global for
 * commandRegistry to read.
 */
export const CONTEXT_ACTIONS = {
  open: 'ctx.open',
  openInNewTab: 'ctx.openInNewTab',
  quickLook: 'ctx.quickLook',
  reveal: 'ctx.reveal',
  openExternal: 'ctx.openExternal',
  rename: 'ctx.rename',
  duplicate: 'ctx.duplicate',
  copyPath: 'ctx.copyPath',
  trash: 'ctx.trash',

  newFolder: 'ctx.newFolder',
  newFile: 'ctx.newFile',
  toggleExpand: 'ctx.toggleExpand',
  removeRoot: 'ctx.removeRoot',
  revealFolder: 'ctx.revealFolder',

  sortByName: 'ctx.sortByName',
  sortByModified: 'ctx.sortByModified',
  sortBySize: 'ctx.sortBySize',
  sortByKind: 'ctx.sortByKind',
  viewAsList: 'ctx.viewAsList',
  viewAsGallery: 'ctx.viewAsGallery',

  closeTab: 'ctx.closeTab',
  closeOtherTabs: 'ctx.closeOtherTabs',
  closeTabsToRight: 'ctx.closeTabsToRight',
  closeAllTabs: 'ctx.closeAllTabs',
} as const;

export type ContextActionId = (typeof CONTEXT_ACTIONS)[keyof typeof CONTEXT_ACTIONS];
```

- [ ] **Step 4: Implement the template**

Create `src/main/menu/contextMenuTemplate.ts`:

```ts
import { CONTEXT_ACTIONS } from '@/common/contextActionIds';
import type { MenuTemplateItem } from './menuTemplate';

export type ContextKind = 'entry' | 'tree-item' | 'background' | 'tab';

export interface ContextRequest {
  kind: ContextKind;
  /**
   * Every path the action applies to. For 'background' this is the directory
   * being shown. Never empty.
   */
  targets: string[];
  /**
   * Describes the item actually clicked, not the whole selection. Ignored when
   * more than one target is present, where per-item entries are omitted anyway.
   */
  isDirectory?: boolean;
  /** Roots offer Remove Root instead of Move to Trash. */
  isRoot?: boolean;
}

const SEPARATOR: MenuTemplateItem = { type: 'separator' };

function item(id: string, label: string): MenuTemplateItem {
  return { label, commandId: id };
}

/**
 * Collapses the separators an omitted item leaves behind.
 *
 * Building the menu as a flat list with unconditional separators and cleaning
 * up afterwards is far easier to read — and to test — than threading
 * conditionals through every separator decision.
 */
function tidy(items: MenuTemplateItem[]): MenuTemplateItem[] {
  const collapsed: MenuTemplateItem[] = [];

  for (const entry of items) {
    const isSeparator = entry.type === 'separator';
    const previous = collapsed[collapsed.length - 1];
    if (isSeparator && (collapsed.length === 0 || previous?.type === 'separator')) continue;
    collapsed.push(entry);
  }

  while (collapsed.length > 0 && collapsed[collapsed.length - 1].type === 'separator') {
    collapsed.pop();
  }

  return collapsed;
}

function entryMenu(request: ContextRequest): MenuTemplateItem[] {
  const count = request.targets.length;
  const isSingle = count === 1;
  const trashLabel = isSingle ? 'Move to Trash' : `Move ${count} Items to Trash`;

  return [
    ...(isSingle ? [item(CONTEXT_ACTIONS.open, 'Open')] : []),
    ...(isSingle ? [item(CONTEXT_ACTIONS.openInNewTab, 'Open in New Tab')] : []),
    ...(isSingle ? [item(CONTEXT_ACTIONS.quickLook, 'Quick Look')] : []),
    SEPARATOR,
    item(CONTEXT_ACTIONS.reveal, 'Reveal in Finder'),
    ...(isSingle && !request.isDirectory
      ? [item(CONTEXT_ACTIONS.openExternal, 'Open With Default App')]
      : []),
    SEPARATOR,
    ...(isSingle ? [item(CONTEXT_ACTIONS.rename, 'Rename…')] : []),
    item(CONTEXT_ACTIONS.duplicate, isSingle ? 'Duplicate' : `Duplicate ${count} Items`),
    item(CONTEXT_ACTIONS.copyPath, isSingle ? 'Copy Path' : 'Copy Paths'),
    SEPARATOR,
    item(CONTEXT_ACTIONS.trash, trashLabel),
  ];
}

function treeMenu(request: ContextRequest): MenuTemplateItem[] {
  return [
    item(CONTEXT_ACTIONS.open, 'Open'),
    ...(request.isDirectory ? [item(CONTEXT_ACTIONS.toggleExpand, 'Expand or Collapse')] : []),
    SEPARATOR,
    ...(request.isDirectory
      ? [item(CONTEXT_ACTIONS.newFolder, 'New Folder'), item(CONTEXT_ACTIONS.newFile, 'New File')]
      : []),
    SEPARATOR,
    item(CONTEXT_ACTIONS.reveal, 'Reveal in Finder'),
    item(CONTEXT_ACTIONS.copyPath, 'Copy Path'),
    SEPARATOR,
    item(CONTEXT_ACTIONS.rename, 'Rename…'),
    request.isRoot
      ? item(CONTEXT_ACTIONS.removeRoot, 'Remove Folder from Opal')
      : item(CONTEXT_ACTIONS.trash, 'Move to Trash'),
  ];
}

function backgroundMenu(): MenuTemplateItem[] {
  return [
    item(CONTEXT_ACTIONS.newFolder, 'New Folder'),
    item(CONTEXT_ACTIONS.newFile, 'New File'),
    SEPARATOR,
    item(CONTEXT_ACTIONS.sortByName, 'Sort by Name'),
    item(CONTEXT_ACTIONS.sortByModified, 'Sort by Date Modified'),
    item(CONTEXT_ACTIONS.sortBySize, 'Sort by Size'),
    item(CONTEXT_ACTIONS.sortByKind, 'Sort by Kind'),
    SEPARATOR,
    item(CONTEXT_ACTIONS.viewAsList, 'View as List'),
    item(CONTEXT_ACTIONS.viewAsGallery, 'View as Gallery'),
    SEPARATOR,
    item(CONTEXT_ACTIONS.revealFolder, 'Reveal Folder in Finder'),
  ];
}

function tabMenu(): MenuTemplateItem[] {
  return [
    item(CONTEXT_ACTIONS.closeTab, 'Close'),
    item(CONTEXT_ACTIONS.closeOtherTabs, 'Close Others'),
    item(CONTEXT_ACTIONS.closeTabsToRight, 'Close to the Right'),
    item(CONTEXT_ACTIONS.closeAllTabs, 'Close All'),
    SEPARATOR,
    item(CONTEXT_ACTIONS.reveal, 'Reveal in Finder'),
    item(CONTEXT_ACTIONS.copyPath, 'Copy Path'),
  ];
}

/**
 * Builds the items for one context menu.
 *
 * Never returns an empty array: Electron stalls building a menu with no items,
 * which presents as the whole app hanging at startup rather than as an error.
 */
export function buildContextTemplate(request: ContextRequest): MenuTemplateItem[] {
  switch (request.kind) {
    case 'entry':
      return tidy(entryMenu(request));
    case 'tree-item':
      return tidy(treeMenu(request));
    case 'background':
      return tidy(backgroundMenu());
    case 'tab':
      return tidy(tabMenu());
  }
}
```

- [ ] **Step 5: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/contextMenuTemplate.test.ts`
Expected: PASS, 19 tests.

- [ ] **Step 6: Commit**

```bash
git add src/common/contextActionIds.ts src/main/menu/contextMenuTemplate.ts src/tests/unit/contextMenuTemplate.test.ts
git commit -m "feat(files): add the context menu template"
```

---

### Task 6: Popping the menu

**Files:**
- Create: `src/main/menu/ContextMenu.ts`
- Modify: `src/main.ts`
- Modify: `src/preload.ts`
- Modify: `src/renderer/shared/types/index.ts`
- Test: `src/tests/unit/contextMenu.test.ts`

**Interfaces:**
- Consumes: `buildContextTemplate` (Task 5), `MenuLike` from `AppMenu.ts`.
- Produces:
  - `class ContextMenu` with `constructor(deps: { menu: MenuLike; send: (actionId: string, targets: string[]) => void })` and `show(request: ContextRequest): void`
  - `window.systemAPI.showContextMenu(request)`, `window.systemAPI.onContextAction(handler)`

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/contextMenu.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextMenu } from '@/main/menu/ContextMenu';
import { CONTEXT_ACTIONS } from '@/common/contextActionIds';

interface FakeItem {
  label?: string;
  type?: string;
  click?: () => void;
}

let built: FakeItem[] | null;
let popped: number;
let sent: Array<{ actionId: string; targets: string[] }>;

const menuStub = {
  buildFromTemplate: vi.fn((template: FakeItem[]) => {
    built = template;
    return { popup: () => { popped += 1; } };
  }),
  setApplicationMenu: vi.fn(),
};

function makeMenu() {
  return new ContextMenu({
    menu: menuStub,
    send: (actionId: string, targets: string[]) => sent.push({ actionId, targets }),
  });
}

beforeEach(() => {
  built = null;
  popped = 0;
  sent = [];
  vi.clearAllMocks();
});

describe('ContextMenu', () => {
  it('builds and pops a menu', () => {
    makeMenu().show({ kind: 'entry', targets: ['/V/a.md'] });
    expect(menuStub.buildFromTemplate).toHaveBeenCalledTimes(1);
    expect(popped).toBe(1);
  });

  it('sends the action id and the targets it was given', () => {
    makeMenu().show({ kind: 'entry', targets: ['/V/a.md', '/V/b.md'] });

    const trash = built!.find((entry) => entry.label?.includes('Trash'));
    trash?.click?.();

    expect(sent).toEqual([
      { actionId: CONTEXT_ACTIONS.trash, targets: ['/V/a.md', '/V/b.md'] },
    ]);
  });

  it('strips the internal commandId before handing the template to Electron', () => {
    makeMenu().show({ kind: 'entry', targets: ['/V/a.md'] });
    for (const entry of built!) {
      expect(entry).not.toHaveProperty('commandId');
    }
  });

  it('gives separators no click handler', () => {
    makeMenu().show({ kind: 'entry', targets: ['/V/a.md'] });
    for (const entry of built!) {
      if (entry.type === 'separator') expect(entry.click).toBeUndefined();
    }
  });

  it('refuses to show a menu with no targets', () => {
    // A menu with nothing to act on would be built empty, and Electron stalls
    // on an empty menu rather than erroring.
    makeMenu().show({ kind: 'entry', targets: [] });
    expect(popped).toBe(0);
  });

  it('does not send anything until an item is clicked', () => {
    makeMenu().show({ kind: 'entry', targets: ['/V/a.md'] });
    expect(sent).toEqual([]);
  });

  it('sends the targets captured at show time, not at click time', () => {
    const menu = makeMenu();
    menu.show({ kind: 'entry', targets: ['/V/first.md'] });
    const firstTemplate = built!;

    menu.show({ kind: 'entry', targets: ['/V/second.md'] });

    // Clicking the first menu's item must still act on the first target.
    firstTemplate.find((entry) => entry.label === 'Copy Path')?.click?.();
    expect(sent[0].targets).toEqual(['/V/first.md']);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/contextMenu.test.ts`
Expected: FAIL — cannot resolve `@/main/menu/ContextMenu`.

- [ ] **Step 3: Implement**

Create `src/main/menu/ContextMenu.ts`:

```ts
import { buildContextTemplate, type ContextRequest } from './contextMenuTemplate';
import type { MenuLike } from './AppMenu';
import type { MenuTemplateItem } from './menuTemplate';

export interface ContextMenuDependencies {
  menu: MenuLike;
  /** Dispatches the chosen action, with the targets it was built for. */
  send: (actionId: string, targets: string[]) => void;
}

interface PoppableMenu {
  popup: () => void;
}

/**
 * Shows a native context menu and reports what was chosen.
 *
 * Mirrors AppMenu deliberately: the same structural MenuLike dependency, the
 * same strip-the-id-and-attach-a-click strategy. The only untestable line is
 * popup() itself, which the OS owns.
 */
export class ContextMenu {
  private deps: ContextMenuDependencies;

  constructor(deps: ContextMenuDependencies) {
    this.deps = deps;
  }

  show(request: ContextRequest): void {
    // Guarded rather than trusted: an empty target list yields an empty menu,
    // and Electron hangs building one instead of failing.
    if (request.targets.length === 0) return;

    const template = buildContextTemplate(request);
    if (template.length === 0) return;

    // The targets are captured here, not read at click time, so a menu always
    // acts on what it was opened for even if the selection has since moved.
    const targets = [...request.targets];

    const electronTemplate = template.map((item) => this.toElectronItem(item, targets));
    const menu = this.deps.menu.buildFromTemplate(electronTemplate) as PoppableMenu;
    menu.popup();
  }

  private toElectronItem(
    item: MenuTemplateItem,
    targets: string[]
  ): Record<string, unknown> {
    const { commandId, ...rest } = item;
    if (!commandId) return { ...rest };

    return {
      ...rest,
      click: () => this.deps.send(commandId, targets),
    };
  }
}
```

`MenuLike` must be exported from `AppMenu.ts` — it already is. `buildFromTemplate` there is typed as returning `unknown`, which is why `show` casts to `PoppableMenu`.

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/contextMenu.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Wire the IPC**

In `src/preload.ts`, add to `systemAPI`:

```ts
  showContextMenu: (request: {
    kind: string;
    targets: string[];
    isDirectory?: boolean;
    isRoot?: boolean;
  }) => ipcRenderer.send("menu:show-context", request),
  onContextAction: (handler: (actionId: string, targets: string[]) => void) => {
    const listener = (_event: IpcRendererEvent, actionId: string, targets: string[]) =>
      handler(actionId, targets);
    ipcRenderer.on("menu:context-invoke", listener);
    return () => ipcRenderer.removeListener("menu:context-invoke", listener);
  },
```

Add to the `systemAPI` interface in `src/renderer/shared/types/index.ts`:

```ts
      showContextMenu: (request: {
        kind: 'entry' | 'tree-item' | 'background' | 'tab';
        targets: string[];
        isDirectory?: boolean;
        isRoot?: boolean;
      }) => void;
      onContextAction: (handler: (actionId: string, targets: string[]) => void) => () => void;
```

In `src/main.ts`, beside the existing `appMenu` construction at module scope:

```ts
const contextMenu = new ContextMenu({
  menu: Menu,
  send: (actionId, targets) => {
    BrowserWindow.getFocusedWindow()?.webContents.send("menu:context-invoke", actionId, targets);
  },
});

// Module scope, like menu:commands — registering inside createWindow would add
// a duplicate listener every time the window is reopened from the dock.
ipcMain.on("menu:show-context", (_event, request) => {
  if (!request || typeof request !== "object") return;
  contextMenu.show(request);
});
```

with `import { ContextMenu } from "@/main/menu/ContextMenu";` at the top.

- [ ] **Step 6: Verify the IPC contract test**

Run: `npx vitest run src/tests/unit/ipcContract.test.ts`
Expected: PASS. `menu:context-invoke` flows main → renderer and has no handler to register, exactly like `menu:invoke` and `disk:changed`.

- [ ] **Step 7: Confirm no new type errors, then commit**

Run: `npx tsc --noEmit 2>&1 | grep -c 'error TS'` — expected: still `13`.
Run: `npm test`

```bash
git add src/main/menu/ContextMenu.ts src/main.ts src/preload.ts src/renderer/shared/types/index.ts src/tests/unit/contextMenu.test.ts
git commit -m "feat(files): pop a native context menu from main"
```

---

### Task 7: Tab close variants

**Files:**
- Modify: `src/renderer/features/disk-explorer/store/tabsStore.ts`
- Test: `src/tests/unit/tabsStore.test.ts` (append)

**Interfaces:**
- Produces: `closeOthers(path: string): void`, `closeToTheRight(path: string): void`

- [ ] **Step 1: Write the failing test**

Append to `src/tests/unit/tabsStore.test.ts`:

```ts
describe('close variants', () => {
  it('closeOthers keeps only the named tab', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().openPinned(C);

    state().closeOthers(B);

    expect(state().openPaths).toEqual([B]);
    expect(state().activePath).toBe(B);
  });

  it('closeOthers activates the survivor even when another tab was active', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().activate(A);

    state().closeOthers(B);

    expect(state().activePath).toBe(B);
  });

  it('closeOthers clears the preview slot when the preview was elsewhere', () => {
    state().openPinned(A);
    state().openPreview(B);

    state().closeOthers(A);

    expect(state().previewPath).toBeNull();
  });

  it('closeOthers on the only tab changes nothing', () => {
    state().openPinned(A);
    state().closeOthers(A);
    expect(state().openPaths).toEqual([A]);
  });

  it('closeToTheRight keeps the named tab and everything before it', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().openPinned(C);

    state().closeToTheRight(A);

    expect(state().openPaths).toEqual([A]);
  });

  it('closeToTheRight on the last tab changes nothing', () => {
    state().openPinned(A);
    state().openPinned(B);

    state().closeToTheRight(B);

    expect(state().openPaths).toEqual([A, B]);
  });

  it('closeToTheRight moves the active tab only if it was closed', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().openPinned(C);
    state().activate(C);

    state().closeToTheRight(A);

    expect(state().activePath).toBe(A);
  });

  it('closeToTheRight leaves the active tab alone when it survives', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().openPinned(C);
    state().activate(A);

    state().closeToTheRight(B);

    expect(state().activePath).toBe(A);
  });

  it('ignores a path that is not open', () => {
    state().openPinned(A);
    state().closeOthers('/V/nope.txt');
    expect(state().openPaths).toEqual([A]);
  });

  it('persists the surviving tabs', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().closeOthers(A);

    const restored = useTabsStore.getState().hydrate();
    expect(restored.openPaths).toEqual([A]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/tabsStore.test.ts`
Expected: FAIL — `state().closeOthers is not a function`.

- [ ] **Step 3: Implement**

Add to `TabsActions` in `tabsStore.ts`:

```ts
  closeOthers: (path: string) => void;
  closeToTheRight: (path: string) => void;
```

Add the implementations beside `closeAll`:

```ts
  closeOthers: (path) =>
    set((state) => {
      if (!state.openPaths.includes(path)) return {};

      const next = {
        openPaths: [path],
        activePath: path,
        // The preview tab is only preserved if it is the survivor.
        previewPath: state.previewPath === path ? path : null,
      };
      persist({ ...state, ...next });
      return next;
    }),

  closeToTheRight: (path) =>
    set((state) => {
      const index = state.openPaths.indexOf(path);
      if (index === -1) return {};

      const openPaths = state.openPaths.slice(0, index + 1);
      if (openPaths.length === state.openPaths.length) return {};

      const activePath =
        state.activePath && openPaths.includes(state.activePath) ? state.activePath : path;
      const previewPath =
        state.previewPath && openPaths.includes(state.previewPath) ? state.previewPath : null;

      const next = { openPaths, activePath, previewPath };
      persist({ ...state, ...next });
      return next;
    }),
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/tabsStore.test.ts`
Expected: PASS, 33 tests (23 existing + 10 new).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/features/disk-explorer/store/tabsStore.ts src/tests/unit/tabsStore.test.ts
git commit -m "feat(files): add close-others and close-to-the-right for tabs"
```

---

# PHASE 3 — Wiring

---

### Task 8: The dispatch table

The table is where a menu item becomes a function call. Its test is what stops a dead menu item ever shipping.

**Files:**
- Create: `src/renderer/features/disk-explorer/contextActions.ts`
- Modify: `src/renderer/features/disk-explorer/store/diskStore.ts` (adds `beginNewFile`)
- Modify: `src/renderer/features/disk-explorer/components/dialogs/NameDialog.tsx`
- Test: `src/tests/unit/contextActions.test.ts`

**Interfaces:**
- Consumes: `CONTEXT_ACTIONS` (Task 5), `useDiskStore`, `useTabsStore`, `window.diskAPI`.
- Produces: `runContextAction(actionId: string, targets: string[]): void`, `CONTEXT_ACTION_HANDLERS: Record<string, (targets: string[]) => void>`

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/contextActions.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  runContextAction,
  CONTEXT_ACTION_HANDLERS,
} from '@/renderer/features/disk-explorer/contextActions';
import { CONTEXT_ACTIONS } from '@/common/contextActionIds';
import { buildContextTemplate, type ContextRequest } from '@/main/menu/contextMenuTemplate';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { installDiskApi } from '@/tests/helpers/diskApi';

const A = '/V/a.md';
const B = '/V/b.md';

beforeEach(() => {
  window.localStorage.clear();
  installDiskApi();
  useTabsStore.setState({ openPaths: [], activePath: null, previewPath: null });
  useDiskStore.setState({ selectedPath: null, selectedPaths: [], pendingDelete: null });
});

describe('coverage', () => {
  const REQUESTS: ContextRequest[] = [
    { kind: 'entry', targets: [A], isDirectory: false },
    { kind: 'entry', targets: [A, B] },
    { kind: 'entry', targets: ['/V/folder'], isDirectory: true },
    { kind: 'tree-item', targets: ['/V/folder'], isDirectory: true },
    { kind: 'tree-item', targets: ['/V'], isDirectory: true, isRoot: true },
    { kind: 'background', targets: ['/V'] },
    { kind: 'tab', targets: [A] },
  ];

  it('has a handler for every action any menu can produce', () => {
    // This is the test that stops the characteristic bug of this feature: a
    // menu item that opens, clicks, and silently does nothing.
    for (const request of REQUESTS) {
      for (const item of buildContextTemplate(request)) {
        if (item.type === 'separator' || !item.commandId) continue;
        expect(
          CONTEXT_ACTION_HANDLERS[item.commandId],
          `no handler for ${item.commandId}`
        ).toBeTypeOf('function');
      }
    }
  });

  it('has no handler for an action no menu produces', () => {
    // A handler with no menu item is dead code that will rot.
    const produced = new Set<string>();
    for (const request of REQUESTS) {
      for (const item of buildContextTemplate(request)) {
        if (item.commandId) produced.add(item.commandId);
      }
    }
    for (const actionId of Object.keys(CONTEXT_ACTION_HANDLERS)) {
      expect(produced.has(actionId), `${actionId} has a handler but no menu item`).toBe(true);
    }
  });
});

describe('dispatch', () => {
  it('ignores an unknown action rather than throwing', () => {
    expect(() => runContextAction('ctx.nonexistent', [A])).not.toThrow();
  });

  it('opens a pinned tab for Open in New Tab', () => {
    runContextAction(CONTEXT_ACTIONS.openInNewTab, [A]);
    expect(useTabsStore.getState().openPaths).toEqual([A]);
    expect(useTabsStore.getState().previewPath).toBeNull();
  });

  it('starts a rename through the store rather than mutating directly', () => {
    runContextAction(CONTEXT_ACTIONS.rename, [A]);
    expect(useDiskStore.getState().pendingAction).toEqual({ kind: 'rename', target: A });
  });

  it('starts a delete for the whole selection', () => {
    runContextAction(CONTEXT_ACTIONS.trash, [A, B]);
    expect(useDiskStore.getState().pendingDelete).toBe(A);
    expect(useDiskStore.getState().selectedPaths).toEqual([A, B]);
  });

  it('copies paths through IPC', () => {
    runContextAction(CONTEXT_ACTIONS.copyPath, [A, B]);
    expect(window.diskAPI.copyPath).toHaveBeenCalledWith([A, B]);
  });

  it('reveals through IPC', () => {
    runContextAction(CONTEXT_ACTIONS.reveal, [A]);
    expect(window.diskAPI.reveal).toHaveBeenCalledWith(A);
  });

  it('duplicates through the batch channel', () => {
    runContextAction(CONTEXT_ACTIONS.duplicate, [A, B]);
    expect(window.diskAPI.duplicateMany).toHaveBeenCalledWith([A, B]);
  });

  it('sets the sort field', () => {
    runContextAction(CONTEXT_ACTIONS.sortBySize, ['/V']);
    expect(useDiskStore.getState().sort.field).toBe('size');
  });

  it('closes other tabs', () => {
    useTabsStore.setState({ openPaths: [A, B], activePath: A, previewPath: null });
    runContextAction(CONTEXT_ACTIONS.closeOtherTabs, [A]);
    expect(useTabsStore.getState().openPaths).toEqual([A]);
  });

  it('does nothing for an action given no targets', () => {
    expect(() => runContextAction(CONTEXT_ACTIONS.trash, [])).not.toThrow();
    expect(useDiskStore.getState().pendingDelete).toBeNull();
  });
});
```

Before writing the implementation, check `src/tests/helpers/diskApi.ts` and extend its fake so `copyPath`, `duplicateMany`, `trashMany`, `moveMany`, and `createFile` are `vi.fn()`s returning `{ success: true, data: [] }`. Every other test file depends on that helper, so add to it rather than replacing what is there.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/contextActions.test.ts`
Expected: FAIL — cannot resolve `contextActions`.

- [ ] **Step 3: Move the view mode into the store**

A context menu item cannot reach a component's local state, and View as
List/Gallery needs to. `DiskFolderView.tsx:43` currently holds
`const [mode, setMode] = useState<ViewMode | null>(null)`, with
`activeMode = mode ?? suggestedMode` at line 76 — `null` means "follow the
suggestion derived from the folder's contents". **That null-means-auto
behaviour must survive the move**, or every folder loses its automatic
gallery/list choice.

In `diskStore.ts`, add to `DiskState`:

```ts
  /** null means follow the suggestion derived from the folder's contents. */
  view: 'list' | 'gallery' | null;
```

with `view: null` in the initial state, and to `DiskActions`:

```ts
  setView: (value: DiskState['view']) => void;
```

implemented as:

```ts
  setView: (value) => set({ view: value }),
```

In `DiskFolderView.tsx`, delete the `useState` at line 43 and read the store
instead:

```tsx
  const mode = useDiskStore((state) => state.view);
  const setMode = useDiskStore((state) => state.setView);
```

Everything downstream — `activeMode`, the two `ModeButton`s, their
`data-testid="disk-folder-view-*"` — stays exactly as it is.

Run: `npx vitest run src/tests/unit/diskFolderView.test.tsx`
Expected: PASS, 17 tests, unchanged. If a test fails because it clicked a mode
button and asserted on local state, seed `view` in the store in its setup and
keep the assertion.

- [ ] **Step 4: Add `beginNewFile` to the store**

In `diskStore.ts`, extend the `pendingAction` kind union to include `'new-file'`, add to `DiskActions`:

```ts
  beginNewFile: (parentDir: string) => void;
```

and implement it beside `beginNewFolder`, identically but with `kind: 'new-file'`.

In `NameDialog.tsx`, handle the new kind: the title becomes "New File", the confirm calls `window.diskAPI.createFile(target, name)`. Follow exactly how `'new-folder'` is handled in that file — it is the same shape with a different channel.

- [ ] **Step 5: Implement the table**

Create `src/renderer/features/disk-explorer/contextActions.ts`:

```ts
import { toast } from 'sonner';
import { CONTEXT_ACTIONS } from '@/common/contextActionIds';
import { summarizeBatch, type BatchResult } from '@/common/batch';
import { useDiskStore } from './store/diskStore';
import { useTabsStore } from './store/tabsStore';

type Handler = (targets: string[]) => void;

/** Runs a batch channel and reports the outcome as one toast. Named apart from
 * FileWriter's private runBatch, which is a different thing in another process. */
async function reportBatch(
  call: Promise<{ success: boolean; error?: string; data?: BatchResult }>,
  verb: { one: string; many: string }
): Promise<void> {
  const response = await call;
  if (!response.success) {
    toast.error(response.error ?? 'Operation failed');
    return;
  }

  const result = response.data ?? [];
  const message = summarizeBatch(result, verb);
  if (!message) return;

  const anyFailed = result.some((outcome) => !outcome.ok);
  if (anyFailed) toast.error(message);
  else toast.success(message);
}

/**
 * Every context action, keyed by id.
 *
 * A flat table rather than a switch so the coverage test can compare its keys
 * against what the menu templates actually produce — a menu item with no
 * handler and a handler with no menu item are both compile-green, silent bugs.
 */
export const CONTEXT_ACTION_HANDLERS: Record<string, Handler> = {
  [CONTEXT_ACTIONS.open]: (targets) => {
    const disk = useDiskStore.getState();
    disk.select(targets[0]);
    void disk.toggleExpanded(targets[0]);
    useTabsStore.getState().openPreview(targets[0]);
  },

  [CONTEXT_ACTIONS.openInNewTab]: (targets) => {
    useTabsStore.getState().openPinned(targets[0]);
  },

  [CONTEXT_ACTIONS.quickLook]: (targets) => {
    useDiskStore.getState().select(targets[0]);
    useDiskStore.getState().openQuickLook();
  },

  [CONTEXT_ACTIONS.reveal]: (targets) => {
    void window.diskAPI.reveal(targets[0]);
  },

  [CONTEXT_ACTIONS.revealFolder]: (targets) => {
    void window.diskAPI.reveal(targets[0]);
  },

  [CONTEXT_ACTIONS.openExternal]: (targets) => {
    void window.diskAPI.openExternal(targets[0]);
  },

  [CONTEXT_ACTIONS.rename]: (targets) => {
    useDiskStore.getState().beginRename(targets[0]);
  },

  [CONTEXT_ACTIONS.duplicate]: (targets) => {
    void reportBatch(window.diskAPI.duplicateMany(targets), {
      one: 'Duplicated',
      many: 'Duplicated {n} items',
    });
  },

  [CONTEXT_ACTIONS.copyPath]: (targets) => {
    void window.diskAPI.copyPath(targets).then((response) => {
      if (response.success) toast.success(targets.length === 1 ? 'Path copied' : 'Paths copied');
      else toast.error(response.error ?? 'Failed to copy path');
    });
  },

  [CONTEXT_ACTIONS.trash]: (targets) => {
    // Routed through the existing confirm dialog rather than trashing straight
    // away: the menu is a new entry point to a flow, not a second flow.
    const disk = useDiskStore.getState();
    if (targets.length > 1) useDiskStore.setState({ selectedPaths: [...targets] });
    disk.beginDelete(targets[0]);
  },

  [CONTEXT_ACTIONS.newFolder]: (targets) => {
    useDiskStore.getState().beginNewFolder(targets[0]);
  },

  [CONTEXT_ACTIONS.newFile]: (targets) => {
    useDiskStore.getState().beginNewFile(targets[0]);
  },

  [CONTEXT_ACTIONS.toggleExpand]: (targets) => {
    void useDiskStore.getState().toggleExpanded(targets[0]);
  },

  [CONTEXT_ACTIONS.removeRoot]: (targets) => {
    void useDiskStore.getState().closeRoot(targets[0]);
  },

  [CONTEXT_ACTIONS.sortByName]: () => useDiskStore.getState().setSort('name'),
  [CONTEXT_ACTIONS.sortByModified]: () => useDiskStore.getState().setSort('modified'),
  [CONTEXT_ACTIONS.sortBySize]: () => useDiskStore.getState().setSort('size'),
  [CONTEXT_ACTIONS.sortByKind]: () => useDiskStore.getState().setSort('kind'),

  [CONTEXT_ACTIONS.viewAsList]: () => useDiskStore.getState().setView('list'),
  [CONTEXT_ACTIONS.viewAsGallery]: () => useDiskStore.getState().setView('gallery'),

  [CONTEXT_ACTIONS.closeTab]: (targets) => useTabsStore.getState().close(targets[0]),
  [CONTEXT_ACTIONS.closeOtherTabs]: (targets) => useTabsStore.getState().closeOthers(targets[0]),
  [CONTEXT_ACTIONS.closeTabsToRight]: (targets) =>
    useTabsStore.getState().closeToTheRight(targets[0]),
  [CONTEXT_ACTIONS.closeAllTabs]: () => useTabsStore.getState().closeAll(),
};

/**
 * Dispatches one menu choice.
 *
 * Unknown ids are ignored rather than thrown: a stale menu left open across a
 * reload should do nothing, not crash the renderer.
 */
export function runContextAction(actionId: string, targets: string[]): void {
  if (targets.length === 0) return;
  const handler = CONTEXT_ACTION_HANDLERS[actionId];
  if (!handler) {
    console.warn(`Context menu dispatched an unknown action: ${actionId}`);
    return;
  }
  handler(targets);
}
```

- [ ] **Step 6: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/contextActions.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 7: Full suite and commit**

Run: `npm test`

```bash
git add src/renderer/features/disk-explorer/ src/tests/
git commit -m "feat(files): add the context action dispatch table"
```

---

### Task 9: The right-click hook

**Files:**
- Create: `src/renderer/features/disk-explorer/hooks/useContextMenu.ts`
- Test: `src/tests/unit/useContextMenu.test.tsx`

**Interfaces:**
- Consumes: `useDiskStore`, `window.systemAPI.showContextMenu`.
- Produces: `useContextMenu(): { onEntryContextMenu, onTreeContextMenu, onBackgroundContextMenu, onTabContextMenu }`, each `(event: React.MouseEvent, ...) => void`

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/useContextMenu.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { useContextMenu } from '@/renderer/features/disk-explorer/hooks/useContextMenu';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';

const A = '/V/a.md';
const B = '/V/b.md';

const showContextMenu = vi.fn();

function fakeEvent() {
  return { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent;
}

beforeEach(() => {
  installDiskApi();
  showContextMenu.mockClear();
  Object.assign(window, { systemAPI: { ...window.systemAPI, showContextMenu } });
  useDiskStore.setState({ selectedPath: null, selectedPaths: [], roots: ['/V'] });
});

describe('useContextMenu', () => {
  it('prevents the browser menu', () => {
    const { result } = renderHook(() => useContextMenu());
    const event = fakeEvent();

    act(() => result.current.onEntryContextMenu(event, entry({ path: A, name: 'a.md' })));

    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('selects an unselected target and acts on it alone', () => {
    const { result } = renderHook(() => useContextMenu());
    useDiskStore.setState({ selectedPath: B, selectedPaths: [B] });

    act(() => result.current.onEntryContextMenu(fakeEvent(), entry({ path: A, name: 'a.md' })));

    expect(useDiskStore.getState().selectedPath).toBe(A);
    expect(showContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'entry', targets: [A] })
    );
  });

  it('keeps a multi-selection when right-clicking inside it', () => {
    // The Finder rule. Getting this backwards is how someone trashes the wrong
    // five files.
    const { result } = renderHook(() => useContextMenu());
    useDiskStore.setState({ selectedPath: A, selectedPaths: [A, B] });

    act(() => result.current.onEntryContextMenu(fakeEvent(), entry({ path: B, name: 'b.md' })));

    expect(showContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({ targets: [A, B] })
    );
  });

  it('reports whether the clicked entry is a directory', () => {
    const { result } = renderHook(() => useContextMenu());

    act(() =>
      result.current.onEntryContextMenu(
        fakeEvent(),
        entry({ path: '/V/folder', name: 'folder', isDirectory: true, kind: 'directory' })
      )
    );

    expect(showContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({ isDirectory: true })
    );
  });

  it('marks a tree item that is a root', () => {
    const { result } = renderHook(() => useContextMenu());

    act(() =>
      result.current.onTreeContextMenu(
        fakeEvent(),
        entry({ path: '/V', name: 'V', isDirectory: true, kind: 'directory' })
      )
    );

    expect(showContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'tree-item', isRoot: true })
    );
  });

  it('sends the directory itself for a background click', () => {
    const { result } = renderHook(() => useContextMenu());

    act(() => result.current.onBackgroundContextMenu(fakeEvent(), '/V/photos'));

    expect(showContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'background', targets: ['/V/photos'] })
    );
  });

  it('sends a single tab path without touching the file selection', () => {
    const { result } = renderHook(() => useContextMenu());
    useDiskStore.setState({ selectedPath: A, selectedPaths: [A] });

    act(() => result.current.onTabContextMenu(fakeEvent(), B));

    expect(showContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'tab', targets: [B] })
    );
    expect(useDiskStore.getState().selectedPath).toBe(A);
  });

  it('does not open a background menu with no directory', () => {
    const { result } = renderHook(() => useContextMenu());
    act(() => result.current.onBackgroundContextMenu(fakeEvent(), null));
    expect(showContextMenu).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/useContextMenu.test.tsx`
Expected: FAIL — cannot resolve `useContextMenu`.

- [ ] **Step 3: Implement**

Create `src/renderer/features/disk-explorer/hooks/useContextMenu.ts`:

```ts
import { useCallback } from 'react';
import type React from 'react';
import type { DiskEntry } from '@/types/disk';
import { useDiskStore } from '../store/diskStore';

/**
 * Right-click handlers for every surface in /files.
 *
 * Selection reconciliation follows Finder: right-clicking something outside the
 * current selection selects it and acts on it alone; right-clicking inside a
 * multi-selection preserves the whole selection. The targets are resolved here
 * and travel with the request, so the menu can never act on a different file
 * than the one the user pointed at.
 */
export function useContextMenu() {
  const onEntryContextMenu = useCallback((event: React.MouseEvent, entry: DiskEntry) => {
    event.preventDefault();
    event.stopPropagation();

    const state = useDiskStore.getState();
    const isInSelection = state.selectedPaths.includes(entry.path);

    if (!isInSelection) {
      state.select(entry.path);
    }

    const targets = isInSelection && state.selectedPaths.length > 1
      ? [...state.selectedPaths]
      : [entry.path];

    window.systemAPI.showContextMenu({
      kind: 'entry',
      targets,
      isDirectory: entry.isDirectory,
    });
  }, []);

  const onTreeContextMenu = useCallback((event: React.MouseEvent, entry: DiskEntry) => {
    event.preventDefault();
    event.stopPropagation();

    const state = useDiskStore.getState();
    state.select(entry.path);

    window.systemAPI.showContextMenu({
      kind: 'tree-item',
      targets: [entry.path],
      isDirectory: entry.isDirectory,
      isRoot: state.roots.includes(entry.path),
    });
  }, []);

  const onBackgroundContextMenu = useCallback(
    (event: React.MouseEvent, directory: string | null) => {
      event.preventDefault();
      if (!directory) return;

      window.systemAPI.showContextMenu({ kind: 'background', targets: [directory] });
    },
    []
  );

  const onTabContextMenu = useCallback((event: React.MouseEvent, path: string) => {
    event.preventDefault();
    event.stopPropagation();

    // Tabs are their own selection model — right-clicking one must not disturb
    // which file the grid has highlighted.
    window.systemAPI.showContextMenu({ kind: 'tab', targets: [path] });
  }, []);

  return {
    onEntryContextMenu,
    onTreeContextMenu,
    onBackgroundContextMenu,
    onTabContextMenu,
  };
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/useContextMenu.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/features/disk-explorer/hooks/useContextMenu.ts src/tests/unit/useContextMenu.test.tsx
git commit -m "feat(files): add the right-click handler hook"
```

---

### Task 10: Attach the menu to every surface

**Files:**
- Modify: `src/renderer/features/disk-explorer/components/DiskExplorer.tsx`
- Modify: `src/renderer/features/disk-explorer/components/DiskFolderView.tsx`
- Modify: `src/renderer/features/disk-explorer/components/DiskTreeItem.tsx`
- Modify: `src/renderer/features/disk-explorer/components/TabStrip.tsx`
- Test: `src/tests/unit/contextMenuSurfaces.test.tsx`

**Interfaces:**
- Consumes: `useContextMenu` (Task 9), `runContextAction` (Task 8).

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/contextMenuSurfaces.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { DiskExplorer } from '@/renderer/features/disk-explorer/components/DiskExplorer';
import { TabStrip } from '@/renderer/features/disk-explorer/components/TabStrip';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';

const A = '/V/a.md';
const showContextMenu = vi.fn();

beforeEach(() => {
  window.localStorage.clear();
  showContextMenu.mockClear();
  installDiskApi({
    listRoots: vi.fn(async () => ({ success: true as const, data: ['/V'] })),
    readDirectory: vi.fn(async (p: string) => ({
      success: true as const,
      data: { path: p, entries: [entry({ path: A, name: 'a.md', kind: 'markdown' })] },
    })),
  });
  Object.assign(window, {
    systemAPI: {
      ...window.systemAPI,
      showContextMenu,
      onContextAction: vi.fn(() => () => undefined),
    },
  });
  useDiskStore.setState({
    roots: ['/V'],
    listings: { '/V': [entry({ path: A, name: 'a.md', kind: 'markdown' })] },
    expanded: { '/V': true },
    selectedPath: null,
    selectedPaths: [],
  });
  useTabsStore.setState({ openPaths: [], activePath: null, previewPath: null });
});

describe('context menu surfaces', () => {
  it('opens a menu from a tree item', async () => {
    render(<DiskExplorer />);
    const item = await screen.findByTestId(`disk-tree-item-${A}`);

    fireEvent.contextMenu(item);

    expect(showContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'tree-item', targets: [A] })
    );
  });

  it('opens a menu from a folder-view entry', async () => {
    useDiskStore.setState({ selectedPath: '/V' });
    render(<DiskExplorer />);
    const row = await screen.findByTestId(`disk-folder-entry-${A}`);

    fireEvent.contextMenu(row);

    expect(showContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'entry', targets: [A] })
    );
  });

  it('opens a background menu from the empty area of the folder view', async () => {
    useDiskStore.setState({ selectedPath: '/V' });
    render(<DiskExplorer />);
    const surface = await screen.findByTestId('disk-folder-surface');

    fireEvent.contextMenu(surface);

    expect(showContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'background' })
    );
  });

  it('opens a menu from a tab', () => {
    useTabsStore.setState({ openPaths: [A], activePath: A, previewPath: null });
    render(<TabStrip />);

    fireEvent.contextMenu(screen.getByTestId(`tab-${A}`));

    expect(showContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'tab', targets: [A] })
    );
  });

  it('subscribes to context actions once', async () => {
    render(<DiskExplorer />);
    await waitFor(() => expect(window.systemAPI.onContextAction).toHaveBeenCalledTimes(1));
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/contextMenuSurfaces.test.tsx`
Expected: FAIL — `showContextMenu` is never called.

- [ ] **Step 3: Subscribe to dispatch in `DiskExplorer.tsx`**

Add the effect beside the existing tab-shortcut effect:

```tsx
  useEffect(() => {
    return window.systemAPI.onContextAction((actionId, targets) => {
      runContextAction(actionId, targets);
    });
  }, []);
```

with `import { runContextAction } from '../contextActions';` at the top.

- [ ] **Step 4: Attach the handlers**

In `DiskTreeItem.tsx`, add to the `role="treeitem"` div:

```tsx
        onContextMenu={(event) => onTreeContextMenu(event, entry)}
```

taking `onTreeContextMenu` from `useContextMenu()` inside the component.

In `DiskFolderView.tsx`:
- `GalleryTile` and `ListRow` each take a new `onContextMenu` prop from `EntryProps` and put it on their `<button>`. Both already receive `entry`, so the parent passes `(event) => onEntryContextMenu(event, entry)`.
- Wrap the list and gallery viewports in a single element carrying
  `data-testid="disk-folder-surface"` and
  `onContextMenu={(event) => onBackgroundContextMenu(event, dirPath)}`.
  Because the entry handlers call `stopPropagation`, a right-click on a row
  never reaches this one — that is what makes the background menu appear only on
  genuinely empty space.

In `TabStrip.tsx`, add to the `role="tab"` div:

```tsx
            onContextMenu={(event) => onTabContextMenu(event, path)}
```

- [ ] **Step 5: Run the surface test and the existing tests together**

Run:
```bash
npx vitest run src/tests/unit/contextMenuSurfaces.test.tsx src/tests/unit/diskExplorer.test.tsx src/tests/unit/diskFolderView.test.tsx src/tests/unit/diskTree.test.tsx src/tests/unit/tabStrip.test.tsx
```
Expected: all pass. **Update structural assertions if they break; never delete a test.** A test that fails because behaviour genuinely broke means fixing the component, not the test.

- [ ] **Step 6: Full suite, then commit**

Run: `npm test`
Run: `npx tsc --noEmit 2>&1 | grep -c 'error TS'` — expected: still `13`.

```bash
git add src/renderer/features/disk-explorer/ src/tests/
git commit -m "feat(files): open context menus from every surface"
```

---

### Task 11: Multi-target delete and partial-failure reporting

The confirm dialog already loops over a selection one path at a time and stops at the first failure. It moves to the batch channel.

**Files:**
- Modify: `src/renderer/features/disk-explorer/components/dialogs/ConfirmDeleteDialog.tsx`
- Test: `src/tests/unit/confirmDelete.test.tsx` (append)

**Interfaces:**
- Consumes: `window.diskAPI.trashMany` (Task 4), `summarizeBatch` (Task 3).

- [ ] **Step 1: Write the failing test**

Append to `src/tests/unit/confirmDelete.test.tsx`, following that file's existing render helper:

```tsx
describe('multi-target delete', () => {
  it('names the count in the prompt', async () => {
    useDiskStore.setState({ pendingDelete: A, selectedPaths: [A, B, C] });
    render(<ConfirmDeleteDialog />);

    expect(screen.getByText(/3 items/i)).toBeInTheDocument();
  });

  it('sends every selected path in one batch call', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({ pendingDelete: A, selectedPaths: [A, B] });
    render(<ConfirmDeleteDialog />);

    await user.click(screen.getByTestId('confirm-delete-confirm'));

    expect(window.diskAPI.trashMany).toHaveBeenCalledWith([A, B]);
  });

  it('closes and reports when every target succeeded', async () => {
    const user = userEvent.setup();
    window.diskAPI.trashMany = vi.fn(async () => ({
      success: true as const,
      data: [
        { path: A, ok: true },
        { path: B, ok: true },
      ],
    }));
    useDiskStore.setState({ pendingDelete: A, selectedPaths: [A, B] });
    render(<ConfirmDeleteDialog />);

    await user.click(screen.getByTestId('confirm-delete-confirm'));

    await waitFor(() => expect(useDiskStore.getState().pendingDelete).toBeNull());
  });

  it('keeps the dialog open and names the failures on a partial failure', async () => {
    const user = userEvent.setup();
    window.diskAPI.trashMany = vi.fn(async () => ({
      success: true as const,
      data: [
        { path: A, ok: true },
        { path: B, ok: false, error: 'Permission denied' },
      ],
    }));
    useDiskStore.setState({ pendingDelete: A, selectedPaths: [A, B] });
    render(<ConfirmDeleteDialog />);

    await user.click(screen.getByTestId('confirm-delete-confirm'));

    // The user must be able to see which file survived and why.
    await waitFor(() => expect(screen.getByText(/b\.md/)).toBeInTheDocument());
    expect(useDiskStore.getState().pendingDelete).not.toBeNull();
  });

  it('still deletes a single target', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({ pendingDelete: A, selectedPaths: [A] });
    render(<ConfirmDeleteDialog />);

    await user.click(screen.getByTestId('confirm-delete-confirm'));

    expect(window.diskAPI.trashMany).toHaveBeenCalledWith([A]);
  });
});
```

Confirm the confirm button's testid by reading `ConfirmDeleteDialog.tsx` first, and use whatever it actually is rather than the name above.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/confirmDelete.test.tsx`
Expected: FAIL — `trashMany` is never called; the component still loops over `trash`.

- [ ] **Step 3: Implement**

Replace the `confirm` function's loop:

```tsx
  const confirm = async () => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    const response = await window.diskAPI.trashMany(deletePaths);

    if (!response.success) {
      setError(response.error ?? 'Failed to move to Trash');
      setIsSubmitting(false);
      return;
    }

    const result = response.data ?? [];
    const failed = result.filter((outcome) => !outcome.ok);

    if (failed.length > 0) {
      // Left open deliberately: a partial failure is the one case where the
      // user needs to see which files are still there before moving on.
      setError(summarizeBatch(result, TRASH_VERB));
      setIsSubmitting(false);
      return;
    }

    useDiskStore.getState().clearSelection();
    cancelDelete();
  };
```

with, at module scope in that file:

```tsx
const TRASH_VERB = { one: 'Moved to Trash', many: 'Moved {n} items to Trash' };
```

and `import { summarizeBatch } from '@/common/batch';`.

Update the prompt copy so a multi-selection reads "Move 3 items to Trash?" and a single target keeps its existing wording.

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/confirmDelete.test.tsx`
Expected: PASS, existing tests plus 5 new.

- [ ] **Step 5: Full suite and commit**

Run: `npm test`

```bash
git add src/renderer/features/disk-explorer/components/dialogs/ConfirmDeleteDialog.tsx src/tests/unit/confirmDelete.test.tsx
git commit -m "feat(files): delete a whole selection and report what failed"
```

---

# PHASE 4 — Verification

---

### Task 12: Final verification

No new code.

- [ ] **Step 1: Confirm the type-error count did not grow**

```bash
npx tsc --noEmit 2>&1 | grep -c 'error TS'
```
Expected: `13`. Anything higher is yours to fix.

- [ ] **Step 2: Confirm the E2E budget is untouched**

```bash
npx playwright test --config e2e/playwright.config.ts --list 2>/dev/null | tail -1
```
Expected: `Total: 9 tests in 5 files`. This plan adds none.

- [ ] **Step 3: Confirm the unit suite**

Run: `npm test`
Expected: every test passes, roughly 540 tests.

- [ ] **Step 4: Confirm the E2E suite still passes**

Run: `npm run test:e2e`
Expected: 9 passed. This is what catches a main-process wiring mistake — a
broken `ipcMain.on` registration shows up as every test failing to launch.

- [ ] **Step 5: Walk the app**

Run: `npm run better-dev`

**If the app hangs at "Attempting to dynamically load sqlite-vss module…", the
menu template produced an empty menu.** That is the known stall, not a database
problem. Check `buildContextTemplate` before looking anywhere else.

Check by hand — none of these can be tested below this tier:

- [ ] Right-click a file in the list: the menu is a real macOS menu, with the OS blur and keyboard navigation
- [ ] Right-click a file that is not selected: it becomes selected, and the menu acts on it alone
- [ ] Select five files, right-click one of them: the selection survives and the menu reads "Move 5 Items to Trash"
- [ ] Duplicate a file: `name copy.ext` appears; duplicate again for `name copy 2.ext`
- [ ] Copy Path, then paste into a terminal: the path is correct
- [ ] Right-click empty space: New Folder, New File, Sort By, View As
- [ ] Right-click a tree folder: New Folder and New File create inside it
- [ ] Right-click a root: it offers Remove Folder from Opal, not Move to Trash
- [ ] Right-click a tab: Close Others leaves one tab
- [ ] Trash a selection where one file is locked: the dialog stays open and names the file that failed
- [ ] Escape closes the menu with nothing happening

- [ ] **Step 6: Commit the tidy-up**

If Step 5 required fixes, commit them individually with a message naming what
broke. If nothing broke, there is nothing to commit.

---

## Notes for whoever executes this

**The empty-menu stall is the trap in this plan.** It presents as the app
hanging at startup on an unrelated log line, and it cost an hour last time. Two
tests guard it (Task 5's "never returns an empty menu", Task 6's "refuses to
show a menu with no targets"). If you find yourself adding a conditional that
could remove the last item from a menu, add a case to those tests first.

**`FileWriter` is the audited mutation layer.** Every method validates against
`RootRegistry` before touching anything. The batch layer is a loop over those
validated methods, never a second path to the filesystem. If you find yourself
calling `fs` directly from the batch code, stop — the guard is the point.

**View mode moving into the store (Task 8, Step 4) is the one piece of
refactoring in this plan.** It is required because a context menu item cannot
reach a component's local state. Keep it surgical: move the state, update the
component to read it, adjust the tests' setup, and change nothing else.
