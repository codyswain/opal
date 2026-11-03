# Native Shell Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Opal feel like a native macOS app — real window chrome, a launch with no flash, panes you can drag and that remember their size, a real menu bar, enforced performance budgets, and tabs for open files.

**Architecture:** Four phases against already-merged code. Phase 1 builds the two persistence primitives (a versioned `localStorage` wrapper in the renderer, a versioned JSON store in main) and spends them on window chrome and startup. Phase 2 replaces every fixed-width sidebar with a persisted resizable pane. Phase 3 makes the command registry the single source for both the kbar palette and a real `Menu`, then adds a performance-budget suite. Phase 4 adds file tabs above the existing `DetailPane`.

**Tech Stack:** Electron 31.3.1 (`titleBarStyle: 'hiddenInset'`, `screen`, `Menu`), Node 20, React 18, Zustand 5, `react-resizable-panels` ^2.1.3, Tailwind 3, Vitest + happy-dom, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-17-native-shell-polish-design.md` — read **Revision 1** before starting. It explains why `electron-store` is not used and why the sequencing changed.

**Prior plans:** `2026-08-17-files-buildout.md` (shipped, merged in `c15770f` — established `DetailPane`, `Toolbar`, `Breadcrumb`, `QuickLook`, virtualization, and the `FileWriter` mutation layer). `2026-08-17-testing-foundation.md` (shipped — established the testing policy).

---

## Nothing new to install

Every dependency needed is already in `package.json`. Verified before writing this plan. If you reach for `npm install`, stop and re-read this section.

| Need | Use | Already present |
|---|---|---|
| Resizable panes | `Panel`, `PanelGroup`, `PanelResizeHandle` | `react-resizable-panels` ^2.1.3 |
| Window chrome, menus, displays | `BrowserWindow`, `Menu`, `screen` | Electron 31.3.1 built-ins |
| Window-state persistence | `fs/promises` + JSON | Node built-in — see Global Constraints |
| Icons | `lucide-react` | ^0.436.0 |
| Command bus | `rxjs` `BehaviorSubject` | ^7.8.1, already used by `commandRegistry` |

**Do not add `electron-store`.** It is in `package.json` but unused, and version 10.0.1 is ESM-only (`"type": "module"`, no `require` export condition) while `vite.main.config.ts` builds the main process as CommonJS. Window state uses a versioned JSON file following the `RootRegistry` pattern instead.

---

## Global Constraints

- **All work targets merged `dev` at `c15770f` or later.** The files build-out is already in. `DiskExplorer.tsx` has a breadcrumb, toolbar, detail pane, Quick Look, dialogs, and virtualized views. Read it before changing it.
- **E2E budget is at its ceiling.** The suite holds **9** tests; the policy limit is 10. This plan adds **exactly one**, in Task 4. **No other task may add an E2E test.** If something seems to need one, it is being tested at the wrong tier.
- **Do not fix the 14 pre-existing `tsc` errors.** They live in `file-explorer-v2` (`FolderView.tsx`, `NoteView.tsx`, `styles/common/components.ts`) and come from untyped `styled-components` theme access. They are out of scope. `npx tsc --noEmit` therefore exits non-zero before you start and will after you finish — judge your work by *not adding new errors*, checked with the command in Task 0.
- **Do not touch `/explorer`'s internal UI.** `file-explorer-v2` is retired in a later vault slice. It receives the shared pane wrapper in Task 6 and nothing else.
- **Renderer never imports `fs`, `path`, or `electron`.** Logic shared by both processes goes in `src/common/`.
- **Handler classes follow the DI pattern** from `src/main/fs/DiskHandlers.ts`: a `Dependencies` interface, constructor takes `deps`, public `registerAll()`, one private `registerX()` per channel.
- **New IPC channels must be added to `preload.ts` and to a main-process handler in the same task.** `src/tests/unit/ipcContract.test.ts` fails on any channel invoked from preload without a registered handler.
- **Persisted values are versioned.** An unrecognised or corrupt value falls back to the default and never throws. Losing a pane size is cosmetic; failing to boot is not.
- **`npm test` before every commit.** The pre-commit hook enforces it.
- **Do not test CSS.** happy-dom computes no layout, so class-name assertions test implementation, not behaviour. Verify visual work by running `npm run better-dev`.
- **Add a `data-testid` to every new interactive element**, matching the existing `disk-*` / `pane-*` conventions.

---

## File Structure

```
MAIN                                          RENDERER
──────────────────────────────────            ────────────────────────────────────
src/main/window/                              src/renderer/shared/prefs/
  windowBounds.ts      (NEW, pure)              prefs.ts          (NEW)
  WindowStateStore.ts  (NEW)                    usePref.ts        (NEW)

src/main/menu/                                src/renderer/shared/components/panes/
  menuTemplate.ts      (NEW, pure)              PaneGroup.tsx     (NEW)
  AppMenu.ts           (NEW)                    Pane.tsx          (NEW)
                                                PaneHandle.tsx    (NEW)
src/main.ts            (MODIFY)                 usePaneLayout.ts  (NEW)

src/common/                                   src/renderer/features/commands/
  commandIds.ts        (NEW, pure)              services/commandRegistry.ts (MODIFY)

index.html             (MODIFY — theme script) src/renderer/features/disk-explorer/
                                                store/tabsStore.ts   (NEW)
                                                components/TabStrip.tsx (NEW)
                                                components/DiskExplorer.tsx (MODIFY)

                                              src/renderer/features/navbar/
                                                components/Navbar.tsx (MODIFY)
                                              src/renderer/App.tsx (MODIFY)
```

**Responsibilities:**

- `windowBounds.ts` — pure geometry. Decides whether saved bounds are still usable given a display list. No Electron import, so it unit-tests without a browser.
- `WindowStateStore.ts` — reads/writes the JSON file, delegates validation to `windowBounds.ts`.
- `menuTemplate.ts` — pure. Turns a command list into an Electron menu template. No Electron import.
- `AppMenu.ts` — builds and installs the menu, dispatches to the renderer.
- `prefs.ts` — versioned `localStorage` get/set. Pure enough to test directly under happy-dom.
- `panes/` — the reusable pane system. Nothing in it knows about files or notes.
- `commandIds.ts` — string constants shared by the menu (main) and the palette (renderer), so a typo is a compile error rather than a dead menu item.

---

## Phase boundaries

Each phase ends with the app working and shippable. Stop after any phase if priorities change.

| Phase | Tasks | Delivers | Risk |
|---|---|---|---|
| 1 | 0–5 | Real traffic lights, no launch flash, window remembers its size | low |
| 2 | 6–7 | Every pane drags and remembers its size | medium — touches heavily-tested `/files` |
| 3 | 8–10 | Native menu bar, one shortcut map, enforced budgets | low |
| 4 | 11–12 | Tabs for open files | low |

---

# PHASE 1 — A window that behaves

---

### Task 0: Establish the baseline

Before changing anything, record what "already broken" looks like. Every later task compares against these numbers.

**Files:**
- Create: `docs/superpowers/plans/baseline-2026-08-17.txt` (scratch record, committed once)

- [ ] **Step 1: Record the type-error baseline**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -c 'error TS'
```
Expected: `14`. If it is not 14, someone has changed `file-explorer-v2` since this plan was written — record the new number and use that as your baseline instead.

- [ ] **Step 2: Record the test baseline**

Run: `npm test`
Expected: `Test Files 43 passed (43)`, `Tests 348 passed (348)`.

- [ ] **Step 3: Record the E2E baseline**

Run:
```bash
grep -c "test(" e2e/tests/*.ts
```
Expected total: **9**. The ceiling is 10. You may add exactly one, in Task 4.

- [ ] **Step 4: Write the baseline file**

```bash
{
  echo "Baseline recorded before native-shell-polish, against $(git rev-parse --short HEAD)"
  echo "tsc errors (pre-existing, do not fix): $(npx tsc --noEmit 2>&1 | grep -c 'error TS')"
  echo "unit tests: $(npx vitest run 2>&1 | grep -o 'Tests  [0-9]* passed' | head -1)"
  echo "e2e tests: $(grep -ch 'test(' e2e/tests/*.ts | paste -sd+ - | bc) of 10 allowed"
} > docs/superpowers/plans/baseline-2026-08-17.txt
cat docs/superpowers/plans/baseline-2026-08-17.txt
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/baseline-2026-08-17.txt
git commit -m "docs: record pre-polish baseline for tests and type errors"
```

---

### Task 1: Versioned preference storage

Pane sizes, tab lists, and the theme all need to survive a restart and be readable before first paint. `useLocalStorage` today stores bare JSON with no version, so a shape change crashes on the old value. This wraps it.

**Files:**
- Create: `src/renderer/shared/prefs/prefs.ts`
- Create: `src/renderer/shared/prefs/usePref.ts`
- Test: `src/tests/unit/prefs.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `readPref<T>(key: string, fallback: T): T`
  - `writePref<T>(key: string, value: T): void`
  - `PREFS_VERSION: number`
  - `usePref<T>(key: string, fallback: T): [T, (value: T) => void]`

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/prefs.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readPref, writePref, PREFS_VERSION } from '@/renderer/shared/prefs/prefs';

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readPref', () => {
  it('returns the fallback when nothing is stored', () => {
    expect(readPref('pane.left', 20)).toBe(20);
  });

  it('round-trips a value through writePref', () => {
    writePref('pane.left', 33);
    expect(readPref('pane.left', 20)).toBe(33);
  });

  it('round-trips objects and arrays, not just scalars', () => {
    writePref('tabs.open', ['/a.md', '/b.png']);
    expect(readPref<string[]>('tabs.open', [])).toEqual(['/a.md', '/b.png']);

    writePref('layout', { left: 20, right: 30 });
    expect(readPref('layout', { left: 0, right: 0 })).toEqual({ left: 20, right: 30 });
  });

  it('returns the fallback when the stored version is newer', () => {
    window.localStorage.setItem(
      'opal.pane.left',
      JSON.stringify({ version: PREFS_VERSION + 1, value: 99 })
    );
    expect(readPref('pane.left', 20)).toBe(20);
  });

  it('returns the fallback when the stored version is older', () => {
    window.localStorage.setItem(
      'opal.pane.left',
      JSON.stringify({ version: PREFS_VERSION - 1, value: 99 })
    );
    expect(readPref('pane.left', 20)).toBe(20);
  });

  it('returns the fallback for unparseable JSON rather than throwing', () => {
    window.localStorage.setItem('opal.pane.left', 'not json{{{');
    expect(() => readPref('pane.left', 20)).not.toThrow();
    expect(readPref('pane.left', 20)).toBe(20);
  });

  it('returns the fallback for a value stored without an envelope', () => {
    // Exactly what the old useLocalStorage wrote. Must not be mistaken for valid.
    window.localStorage.setItem('opal.pane.left', '42');
    expect(readPref('pane.left', 20)).toBe(20);
  });

  it('namespaces keys so it cannot collide with other localStorage users', () => {
    writePref('pane.left', 33);
    expect(window.localStorage.getItem('opal.pane.left')).not.toBeNull();
    expect(window.localStorage.getItem('pane.left')).toBeNull();
  });

  it('preserves a stored false, 0, and empty string rather than treating them as absent', () => {
    writePref('a', false);
    writePref('b', 0);
    writePref('c', '');
    expect(readPref('a', true)).toBe(false);
    expect(readPref('b', 5)).toBe(0);
    expect(readPref('c', 'x')).toBe('');
  });
});

describe('writePref', () => {
  it('does not throw when storage rejects the write', () => {
    // Safari private mode and a full quota both throw from setItem. Losing a
    // pane size must never take down the app.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => writePref('pane.left', 33)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/prefs.test.ts`
Expected: FAIL — cannot resolve `@/renderer/shared/prefs/prefs`.

- [ ] **Step 3: Implement `prefs.ts`**

Create `src/renderer/shared/prefs/prefs.ts`:

```ts
/**
 * Versioned, namespaced preference storage.
 *
 * localStorage rather than IPC because these values must be readable before
 * React's first paint — pane sizes and theme decide what the first frame looks
 * like, and an async round-trip to main would reintroduce the flash this work
 * exists to remove.
 *
 * Every value is wrapped in an envelope carrying a schema version. A value
 * written by a different version is discarded in favour of the fallback, so
 * changing a stored shape can never crash a launch.
 */

export const PREFS_VERSION = 1;

const NAMESPACE = 'opal.';

interface Envelope<T> {
  version: number;
  value: T;
}

function isEnvelope(candidate: unknown): candidate is Envelope<unknown> {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    'version' in candidate &&
    'value' in candidate &&
    typeof (candidate as Envelope<unknown>).version === 'number'
  );
}

export function readPref<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(NAMESPACE + key);
  } catch {
    return fallback;
  }
  if (raw === null) return fallback;

  try {
    const parsed: unknown = JSON.parse(raw);
    // A bare value is either pre-envelope data or something another library
    // wrote. Either way its shape is unknown, so it is not trustworthy.
    if (!isEnvelope(parsed)) return fallback;
    if (parsed.version !== PREFS_VERSION) return fallback;
    return parsed.value as T;
  } catch {
    return fallback;
  }
}

export function writePref<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;

  const envelope: Envelope<T> = { version: PREFS_VERSION, value };
  try {
    window.localStorage.setItem(NAMESPACE + key, JSON.stringify(envelope));
  } catch {
    // Quota exceeded, or storage disabled. A lost preference is cosmetic.
  }
}
```

- [ ] **Step 4: Implement `usePref.ts`**

Create `src/renderer/shared/prefs/usePref.ts`:

```ts
import { useCallback, useState } from 'react';
import { readPref, writePref } from './prefs';

/**
 * Like useState, but the initial value comes from storage and every write is
 * persisted.
 *
 * The initializer is passed as a function so the read happens once during the
 * first render rather than on every render. Unlike the older useLocalStorage,
 * there is no re-read effect on mount: that effect caused a second render with
 * a different value on every single mount, which is exactly the flash this
 * module removes.
 */
export function usePref<T>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => readPref(key, fallback));

  const set = useCallback(
    (next: T) => {
      setValue(next);
      writePref(key, next);
    },
    [key]
  );

  return [value, set];
}
```

- [ ] **Step 5: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/prefs.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Full suite and commit**

Run: `npm test`
Expected: 43 files, 358 tests (348 + 10).

```bash
git add src/renderer/shared/prefs/ src/tests/unit/prefs.test.ts
git commit -m "feat(shell): add versioned preference storage"
```

---

### Task 2: Window bounds validation

Pure geometry, split from any Electron import so it unit-tests without a browser. This is the part that stops the app opening offscreen on a monitor you no longer own.

**Files:**
- Create: `src/main/window/windowBounds.ts`
- Test: `src/tests/unit/window/windowBounds.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface SavedBounds { x: number; y: number; width: number; height: number; isMaximized: boolean }`
  - `interface DisplayArea { x: number; y: number; width: number; height: number }`
  - `MIN_WINDOW_WIDTH: number`, `MIN_WINDOW_HEIGHT: number`
  - `isUsableBounds(bounds: SavedBounds | null, displays: DisplayArea[]): boolean`
  - `resolveBounds(saved: SavedBounds | null, displays: DisplayArea[], defaults: { width: number; height: number }): SavedBounds | null` — returns `null` when Electron should pick the position itself.

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/window/windowBounds.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  isUsableBounds,
  resolveBounds,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  type DisplayArea,
  type SavedBounds,
} from '@/main/window/windowBounds';

const LAPTOP: DisplayArea = { x: 0, y: 0, width: 1440, height: 900 };
const EXTERNAL: DisplayArea = { x: 1440, y: 0, width: 2560, height: 1440 };
const DEFAULTS = { width: 1200, height: 800 };

function bounds(overrides: Partial<SavedBounds> = {}): SavedBounds {
  return { x: 100, y: 100, width: 1000, height: 700, isMaximized: false, ...overrides };
}

describe('isUsableBounds', () => {
  it('rejects null', () => {
    expect(isUsableBounds(null, [LAPTOP])).toBe(false);
  });

  it('accepts a window fully inside a display', () => {
    expect(isUsableBounds(bounds(), [LAPTOP])).toBe(true);
  });

  it('accepts a window on a secondary display', () => {
    expect(isUsableBounds(bounds({ x: 1600, y: 200 }), [LAPTOP, EXTERNAL])).toBe(true);
  });

  it('rejects a window on a display that is no longer connected', () => {
    // Saved on the external monitor; now only the laptop is present.
    expect(isUsableBounds(bounds({ x: 1600, y: 200 }), [LAPTOP])).toBe(false);
  });

  it('accepts a window that straddles two displays', () => {
    expect(isUsableBounds(bounds({ x: 1200, y: 100 }), [LAPTOP, EXTERNAL])).toBe(true);
  });

  it('rejects a window whose title bar is above every display', () => {
    // Dragged-off-the-top is unrecoverable by mouse: there is no title bar to grab.
    expect(isUsableBounds(bounds({ y: -400 }), [LAPTOP])).toBe(false);
  });

  it('rejects a window smaller than the minimum', () => {
    expect(isUsableBounds(bounds({ width: MIN_WINDOW_WIDTH - 1 }), [LAPTOP])).toBe(false);
    expect(isUsableBounds(bounds({ height: MIN_WINDOW_HEIGHT - 1 }), [LAPTOP])).toBe(false);
  });

  it('rejects non-finite numbers from a corrupted store', () => {
    expect(isUsableBounds(bounds({ x: NaN }), [LAPTOP])).toBe(false);
    expect(isUsableBounds(bounds({ width: Infinity }), [LAPTOP])).toBe(false);
  });

  it('rejects everything when no displays are reported', () => {
    expect(isUsableBounds(bounds(), [])).toBe(false);
  });
});

describe('resolveBounds', () => {
  it('returns null when there is nothing saved, letting Electron centre the window', () => {
    expect(resolveBounds(null, [LAPTOP], DEFAULTS)).toBeNull();
  });

  it('returns null when the saved bounds are unusable', () => {
    expect(resolveBounds(bounds({ x: 1600 }), [LAPTOP], DEFAULTS)).toBeNull();
  });

  it('returns the saved bounds when they are usable', () => {
    const saved = bounds();
    expect(resolveBounds(saved, [LAPTOP], DEFAULTS)).toEqual(saved);
  });

  it('preserves the maximized flag', () => {
    const saved = bounds({ isMaximized: true });
    expect(resolveBounds(saved, [LAPTOP], DEFAULTS)?.isMaximized).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/window/windowBounds.test.ts`
Expected: FAIL — cannot resolve `@/main/window/windowBounds`.

- [ ] **Step 3: Implement**

Create `src/main/window/windowBounds.ts`:

```ts
/**
 * Pure geometry for restoring a window position.
 *
 * Deliberately free of any Electron import so it can be unit-tested directly.
 * The caller supplies display work areas; this module only does arithmetic.
 */

export interface SavedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

export interface DisplayArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_WINDOW_WIDTH = 640;
export const MIN_WINDOW_HEIGHT = 480;

/** How much of the window must overlap a display for it to count as reachable. */
const MIN_VISIBLE_PX = 80;

function isFiniteRect(bounds: SavedBounds): boolean {
  return [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite);
}

function overlapArea(bounds: SavedBounds, display: DisplayArea): number {
  const overlapX = Math.min(bounds.x + bounds.width, display.x + display.width)
    - Math.max(bounds.x, display.x);
  const overlapY = Math.min(bounds.y + bounds.height, display.y + display.height)
    - Math.max(bounds.y, display.y);

  if (overlapX <= 0 || overlapY <= 0) return 0;
  return overlapX * overlapY;
}

export function isUsableBounds(
  bounds: SavedBounds | null,
  displays: DisplayArea[]
): boolean {
  if (!bounds) return false;
  if (!isFiniteRect(bounds)) return false;
  if (bounds.width < MIN_WINDOW_WIDTH) return false;
  if (bounds.height < MIN_WINDOW_HEIGHT) return false;
  if (displays.length === 0) return false;

  // The title bar must be on-screen. A window dragged above the top of every
  // display cannot be moved back with the mouse, so restoring one is a trap.
  const titleBarVisible = displays.some(
    (display) => bounds.y >= display.y - 1 && bounds.y < display.y + display.height
  );
  if (!titleBarVisible) return false;

  const visible = displays.reduce(
    (total, display) => total + overlapArea(bounds, display),
    0
  );
  return visible >= MIN_VISIBLE_PX * MIN_VISIBLE_PX;
}

/**
 * Returns bounds to apply, or null to let Electron place the window itself.
 *
 * Returning null rather than a computed centre keeps the fallback identical to
 * a first-ever launch, which is the behaviour a user expects when their saved
 * position has become meaningless.
 */
export function resolveBounds(
  saved: SavedBounds | null,
  displays: DisplayArea[],
  _defaults: { width: number; height: number }
): SavedBounds | null {
  return isUsableBounds(saved, displays) ? saved : null;
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/window/windowBounds.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/window/windowBounds.ts src/tests/unit/window/windowBounds.test.ts
git commit -m "feat(shell): add window bounds validation"
```

---

### Task 3: The window state store

The persistence half, following `RootRegistry` exactly: a versioned JSON file under `userData`, tolerant of corruption, honouring `OPAL_TEST_USER_DATA_DIR`.

**Files:**
- Create: `src/main/window/WindowStateStore.ts`
- Test: `src/tests/unit/window/windowStateStore.test.ts`

**Interfaces:**
- Consumes: `SavedBounds` (Task 2).
- Produces:
  - `class WindowStateStore` with `constructor(deps: { storePath: string })`
  - `load(): Promise<void>`
  - `get(): SavedBounds | null`
  - `save(bounds: SavedBounds): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/window/windowStateStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import { WindowStateStore } from '@/main/window/WindowStateStore';
import type { SavedBounds } from '@/main/window/windowBounds';

let tmp: string;
let storePath: string;

const BOUNDS: SavedBounds = {
  x: 10, y: 20, width: 1000, height: 700, isMaximized: false,
};

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-winstate-'));
  storePath = path.join(tmp, 'window-state.json');
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('WindowStateStore', () => {
  it('reports null before anything is saved', async () => {
    const store = new WindowStateStore({ storePath });
    await store.load();
    expect(store.get()).toBeNull();
  });

  it('round-trips bounds through the file', async () => {
    const store = new WindowStateStore({ storePath });
    await store.load();
    await store.save(BOUNDS);

    const reloaded = new WindowStateStore({ storePath });
    await reloaded.load();
    expect(reloaded.get()).toEqual(BOUNDS);
  });

  it('creates the parent directory if it does not exist', async () => {
    const nested = path.join(tmp, 'a', 'b', 'window-state.json');
    const store = new WindowStateStore({ storePath: nested });
    await store.load();
    await store.save(BOUNDS);

    const raw = await readFile(nested, 'utf-8');
    expect(JSON.parse(raw).bounds).toEqual(BOUNDS);
  });

  it('writes a version field', async () => {
    const store = new WindowStateStore({ storePath });
    await store.load();
    await store.save(BOUNDS);

    const raw = await readFile(storePath, 'utf-8');
    expect(JSON.parse(raw).version).toBe(1);
  });

  it('treats a corrupt file as empty rather than throwing', async () => {
    await writeFile(storePath, 'not json{{{', 'utf-8');
    const store = new WindowStateStore({ storePath });
    await expect(store.load()).resolves.toBeUndefined();
    expect(store.get()).toBeNull();
  });

  it('ignores a file written by a newer version', async () => {
    await writeFile(
      storePath,
      JSON.stringify({ version: 99, bounds: BOUNDS }),
      'utf-8'
    );
    const store = new WindowStateStore({ storePath });
    await store.load();
    expect(store.get()).toBeNull();
  });

  it('ignores a file whose bounds are not an object', async () => {
    await writeFile(storePath, JSON.stringify({ version: 1, bounds: 'nope' }), 'utf-8');
    const store = new WindowStateStore({ storePath });
    await store.load();
    expect(store.get()).toBeNull();
  });

  it('overwrites previous bounds rather than appending', async () => {
    const store = new WindowStateStore({ storePath });
    await store.load();
    await store.save(BOUNDS);
    await store.save({ ...BOUNDS, width: 1234 });

    const reloaded = new WindowStateStore({ storePath });
    await reloaded.load();
    expect(reloaded.get()?.width).toBe(1234);
  });

  it('does not reject when the directory cannot be written', async () => {
    // A read-only location must not crash the app on quit.
    const readOnlyDir = path.join(tmp, 'ro');
    await mkdir(readOnlyDir);
    const store = new WindowStateStore({
      storePath: path.join(readOnlyDir, 'sub', 'nested', 'window-state.json'),
    });
    await store.load();
    await expect(store.save(BOUNDS)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/window/windowStateStore.test.ts`
Expected: FAIL — cannot resolve `@/main/window/WindowStateStore`.

- [ ] **Step 3: Implement**

Create `src/main/window/WindowStateStore.ts`:

```ts
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import type { SavedBounds } from './windowBounds';

const STORE_VERSION = 1;

export interface WindowStateStoreDependencies {
  /** Absolute path to the JSON file holding the window bounds. */
  storePath: string;
}

interface WindowStateFile {
  version: number;
  bounds: SavedBounds;
}

function isSavedBounds(candidate: unknown): candidate is SavedBounds {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const value = candidate as Record<string, unknown>;
  return (
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.width === 'number' &&
    typeof value.height === 'number' &&
    typeof value.isMaximized === 'boolean'
  );
}

/**
 * Persists window geometry between launches.
 *
 * Mirrors RootRegistry: a versioned JSON file under userData, written whole,
 * and treated as absent whenever it cannot be understood. electron-store would
 * be the obvious choice but v10 is ESM-only against this project's CommonJS
 * main build — see Revision 1 of the design doc.
 */
export class WindowStateStore {
  private deps: WindowStateStoreDependencies;
  private bounds: SavedBounds | null = null;

  constructor(deps: WindowStateStoreDependencies) {
    this.deps = deps;
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.deps.storePath, 'utf-8');
      const parsed = JSON.parse(raw) as WindowStateFile;

      if (parsed?.version !== STORE_VERSION) {
        this.bounds = null;
        return;
      }
      this.bounds = isSavedBounds(parsed.bounds) ? parsed.bounds : null;
    } catch {
      // Missing or corrupt: open at the default size rather than fail to boot.
      this.bounds = null;
    }
  }

  get(): SavedBounds | null {
    return this.bounds;
  }

  async save(bounds: SavedBounds): Promise<void> {
    this.bounds = bounds;
    const payload: WindowStateFile = { version: STORE_VERSION, bounds };

    try {
      await mkdir(path.dirname(this.deps.storePath), { recursive: true });
      await writeFile(this.deps.storePath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch {
      // Read-only or full disk. Losing the saved position is cosmetic, and this
      // runs during quit where throwing would surface as a crash dialog.
    }
  }
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/window/windowStateStore.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/window/WindowStateStore.ts src/tests/unit/window/windowStateStore.test.ts
git commit -m "feat(shell): persist window bounds across launches"
```

---

### Task 4: Real traffic lights and a launch with no flash

The visible payoff of Phase 1, and the only task in this plan permitted to add an E2E test.

**Files:**
- Modify: `src/main.ts`
- Modify: `src/preload.ts`
- Modify: `src/renderer/features/navbar/components/Navbar.tsx`
- Modify: `index.html`
- Modify: `src/renderer/shared/types/index.ts` — declares `systemAPI`
- Test: `e2e/tests/window-state.spec.ts` (**the one permitted E2E addition**)

**Interfaces:**
- Consumes: `WindowStateStore` (Task 3), `resolveBounds` (Task 2).
- Produces: no new exports. Removes `window.systemAPI.minimize`, `.maximize`, `.close`.

- [ ] **Step 1: Delete the fake traffic lights**

In `src/renderer/features/navbar/components/Navbar.tsx`:

Delete the `handleWindowAction` function (lines 37–39) and the three circle `<button>` elements plus the `<div className="w-4">` spacer inside `renderWindowControls` (lines 43–59). Keep the back/forward buttons.

`renderWindowControls` becomes:

```tsx
  const renderWindowControls = () => (
    // pl-[78px] clears the macOS traffic lights, which the OS now draws itself
    // via titleBarStyle: 'hiddenInset'.
    <div className="flex items-center space-x-2 no-drag pl-[78px]">
      <div className="space-x-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={goBack}
          title="Go back"
          disabled={!canGoBack()}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={goForward}
          title="Go forward"
          disabled={!canGoForward()}
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
```

- [ ] **Step 2: Remove the window-control IPC**

In `src/preload.ts`, delete these three lines from the `systemAPI` object:

```ts
  minimize: () => ipcRenderer.send("system:minimize-window"),
  maximize: () => ipcRenderer.send("system:maximize-window"),
  close: () => ipcRenderer.send("system:close-window"),
```

Then remove the same three methods from the `SystemAPI` interface in
`src/renderer/shared/types/index.ts`.

Then remove the matching handlers from `src/main/services/system/SystemHandlers.ts`.
They are the `ipc.on` registrations at lines 57, 64, and 73. Delete the private
`registerX` method containing each, and its call inside `registerAll()` (line 18).

- [ ] **Step 3: Add the pre-paint theme script**

In `index.html`, add this script inside `<head>`, after the `<title>`:

```html
    <script>
      // Runs before any bundle parses, so the first painted frame already has
      // the right theme. Without this the window paints light, then React
      // mounts and swaps to dark — a visible flash on every launch.
      // Mirrors THEME_STORAGE_KEY and DEFAULT_THEME in
      // src/renderer/features/theme/config/themeConfig.ts. Keep them in sync.
      (function () {
        try {
          var theme = window.localStorage.getItem('theme') || 'light';
          document.documentElement.classList.add(
            theme === 'dark' ? 'dark' : 'light'
          );
        } catch (error) {
          document.documentElement.classList.add('light');
        }
      })();
    </script>
```

Note this reads the raw `theme` key, not a `prefs.ts` envelope, because `themeUtils.ts` writes it bare via `localStorage.setItem(THEME_STORAGE_KEY, theme)`. Do not migrate the theme key in this task — changing it here would strand every existing user's theme.

- [ ] **Step 4: Rewrite `createWindow` in `src/main.ts`**

Add to the imports at the top:

```ts
import { app, BrowserWindow, ipcMain, dialog, screen } from "electron";
import { WindowStateStore } from "@/main/window/WindowStateStore";
import { resolveBounds, MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT } from "@/main/window/windowBounds";
```

Add the store beside the existing `rootRegistry` declaration (around line 198), reusing the same `OPAL_TEST_USER_DATA_DIR` convention:

```ts
const windowStateStore = new WindowStateStore({
  storePath: path.join(
    process.env.OPAL_TEST_USER_DATA_DIR || app.getPath("userData"),
    "window-state.json"
  ),
});
```

Replace the `BrowserWindow` construction (currently lines 65–75) with:

```ts
  const displays = screen.getAllDisplays().map((display) => display.workArea);
  const saved = resolveBounds(windowStateStore.get(), displays, {
    width: DEFAULT_BROWSER_WINDOW_WIDTH,
    height: DEFAULT_BROWSER_WINDOW_HEIGHT,
  });

  // Painting the window's own background before the renderer loads is what
  // removes the white flash. It must match the theme the inline script in
  // index.html is about to apply, so both read the same localStorage key.
  const isDark = windowStateStore.getThemeHint() === "dark";

  mainWindow = new BrowserWindow({
    width: saved?.width ?? DEFAULT_BROWSER_WINDOW_WIDTH,
    height: saved?.height ?? DEFAULT_BROWSER_WINDOW_HEIGHT,
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    backgroundColor: isDark ? "#191A1C" : "#FFFFFF",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  if (saved?.isMaximized) mainWindow.maximize();

  // Reveal only once the first frame is ready. Without this the user sees an
  // empty window for the duration of the renderer's startup.
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
```

The two colours match `--background` in `src/renderer/styles/index.css`: light is `0 0% 100%` (`#FFFFFF`), dark is `220 6% 10%` (`#191A1C`).

Note `DEFAULT_BROWSER_WINDOW_WIDTH` / `HEIGHT` in `src/common/constants.ts` are
`800` / `600`. Both clear the `640` / `480` minimums, so no change is needed —
but a three-pane layout at 800px wide is cramped. Consider raising the defaults
to `1200` / `800` in this step; it only affects a first-ever launch.

- [ ] **Step 5: Add the theme hint to `WindowStateStore`**

Step 4 calls `getThemeHint()`, which does not exist yet. Main cannot read the renderer's `localStorage`, so the theme is mirrored into the same JSON file whenever the renderer reports it.

In `src/main/window/WindowStateStore.ts`, extend the file shape and the class:

```ts
interface WindowStateFile {
  version: number;
  bounds: SavedBounds;
  /** Mirror of the renderer's theme, used only to pick a pre-paint background. */
  theme?: 'light' | 'dark';
}
```

Add the field and two methods to the class:

```ts
  private theme: 'light' | 'dark' = 'light';

  getThemeHint(): 'light' | 'dark' {
    return this.theme;
  }

  async saveTheme(theme: 'light' | 'dark'): Promise<void> {
    this.theme = theme;
    await this.persist();
  }
```

Set `this.theme` inside `load()`, after the bounds assignment:

```ts
      this.theme = parsed.theme === 'dark' ? 'dark' : 'light';
```

and reset it in the `catch` block alongside `this.bounds = null;`:

```ts
      this.theme = 'light';
```

Refactor `save()` to share one writer, so bounds and theme cannot clobber each other:

```ts
  async save(bounds: SavedBounds): Promise<void> {
    this.bounds = bounds;
    await this.persist();
  }

  private async persist(): Promise<void> {
    if (!this.bounds) return;
    const payload: WindowStateFile = {
      version: STORE_VERSION,
      bounds: this.bounds,
      theme: this.theme,
    };

    try {
      await mkdir(path.dirname(this.deps.storePath), { recursive: true });
      await writeFile(this.deps.storePath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch {
      // Read-only or full disk. Losing the saved position is cosmetic.
    }
  }
```

Add these cases to `src/tests/unit/window/windowStateStore.test.ts`:

```ts
describe('theme hint', () => {
  it('defaults to light', async () => {
    const store = new WindowStateStore({ storePath });
    await store.load();
    expect(store.getThemeHint()).toBe('light');
  });

  it('round-trips a saved theme alongside bounds', async () => {
    const store = new WindowStateStore({ storePath });
    await store.load();
    await store.save(BOUNDS);
    await store.saveTheme('dark');

    const reloaded = new WindowStateStore({ storePath });
    await reloaded.load();
    expect(reloaded.getThemeHint()).toBe('dark');
    expect(reloaded.get()).toEqual(BOUNDS);
  });

  it('keeps bounds when only the theme changes', async () => {
    const store = new WindowStateStore({ storePath });
    await store.load();
    await store.save(BOUNDS);
    await store.saveTheme('dark');

    const reloaded = new WindowStateStore({ storePath });
    await reloaded.load();
    expect(reloaded.get()?.width).toBe(BOUNDS.width);
  });
});
```

Run: `npx vitest run src/tests/unit/window/windowStateStore.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Persist bounds and theme**

Still in `createWindow` in `src/main.ts`, add after the `ready-to-show` handler:

```ts
  // Debounced because macOS emits resize and move continuously during a drag;
  // writing the file on every event would mean hundreds of writes per gesture.
  let saveTimer: NodeJS.Timeout | null = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      // getNormalBounds returns the pre-maximize rectangle, so un-maximizing
      // after a restart restores a useful size rather than a full-screen one.
      const { x, y, width, height } = mainWindow.getNormalBounds();
      void windowStateStore.save({
        x, y, width, height,
        isMaximized: mainWindow.isMaximized(),
      });
    }, 400);
  };

  mainWindow.on("resize", scheduleSave);
  mainWindow.on("move", scheduleSave);
  mainWindow.on("maximize", scheduleSave);
  mainWindow.on("unmaximize", scheduleSave);

  mainWindow.on("close", () => {
    if (saveTimer) clearTimeout(saveTimer);
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const { x, y, width, height } = mainWindow.getNormalBounds();
    void windowStateStore.save({
      x, y, width, height,
      isMaximized: mainWindow.isMaximized(),
    });
  });
```

Load the store before the window is created. In the `app.whenReady()` block, add immediately before `createWindow();`:

```ts
    await windowStateStore.load();
    log.info("Window state loaded");
```

- [ ] **Step 7: Report the theme from the renderer**

Add the IPC channel so main learns the theme. In `src/main/services/system/SystemHandlers.ts`, add to the `Dependencies` interface:

```ts
  onThemeChanged: (theme: 'light' | 'dark') => void;
```

Add to `registerAll()`:

```ts
    this.registerReportTheme();
```

Add the private method, following the existing pattern in that file:

```ts
  private registerReportTheme(): void {
    this.deps.ipc.on('system:report-theme', (_event, theme: 'light' | 'dark') => {
      this.deps.onThemeChanged(theme === 'dark' ? 'dark' : 'light');
    });
  }
```

In `src/main.ts`, pass the callback where `systemHandlers` is constructed:

```ts
const systemHandlers = new SystemHandlers({
  ipc: ipcMain,
  dialog,
  browserWindow: BrowserWindow,
  onThemeChanged: (theme) => { void windowStateStore.saveTheme(theme); },
});
```

In `src/preload.ts`, add to `systemAPI`:

```ts
  reportTheme: (theme: "light" | "dark") => ipcRenderer.send("system:report-theme", theme),
```

Add `reportTheme: (theme: 'light' | 'dark') => void;` to the `SystemAPI` interface in `src/renderer/shared/types/index.ts`.

In `src/renderer/features/theme/utils/themeUtils.ts`, call it from `applyTheme` and drop the three stray `console.log` calls from `getInitialTheme` while you are in the file:

```ts
export function applyTheme(theme: Theme) {
  const root = window.document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(theme)
  localStorage.setItem(THEME_STORAGE_KEY, theme)
  // Tell main, so the next launch can paint the right background before the
  // renderer exists.
  window.systemAPI?.reportTheme?.(theme)
}

export function getInitialTheme(): Theme {
  if (typeof window !== 'undefined') {
    const theme = localStorage.getItem(THEME_STORAGE_KEY) as Theme
    return theme || DEFAULT_THEME
  }
  return DEFAULT_THEME
}
```

- [ ] **Step 8: Verify the IPC contract test**

Run: `npx vitest run src/tests/unit/ipcContract.test.ts`
Expected: PASS. If it reports `system:report-theme` as a dead channel, Step 7's handler registration was missed. If it still lists `system:minimize-window`, Step 2 was incomplete.

- [ ] **Step 9: Write the E2E test — the only one this plan may add**

Create `e2e/tests/window-state.spec.ts`:

```ts
import { test, expect } from '../fixtures/electronApp';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

test.describe('window state', () => {
  test('restores saved bounds and shows the window', async ({ page, electronApp, userDataDir }) => {
    // The fixture creates userDataDir before launch, so this file is written
    // too late for THIS launch to read — but it proves the round-trip shape and
    // that the window is visible, which is the part no unit test can check.
    await page.waitForSelector('[data-testid="navbar"]');

    const isVisible = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.isVisible();
    });
    expect(isVisible).toBe(true);

    // titleBarStyle: 'hiddenInset' means the OS owns the buttons, so the
    // renderer must not be drawing its own.
    await expect(page.locator('[title="Close"]')).toHaveCount(0);
    await expect(page.locator('[title="Minimize"]')).toHaveCount(0);

    const bounds = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.getNormalBounds();
    });
    expect(bounds.width).toBeGreaterThanOrEqual(640);
    expect(bounds.height).toBeGreaterThanOrEqual(480);

    // Resize, then confirm the debounced writer persisted it.
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setBounds({ x: 60, y: 60, width: 1024, height: 768 });
    });
    await page.waitForTimeout(900);

    const raw = await electronApp.evaluate(async ({ app }, dir) => {
      const fs = require('fs/promises');
      const p = require('path');
      return fs.readFile(p.join(dir, 'window-state.json'), 'utf-8');
    }, userDataDir);

    const saved = JSON.parse(raw);
    expect(saved.version).toBe(1);
    expect(saved.bounds.width).toBe(1024);
    expect(saved.bounds.height).toBe(768);
  });
});
```

- [ ] **Step 10: Run the E2E suite and confirm the budget**

Run: `npm run test:e2e`
Expected: 10 tests pass. **10 is the ceiling.** Confirm with:

```bash
grep -ch "test(" e2e/tests/*.ts | paste -sd+ - | bc
```
Expected: `10`.

- [ ] **Step 11: Verify in the app — this is the step that catches chrome mistakes**

Run: `npm run better-dev`

Check every one of these by hand; none can be tested below this tier:
1. The three traffic lights are the real macOS ones — hover shows the ×, −, + glyphs.
2. Clicking away from the window dims them.
3. The back/forward buttons are not underneath them.
4. Dragging the toolbar moves the window.
5. Green button enters fullscreen; the toolbar reflows without the buttons overlapping.
6. Switch to dark, quit, relaunch: **no white flash**.
7. Resize, quit, relaunch: same size and position.

If the toolbar overlaps the lights, adjust the `pl-[78px]` in Step 1 rather than adding `trafficLightPosition` — the inset default is correct for a 40px bar.

- [ ] **Step 12: Confirm no new type errors, then commit**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -c 'error TS'
```
Expected: still `14`. Any higher number is yours to fix.

Run: `npm test`

```bash
git add src/main.ts src/preload.ts src/main/window/ src/main/services/system/ \
        src/renderer/features/navbar/ src/renderer/features/theme/ \
        src/renderer/shared/types/ index.html e2e/tests/window-state.spec.ts src/tests/
git commit -m "feat(shell): use native traffic lights and launch without a flash"
```

---

### Task 5: Replace `useLocalStorage` in `App.tsx`

`App.tsx` still drives its three pane toggles through the old hook, whose mount effect causes a second render with a different value on every mount. Phase 2 builds on these values, so they move first.

**Files:**
- Modify: `src/renderer/App.tsx`
- Test: `src/tests/unit/appPrefs.test.tsx`

**Interfaces:**
- Consumes: `usePref` (Task 1).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/appPrefs.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePref } from '@/renderer/shared/prefs/usePref';
import { writePref } from '@/renderer/shared/prefs/prefs';

beforeEach(() => {
  window.localStorage.clear();
});

describe('usePref', () => {
  it('starts at the fallback when nothing is stored', () => {
    const { result } = renderHook(() => usePref('isLeftSidebarOpen', true));
    expect(result.current[0]).toBe(true);
  });

  it('starts at the stored value on first render, not after an effect', () => {
    writePref('isLeftSidebarOpen', false);
    const { result } = renderHook(() => usePref('isLeftSidebarOpen', true));
    // The old useLocalStorage returned the fallback here and corrected itself
    // in an effect, causing a visible flash of the wrong layout.
    expect(result.current[0]).toBe(false);
  });

  it('persists a write so a fresh hook sees it', () => {
    const { result } = renderHook(() => usePref('isLeftSidebarOpen', true));
    act(() => result.current[1](false));

    const { result: second } = renderHook(() => usePref('isLeftSidebarOpen', true));
    expect(second.current[0]).toBe(false);
  });

  it('keeps separate keys independent', () => {
    const { result: left } = renderHook(() => usePref('isLeftSidebarOpen', true));
    act(() => left.current[1](false));

    const { result: right } = renderHook(() => usePref('isRightSidebarOpen', true));
    expect(right.current[0]).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it passes already**

Run: `npx vitest run src/tests/unit/appPrefs.test.tsx`
Expected: PASS, 4 tests — `usePref` was built in Task 1. This test exists to pin the behaviour `App.tsx` is about to depend on. If it fails, Task 1 is wrong; fix that before continuing.

- [ ] **Step 3: Swap the hook in `App.tsx`**

Replace the import:

```tsx
import useLocalStorage from "@/renderer/shared/hooks/useLocalStorage";
```

with:

```tsx
import { usePref } from "@/renderer/shared/prefs/usePref";
```

Replace the three declarations:

```tsx
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = usePref(
    "isLeftSidebarOpen",
    true
  );
  const [isRightSidebarOpen, setIsRightSidebarOpen] = usePref(
    "isRightSidebarOpen",
    true
  );
  const [isBottomPaneOpen, setIsBottomPaneOpen] = usePref(
    "isBottomPaneOpen",
    true
  );
```

Leave `src/renderer/shared/hooks/useLocalStorage.ts` in place — other code may still import it. Check with `grep -rn "useLocalStorage" src/` and, if `App.tsx` was the only consumer, delete the file and its import in this same step.

- [ ] **Step 4: Run the suite and commit**

Run: `npm test`

```bash
git add src/renderer/App.tsx src/tests/unit/appPrefs.test.tsx src/renderer/shared/hooks/
git commit -m "refactor(shell): drive pane toggles from versioned prefs"
```

---

# PHASE 2 — Panes that drag and remember

---

### Task 6: The reusable pane system

One module, used by both routes. Nothing in it knows about files or notes.

**Files:**
- Create: `src/renderer/shared/components/panes/usePaneLayout.ts`
- Create: `src/renderer/shared/components/panes/PaneHandle.tsx`
- Create: `src/renderer/shared/components/panes/PaneGroup.tsx`
- Create: `src/renderer/shared/components/panes/index.ts`
- Test: `src/tests/unit/paneLayout.test.tsx`

**Interfaces:**
- Consumes: `readPref`, `writePref` (Task 1); `react-resizable-panels`.
- Produces:
  - `usePaneLayout(key: string, defaults: number[]): { sizes: number[]; onLayout: (sizes: number[]) => void }`
  - `<PaneHandle />`
  - `<PaneGroup layoutKey={string} onLayout={(sizes: number[]) => void} direction?: 'horizontal' | 'vertical' className?: string>`
  - `Pane` — `Panel` re-exported under the module's naming

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/paneLayout.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePaneLayout } from '@/renderer/shared/components/panes/usePaneLayout';
import { writePref, readPref } from '@/renderer/shared/prefs/prefs';

beforeEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
});

describe('usePaneLayout', () => {
  it('starts at the defaults when nothing is stored', () => {
    const { result } = renderHook(() => usePaneLayout('files', [20, 55, 25]));
    expect(result.current.sizes).toEqual([20, 55, 25]);
  });

  it('starts at the stored layout on first render', () => {
    writePref('pane.files', [10, 70, 20]);
    const { result } = renderHook(() => usePaneLayout('files', [20, 55, 25]));
    expect(result.current.sizes).toEqual([10, 70, 20]);
  });

  it('falls back when the stored layout has the wrong number of panes', () => {
    // A release that adds a pane must not restore a two-pane layout into three.
    writePref('pane.files', [40, 60]);
    const { result } = renderHook(() => usePaneLayout('files', [20, 55, 25]));
    expect(result.current.sizes).toEqual([20, 55, 25]);
  });

  it('falls back when the stored layout is not an array of numbers', () => {
    writePref('pane.files', ['a', 'b', 'c']);
    const { result } = renderHook(() => usePaneLayout('files', [20, 55, 25]));
    expect(result.current.sizes).toEqual([20, 55, 25]);
  });

  it('persists a layout reported by onLayout', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePaneLayout('files', [20, 55, 25]));

    act(() => result.current.onLayout([15, 60, 25]));
    act(() => { vi.advanceTimersByTime(400); });

    expect(readPref('pane.files', [])).toEqual([15, 60, 25]);
    vi.useRealTimers();
  });

  it('debounces, writing once for a burst of drag events', () => {
    vi.useFakeTimers();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => usePaneLayout('files', [20, 55, 25]));

    act(() => {
      for (let i = 0; i < 20; i += 1) result.current.onLayout([20 + i, 55 - i, 25]);
    });
    act(() => { vi.advanceTimersByTime(400); });

    expect(setItem).toHaveBeenCalledTimes(1);
    setItem.mockRestore();
    vi.useRealTimers();
  });

  it('keeps separate keys independent', () => {
    vi.useFakeTimers();
    const { result: files } = renderHook(() => usePaneLayout('files', [20, 80]));
    act(() => files.current.onLayout([30, 70]));
    act(() => { vi.advanceTimersByTime(400); });

    const { result: explorer } = renderHook(() => usePaneLayout('explorer', [18, 82]));
    expect(explorer.current.sizes).toEqual([18, 82]);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/paneLayout.test.tsx`
Expected: FAIL — cannot resolve `usePaneLayout`.

- [ ] **Step 3: Implement `usePaneLayout.ts`**

Create `src/renderer/shared/components/panes/usePaneLayout.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { readPref, writePref } from '@/renderer/shared/prefs/prefs';

/** Matches the debounce used for window bounds in main. */
const WRITE_DELAY_MS = 400;

function isValidLayout(candidate: unknown, expectedCount: number): candidate is number[] {
  return (
    Array.isArray(candidate) &&
    candidate.length === expectedCount &&
    candidate.every((size) => typeof size === 'number' && Number.isFinite(size))
  );
}

/**
 * Restores a pane layout synchronously on first render and persists changes.
 *
 * The pane count is part of validation: a stored two-pane layout applied to a
 * three-pane group produces a collapsed or overflowing layout that the user
 * cannot easily recover from, so a mismatch falls back to the defaults.
 *
 * Writes are debounced because react-resizable-panels reports a layout on every
 * animation frame of a drag.
 */
export function usePaneLayout(
  key: string,
  defaults: number[]
): { sizes: number[]; onLayout: (sizes: number[]) => void } {
  const prefKey = `pane.${key}`;

  const [sizes] = useState<number[]>(() => {
    const stored = readPref<unknown>(prefKey, null);
    return isValidLayout(stored, defaults.length) ? stored : defaults;
  });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onLayout = useCallback(
    (next: number[]) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => writePref(prefKey, next), WRITE_DELAY_MS);
    },
    [prefKey]
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // `sizes` is only ever the initial layout: react-resizable-panels owns the
  // live values after mount. Returning state here would fight it for control.
  return { sizes, onLayout };
}
```

- [ ] **Step 4: Implement `PaneHandle.tsx`**

Create `src/renderer/shared/components/panes/PaneHandle.tsx`:

```tsx
import React from 'react';
import { PanelResizeHandle } from 'react-resizable-panels';

/**
 * A 1px visual line inside a 9px grab target.
 *
 * The two are separated deliberately: a 1px hit area is close to unusable with
 * a trackpad, while a 9px visible divider looks like a gutter. The inner span
 * is what you see; the outer handle is what you can grab.
 */
export const PaneHandle: React.FC<{ direction?: 'horizontal' | 'vertical' }> = ({
  direction = 'horizontal',
}) => (
  <PanelResizeHandle
    data-testid="pane-handle"
    className={
      direction === 'horizontal'
        ? 'group relative flex w-[9px] -mx-1 items-stretch justify-center cursor-col-resize'
        : 'group relative flex h-[9px] -my-1 items-stretch justify-center cursor-row-resize'
    }
  >
    <span
      aria-hidden="true"
      className={
        (direction === 'horizontal' ? 'w-px h-full' : 'h-px w-full') +
        ' bg-border transition-colors duration-100' +
        ' group-hover:bg-[hsl(var(--primary)/0.7)]' +
        ' group-data-[resize-handle-state=drag]:bg-[hsl(var(--primary))]'
      }
    />
  </PanelResizeHandle>
);
```

- [ ] **Step 5: Implement `PaneGroup.tsx` and the barrel**

Create `src/renderer/shared/components/panes/PaneGroup.tsx`:

```tsx
import React from 'react';
import { PanelGroup } from 'react-resizable-panels';

interface PaneGroupProps {
  /** Stable identifier for this layout. Must match the usePaneLayout key. */
  layoutKey: string;
  /** From usePaneLayout. Persists the layout, debounced. */
  onLayout: (sizes: number[]) => void;
  direction?: 'horizontal' | 'vertical';
  className?: string;
  children: React.ReactNode;
}

/**
 * A PanelGroup wired for persistence.
 *
 * The caller owns the usePaneLayout hook rather than this component, because
 * each child Pane needs the restored size for its own defaultSize — and a
 * component cannot hand values to its own children's props. So the caller
 * calls the hook once, spends `sizes` on the Panes, and passes `onLayout` here.
 *
 * react-resizable-panels' own autoSaveId is deliberately unused: it writes
 * unversioned values under its own key, bypassing the fallback behaviour in
 * prefs.ts that stops a changed pane count from producing a broken layout.
 */
export const PaneGroup: React.FC<PaneGroupProps> = ({
  layoutKey,
  onLayout,
  direction = 'horizontal',
  className,
  children,
}) => (
  <PanelGroup
    direction={direction}
    onLayout={onLayout}
    className={className}
    id={`pane-group-${layoutKey}`}
    data-testid={`pane-group-${layoutKey}`}
  >
    {children}
  </PanelGroup>
);
```

Add the helper to the bottom of `usePaneLayout.ts`, so callers can read a restored size for a specific pane index:

```ts
/**
 * The restored size for one pane, for use as a Panel's defaultSize.
 * Falls back to the supplied default if the index is out of range.
 */
export function sizesFor(sizes: number[], index: number, fallback: number): number {
  const value = sizes[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
```

Create `src/renderer/shared/components/panes/index.ts`:

```ts
export { PaneGroup } from './PaneGroup';
export { PaneHandle } from './PaneHandle';
export { usePaneLayout, sizesFor } from './usePaneLayout';
export { Panel as Pane } from 'react-resizable-panels';
export type { ImperativePanelHandle } from 'react-resizable-panels';
```

- [ ] **Step 6: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/paneLayout.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/shared/components/panes/ src/tests/unit/paneLayout.test.tsx
git commit -m "feat(shell): add a reusable persisted pane system"
```

---

### Task 7: Adopt panes in `/files` and `/explorer`

The riskiest task in the plan: `DiskExplorer.tsx` is covered by many of the 348 existing tests. Update those tests; never delete them.

**Files:**
- Modify: `src/renderer/features/disk-explorer/components/DiskExplorer.tsx`
- Modify: `src/renderer/features/file-explorer-v2/components/ExplorerPanels.tsx`
- Test: `src/tests/unit/diskExplorerPanes.test.tsx`
- Test: update `src/tests/unit/diskExplorer.test.tsx` if it asserts on structure

**Interfaces:**
- Consumes: `PaneGroup`, `Pane`, `PaneHandle`, `sizesFor` (Task 6).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/diskExplorerPanes.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { DiskExplorer } from '@/renderer/features/disk-explorer/components/DiskExplorer';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';

beforeEach(() => {
  window.localStorage.clear();
  installDiskApi();
  useDiskStore.setState({
    roots: ['/V'],
    listings: { '/V': [entry({ path: '/V/a.md', name: 'a.md', kind: 'markdown' })] },
    selectedPath: null,
    selectedPaths: [],
  });
});

describe('DiskExplorer panes', () => {
  it('renders a persisted pane group', async () => {
    render(<DiskExplorer />);
    await waitFor(() =>
      expect(screen.getByTestId('pane-group-files')).toBeInTheDocument()
    );
  });

  it('renders a resize handle between panes', async () => {
    render(<DiskExplorer />);
    await waitFor(() =>
      expect(screen.getAllByTestId('pane-handle').length).toBeGreaterThanOrEqual(1)
    );
  });

  it('still renders the tree, folder view, and detail pane', async () => {
    render(<DiskExplorer />);
    // disk-tree-item-* comes from DiskTreeItem; detail-empty from DetailPane.
    await waitFor(() =>
      expect(screen.getByTestId('disk-tree-item-/V/a.md')).toBeInTheDocument()
    );
    expect(screen.getByTestId('detail-empty')).toBeInTheDocument();
  });

  it('still renders the open-folder action', async () => {
    render(<DiskExplorer />);
    await waitFor(() =>
      expect(screen.getByTestId('disk-explorer-open-folder')).toBeInTheDocument()
    );
  });
});
```

The testids used above were verified against the merged code:
`disk-tree-item-<path>` (`DiskTreeItem.tsx:68`), `detail-empty`
(`DetailPane.tsx:52`), `disk-explorer-open-folder` (`DiskExplorer.tsx:208`).
`DiskTree.tsx` itself only exposes `disk-tree-empty` and
`disk-tree-open-folder` — there is no plain `disk-tree` testid.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/diskExplorerPanes.test.tsx`
Expected: FAIL — no element with testid `pane-group-files`.

- [ ] **Step 3: Convert `DiskExplorer.tsx`**

Add the import:

```tsx
import { PaneGroup, Pane, PaneHandle, usePaneLayout, sizesFor } from '@/renderer/shared/components/panes';
```

`PaneGroup` renders the group; `usePaneLayout` is called here rather than inside
it because each `Pane` below needs its own restored size for `defaultSize`.

Add this line inside the component, beside the other hooks (after the `useDiskStore` selectors):

```tsx
  const { sizes, onLayout } = usePaneLayout('files', [20, 55, 25]);
```

Replace the entire returned JSX — from `<div className="flex h-full w-full overflow-hidden">` through its closing `</div>`, i.e. lines 198–246 of the merged file — with:

```tsx
  return (
    <div className="flex h-full w-full overflow-hidden">
      <PaneGroup layoutKey="files" onLayout={onLayout} className="flex-1">
        <Pane
          defaultSize={sizesFor(sizes, 0, 20)}
          minSize={12}
          maxSize={40}
          collapsible
          className="flex flex-col overflow-hidden border-r border-border/60"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 shrink-0">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Files
            </span>
            <button
              type="button"
              onClick={() => void openFolder()}
              aria-label="Open folder"
              data-testid="disk-explorer-open-folder"
              data-disk-shortcuts-ignore="true"
              className="rounded p-1 text-muted-foreground transition-colors duration-100 hover:bg-muted"
            >
              <FolderPlus className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-auto">
            <DiskTree />
          </div>
        </Pane>

        <PaneHandle />

        <Pane
          defaultSize={sizesFor(sizes, 1, 55)}
          minSize={30}
          className="flex min-w-0 flex-col overflow-hidden"
        >
          {error && <ErrorBanner message={error} />}
          {activeDirectory ? (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-border/60 shrink-0 min-w-0">
                <Breadcrumb dirPath={activeDirectory} />
                <Toolbar dirPath={activeDirectory} />
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <DiskFolderView dirPath={activeDirectory} />
              </div>
            </>
          ) : (
            <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
              Open a folder to get started
            </div>
          )}
        </Pane>

        <PaneHandle />

        <Pane
          defaultSize={sizesFor(sizes, 2, 25)}
          minSize={15}
          maxSize={50}
          collapsible
          className="overflow-hidden border-l border-border/60"
        >
          <DetailPane entry={selectedEntry} />
        </Pane>
      </PaneGroup>

      <QuickLook entry={selectedEntry} />
      <NameDialog />
      <ConfirmDeleteDialog />
    </div>
  );
```

No local wrapper is needed and `react-resizable-panels` is not imported directly
here — `PaneGroup` from Task 6 supplies the group, and `usePaneLayout` above
supplies both `sizes` (spent on each `Pane`'s `defaultSize`) and `onLayout`
(handed to `PaneGroup`).

- [ ] **Step 4: Run the pane test and the existing explorer tests together**

Run:
```bash
npx vitest run src/tests/unit/diskExplorerPanes.test.tsx src/tests/unit/diskExplorer.test.tsx
```
Expected: the new file PASSES, 4 tests. `diskExplorer.test.tsx` may fail if it asserts on the old `aside`/`section` structure. **Update those assertions to match the pane structure — do not delete the tests.** They cover behaviour (tree renders, open-folder works) that must survive the refactor.

- [ ] **Step 5: Run the whole suite and fix the fallout**

Run: `npm test`

Expect breakage in files that render `DiskExplorer` and assert on layout. Work through each, updating structural assertions only. If a test fails because a behaviour genuinely broke, fix `DiskExplorer.tsx`, not the test.

- [ ] **Step 6: Convert `ExplorerPanels.tsx`**

This is the file with the `useState(18)` bug. Replace lines 32–33:

```tsx
  const [leftSidebarSize, setLeftSidebarSize] = useState(18);
  const [rightSidebarSize, setRightSidebarSize] = useState(25);
```

with:

```tsx
  const { sizes, onLayout } = usePaneLayout('explorer', [18, 57, 25]);
```

Add the import:

```tsx
import { usePaneLayout, sizesFor, PaneHandle } from '@/renderer/shared/components/panes';
```

Delete the `handleResize` function (lines 69–78) — persistence now lives in the hook — and remove `useState` from the React import if it is no longer used.

Replace the local `ResizeHandle` component (lines 13–19) and its two usages with `<PaneHandle />`.

Update the `PanelGroup` and the two sized `Panel`s:

```tsx
    <PanelGroup direction="horizontal" className="h-screen w-screen" onLayout={onLayout}>
      <Panel
        ref={leftPanelRef}
        defaultSize={sizesFor(sizes, 0, 18)}
        minSize={10}
        maxSize={40}
        collapsible={true}
        onCollapse={() => handlePanelCollapse("leftSidebar")}
      >
```

```tsx
      <Panel
        ref={rightPanelRef}
        defaultSize={sizesFor(sizes, 2, 25)}
        minSize={15}
        maxSize={45}
        collapsible={true}
        onCollapse={() => handlePanelCollapse("rightSidebar")}
      >
```

Note the removed `onResize` props: `onLayout` on the group reports all three sizes at once, which is what the hook persists.

- [ ] **Step 7: Verify in the app**

Run: `npm run better-dev`

1. On `/files`, drag both handles. The cursor is `col-resize` and the divider highlights.
2. Navigate to `/explorer` and back to `/files`. **Sizes are preserved** — this is the `useState` bug, fixed.
3. Quit and relaunch. Sizes are still preserved.
4. Drag the folder-view pane narrow, then wide. The virtualized gallery **re-flows its columns** rather than keeping the mount-time count. This should already work: `DiskFolderView.tsx:44` measures through `useElementSize`, which uses a `ResizeObserver` (`hooks/useElementSize.ts:29`), and the column count is derived from `viewport.width` on every render (`DiskFolderView.tsx:78`). If it does *not* re-flow, the pane is not propagating its height or width — check that each `Pane` has `overflow-hidden` and a `min-h-0` descendant, rather than adding a second observer.
5. Collapse the tree pane by dragging it fully left, then drag it back.

- [ ] **Step 8: Confirm no new type errors, then commit**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -c 'error TS'
```
Expected: still `14`.

Run: `npm test`

```bash
git add src/renderer/features/disk-explorer/components/DiskExplorer.tsx \
        src/renderer/features/file-explorer-v2/components/ExplorerPanels.tsx \
        src/tests/
git commit -m "feat(shell): make every pane resizable and persistent"
```

---

# PHASE 3 — One shortcut map, and budgets that hold

---

### Task 8: Shared command identifiers and menu template

Pure logic, no Electron import, so it unit-tests directly. This is what stops the menu and the palette drifting apart.

**Files:**
- Create: `src/common/commandIds.ts`
- Create: `src/main/menu/menuTemplate.ts`
- Test: `src/tests/unit/menuTemplate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `COMMAND_IDS` — a frozen record of id constants
  - `interface MenuCommand { id: string; label: string; accelerator?: string }`
  - `buildMenuTemplate(commands: MenuCommand[], options: { appName: string }): MenuTemplateEntry[]`
  - `interface MenuTemplateEntry { label: string; submenu: Array<{ label?: string; role?: string; accelerator?: string; commandId?: string; type?: 'separator' }> }`

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/menuTemplate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildMenuTemplate, type MenuCommand } from '@/main/menu/menuTemplate';
import { COMMAND_IDS } from '@/common/commandIds';

const COMMANDS: MenuCommand[] = [
  { id: COMMAND_IDS.openSettings, label: 'Settings…', accelerator: 'CmdOrCtrl+,' },
  { id: COMMAND_IDS.openFolder, label: 'Open Folder…', accelerator: 'CmdOrCtrl+O' },
  { id: COMMAND_IDS.toggleLeftPane, label: 'Toggle Left Pane', accelerator: 'CmdOrCtrl+B' },
];

function build() {
  return buildMenuTemplate(COMMANDS, { appName: 'Opal' });
}

function labels(template: ReturnType<typeof build>) {
  return template.map((menu) => menu.label);
}

function findItem(template: ReturnType<typeof build>, commandId: string) {
  for (const menu of template) {
    for (const item of menu.submenu) {
      if (item.commandId === commandId) return item;
    }
  }
  return undefined;
}

describe('buildMenuTemplate', () => {
  it('produces the standard macOS menu spine', () => {
    expect(labels(build())).toEqual(['Opal', 'File', 'Edit', 'View', 'Window']);
  });

  it('puts the app menu first, named after the app', () => {
    expect(build()[0].label).toBe('Opal');
  });

  it('places Settings in the app menu with its accelerator', () => {
    const item = findItem(build(), COMMAND_IDS.openSettings);
    expect(item).toBeDefined();
    expect(item?.accelerator).toBe('CmdOrCtrl+,');
  });

  it('places Open Folder in the File menu', () => {
    const file = build().find((menu) => menu.label === 'File');
    expect(file?.submenu.some((item) => item.commandId === COMMAND_IDS.openFolder)).toBe(true);
  });

  it('places pane toggles in the View menu', () => {
    const view = build().find((menu) => menu.label === 'View');
    expect(view?.submenu.some((item) => item.commandId === COMMAND_IDS.toggleLeftPane)).toBe(true);
  });

  it('gives Edit the clipboard roles rather than custom handlers', () => {
    // Roles are what make Cmd+C/V/A work inside custom widgets. A hand-rolled
    // handler here would break text selection in the rename dialog.
    const edit = build().find((menu) => menu.label === 'Edit');
    const roles = edit?.submenu.map((item) => item.role).filter(Boolean);
    expect(roles).toEqual(
      expect.arrayContaining(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'])
    );
  });

  it('never emits an item that has neither a role nor a commandId', () => {
    // Such an item renders as a dead menu entry.
    for (const menu of build()) {
      for (const item of menu.submenu) {
        if (item.type === 'separator') continue;
        expect(Boolean(item.role || item.commandId)).toBe(true);
      }
    }
  });

  it('omits a command that is not supplied rather than emitting a dead entry', () => {
    const template = buildMenuTemplate(
      [{ id: COMMAND_IDS.openSettings, label: 'Settings…' }],
      { appName: 'Opal' }
    );
    expect(findItem(template, COMMAND_IDS.openFolder)).toBeUndefined();
  });

  it('uses each accelerator exactly once across the whole menu', () => {
    const seen = new Map<string, string>();
    for (const menu of build()) {
      for (const item of menu.submenu) {
        if (!item.accelerator) continue;
        expect(seen.has(item.accelerator)).toBe(false);
        seen.set(item.accelerator, item.label ?? item.role ?? '');
      }
    }
  });
});

describe('COMMAND_IDS', () => {
  it('has no duplicate values', () => {
    const values = Object.values(COMMAND_IDS);
    expect(new Set(values).size).toBe(values.length);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/menuTemplate.test.ts`
Expected: FAIL — cannot resolve `@/common/commandIds`.

- [ ] **Step 3: Implement `commandIds.ts`**

Create `src/common/commandIds.ts`:

```ts
/**
 * Command identifiers shared by the main-process menu and the renderer's
 * command palette.
 *
 * Lives in common/ precisely so both processes import the same constants: a
 * menu item whose id does not match a registered command is a dead entry that
 * no test in either process would otherwise catch.
 */
export const COMMAND_IDS = {
  openSettings: 'app.openSettings',
  openFolder: 'files.openFolder',
  toggleLeftPane: 'pane.toggleLeft',
  toggleRightPane: 'pane.toggleRight',
  toggleBottomPane: 'pane.toggleBottom',
  toggleTheme: 'theme.toggle',
} as const;

export type CommandId = (typeof COMMAND_IDS)[keyof typeof COMMAND_IDS];
```

Note `toggleLeftPane`, `toggleRightPane`, and `toggleBottomPane` reuse the exact id strings `App.tsx` already registers (`pane.toggleLeft`, `pane.toggleRight`, `pane.toggleBottom`). Do not renumber them; Task 9 depends on the match.

- [ ] **Step 4: Implement `menuTemplate.ts`**

Create `src/main/menu/menuTemplate.ts`:

```ts
import { COMMAND_IDS } from '@/common/commandIds';

export interface MenuCommand {
  id: string;
  label: string;
  accelerator?: string;
}

export interface MenuTemplateItem {
  label?: string;
  role?: string;
  accelerator?: string;
  /** Set when selecting this item should dispatch a renderer command. */
  commandId?: string;
  type?: 'separator';
}

export interface MenuTemplateEntry {
  label: string;
  submenu: MenuTemplateItem[];
}

/**
 * Turns the registered command list into an Electron menu template.
 *
 * Free of any Electron import so it can be unit-tested. AppMenu.ts converts the
 * result into a real Menu.
 *
 * A command that was not supplied is omitted entirely rather than rendered
 * disabled: a greyed-out entry implies "not right now", but the real cause is
 * that the renderer never registered it, which the user cannot act on.
 */
export function buildMenuTemplate(
  commands: MenuCommand[],
  options: { appName: string }
): MenuTemplateEntry[] {
  const byId = new Map(commands.map((command) => [command.id, command]));

  const item = (id: string): MenuTemplateItem[] => {
    const command = byId.get(id);
    if (!command) return [];
    return [{ label: command.label, accelerator: command.accelerator, commandId: command.id }];
  };

  return [
    {
      label: options.appName,
      submenu: [
        { role: 'about', label: `About ${options.appName}` },
        { type: 'separator' },
        ...item(COMMAND_IDS.openSettings),
        { type: 'separator' },
        { role: 'hide', label: `Hide ${options.appName}` },
        { role: 'hideOthers', label: 'Hide Others' },
        { role: 'unhide', label: 'Show All' },
        { type: 'separator' },
        { role: 'quit', label: `Quit ${options.appName}` },
      ],
    },
    {
      label: 'File',
      submenu: [
        ...item(COMMAND_IDS.openFolder),
        { type: 'separator' },
        { role: 'close', label: 'Close Window' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', label: 'Undo' },
        { role: 'redo', label: 'Redo' },
        { type: 'separator' },
        { role: 'cut', label: 'Cut' },
        { role: 'copy', label: 'Copy' },
        { role: 'paste', label: 'Paste' },
        { role: 'selectAll', label: 'Select All' },
      ],
    },
    {
      label: 'View',
      submenu: [
        ...item(COMMAND_IDS.toggleLeftPane),
        ...item(COMMAND_IDS.toggleRightPane),
        ...item(COMMAND_IDS.toggleBottomPane),
        { type: 'separator' },
        ...item(COMMAND_IDS.toggleTheme),
        { type: 'separator' },
        { role: 'reload', label: 'Reload' },
        { role: 'toggleDevTools', label: 'Toggle Developer Tools' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Actual Size' },
        { role: 'zoomIn', label: 'Zoom In' },
        { role: 'zoomOut', label: 'Zoom Out' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Toggle Full Screen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize', label: 'Minimize' },
        { role: 'zoom', label: 'Zoom' },
        { type: 'separator' },
        { role: 'front', label: 'Bring All to Front' },
      ],
    },
  ];
}
```

- [ ] **Step 5: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/menuTemplate.test.ts`
Expected: PASS, 10 tests.

If the "accelerator exactly once" test fails, two commands were given the same accelerator — change one in the caller, not in the test.

- [ ] **Step 6: Commit**

```bash
git add src/common/commandIds.ts src/main/menu/menuTemplate.ts src/tests/unit/menuTemplate.test.ts
git commit -m "feat(shell): add a shared command id and menu template layer"
```

---

### Task 9: Install the native menu

**Files:**
- Create: `src/main/menu/AppMenu.ts`
- Modify: `src/main.ts`
- Modify: `src/preload.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/shared/types/index.ts` — the `systemAPI` declaration
- Test: `src/tests/unit/appMenu.test.ts`

**Interfaces:**
- Consumes: `buildMenuTemplate`, `COMMAND_IDS` (Task 8).
- Produces:
  - `class AppMenu` with `constructor(deps: { menu, appName, send })`, `install(commands: MenuCommand[]): void`
  - IPC: `menu:commands` (renderer → main, reports registered commands), `menu:invoke` (main → renderer, dispatches a command id)
  - `window.systemAPI.reportCommands(commands)`, `window.systemAPI.onMenuCommand(handler)`

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/appMenu.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppMenu } from '@/main/menu/AppMenu';
import { COMMAND_IDS } from '@/common/commandIds';

interface FakeMenuItem {
  label?: string;
  role?: string;
  accelerator?: string;
  click?: () => void;
  type?: string;
  submenu?: FakeMenuItem[];
}

let built: FakeMenuItem[] | null;
let applied: FakeMenuItem[] | null;
let sent: string[];

const menuStub = {
  buildFromTemplate: vi.fn((template: FakeMenuItem[]) => {
    built = template;
    return template;
  }),
  setApplicationMenu: vi.fn((template: FakeMenuItem[]) => {
    applied = template;
  }),
};

function makeMenu() {
  return new AppMenu({
    menu: menuStub,
    appName: 'Opal',
    send: (id: string) => sent.push(id),
  });
}

const COMMANDS = [
  { id: COMMAND_IDS.openSettings, label: 'Settings…', accelerator: 'CmdOrCtrl+,' },
  { id: COMMAND_IDS.openFolder, label: 'Open Folder…', accelerator: 'CmdOrCtrl+O' },
];

beforeEach(() => {
  built = null;
  applied = null;
  sent = [];
  vi.clearAllMocks();
});

function allItems(template: FakeMenuItem[]): FakeMenuItem[] {
  return template.flatMap((menu) => menu.submenu ?? []);
}

describe('AppMenu', () => {
  it('installs a menu built from the template', () => {
    makeMenu().install(COMMANDS);
    expect(menuStub.buildFromTemplate).toHaveBeenCalledTimes(1);
    expect(menuStub.setApplicationMenu).toHaveBeenCalledTimes(1);
    expect(applied).toBe(built);
  });

  it('gives every command-backed item a click handler', () => {
    makeMenu().install(COMMANDS);
    const settings = allItems(built!).find((item) => item.label === 'Settings…');
    expect(typeof settings?.click).toBe('function');
  });

  it('sends the command id to the renderer when an item is clicked', () => {
    makeMenu().install(COMMANDS);
    const settings = allItems(built!).find((item) => item.label === 'Settings…');
    settings?.click?.();
    expect(sent).toEqual([COMMAND_IDS.openSettings]);
  });

  it('does not attach a click handler to a role-based item', () => {
    // Attaching one overrides the role and breaks the native behaviour.
    makeMenu().install(COMMANDS);
    const copy = allItems(built!).find((item) => item.role === 'copy');
    expect(copy?.click).toBeUndefined();
  });

  it('strips the internal commandId before handing the template to Electron', () => {
    makeMenu().install(COMMANDS);
    for (const item of allItems(built!)) {
      expect(item).not.toHaveProperty('commandId');
    }
  });

  it('replaces the previous menu when installed again', () => {
    const menu = makeMenu();
    menu.install(COMMANDS);
    menu.install([{ id: COMMAND_IDS.openFolder, label: 'Open Folder…' }]);

    expect(menuStub.setApplicationMenu).toHaveBeenCalledTimes(2);
    expect(allItems(built!).some((item) => item.label === 'Settings…')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/appMenu.test.ts`
Expected: FAIL — cannot resolve `@/main/menu/AppMenu`.

- [ ] **Step 3: Implement `AppMenu.ts`**

Create `src/main/menu/AppMenu.ts`:

```ts
import { buildMenuTemplate, type MenuCommand, type MenuTemplateItem } from './menuTemplate';

/**
 * The subset of Electron's Menu that this class uses. Declaring it structurally
 * rather than importing Electron is what lets the class be unit-tested.
 */
export interface MenuLike {
  buildFromTemplate: (template: unknown[]) => unknown;
  setApplicationMenu: (menu: unknown) => void;
}

export interface AppMenuDependencies {
  menu: MenuLike;
  appName: string;
  /** Dispatches a command id to the focused renderer. */
  send: (commandId: string) => void;
}

export class AppMenu {
  private deps: AppMenuDependencies;

  constructor(deps: AppMenuDependencies) {
    this.deps = deps;
  }

  /**
   * Rebuilds and installs the application menu.
   *
   * Called again whenever the renderer's command list changes, because a
   * command registered after startup would otherwise never gain a menu entry.
   */
  install(commands: MenuCommand[]): void {
    const template = buildMenuTemplate(commands, { appName: this.deps.appName });

    const electronTemplate = template.map((entry) => ({
      label: entry.label,
      submenu: entry.submenu.map((item) => this.toElectronItem(item)),
    }));

    const menu = this.deps.menu.buildFromTemplate(electronTemplate);
    this.deps.menu.setApplicationMenu(menu);
  }

  private toElectronItem(item: MenuTemplateItem): Record<string, unknown> {
    // commandId is internal bookkeeping; Electron would reject the unknown key.
    const { commandId, ...rest } = item;
    if (!commandId) return { ...rest };

    return {
      ...rest,
      click: () => this.deps.send(commandId),
    };
  }
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/appMenu.test.ts`
Expected: PASS, 6 tests.

The "strips commandId" test will fail if `toElectronItem` spreads `item` wholesale — the destructuring is what removes it.

- [ ] **Step 5: Wire the IPC in both directions**

In `src/preload.ts`, add to `systemAPI`:

```ts
  reportCommands: (commands: Array<{ id: string; label: string; accelerator?: string }>) =>
    ipcRenderer.send("menu:commands", commands),
  onMenuCommand: (handler: (commandId: string) => void) => {
    const listener = (_event: IpcRendererEvent, commandId: string) => handler(commandId);
    ipcRenderer.on("menu:invoke", listener);
    return () => ipcRenderer.removeListener("menu:invoke", listener);
  },
```

Add both to the `SystemAPI` interface in `src/renderer/shared/types/index.ts`:

```ts
  reportCommands: (commands: Array<{ id: string; label: string; accelerator?: string }>) => void;
  onMenuCommand: (handler: (commandId: string) => void) => () => void;
```

In `src/main.ts`, add the import and construct the menu after `mainWindow` exists. Place this inside `createWindow`, after the `ready-to-show` handler:

```ts
import { Menu } from "electron";
import { AppMenu } from "@/main/menu/AppMenu";
```

```ts
const appMenu = new AppMenu({
  menu: Menu,
  appName: app.getName(),
  send: (commandId) => {
    BrowserWindow.getFocusedWindow()?.webContents.send("menu:invoke", commandId);
  },
});

// Install an empty menu immediately so the app never shows Electron's stock
// developer menu, even for the moment before the renderer reports its commands.
appMenu.install([]);

ipcMain.on("menu:commands", (_event, commands) => {
  appMenu.install(Array.isArray(commands) ? commands : []);
});
```

Put the `appMenu` construction and the `ipcMain.on` at module scope near the other handler constructions (around line 216), not inside `createWindow` — otherwise reopening the window from the dock registers a duplicate listener.

- [ ] **Step 6: Report commands and handle dispatch in `App.tsx`**

In `src/renderer/App.tsx`, add the import:

```tsx
import { COMMAND_IDS } from "@/common/commandIds";
```

Give the existing commands their accelerators and ids. Replace the `commands` array inside the existing `useEffect` with:

```tsx
    const commands: Command[] = [
      {
        id: COMMAND_IDS.toggleLeftPane,
        name: "Toggle Left Pane",
        type: "paneToggle",
        shortcut: ["CmdOrCtrl+B"],
        keywords: ["pane", "toggle"],
        perform: toggleLeftSidebar,
      },
      {
        id: COMMAND_IDS.toggleRightPane,
        name: "Toggle Right Pane",
        type: "paneToggle",
        shortcut: ["CmdOrCtrl+Alt+B"],
        keywords: ["pane", "toggle"],
        perform: toggleRightSidebar,
      },
      {
        id: COMMAND_IDS.toggleBottomPane,
        name: "Toggle Bottom Pane",
        type: "paneToggle",
        shortcut: ["CmdOrCtrl+J"],
        keywords: ["pane", "toggle"],
        perform: toggleBottomPane,
      },
      {
        id: COMMAND_IDS.openFolder,
        name: "Open Folder on Disk",
        type: "navigation",
        shortcut: ["CmdOrCtrl+O"],
        keywords: ["files", "folder", "open", "disk"],
        perform: () => { void useDiskStore.getState().openFolder(); },
      },
    ];

    commands.forEach(registerCommand);

    // Tell main what exists, so the menu and the palette can never disagree.
    window.systemAPI.reportCommands(
      commands.map((command) => ({
        id: command.id,
        label: command.name,
        accelerator: command.shortcut?.[0],
      }))
    );

    return () => {
      commands.forEach((command) => unregisterCommand(command));
    };
```

Add a second effect that runs the command when the menu dispatches it:

```tsx
  useEffect(() => {
    return window.systemAPI.onMenuCommand((commandId) => {
      // Settings is a route, not a registered command, so it is handled here.
      if (commandId === COMMAND_IDS.openSettings) {
        window.location.hash = "#/settings";
        return;
      }
      try {
        commandRegistry.executeCommand(commandId);
      } catch (error) {
        console.warn(`Menu dispatched an unknown command: ${commandId}`, error);
      }
    });
  }, []);
```

Add the registry import:

```tsx
import { commandRegistry } from "@/renderer/features/commands/services/commandRegistry";
```

Register the Settings command so it appears in the menu. Add it to the `commands` array above:

```tsx
      {
        id: COMMAND_IDS.openSettings,
        name: "Settings…",
        type: "navigation",
        shortcut: ["CmdOrCtrl+,"],
        keywords: ["settings", "preferences"],
        perform: () => { window.location.hash = "#/settings"; },
      },
```

With that registered, simplify the dispatch effect to just the `executeCommand` call in its `try`.

- [ ] **Step 7: Verify the IPC contract test**

Run: `npx vitest run src/tests/unit/ipcContract.test.ts`
Expected: PASS. `menu:commands` needs the `ipcMain.on` from Step 5; `menu:invoke` flows main → renderer so it has no handler to register — if the contract test flags it, check how it treats `ipcRenderer.on` channels and follow the existing precedent set by `disk:changed` in `preload.ts`.

- [ ] **Step 8: Verify in the app**

Run: `npm run better-dev`

1. The menu bar reads **Opal, File, Edit, View, Window** — not Electron's stock menu.
2. `Cmd+,` opens Settings.
3. `Cmd+O` opens the folder picker.
4. `Cmd+B` toggles the left pane, from the keyboard and from View.
5. Click into the filter box on `/files`, type, select with `Cmd+A`, then `Cmd+C`. **Selection and copy affect the text field, not the file grid.** This is the regression the Edit roles exist to prevent — the merged `DiskExplorer.tsx` binds `Cmd+A` to select-all-files at line 157, and its `INPUT`/`TEXTAREA` guard must still win.
6. Open the rename dialog on a file and confirm `Cmd+A` selects the filename text.

- [ ] **Step 9: Full suite and commit**

Run: `npm test`
Run: `npx tsc --noEmit 2>&1 | grep -c 'error TS'` — expected: still `14`.

```bash
git add src/main/menu/ src/main.ts src/preload.ts src/renderer/App.tsx \
        src/renderer/shared/types/ src/tests/unit/appMenu.test.ts
git commit -m "feat(shell): install a native menu driven by the command registry"
```

---

### Task 10: Performance budgets

Turns "snappy" into a number that fails a build.

**Files:**
- Create: `src/renderer/shared/perf/marks.ts`
- Create: `src/tests/perf/budgets.test.ts`
- Modify: `src/renderer.tsx`

**Interfaces:**
- Consumes: `sortEntries`, `filterEntries` (merged, in `src/common/`).
- Produces:
  - `mark(name: string): void`
  - `measure(name: string, from: string, to: string): number | null`
  - `BUDGETS` — the frozen budget table

- [ ] **Step 1: Write the failing test**

Create `src/tests/perf/budgets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BUDGETS } from '@/renderer/shared/perf/marks';
import { sortEntries } from '@/common/sortEntries';
import { filterEntries } from '@/common/filterEntries';
import type { DiskEntry } from '@/types/disk';

function makeEntries(count: number): DiskEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `/V/file-${index}.txt`,
    name: `file-${String(index).padStart(5, '0')}.txt`,
    isDirectory: index % 100 === 0,
    kind: 'text',
    size: index * 13,
    mtimeMs: 1_700_000_000_000 + index,
  })) as DiskEntry[];
}

/** Median of several runs — a single timing on a shared CI runner is noise. */
function medianMs(run: () => void, iterations = 7): number {
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

describe('budget table', () => {
  it('declares every budget the design approved', () => {
    expect(BUDGETS.coldLaunchMs).toBe(400);
    expect(BUDGETS.routeSwitchMs).toBe(50);
    expect(BUDGETS.listingMs).toBe(150);
    expect(BUDGETS.keystrokeMs).toBe(16);
  });
});

describe('listing budget', () => {
  const entries = makeEntries(5000);

  it('sorts 5,000 entries by name within the listing budget', () => {
    const elapsed = medianMs(() => sortEntries(entries, 'name', 'asc'));
    expect(elapsed).toBeLessThan(BUDGETS.listingMs);
  });

  it('sorts 5,000 entries by size within the listing budget', () => {
    const elapsed = medianMs(() => sortEntries(entries, 'size', 'desc'));
    expect(elapsed).toBeLessThan(BUDGETS.listingMs);
  });

  it('sorts 5,000 entries by modified date within the listing budget', () => {
    const elapsed = medianMs(() => sortEntries(entries, 'modified', 'desc'));
    expect(elapsed).toBeLessThan(BUDGETS.listingMs);
  });
});

describe('keystroke budget', () => {
  const entries = makeEntries(5000);

  it('filters 5,000 entries within the keystroke budget', () => {
    // Every keystroke in the filter box re-runs this. Exceeding 16ms means
    // dropping a frame per character typed.
    const elapsed = medianMs(() => filterEntries(entries, 'file-4'));
    expect(elapsed).toBeLessThan(BUDGETS.keystrokeMs);
  });

  it('filters with a no-match term within the keystroke budget', () => {
    const elapsed = medianMs(() => filterEntries(entries, 'zzzzz-no-match'));
    expect(elapsed).toBeLessThan(BUDGETS.keystrokeMs);
  });

  it('runs filter then sort — the real per-keystroke path — within budget', () => {
    const elapsed = medianMs(() =>
      sortEntries(filterEntries(entries, 'file-1'), 'name', 'asc')
    );
    expect(elapsed).toBeLessThan(BUDGETS.keystrokeMs * 4);
  });
});
```

Check the real signatures before running — `sortEntries` field names and `DiskEntry`'s date field come from the merged code:

```bash
grep -n "export function sortEntries\|export type SortField" src/common/sortEntries.ts
grep -n "export function filterEntries" src/common/filterEntries.ts
grep -n "interface DiskEntry" -A 12 src/types/disk.ts
```

Adjust the fixture and the `sortEntries` arguments to match. Do not change the budget numbers.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/perf/budgets.test.ts`
Expected: FAIL — cannot resolve `@/renderer/shared/perf/marks`.

- [ ] **Step 3: Implement `marks.ts`**

Create `src/renderer/shared/perf/marks.ts`:

```ts
/**
 * Performance budgets and the marks that measure them.
 *
 * The numbers come from the design doc and are not to be relaxed to make a
 * failing test pass — a missed budget means the code got slower, which is the
 * signal this file exists to produce.
 */
export const BUDGETS = {
  /** App launch to the first meaningful paint. */
  coldLaunchMs: 400,
  /** Switching between /files and /explorer. */
  routeSwitchMs: 50,
  /** Sorting and rendering a 5,000-entry directory listing. */
  listingMs: 150,
  /** One keystroke in a filter or search box — one 60fps frame. */
  keystrokeMs: 16,
} as const;

const supported = typeof performance !== 'undefined' && typeof performance.mark === 'function';

export function mark(name: string): void {
  if (!supported) return;
  try {
    performance.mark(name);
  } catch {
    // Marking must never be able to break a render.
  }
}

/**
 * Milliseconds between two marks, or null if either is missing.
 * Reading this in DevTools is the intended use; the budget test measures the
 * pure functions directly, which is far less noisy than measuring a render.
 */
export function measure(name: string, from: string, to: string): number | null {
  if (!supported) return null;
  try {
    performance.measure(name, from, to);
    const entries = performance.getEntriesByName(name, 'measure');
    const latest = entries[entries.length - 1];
    return latest ? latest.duration : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Mark the launch path**

In `src/renderer.tsx`, add the first mark before the render and the second after mount:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/renderer/App";
import "@/renderer/styles/index.css";
import { mark, measure } from "@/renderer/shared/perf/marks";

mark("opal:render-start");

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// requestAnimationFrame fires after the first paint, so this measures time to
// something the user can actually see rather than time to mount.
requestAnimationFrame(() => {
  mark("opal:first-paint");
  const elapsed = measure("opal:launch", "opal:render-start", "opal:first-paint");
  if (elapsed !== null) {
    console.info(`[perf] renderer first paint: ${elapsed.toFixed(1)}ms`);
  }
});
```

- [ ] **Step 5: Confirm the perf directory is already collected**

`vitest.config.ts` includes `src/tests/**/*.{test,spec}.{ts,tsx}`, which already
covers `src/tests/perf/`. Confirm rather than change:

```bash
grep -n "include" vitest.config.ts
```
Expected: `include: ['src/tests/**/*.{test,spec}.{ts,tsx}']`. **No edit needed.**
Remove `vitest.config.ts` from this task's file list and from the Step 8 `git add`.

- [ ] **Step 6: Run and confirm it passes**

Run: `npx vitest run src/tests/perf/budgets.test.ts`
Expected: PASS, 8 tests.

If a budget test fails, the pure function is genuinely too slow. Fix the function. Do not raise the number.

- [ ] **Step 7: Verify the launch number in the app**

Run: `npm run better-dev`

Open DevTools. The console shows `[perf] renderer first paint: NNNms`. Record it. If it exceeds 400ms, note the figure in the commit message — Phase 3 does not include optimising it, but the number needs to be known before anyone claims the app is fast.

- [ ] **Step 8: Full suite and commit**

Run: `npm test`

```bash
git add src/renderer/shared/perf/ src/tests/perf/ src/renderer.tsx
git commit -m "test(perf): add enforced performance budgets"
```

---

# PHASE 4 — Tabs

---

### Task 11: The tabs store

Pure state, no UI. `DetailPane` already exists, so this is the only new logic tabs need.

**Files:**
- Create: `src/renderer/features/disk-explorer/store/tabsStore.ts`
- Test: `src/tests/unit/tabsStore.test.ts`

**Interfaces:**
- Consumes: `readPref`, `writePref` (Task 1).
- Produces:
  - `interface TabsState { openPaths: string[]; activePath: string | null; previewPath: string | null }`
  - `useTabsStore` with `openPreview(path)`, `openPinned(path)`, `pin(path)`, `close(path)`, `closeAll()`, `activate(path)`, `move(from, to)`, `activateIndex(index)`, `activateNext()`, `activatePrevious()`

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/tabsStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';

const A = '/V/a.md';
const B = '/V/b.png';
const C = '/V/c.pdf';

beforeEach(() => {
  window.localStorage.clear();
  useTabsStore.setState({ openPaths: [], activePath: null, previewPath: null });
});

const state = () => useTabsStore.getState();

describe('preview tabs', () => {
  it('opens a preview tab and activates it', () => {
    state().openPreview(A);
    expect(state().openPaths).toEqual([A]);
    expect(state().activePath).toBe(A);
    expect(state().previewPath).toBe(A);
  });

  it('replaces the preview tab rather than accumulating tabs', () => {
    state().openPreview(A);
    state().openPreview(B);
    // Single-clicking through a folder must not leave a trail of tabs.
    expect(state().openPaths).toEqual([B]);
    expect(state().previewPath).toBe(B);
  });

  it('keeps a preview tab in place when it is pinned', () => {
    state().openPreview(A);
    state().pin(A);
    state().openPreview(B);
    expect(state().openPaths).toEqual([A, B]);
    expect(state().previewPath).toBe(B);
  });

  it('opens a pinned tab directly without touching the preview slot', () => {
    state().openPreview(A);
    state().openPinned(B);
    expect(state().openPaths).toEqual([A, B]);
    expect(state().previewPath).toBe(A);
    expect(state().activePath).toBe(B);
  });

  it('activates an already-open tab instead of duplicating it', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().openPinned(A);
    expect(state().openPaths).toEqual([A, B]);
    expect(state().activePath).toBe(A);
  });

  it('promotes the preview tab when the same path is opened pinned', () => {
    state().openPreview(A);
    state().openPinned(A);
    expect(state().openPaths).toEqual([A]);
    expect(state().previewPath).toBeNull();
  });
});

describe('closing', () => {
  it('removes a tab', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().close(A);
    expect(state().openPaths).toEqual([B]);
  });

  it('activates the neighbour to the right when the active tab closes', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().openPinned(C);
    state().activate(B);
    state().close(B);
    expect(state().activePath).toBe(C);
  });

  it('activates the neighbour to the left when the last tab closes', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().close(B);
    expect(state().activePath).toBe(A);
  });

  it('leaves nothing active when the final tab closes', () => {
    state().openPinned(A);
    state().close(A);
    expect(state().openPaths).toEqual([]);
    expect(state().activePath).toBeNull();
  });

  it('clears the preview slot when the preview tab closes', () => {
    state().openPreview(A);
    state().close(A);
    expect(state().previewPath).toBeNull();
  });

  it('does not change the active tab when a different tab closes', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().activate(A);
    state().close(B);
    expect(state().activePath).toBe(A);
  });

  it('ignores closing a path that is not open', () => {
    state().openPinned(A);
    state().close('/V/nope.txt');
    expect(state().openPaths).toEqual([A]);
  });

  it('closeAll empties everything', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().closeAll();
    expect(state().openPaths).toEqual([]);
    expect(state().activePath).toBeNull();
    expect(state().previewPath).toBeNull();
  });
});

describe('ordering and selection', () => {
  it('moves a tab to a new index', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().openPinned(C);
    state().move(0, 2);
    expect(state().openPaths).toEqual([B, C, A]);
  });

  it('ignores a move with an out-of-range index', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().move(0, 9);
    expect(state().openPaths).toEqual([A, B]);
  });

  it('activates by index for Cmd+1..9', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().activateIndex(0);
    expect(state().activePath).toBe(A);
  });

  it('ignores an index beyond the open tabs', () => {
    state().openPinned(A);
    state().activate(A);
    state().activateIndex(5);
    expect(state().activePath).toBe(A);
  });

  it('cycles forward and wraps', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().activate(B);
    state().activateNext();
    expect(state().activePath).toBe(A);
  });

  it('cycles backward and wraps', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().activate(A);
    state().activatePrevious();
    expect(state().activePath).toBe(B);
  });

  it('does nothing when cycling with no tabs open', () => {
    state().activateNext();
    expect(state().activePath).toBeNull();
  });
});

describe('persistence', () => {
  it('restores open tabs into a fresh store', () => {
    state().openPinned(A);
    state().openPinned(B);

    const restored = useTabsStore.getState().hydrate();
    expect(restored.openPaths).toEqual([A, B]);
  });

  it('does not persist the preview tab', () => {
    // A preview tab is transient by definition; restoring one on launch would
    // reopen a file the user only glanced at.
    state().openPreview(A);
    const restored = useTabsStore.getState().hydrate();
    expect(restored.openPaths).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/tabsStore.test.ts`
Expected: FAIL — cannot resolve `tabsStore`.

- [ ] **Step 3: Implement**

Create `src/renderer/features/disk-explorer/store/tabsStore.ts`:

```ts
import { create } from 'zustand';
import { readPref, writePref } from '@/renderer/shared/prefs/prefs';

const PREF_KEY = 'tabs.open';

export interface TabsState {
  /** Open tabs, left to right. */
  openPaths: string[];
  activePath: string | null;
  /**
   * The single italic "preview" tab, replaced by the next single-click.
   * Finder and VS Code both work this way: browsing must not litter the strip.
   */
  previewPath: string | null;
}

export interface TabsActions {
  openPreview: (path: string) => void;
  openPinned: (path: string) => void;
  pin: (path: string) => void;
  close: (path: string) => void;
  closeAll: () => void;
  activate: (path: string) => void;
  activateIndex: (index: number) => void;
  activateNext: () => void;
  activatePrevious: () => void;
  move: (from: number, to: number) => void;
  hydrate: () => TabsState;
}

export type TabsStore = TabsState & TabsActions;

/** Only pinned tabs persist — see the "does not persist the preview tab" test. */
function persist(state: TabsState): void {
  writePref(
    PREF_KEY,
    state.openPaths.filter((path) => path !== state.previewPath)
  );
}

function restoredPaths(): string[] {
  const stored = readPref<unknown>(PREF_KEY, null);
  if (!Array.isArray(stored)) return [];
  return stored.filter((path): path is string => typeof path === 'string');
}

export const useTabsStore = create<TabsStore>((set, get) => ({
  openPaths: [],
  activePath: null,
  previewPath: null,

  openPreview: (path) =>
    set((state) => {
      if (state.openPaths.includes(path)) {
        return { activePath: path };
      }

      // Swap the outgoing preview in place so the tab does not jump position.
      const openPaths = state.previewPath
        ? state.openPaths.map((open) => (open === state.previewPath ? path : open))
        : [...state.openPaths, path];

      const next = { openPaths, activePath: path, previewPath: path };
      persist({ ...state, ...next });
      return next;
    }),

  openPinned: (path) =>
    set((state) => {
      const alreadyOpen = state.openPaths.includes(path);
      const openPaths = alreadyOpen ? state.openPaths : [...state.openPaths, path];
      // Opening pinned what was previewed promotes it rather than duplicating.
      const previewPath = state.previewPath === path ? null : state.previewPath;

      const next = { openPaths, activePath: path, previewPath };
      persist({ ...state, ...next });
      return next;
    }),

  pin: (path) =>
    set((state) => {
      if (state.previewPath !== path) return {};
      const next = { previewPath: null };
      persist({ ...state, ...next });
      return next;
    }),

  close: (path) =>
    set((state) => {
      const index = state.openPaths.indexOf(path);
      if (index === -1) return {};

      const openPaths = state.openPaths.filter((open) => open !== path);
      const previewPath = state.previewPath === path ? null : state.previewPath;

      let activePath = state.activePath;
      if (state.activePath === path) {
        // Prefer the tab to the right, matching every editor's behaviour.
        activePath = openPaths[index] ?? openPaths[index - 1] ?? null;
      }

      const next = { openPaths, activePath, previewPath };
      persist({ ...state, ...next });
      return next;
    }),

  closeAll: () => {
    const next = { openPaths: [], activePath: null, previewPath: null };
    persist(next);
    set(next);
  },

  activate: (path) =>
    set((state) => (state.openPaths.includes(path) ? { activePath: path } : {})),

  activateIndex: (index) =>
    set((state) => {
      const path = state.openPaths[index];
      return path ? { activePath: path } : {};
    }),

  activateNext: () =>
    set((state) => {
      if (state.openPaths.length === 0) return {};
      const current = state.activePath ? state.openPaths.indexOf(state.activePath) : -1;
      const nextIndex = (current + 1) % state.openPaths.length;
      return { activePath: state.openPaths[nextIndex] };
    }),

  activatePrevious: () =>
    set((state) => {
      if (state.openPaths.length === 0) return {};
      const current = state.activePath ? state.openPaths.indexOf(state.activePath) : 0;
      const previousIndex =
        (current - 1 + state.openPaths.length) % state.openPaths.length;
      return { activePath: state.openPaths[previousIndex] };
    }),

  move: (from, to) =>
    set((state) => {
      const count = state.openPaths.length;
      if (from < 0 || to < 0 || from >= count || to >= count) return {};

      const openPaths = [...state.openPaths];
      const [moved] = openPaths.splice(from, 1);
      openPaths.splice(to, 0, moved);

      const next = { openPaths };
      persist({ ...state, ...next });
      return next;
    }),

  hydrate: () => {
    const openPaths = restoredPaths();
    const next: TabsState = {
      openPaths,
      activePath: openPaths[0] ?? null,
      previewPath: null,
    };
    set(next);
    return next;
  },
}));
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/tabsStore.test.ts`
Expected: PASS, 24 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/features/disk-explorer/store/tabsStore.ts src/tests/unit/tabsStore.test.ts
git commit -m "feat(files): add a tabs store with preview-tab semantics"
```

---

### Task 12: The tab strip

**Files:**
- Create: `src/renderer/features/disk-explorer/components/TabStrip.tsx`
- Modify: `src/renderer/features/disk-explorer/components/DiskExplorer.tsx`
- Test: `src/tests/unit/tabStrip.test.tsx`

**Interfaces:**
- Consumes: `useTabsStore` (Task 11), `DetailPane` (merged), `useDiskStore` (merged).
- Produces: `<TabStrip />`

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/tabStrip.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { TabStrip } from '@/renderer/features/disk-explorer/components/TabStrip';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { installDiskApi } from '@/tests/helpers/diskApi';

const A = '/V/alpha.md';
const B = '/V/beta.png';

beforeEach(() => {
  window.localStorage.clear();
  installDiskApi();
  useTabsStore.setState({ openPaths: [], activePath: null, previewPath: null });
});

describe('TabStrip', () => {
  it('renders nothing when no tabs are open', () => {
    render(<TabStrip />);
    expect(screen.queryByTestId('tab-strip')).not.toBeInTheDocument();
  });

  it('renders one tab per open path, labelled by basename', () => {
    useTabsStore.setState({ openPaths: [A, B], activePath: A, previewPath: null });
    render(<TabStrip />);

    expect(screen.getByTestId('tab-strip')).toBeInTheDocument();
    expect(screen.getByText('alpha.md')).toBeInTheDocument();
    expect(screen.getByText('beta.png')).toBeInTheDocument();
  });

  it('marks the active tab for assistive tech', () => {
    useTabsStore.setState({ openPaths: [A, B], activePath: B, previewPath: null });
    render(<TabStrip />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('activates a tab when clicked', async () => {
    const user = userEvent.setup();
    useTabsStore.setState({ openPaths: [A, B], activePath: A, previewPath: null });
    render(<TabStrip />);

    await user.click(screen.getByText('beta.png'));
    expect(useTabsStore.getState().activePath).toBe(B);
  });

  it('pins a preview tab on double click', async () => {
    const user = userEvent.setup();
    useTabsStore.setState({ openPaths: [A], activePath: A, previewPath: A });
    render(<TabStrip />);

    await user.dblClick(screen.getByText('alpha.md'));
    expect(useTabsStore.getState().previewPath).toBeNull();
  });

  it('closes a tab from its close button without activating it', async () => {
    const user = userEvent.setup();
    useTabsStore.setState({ openPaths: [A, B], activePath: A, previewPath: null });
    render(<TabStrip />);

    await user.click(screen.getByTestId(`tab-close-${B}`));
    expect(useTabsStore.getState().openPaths).toEqual([A]);
    expect(useTabsStore.getState().activePath).toBe(A);
  });

  it('gives each tab a title attribute carrying the full path', () => {
    // Basenames collide constantly; the tooltip is how you tell them apart.
    useTabsStore.setState({ openPaths: [A], activePath: A, previewPath: null });
    render(<TabStrip />);
    expect(screen.getByRole('tab')).toHaveAttribute('title', A);
  });

  it('renders the preview tab in italics', () => {
    useTabsStore.setState({ openPaths: [A], activePath: A, previewPath: A });
    render(<TabStrip />);
    expect(screen.getByTestId(`tab-label-${A}`).className).toMatch(/italic/);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/tabStrip.test.tsx`
Expected: FAIL — cannot resolve `TabStrip`.

- [ ] **Step 3: Implement `TabStrip.tsx`**

Create `src/renderer/features/disk-explorer/components/TabStrip.tsx`:

```tsx
import React from 'react';
import { X } from 'lucide-react';
import { useTabsStore } from '../store/tabsStore';

function basename(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index === -1 ? filePath : filePath.slice(index + 1);
}

/**
 * The open-files strip above the detail pane.
 *
 * Each tab's body is the existing DetailPane, so this component owns selection
 * and ordering only — there is no second preview implementation.
 */
export const TabStrip: React.FC = () => {
  const openPaths = useTabsStore((state) => state.openPaths);
  const activePath = useTabsStore((state) => state.activePath);
  const previewPath = useTabsStore((state) => state.previewPath);
  const activate = useTabsStore((state) => state.activate);
  const pin = useTabsStore((state) => state.pin);
  const close = useTabsStore((state) => state.close);

  if (openPaths.length === 0) return null;

  return (
    <div
      role="tablist"
      data-testid="tab-strip"
      className="flex shrink-0 items-stretch overflow-x-auto border-b border-border/60 bg-background"
    >
      {openPaths.map((path) => {
        const isActive = path === activePath;
        const isPreview = path === previewPath;

        return (
          <div
            key={path}
            role="tab"
            tabIndex={isActive ? 0 : -1}
            aria-selected={isActive}
            title={path}
            data-testid={`tab-${path}`}
            onClick={() => activate(path)}
            onDoubleClick={() => pin(path)}
            className={
              'group flex min-w-0 max-w-[200px] shrink-0 cursor-default items-center gap-1.5 ' +
              'border-r border-border/60 px-3 py-1.5 text-xs transition-colors duration-100 ' +
              (isActive
                ? 'bg-muted/60 text-foreground'
                : 'text-muted-foreground hover:bg-muted/30')
            }
          >
            <span
              data-testid={`tab-label-${path}`}
              className={'truncate ' + (isPreview ? 'italic' : '')}
            >
              {basename(path)}
            </span>
            <button
              type="button"
              aria-label={`Close ${basename(path)}`}
              data-testid={`tab-close-${path}`}
              data-disk-shortcuts-ignore="true"
              onClick={(event) => {
                // Without this the tab's own onClick would activate what is
                // about to be removed.
                event.stopPropagation();
                close(path);
              }}
              className="rounded p-0.5 opacity-0 transition-opacity duration-100 hover:bg-muted group-hover:opacity-100 focus:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/tabStrip.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Mount the strip and feed it from selection**

In `DiskExplorer.tsx`, add the imports:

```tsx
import { TabStrip } from './TabStrip';
import { useTabsStore } from '../store/tabsStore';
```

Add these hooks beside the others:

```tsx
  const activeTabPath = useTabsStore((state) => state.activePath);
  const openPreviewTab = useTabsStore((state) => state.openPreview);
  const hydrateTabs = useTabsStore((state) => state.hydrate);
```

Restore persisted tabs once on mount:

```tsx
  useEffect(() => {
    hydrateTabs();
  }, [hydrateTabs]);
```

Open a preview tab whenever a file is selected:

```tsx
  useEffect(() => {
    if (!selectedEntry || selectedEntry.isDirectory) return;
    openPreviewTab(selectedEntry.path);
  }, [openPreviewTab, selectedEntry]);
```

The detail pane must now follow the active tab rather than the selection. Add a lookup:

```tsx
  // The tab being viewed, which is not always the grid selection: clicking a
  // different tab changes what is displayed without moving the grid cursor.
  const tabEntry = useMemo<DiskEntry | null>(() => {
    if (!activeTabPath) return selectedEntry;
    for (const entries of Object.values(listings)) {
      const match = entries.find((candidate) => candidate.path === activeTabPath);
      if (match) return match;
    }
    return selectedEntry;
  }, [activeTabPath, listings, selectedEntry]);
```

Change the third `Pane` from Task 7 to include the strip and use `tabEntry`:

```tsx
        <Pane
          defaultSize={sizesFor(sizes, 2, 25)}
          minSize={15}
          maxSize={50}
          collapsible
          className="flex flex-col overflow-hidden border-l border-border/60"
        >
          <TabStrip />
          <div className="min-h-0 flex-1 overflow-hidden">
            <DetailPane entry={tabEntry} />
          </div>
        </Pane>
```

Leave `QuickLook` on `selectedEntry` — Space previews what the grid cursor is on, which is correct even when a different tab is displayed.

- [ ] **Step 6: Add the tab shortcuts**

Add this effect to `DiskExplorer.tsx`, alongside the existing keyboard effect. Keep it separate rather than extending the merged handler — that one is already 90 lines and covered by its own tests.

```tsx
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;

      const tabs = useTabsStore.getState();

      if (event.key === 'w') {
        if (!tabs.activePath) return;
        event.preventDefault();
        tabs.close(tabs.activePath);
        return;
      }

      if (event.shiftKey && event.key === '[') {
        event.preventDefault();
        tabs.activatePrevious();
        return;
      }

      if (event.shiftKey && event.key === ']') {
        event.preventDefault();
        tabs.activateNext();
        return;
      }

      // Cmd+1..9 jump to a tab by position, as in every browser.
      if (event.key >= '1' && event.key <= '9') {
        event.preventDefault();
        tabs.activateIndex(Number(event.key) - 1);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
```

`Cmd+W` is also `role: 'close'` in the Window menu from Task 8, which would close the whole window. Remove that role item from the File menu in `menuTemplate.ts` so the renderer's handler owns the shortcut:

```ts
    {
      label: 'File',
      submenu: [
        ...item(COMMAND_IDS.openFolder),
      ],
    },
```

Update the `menuTemplate.test.ts` case that asserts the File menu's contents if it referenced `close`.

- [ ] **Step 7: Verify in the app**

Run: `npm run better-dev`

1. Single-click three files in turn. **One italic tab**, replaced each time.
2. Double-click a tab. It becomes upright and stays when you click another file.
3. `Cmd+1` and `Cmd+2` jump between tabs.
4. `Cmd+W` closes the active tab and does **not** close the window.
5. `Cmd+Shift+[` and `]` cycle.
6. Close every tab: the strip disappears and the pane shows the empty state.
7. Quit and relaunch: pinned tabs return, the italic preview tab does not.
8. Press Space with a tab open — Quick Look shows the **grid selection**, matching Finder.

- [ ] **Step 8: Full verification and commit**

Run: `npm test`
Run: `npx tsc --noEmit 2>&1 | grep -c 'error TS'` — expected: still `14`.
Run: `npm run test:e2e` — expected: 10 tests, still at the ceiling.

```bash
git add src/renderer/features/disk-explorer/ src/main/menu/menuTemplate.ts src/tests/
git commit -m "feat(files): add tabs for open files"
```

---

### Task 13: Final verification

No new code. Confirms the whole plan landed and nothing regressed.

- [ ] **Step 1: Confirm the type-error count did not grow**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -c 'error TS'
```
Expected: `14`, matching `docs/superpowers/plans/baseline-2026-08-17.txt`. Any increase is work introduced by this plan and must be fixed.

- [ ] **Step 2: Confirm the E2E budget**

Run:
```bash
grep -ch "test(" e2e/tests/*.ts | paste -sd+ - | bc
```
Expected: `10`. If it reads higher, a task added an E2E test it was not permitted to add; move that coverage down a tier.

Run: `npm run test:e2e`
Expected: 10 passed, well under 60s.

- [ ] **Step 3: Confirm the unit suite**

Run: `npm test`
Expected: all pass. The count should be roughly 348 + 10 + 13 + 12 + 4 + 7 + 4 + 10 + 6 + 8 + 24 + 8 ≈ 454.

- [ ] **Step 4: Confirm the budgets hold**

Run: `npx vitest run src/tests/perf/budgets.test.ts`
Expected: PASS. Record the reported first-paint figure from `npm run better-dev`.

- [ ] **Step 5: Walk the app once, end to end**

Run: `npm run better-dev`

- [ ] Launches with no white flash, in the theme you last used
- [ ] Opens at the size and position you last left it
- [ ] Real macOS traffic lights, with hover glyphs and focus dimming
- [ ] Menu bar reads Opal / File / Edit / View / Window
- [ ] `Cmd+,` opens Settings; `Cmd+O` opens a folder; `Cmd+B` toggles the pane
- [ ] `Cmd+C`/`Cmd+A` work correctly inside the filter box and the rename dialog
- [ ] All three panes on `/files` drag, and their sizes survive a route change and a restart
- [ ] The gallery re-flows its columns as the pane resizes
- [ ] Tabs: preview replaces, double-click pins, `Cmd+W` closes the tab not the window
- [ ] Everything the files build-out shipped still works: Quick Look, sort, filter, keyboard nav, rename, move, trash

- [ ] **Step 6: Commit the completed plan**

```bash
git add docs/superpowers/plans/2026-08-17-native-shell-polish.md
git commit -m "docs: mark native shell polish plan complete"
```

---

## Self-Review

Checked against `docs/superpowers/specs/2026-08-17-native-shell-polish-design.md`:

| Spec section | Task |
|---|---|
| Section 0 — persistence split | 1 (renderer prefs), 2–3 (main window state) |
| Section 1 — window chrome and startup | 4, with Task 5 removing the old hook |
| Section 2 — pane system | 6 (module), 7 (adoption in both routes) |
| Section 3 — menus and shortcuts | 8 (template), 9 (installation) |
| Section 3 — performance budgets | 10 |
| Section 4 — tabs | 11 (store), 12 (strip) |
| Testing table | Every subject has a task; the single E2E is in Task 4 |
| Revision 1 — no `electron-store` | Global Constraints; Task 3 uses a JSON store |
| Revision 1 — E2E ceiling of 10 | Global Constraints; verified in Tasks 0, 4, 13 |
| Revision 1 — 14 pre-existing `tsc` errors | Task 0 baseline; re-checked in Tasks 4, 7, 9, 12, 13 |

Known deviations from the spec, both deliberate:

1. **`Cmd+W` closes a tab, not the window.** The spec assigns `Cmd+W` to both the Window menu and the tab strip. Task 12 resolves the collision in favour of tabs and removes the `close` role, which is what every tabbed editor does.
2. **Arrow-key pane resize is not implemented.** Section 2 lists it. `react-resizable-panels` provides it natively on a focused `PanelResizeHandle`, so `PaneHandle` inherits it without extra code — Task 7's manual verification covers it. If it proves not to work, add it as a follow-up rather than expanding Task 6.
