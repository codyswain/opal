# Recent Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the built-in Recent collection end to end: durable personal activity in main, an explicit collection in the Files navigation model, and a Recent surface whose Open/Back round trip preserves context.

**Architecture:** Main owns an `ActivityStore` (bounded, write-through JSON under `<userData>/library/`) and an `ActivityService` that validates paths through `RootRegistry`, records opens from the renderer and organize events from `MetadataService`/`FileWriter`, and answers `recent` queries from memory with fresh stats. The renderer's `FilesLocation` gains a `FilesCollection` discriminator (`directory` | `recent`) so focus locations remember their origin; `diskStore` tracks `currentCollection`; a new `recentStore` and `RecentView` reuse the extracted `CollectionView` list/gallery.

**Tech Stack:** Electron 31 main/preload/renderer, TypeScript, React 18, Zustand, react-window, Vitest + Testing Library + happy-dom, Node `fs/promises` with real temp directories for main-process tests.

**Spec:** `docs/superpowers/specs/2026-09-06-recent-activity-design.md` (product authority: `docs/superpowers/specs/2026-09-06-recent-and-saved-views-handoff.md`)

## Global Constraints

- Work only in `/Users/codyswain/code/opal/.worktrees/core-ux` on branch `codex/core-ux`. Do not merge, push, or restart the user's running app.
- Baseline: 726 tests in 69 files pass; 13 pre-existing TypeScript errors (`npx tsc --noEmit 2>&1 | grep -c "error TS"` prints `13`); 15 lint warnings, 0 errors. No new errors or warnings.
- Run `npm test` (rebuilds better-sqlite3 for Node). Never run it concurrently with `npm run test:e2e`. E2E stays at nine tests; no visual regression tests.
- The pre-commit hook runs lint-staged and the full `npm test`. A flaky `diskWatcher` timing test occasionally fails; rerun the commit once before investigating.
- Activity never writes into opened roots, never allocates a UUID, never builds the metadata catalog, and never scans. Renderer may record only `'opened'`. Main records organize events after success only.
- Timestamps are epoch milliseconds. Paths are absolute canonical (`normalizePath` in main, `normalizeFsPath` in renderer).
- Existing directory URLs (`?mode=browse&dir=…`, `?mode=focus&dir=…&file=…`) must serialize byte-for-byte as before.
- Commit after each task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File map

| File | Responsibility |
|---|---|
| `src/types/activity.ts` (create) | Shared activity/recent contracts for main, preload, renderer |
| `src/main/library/libraryPaths.ts` (create) | The one place that knows the library configuration directory layout |
| `src/main/activity/ActivityStore.ts` (create) | In-memory records + bounded, atomic, write-through JSON persistence |
| `src/main/activity/ActivityService.ts` (create) | Root-guarded recording, remap, removal, clear, recent query |
| `src/main/activity/ActivityHandlers.ts` (create) | IPC validation and dispatch |
| `src/main/fs/MetadataService.ts` (modify) | Record organized after successful writes |
| `src/main/fs/FileWriter.ts` (modify) | Remap/record/remove after successful rename, move, trash |
| `src/main.ts`, `src/preload.ts` (modify) | Wiring and `activityAPI` |
| `src/renderer/shared/types/activityApi.d.ts` (create) | `window.activityAPI` typing |
| `src/tests/helpers/activityApi.ts` (create) | `installActivityApi` fake |
| `src/common/relativeTime.ts` (create) | "10 minutes ago" formatting, pure |
| `src/renderer/features/disk-explorer/navigation/filesLocation.ts` (modify) | `FilesCollection` model, URL codec |
| `src/renderer/features/disk-explorer/navigation/filesLocationSnapshots.ts` (modify) | Collection-aware scoping |
| `src/renderer/features/disk-explorer/store/diskStore.ts`, `diskPathState.ts` (modify) | `currentCollection`, `navigateToRecent` |
| `src/renderer/features/disk-explorer/store/recentStore.ts` (create) | Recent results, stale-response guard |
| `src/renderer/features/disk-explorer/activity/recordActivity.ts` (create) | Fire-and-forget `recordOpened` |
| `src/renderer/features/disk-explorer/components/CollectionView.tsx` (create) | List/gallery rendering extracted from `DiskFolderView` |
| `src/renderer/features/disk-explorer/components/DiskFolderView.tsx` (modify) | Folder wrapper over `CollectionView` |
| `src/renderer/features/disk-explorer/components/RecentView.tsx` (create) | Recent header, decorations, empty/loading/warning states |
| `src/renderer/features/disk-explorer/components/FilesRoute.tsx`, `DiskExplorer.tsx` (modify) | Apply recent locations, render Recent |
| `src/renderer/features/shell/components/WorkspaceSidebar.tsx`, `SidebarItem.tsx` (modify) | Recent sidebar item |

---

### Task 1: Activity contracts, library paths and `ActivityStore`

**Files:**
- Create: `src/types/activity.ts`
- Create: `src/main/library/libraryPaths.ts`
- Create: `src/main/activity/ActivityStore.ts`
- Test: `src/tests/unit/activity/activityStore.test.ts`, `src/tests/unit/activity/libraryPaths.test.ts`

**Interfaces:**
- Produces `ActivityKind`, `ActivityRecord`, `RecentItem`, `RecentResult`, `RecentQuery`, `RECENT_DEFAULT_LIMIT = 200`, `RECENT_MAX_LIMIT = 1000`.
- Produces `libraryDirectory(userDataDir: string): string` → `<userDataDir>/library`; `activityStorePath(userDataDir): string` → `<userDataDir>/library/activity.json`.
- Produces `class ActivityStore` with `load(): Promise<void>`, `list(): ActivityRecord[]`, `get(path): ActivityRecord | null`, `touch(path, kind, id): Promise<boolean>`, `remap(oldPath, newPath): Promise<boolean>`, `remove(paths: readonly string[]): Promise<boolean>`, `clear(): Promise<boolean>`, `warnings(): string[]`, `touchedAt(record): number`, `touchedKind(record): ActivityKind`.

- [ ] **Step 1: Write the contracts**

```ts
// src/types/activity.ts
import type { DiskEntry } from './disk';

export type ActivityKind = 'opened' | 'organized' | 'edited';

export interface ActivityRecord {
  /** Absolute canonical path; the record key. */
  path: string;
  /** Metadata UUID readable when last recorded, or null. Never allocated here. */
  id: string | null;
  openedAt: number | null;
  organizedAt: number | null;
  editedAt: number | null;
}

export interface RecentItem {
  entry: DiskEntry;
  touchedAt: number;
  touchedKind: ActivityKind;
  openedAt: number | null;
  organizedAt: number | null;
  editedAt: number | null;
}

export interface RecentResult {
  items: RecentItem[];
  /** Records considered before missing/closed/replaced filtering and the limit. */
  total: number;
  truncated: boolean;
  warnings: string[];
}

export interface RecentQuery {
  limit?: number;
}

export const RECENT_DEFAULT_LIMIT = 200;
export const RECENT_MAX_LIMIT = 1000;
```

```ts
// src/main/library/libraryPaths.ts
import path from 'path';

/**
 * The app-managed configuration directory for the current library. One folder
 * under userData so a whole library configuration can be copied or moved.
 * Nothing here is ever written into an opened root.
 *
 *   <userData>/library/activity.json       personal activity (Recent)
 *   <userData>/library/views/<id>.yaml     saved views (later slice)
 *   <userData>/library/library.json        library preferences (later slice)
 */
export function libraryDirectory(userDataDir: string): string {
  return path.join(userDataDir, 'library');
}

export function activityStorePath(userDataDir: string): string {
  return path.join(libraryDirectory(userDataDir), 'activity.json');
}
```

- [ ] **Step 2: Write the failing store tests**

```ts
// src/tests/unit/activity/activityStore.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'fs/promises';
import os from 'os';
import path from 'path';
import { ActivityStore } from '@/main/activity/ActivityStore';

let tmp: string;
let storePath: string;
let now = 1_000_000;
const clock = () => now;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-activity-'));
  storePath = path.join(tmp, 'library', 'activity.json');
  now = 1_000_000;
});
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

async function fresh(limit = 2000) {
  const store = new ActivityStore({ storePath, now: clock, limit });
  await store.load();
  return store;
}

describe('ActivityStore', () => {
  it('starts empty when the file is missing and creates the directory on first write', async () => {
    const store = await fresh();
    expect(store.list()).toEqual([]);
    expect(await store.touch('/V/a.md', 'opened', null)).toBe(true);
    const parsed = JSON.parse(await readFile(storePath, 'utf8'));
    expect(parsed).toEqual({ version: 1, items: [{ path: '/V/a.md', id: null, openedAt: 1_000_000, organizedAt: null, editedAt: null }] });
  });

  it('reloads records in a fresh instance', async () => {
    const store = await fresh();
    await store.touch('/V/a.md', 'opened', 'id-a');
    now += 5_000;
    await store.touch('/V/a.md', 'organized', 'id-a');
    const again = await fresh();
    expect(again.get('/V/a.md')).toEqual({ path: '/V/a.md', id: 'id-a', openedAt: 1_000_000, organizedAt: 1_005_000, editedAt: null });
  });

  it('coalesces repeated opens within 30 seconds without rewriting', async () => {
    const store = await fresh();
    await store.touch('/V/a.md', 'opened', null);
    now += 29_000;
    expect(await store.touch('/V/a.md', 'opened', null)).toBe(false);
    expect(store.get('/V/a.md')?.openedAt).toBe(1_000_000);
    now += 2_000;
    expect(await store.touch('/V/a.md', 'opened', null)).toBe(true);
    expect(store.get('/V/a.md')?.openedAt).toBe(1_031_000);
  });

  it('updates the id when a later touch supplies one, and keeps it when a later touch cannot read one', async () => {
    const store = await fresh();
    await store.touch('/V/a.md', 'opened', null);
    now += 60_000;
    await store.touch('/V/a.md', 'organized', 'id-a');
    expect(store.get('/V/a.md')?.id).toBe('id-a');
    now += 60_000;
    await store.touch('/V/a.md', 'opened', null);
    expect(store.get('/V/a.md')?.id).toBe('id-a');
  });

  it('evicts the least recently touched record beyond the limit', async () => {
    const store = await fresh(2);
    await store.touch('/V/a', 'opened', null);
    now += 60_000; await store.touch('/V/b', 'opened', null);
    now += 60_000; await store.touch('/V/c', 'opened', null);
    expect(store.list().map((record) => record.path).sort()).toEqual(['/V/b', '/V/c']);
  });

  it('remaps a file and a whole directory subtree', async () => {
    const store = await fresh();
    await store.touch('/V/Old/a.md', 'opened', 'id-a');
    await store.touch('/V/Old/Deep/b.png', 'opened', null);
    await store.touch('/V/Other/c.md', 'opened', null);
    expect(await store.remap('/V/Old', '/V/New')).toBe(true);
    expect(store.list().map((record) => record.path).sort()).toEqual(['/V/New/Deep/b.png', '/V/New/a.md', '/V/Other/c.md']);
    expect(store.get('/V/New/a.md')?.id).toBe('id-a');
    expect(await store.remap('/V/Missing', '/V/Elsewhere')).toBe(false);
  });

  it('removes subtrees and clears everything', async () => {
    const store = await fresh();
    await store.touch('/V/Old/a.md', 'opened', null);
    await store.touch('/V/Old-2/b.md', 'opened', null);
    expect(await store.remove(['/V/Old'])).toBe(true);
    expect(store.list().map((record) => record.path)).toEqual(['/V/Old-2/b.md']);
    expect(await store.clear()).toBe(true);
    expect(store.list()).toEqual([]);
    expect(await store.clear()).toBe(false);
    expect(JSON.parse(await readFile(storePath, 'utf8'))).toEqual({ version: 1, items: [] });
  });

  it('preserves an unreadable file aside, starts empty and reports a warning', async () => {
    await mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(storePath, '{ not json');
    const store = await fresh();
    expect(store.list()).toEqual([]);
    expect(store.warnings()).toEqual([expect.stringMatching(/could not be read/i)]);
    const files = await readdir(path.dirname(storePath));
    expect(files.some((name) => name.startsWith('activity.json.invalid-'))).toBe(true);
    await store.touch('/V/a.md', 'opened', null);
    expect(store.warnings()).toEqual([]);
  });

  it('keeps the in-memory change and reports a persistence failure without throwing', async () => {
    await mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(path.join(path.dirname(storePath), 'activity.json'), '{"version":1,"items":[]}');
    const store = new ActivityStore({ storePath, now: clock, writeFile: async () => { throw new Error('disk full'); } });
    await store.load();
    expect(await store.touch('/V/a.md', 'opened', null)).toBe(true);
    expect(store.get('/V/a.md')).not.toBeNull();
    expect(store.warnings()).toEqual([expect.stringMatching(/disk full/)]);
  });

  it('derives touchedAt and touchedKind, preferring organized over opened on ties', () => {
    const store = new ActivityStore({ storePath, now: clock });
    expect(store.touchedKind({ path: '/x', id: null, openedAt: 5, organizedAt: 5, editedAt: null })).toBe('organized');
    expect(store.touchedAt({ path: '/x', id: null, openedAt: 5, organizedAt: 9, editedAt: 7 })).toBe(9);
    expect(store.touchedKind({ path: '/x', id: null, openedAt: 5, organizedAt: 9, editedAt: 7 })).toBe('organized');
  });
});
```

```ts
// src/tests/unit/activity/libraryPaths.test.ts
import { describe, expect, it } from 'vitest';
import { activityStorePath, libraryDirectory } from '@/main/library/libraryPaths';

describe('libraryPaths', () => {
  it('places every library file under one app-managed directory', () => {
    expect(libraryDirectory('/data')).toBe('/data/library');
    expect(activityStorePath('/data')).toBe('/data/library/activity.json');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/tests/unit/activity`
Expected: FAIL — cannot resolve `@/main/activity/ActivityStore`.

- [ ] **Step 4: Implement `ActivityStore`**

```ts
// src/main/activity/ActivityStore.ts
import { randomUUID } from 'crypto';
import { mkdir, readFile, rename, unlink, writeFile as writeFileOnDisk } from 'fs/promises';
import path from 'path';
import { isInsideRoot, normalizePath } from '@/main/fs/paths';
import type { ActivityKind, ActivityRecord } from '@/types/activity';

const STORE_VERSION = 1;
export const ACTIVITY_COALESCE_MS = 30_000;
export const ACTIVITY_DEFAULT_LIMIT = 2000;

interface ActivityFile { version: number; items: ActivityRecord[] }

export interface ActivityStoreDependencies {
  storePath: string;
  now?: () => number;
  limit?: number;
  coalesceMs?: number;
  /** Seam for write-failure tests. */
  writeFile?: (target: string, bytes: string) => Promise<void>;
}

const KIND_FIELD: Record<ActivityKind, keyof Pick<ActivityRecord, 'openedAt' | 'organizedAt' | 'editedAt'>> = {
  opened: 'openedAt', organized: 'organizedAt', edited: 'editedAt',
};
/** Tie-break order: the more deliberate action wins. */
const KIND_PRIORITY: ActivityKind[] = ['edited', 'organized', 'opened'];

function isRecord(value: unknown): value is ActivityRecord {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  const stamp = (field: unknown) => field === null || (typeof field === 'number' && Number.isFinite(field));
  return typeof candidate.path === 'string' && candidate.path.length > 0 &&
    (candidate.id === null || typeof candidate.id === 'string') &&
    stamp(candidate.openedAt) && stamp(candidate.organizedAt) && stamp(candidate.editedAt);
}

/**
 * Personal activity behind Recent. Records are keyed by absolute canonical
 * path; the whole file is rewritten atomically on every change, serialized so
 * writes never interleave. Persistence failures are reported, never thrown.
 */
export class ActivityStore {
  private records = new Map<string, ActivityRecord>();
  private loadWarning: string | null = null;
  private persistenceError: string | null = null;
  private tail: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly limit: number;
  private readonly coalesceMs: number;

  constructor(private deps: ActivityStoreDependencies) {
    this.now = deps.now ?? Date.now;
    this.limit = Math.max(1, deps.limit ?? ACTIVITY_DEFAULT_LIMIT);
    this.coalesceMs = deps.coalesceMs ?? ACTIVITY_COALESCE_MS;
  }

  async load(): Promise<void> {
    this.records.clear();
    this.loadWarning = null;
    let raw: string;
    try {
      raw = await readFile(this.deps.storePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      this.loadWarning = `Recent activity could not be read: ${message(error)}`;
      return;
    }
    let parsed: ActivityFile | null = null;
    try { parsed = JSON.parse(raw) as ActivityFile; } catch { parsed = null; }
    if (!parsed || parsed.version !== STORE_VERSION || !Array.isArray(parsed.items)) {
      const aside = `${this.deps.storePath}.invalid-${this.now()}`;
      try { await rename(this.deps.storePath, aside); } catch { /* keep the original in place if it cannot move */ }
      this.loadWarning = `Recent activity could not be read; the previous file was kept at ${path.basename(aside)}.`;
      return;
    }
    for (const item of parsed.items) {
      if (isRecord(item)) this.records.set(normalizePath(item.path), { ...item, path: normalizePath(item.path) });
    }
  }

  list(): ActivityRecord[] { return [...this.records.values()].map((record) => ({ ...record })); }

  get(target: string): ActivityRecord | null {
    const record = this.records.get(normalizePath(target));
    return record ? { ...record } : null;
  }

  warnings(): string[] {
    return [this.loadWarning, this.persistenceError].filter((warning): warning is string => !!warning);
  }

  touchedAt(record: ActivityRecord): number {
    return Math.max(record.openedAt ?? 0, record.organizedAt ?? 0, record.editedAt ?? 0);
  }

  touchedKind(record: ActivityRecord): ActivityKind {
    const at = this.touchedAt(record);
    return KIND_PRIORITY.find((kind) => record[KIND_FIELD[kind]] === at) ?? 'opened';
  }

  touch(target: string, kind: ActivityKind, id: string | null): Promise<boolean> {
    const key = normalizePath(target);
    const now = this.now();
    const current = this.records.get(key);
    const field = KIND_FIELD[kind];
    if (current && kind === 'opened' && current.openedAt !== null && now - current.openedAt < this.coalesceMs && (id === null || id === current.id)) {
      return Promise.resolve(false);
    }
    const next: ActivityRecord = {
      path: key,
      id: id ?? current?.id ?? null,
      openedAt: current?.openedAt ?? null,
      organizedAt: current?.organizedAt ?? null,
      editedAt: current?.editedAt ?? null,
    };
    next[field] = now;
    this.records.delete(key);
    this.records.set(key, next);
    this.evict();
    return this.persist();
  }

  remap(oldPath: string, newPath: string): Promise<boolean> {
    const from = normalizePath(oldPath);
    const to = normalizePath(newPath);
    const moved = [...this.records.values()].filter((record) => isInsideRoot(from, record.path));
    if (moved.length === 0) return Promise.resolve(false);
    for (const record of moved) {
      this.records.delete(record.path);
      const suffix = record.path.slice(from.length);
      const remapped = normalizePath(`${to}${suffix}`);
      this.records.set(remapped, { ...record, path: remapped });
    }
    return this.persist();
  }

  remove(paths: readonly string[]): Promise<boolean> {
    const removed = paths.map(normalizePath);
    let changed = false;
    for (const key of [...this.records.keys()]) {
      if (removed.some((prefix) => isInsideRoot(prefix, key))) { this.records.delete(key); changed = true; }
    }
    return changed ? this.persist() : Promise.resolve(false);
  }

  clear(): Promise<boolean> {
    if (this.records.size === 0) return Promise.resolve(false);
    this.records.clear();
    return this.persist();
  }

  private evict(): void {
    while (this.records.size > this.limit) {
      let oldest: ActivityRecord | null = null;
      for (const record of this.records.values()) {
        if (!oldest || this.touchedAt(record) < this.touchedAt(oldest)) oldest = record;
      }
      if (!oldest) break;
      this.records.delete(oldest.path);
    }
  }

  /** Serialized atomic replace; resolves true after the attempt, recording any failure. */
  private persist(): Promise<boolean> {
    const payload: ActivityFile = { version: STORE_VERSION, items: this.list() };
    const run = this.tail.then(async () => {
      const directory = path.dirname(this.deps.storePath);
      const temporary = path.join(directory, `.activity-${randomUUID()}.tmp`);
      try {
        await mkdir(directory, { recursive: true });
        await (this.deps.writeFile ?? ((target, bytes) => writeFileOnDisk(target, bytes, 'utf8')))(temporary, JSON.stringify(payload, null, 2));
        await rename(temporary, this.deps.storePath);
        this.persistenceError = null;
      } catch (error) {
        this.persistenceError = `Recent activity could not be saved: ${message(error)}`;
        try { await unlink(temporary); } catch { /* nothing to clean */ }
      }
    });
    this.tail = run;
    return run.then(() => true);
  }
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/tests/unit/activity`
Expected: PASS (11 tests).

- [ ] **Step 6: Commit**

```bash
git add src/types/activity.ts src/main/library/libraryPaths.ts src/main/activity/ActivityStore.ts src/tests/unit/activity
git commit -m "feat(activity): add bounded write-through activity store"
```

---

### Task 2: `ActivityService`

**Files:**
- Create: `src/main/activity/ActivityService.ts`
- Test: `src/tests/unit/activity/activityService.test.ts`

**Interfaces:**
- Consumes `ActivityStore` (Task 1), `RootRegistry`, `readMetadata` from `MetadataCodec`, `DiskReader.statEntry` shape `(target: string) => Promise<DiskEntry>`.
- Produces:

```ts
export interface ActivityRecorder {
  noteOrganized(target: string): Promise<void>;                 // never throws
  noteMoved(oldPath: string, newPath: string): Promise<void>;  // never throws
  noteRemoved(target: string): Promise<void>;                  // never throws
}
export interface ActivityServiceDependencies {
  registry: RootRegistry;
  store: ActivityStore;
  statEntry: (target: string) => Promise<DiskEntry>;
  onChanged?: () => void;
  changeDebounceMs?: number;   // default 100
}
export class ActivityService implements ActivityRecorder {
  recordOpened(target: string): Promise<void>;   // throws PathNotAllowedError / Error for missing
  recent(query?: RecentQuery): Promise<RecentResult>;
  clear(): Promise<void>;
  // plus ActivityRecorder methods
}
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/tests/unit/activity/activityService.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, rename } from 'fs/promises';
import os from 'os';
import path from 'path';
import { ActivityService } from '@/main/activity/ActivityService';
import { ActivityStore } from '@/main/activity/ActivityStore';
import { DiskReader } from '@/main/fs/DiskReader';
import { MetadataService } from '@/main/fs/MetadataService';
import { RootRegistry } from '@/main/fs/RootRegistry';

let tmp: string; let root: string; let other: string;
let registry: RootRegistry; let store: ActivityStore; let service: ActivityService;
let now = 1_000_000;
const onChanged = vi.fn();
const item = (name: string) => path.join(root, name);

beforeEach(async () => {
  vi.useFakeTimers();
  now = 1_000_000;
  onChanged.mockClear();
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-activity-service-'));
  root = path.join(tmp, 'root'); other = path.join(tmp, 'other');
  await mkdir(root); await mkdir(other);
  await writeFile(item('a.md'), '# a'); await writeFile(item('b.pdf'), 'pdf'); await mkdir(item('Folder'));
  await writeFile(path.join(other, 'outside.md'), '# out');
  registry = new RootRegistry({ storePath: path.join(tmp, 'roots.json') });
  root = await registry.add(root);
  store = new ActivityStore({ storePath: path.join(tmp, 'library', 'activity.json'), now: () => now });
  await store.load();
  const reader = new DiskReader({ registry });
  service = new ActivityService({ registry, store, statEntry: (target) => reader.statEntry(target), onChanged, changeDebounceMs: 100 });
});
afterEach(async () => { vi.useRealTimers(); await rm(tmp, { recursive: true, force: true }); });

describe('ActivityService', () => {
  it('records explicit opens inside opened roots and refuses everything else', async () => {
    await service.recordOpened(item('a.md'));
    expect(store.get(item('a.md'))?.openedAt).toBe(1_000_000);
    await expect(service.recordOpened(path.join(other, 'outside.md'))).rejects.toThrow(/not inside any folder/i);
    await expect(service.recordOpened(item('missing.md'))).rejects.toThrow();
    expect(store.list()).toHaveLength(1);
  });

  it('captures an existing UUID without allocating one', async () => {
    const metadata = new MetadataService({ registry });
    const saved = await metadata.saveProperties(item('a.md'), { tags: ['x'], description: '' }, (await metadata.read(item('a.md'))).revision);
    await service.recordOpened(item('a.md'));
    await service.recordOpened(item('b.pdf'));
    expect(store.get(item('a.md'))?.id).toBe(saved.id);
    expect(store.get(item('b.pdf'))?.id).toBeNull();
    expect((await metadata.read(item('b.pdf'))).id).toBeNull();
  });

  it('lists recent items newest first with deterministic tie-breaks and readable reasons', async () => {
    await service.recordOpened(item('b.pdf'));
    now += 60_000; await service.recordOpened(item('a.md'));
    now += 60_000; await service.noteOrganized(item('Folder'));
    await service.recordOpened(item('a.md')); // coalesced, same touchedAt
    const result = await service.recent();
    expect(result.items.map((row) => [row.entry.name, row.touchedKind])).toEqual([['Folder', 'organized'], ['a.md', 'opened'], ['b.pdf', 'opened']]);
    expect(result.items[0].entry.isDirectory).toBe(true);
    expect(result).toMatchObject({ total: 3, truncated: false, warnings: [] });
  });

  it('applies and caps the limit', async () => {
    for (const name of ['a.md', 'b.pdf', 'Folder']) { await service.recordOpened(item(name)); now += 60_000; }
    const limited = await service.recent({ limit: 2 });
    expect(limited.items).toHaveLength(2);
    expect(limited.truncated).toBe(true);
    const capped = await service.recent({ limit: 5000 });
    expect(capped.items).toHaveLength(3);
  });

  it('omits missing items and items in closed roots without deleting their records', async () => {
    await service.recordOpened(item('a.md'));
    await service.recordOpened(item('b.pdf'));
    await rm(item('b.pdf'));
    expect((await service.recent()).items.map((row) => row.entry.name)).toEqual(['a.md']);
    await registry.remove(root);
    expect((await service.recent()).items).toEqual([]);
    expect(store.list()).toHaveLength(2);
  });

  it('drops a record whose annotated item was replaced by a different identity, and keeps duplicate copies separate', async () => {
    const metadata = new MetadataService({ registry });
    await metadata.saveProperties(item('b.pdf'), { tags: [], description: 'd' }, (await metadata.read(item('b.pdf'))).revision);
    await service.recordOpened(item('b.pdf'));
    // Copy the pair: same UUID in two places is two rows, never merged.
    await writeFile(item('copy.pdf'), 'pdf');
    await writeFile(item('copy.pdf.opal.yaml'), await (await import('fs/promises')).readFile(item('b.pdf.opal.yaml'), 'utf8'));
    now += 60_000; await service.recordOpened(item('copy.pdf'));
    expect((await service.recent()).items.map((row) => row.entry.name)).toEqual(['copy.pdf', 'b.pdf']);
    // Replace b.pdf's carrier with a different identity.
    await rm(item('b.pdf.opal.yaml'));
    await writeFile(item('b.pdf.opal.yaml'), 'schema: 1\nid: 00000000-0000-4000-8000-000000000000\n');
    expect((await service.recent()).items.map((row) => row.entry.name)).toEqual(['copy.pdf']);
  });

  it('remaps on move, records organized at the new path, removes on trash, and never throws from recorder methods', async () => {
    await service.recordOpened(item('Folder'));
    await mkdir(item('Folder/Inner')); await writeFile(item('Folder/Inner/c.md'), '# c');
    await service.recordOpened(item('Folder/Inner/c.md'));
    now += 60_000;
    await rename(item('Folder'), item('Renamed'));
    await service.noteMoved(item('Folder'), item('Renamed'));
    expect(store.get(item('Renamed'))?.organizedAt).toBe(1_060_000);
    expect(store.get(item('Renamed/Inner/c.md'))?.openedAt).toBe(1_000_000);
    expect(store.get(item('Folder'))).toBeNull();
    await service.noteRemoved(item('Renamed/Inner'));
    expect(store.get(item('Renamed/Inner/c.md'))).toBeNull();
    await expect(service.noteOrganized(path.join(other, 'outside.md'))).resolves.toBeUndefined();
    await expect(service.noteOrganized(item('nope.md'))).resolves.toBeUndefined();
    expect(store.list().map((record) => record.path)).toEqual([item('Renamed')]);
  });

  it('clears activity and reports store warnings in results', async () => {
    await service.recordOpened(item('a.md'));
    await service.clear();
    expect((await service.recent()).items).toEqual([]);
    const failing = new ActivityStore({ storePath: path.join(tmp, 'library', 'activity.json'), now: () => now, writeFile: async () => { throw new Error('disk full'); } });
    await failing.load();
    const reader = new DiskReader({ registry });
    const broken = new ActivityService({ registry, store: failing, statEntry: (target) => reader.statEntry(target) });
    await broken.recordOpened(item('a.md'));
    expect((await broken.recent()).warnings).toEqual([expect.stringMatching(/disk full/)]);
  });

  it('coalesces change notifications', async () => {
    await service.recordOpened(item('a.md'));
    now += 60_000; await service.recordOpened(item('b.pdf'));
    expect(onChanged).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/tests/unit/activity/activityService.test.ts`
Expected: FAIL — cannot resolve `@/main/activity/ActivityService`.

- [ ] **Step 3: Implement the service**

```ts
// src/main/activity/ActivityService.ts
import path from 'path';
import logger from '@/main/logger';
import { readMetadata } from '@/main/fs/MetadataCodec';
import { normalizePath } from '@/main/fs/paths';
import type { RootRegistry } from '@/main/fs/RootRegistry';
import type { DiskEntry } from '@/types/disk';
import { RECENT_DEFAULT_LIMIT, RECENT_MAX_LIMIT, type RecentItem, type RecentQuery, type RecentResult } from '@/types/activity';
import type { ActivityStore } from './ActivityStore';

export interface ActivityRecorder {
  noteOrganized(target: string): Promise<void>;
  noteMoved(oldPath: string, newPath: string): Promise<void>;
  noteRemoved(target: string): Promise<void>;
}

export interface ActivityServiceDependencies {
  registry: RootRegistry;
  store: ActivityStore;
  statEntry: (target: string) => Promise<DiskEntry>;
  onChanged?: () => void;
  changeDebounceMs?: number;
}

/**
 * Records meaningful Opal actions and answers Recent. Every path is resolved
 * through the root registry first. Reading an item's UUID uses the bounded
 * single-item codec; it never builds the catalog or writes to the item.
 */
export class ActivityService implements ActivityRecorder {
  private changeTimer: NodeJS.Timeout | null = null;

  constructor(private deps: ActivityServiceDependencies) {}

  async recordOpened(target: string): Promise<void> {
    const resolved = await this.deps.registry.assertAllowed(target);
    await this.deps.statEntry(resolved);
    if (await this.deps.store.touch(resolved, 'opened', await this.readId(resolved))) this.emit();
  }

  async noteOrganized(target: string): Promise<void> {
    try {
      const resolved = await this.deps.registry.assertAllowed(target);
      if (await this.deps.store.touch(resolved, 'organized', await this.readId(resolved))) this.emit();
    } catch (error) {
      logger.warn(`Activity not recorded for ${target}: ${message(error)}`);
    }
  }

  async noteMoved(oldPath: string, newPath: string): Promise<void> {
    try {
      const from = normalizePath(oldPath);
      const to = await this.deps.registry.assertAllowed(newPath);
      const remapped = await this.deps.store.remap(from, to);
      const touched = await this.deps.store.touch(to, 'organized', await this.readId(to));
      if (remapped || touched) this.emit();
    } catch (error) {
      logger.warn(`Activity not remapped for ${oldPath}: ${message(error)}`);
    }
  }

  async noteRemoved(target: string): Promise<void> {
    try {
      if (await this.deps.store.remove([normalizePath(target)])) this.emit();
    } catch (error) {
      logger.warn(`Activity not removed for ${target}: ${message(error)}`);
    }
  }

  async clear(): Promise<void> {
    if (await this.deps.store.clear()) this.emit();
  }

  async recent(query: RecentQuery = {}): Promise<RecentResult> {
    const limit = Math.min(RECENT_MAX_LIMIT, Math.max(1, Math.floor(query.limit ?? RECENT_DEFAULT_LIMIT)));
    const store = this.deps.store;
    const records = store.list().sort((left, right) =>
      store.touchedAt(right) - store.touchedAt(left) ||
      path.basename(left.path).localeCompare(path.basename(right.path), undefined, { sensitivity: 'base' }) ||
      (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    const items: RecentItem[] = [];
    let index = 0;
    for (; index < records.length && items.length < limit; index++) {
      const record = records[index];
      let entry: DiskEntry;
      try { entry = await this.deps.statEntry(record.path); } catch { continue; }
      if (record.id !== null) {
        const currentId = await this.readId(record.path, true);
        if (currentId !== undefined && currentId !== record.id) continue;
      }
      items.push({
        entry,
        touchedAt: store.touchedAt(record),
        touchedKind: store.touchedKind(record),
        openedAt: record.openedAt,
        organizedAt: record.organizedAt,
        editedAt: record.editedAt,
      });
    }
    return { items, total: records.length, truncated: index < records.length, warnings: store.warnings() };
  }

  /** `undefined` means unreadable (unknown); `null` means readable and unannotated. */
  private async readId(target: string, distinguishUnknown = false): Promise<string | null | undefined> {
    try { return (await readMetadata(this.deps.registry, target)).id; } catch { return distinguishUnknown ? undefined : null; }
  }

  private emit(): void {
    if (!this.deps.onChanged) return;
    if (this.changeTimer) return;
    this.changeTimer = setTimeout(() => { this.changeTimer = null; this.deps.onChanged?.(); }, this.deps.changeDebounceMs ?? 100);
  }
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
```

Note `readId(target)` for recording returns `null` on unreadable metadata (typed as `string | null | undefined`; pass through `?? null` where `touch` needs `string | null`): write `await this.readId(resolved) ?? null` in `recordOpened`, `noteOrganized`, `noteMoved`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/tests/unit/activity`
Expected: PASS. If the logger import fails under vitest, add at the top of the test: `vi.mock('@/main/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));` (the pattern `metadataHandlers.test.ts` uses).

- [ ] **Step 5: Commit**

```bash
git add src/main/activity/ActivityService.ts src/tests/unit/activity/activityService.test.ts
git commit -m "feat(activity): record opens and organize events, answer Recent"
```

---

### Task 3: IPC surface, preload bridge and renderer typing

**Files:**
- Create: `src/main/activity/ActivityHandlers.ts`
- Modify: `src/preload.ts` (append `activityAPI`)
- Create: `src/renderer/shared/types/activityApi.d.ts`
- Create: `src/tests/helpers/activityApi.ts`
- Test: `src/tests/unit/activity/activityHandlers.test.ts`

**Interfaces:**
- Channels: `activity:record (target, kind)`, `activity:recent (query)`, `activity:clear ()`, event `activity:changed`.
- Produces `window.activityAPI: { record(path, 'opened'): Promise<DiskResult>; recent(query?): Promise<DiskResult<RecentResult>>; clear(): Promise<DiskResult>; onChanged(cb): () => void }`.
- Produces `installActivityApi(overrides?)` and `recentItem(overrides)` test helpers.

- [ ] **Step 1: Write the failing handler test**

```ts
// src/tests/unit/activity/activityHandlers.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMain } from 'electron';
vi.mock('@/main/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
import { ActivityHandlers } from '@/main/activity/ActivityHandlers';
import type { ActivityService } from '@/main/activity/ActivityService';
import { PathNotAllowedError } from '@/main/fs/RootRegistry';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
function ipcStub() {
  const handlers = new Map<string, Handler>();
  return {
    ipc: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) } as unknown as IpcMain,
    invoke: (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args),
    channels: () => [...handlers.keys()].sort(),
  };
}

describe('ActivityHandlers', () => {
  let stub: ReturnType<typeof ipcStub>;
  let service: { recordOpened: ReturnType<typeof vi.fn>; recent: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    stub = ipcStub();
    service = {
      recordOpened: vi.fn(async () => undefined),
      recent: vi.fn(async () => ({ items: [], total: 0, truncated: false, warnings: [] })),
      clear: vi.fn(async () => undefined),
    };
    new ActivityHandlers({ ipc: stub.ipc, service: service as unknown as ActivityService }).registerAll();
  });

  it('registers the activity channels', () => {
    expect(stub.channels()).toEqual(['activity:clear', 'activity:recent', 'activity:record']);
  });

  it('accepts only explicit opens from the renderer', async () => {
    expect(await stub.invoke('activity:record', '/V/a.md', 'opened')).toEqual({ success: true });
    expect(service.recordOpened).toHaveBeenCalledWith('/V/a.md');
    expect(await stub.invoke('activity:record', '/V/a.md', 'organized')).toMatchObject({ success: false });
    expect(await stub.invoke('activity:record', '', 'opened')).toMatchObject({ success: false });
    expect(service.recordOpened).toHaveBeenCalledTimes(1);
  });

  it('validates the recent limit and passes it through', async () => {
    expect(await stub.invoke('activity:recent', { limit: 50 })).toMatchObject({ success: true });
    expect(service.recent).toHaveBeenCalledWith({ limit: 50 });
    expect(await stub.invoke('activity:recent', undefined)).toMatchObject({ success: true });
    expect(await stub.invoke('activity:recent', { limit: -1 })).toMatchObject({ success: false });
    expect(await stub.invoke('activity:recent', { limit: 'lots' })).toMatchObject({ success: false });
  });

  it('surfaces allowed-root refusals and hides other failures', async () => {
    service.recordOpened.mockRejectedValueOnce(new PathNotAllowedError('/x'));
    expect(await stub.invoke('activity:record', '/x', 'opened')).toEqual({ success: false, error: expect.stringMatching(/not inside/i) });
    service.recent.mockRejectedValueOnce(new Error('boom'));
    expect(await stub.invoke('activity:recent', {})).toEqual({ success: false, error: 'Failed to load recent activity' });
    expect(await stub.invoke('activity:clear')).toEqual({ success: true });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/tests/unit/activity/activityHandlers.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement handlers, preload, typing, helper**

```ts
// src/main/activity/ActivityHandlers.ts
import type { IpcMain } from 'electron';
import logger from '@/main/logger';
import type { IPCResponse } from '@/types/ipc';
import type { RecentResult } from '@/types/activity';
import { PathNotAllowedError } from '@/main/fs/RootRegistry';
import type { ActivityService } from './ActivityService';

export interface ActivityHandlerDependencies { ipc: IpcMain; service: ActivityService }

export class ActivityHandlers {
  constructor(private deps: ActivityHandlerDependencies) {}

  registerAll(): void {
    this.deps.ipc.handle('activity:record', async (_, target: unknown, kind: unknown): Promise<IPCResponse> => {
      if (typeof target !== 'string' || target.trim().length === 0 || kind !== 'opened') return { success: false, error: 'Invalid activity request.' };
      return this.respond(async () => { await this.deps.service.recordOpened(target); }, 'Failed to record activity');
    });
    this.deps.ipc.handle('activity:recent', async (_, query: unknown): Promise<IPCResponse<RecentResult>> => {
      const limit = query && typeof query === 'object' ? (query as { limit?: unknown }).limit : undefined;
      if (limit !== undefined && (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1)) return { success: false, error: 'Invalid activity request.' };
      return this.respond(() => this.deps.service.recent(limit === undefined ? {} : { limit }), 'Failed to load recent activity');
    });
    this.deps.ipc.handle('activity:clear', async (): Promise<IPCResponse> =>
      this.respond(async () => { await this.deps.service.clear(); }, 'Failed to clear recent activity'));
  }

  private async respond<T>(operation: () => Promise<T>, fallback: string): Promise<IPCResponse<T>> {
    try {
      const data = await operation();
      return data === undefined ? { success: true } : { success: true, data };
    } catch (error) {
      if (error instanceof PathNotAllowedError) return { success: false, error: error.message };
      logger.error(fallback, error instanceof Error ? error : undefined);
      return { success: false, error: fallback };
    }
  }
}
```

Append to `src/preload.ts`:

```ts
contextBridge.exposeInMainWorld("activityAPI", {
  record: (target: string, kind: "opened") => ipcRenderer.invoke("activity:record", target, kind),
  recent: (query?: { limit?: number }) => ipcRenderer.invoke("activity:recent", query ?? {}),
  clear: () => ipcRenderer.invoke("activity:clear"),
  onChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("activity:changed", listener);
    return () => ipcRenderer.removeListener("activity:changed", listener);
  },
});
```

```ts
// src/renderer/shared/types/activityApi.d.ts
import type { DiskResult } from '@/types/disk';
import type { RecentQuery, RecentResult } from '@/types/activity';

export interface ActivityAPI {
  record: (target: string, kind: 'opened') => Promise<DiskResult>;
  recent: (query?: RecentQuery) => Promise<DiskResult<RecentResult>>;
  clear: () => Promise<DiskResult>;
  onChanged: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    activityAPI: ActivityAPI;
  }
}
```

```ts
// src/tests/helpers/activityApi.ts
import { vi } from 'vitest';
import type { ActivityAPI } from '@/renderer/shared/types/activityApi';
import type { RecentItem, RecentResult } from '@/types/activity';
import { entry } from './diskApi';

export function recentItem(over: Partial<RecentItem> & { entry: Parameters<typeof entry>[0] }): RecentItem {
  return { touchedAt: 1_000_000, touchedKind: 'opened', openedAt: 1_000_000, organizedAt: null, editedAt: null, ...over, entry: entry(over.entry) };
}

export function recentResult(items: RecentItem[] = [], over: Partial<RecentResult> = {}): RecentResult {
  return { items, total: items.length, truncated: false, warnings: [], ...over };
}

export function installActivityApi(overrides: Partial<ActivityAPI> = {}): ActivityAPI {
  const api: ActivityAPI = {
    record: vi.fn(async () => ({ success: true as const, data: undefined })),
    recent: vi.fn(async () => ({ success: true as const, data: recentResult() })),
    clear: vi.fn(async () => ({ success: true as const, data: undefined })),
    onChanged: vi.fn(() => () => undefined),
    ...overrides,
  };
  (window as unknown as { activityAPI: ActivityAPI }).activityAPI = api;
  return api;
}
```

- [ ] **Step 4: Run handler test and the IPC contract test**

Run: `npx vitest run src/tests/unit/activity src/tests/unit/ipcContract.test.ts`
Expected: PASS. The contract test sees `activity:*` invoked in preload and registered in `ActivityHandlers.ts` (it scans `src/main` recursively).

- [ ] **Step 5: Commit**

```bash
git add src/main/activity/ActivityHandlers.ts src/preload.ts src/renderer/shared/types/activityApi.d.ts src/tests/helpers/activityApi.ts src/tests/unit/activity/activityHandlers.test.ts
git commit -m "feat(activity): expose activity IPC and preload bridge"
```

---

### Task 4: Organize hooks in `MetadataService` and `FileWriter`, main wiring

**Files:**
- Modify: `src/main/fs/MetadataService.ts`
- Modify: `src/main/fs/FileWriter.ts`
- Modify: `src/main.ts`
- Test: extend `src/tests/unit/fs/metadataService.test.ts` and `src/tests/unit/fs/fileWriter.test.ts`

**Interfaces:**
- Consumes `ActivityRecorder` (Task 2). Both services accept an optional `activity?: ActivityRecorder` dependency.

- [ ] **Step 1: Write failing tests**

Append a `describe('activity hooks', …)` block to `metadataService.test.ts`:

```ts
describe('activity hooks', () => {
  function recorder() {
    return { noteOrganized: vi.fn(async () => undefined), noteMoved: vi.fn(async () => undefined), noteRemoved: vi.fn(async () => undefined) };
  }
  it('records organized only after successful property saves and connection changes', async () => {
    const activity = recorder();
    service = new MetadataService({ registry, activity });
    await writeFile(item('a.md'), '# a'); await writeFile(item('b.md'), '# b');
    await expect(service.saveProperties(item('a.md'), props, 'stale')).rejects.toThrow();
    expect(activity.noteOrganized).not.toHaveBeenCalled();
    await save(item('a.md'));
    expect(activity.noteOrganized).toHaveBeenCalledWith(item('a.md'));
    const linked = await service.addRelated(item('a.md'), item('b.md'));
    expect(activity.noteOrganized).toHaveBeenLastCalledWith(item('a.md'));
    expect(activity.noteOrganized).toHaveBeenCalledTimes(2);
    await service.removeRelated(item('b.md'), linked.related[0].edgeId);
    expect(activity.noteOrganized).toHaveBeenLastCalledWith(item('b.md'));
  });
});
```

(`vi` must be imported from vitest in that file.) Append to `fileWriter.test.ts` a block using its existing setup helpers (check the file's `beforeEach` for how `writer`, `root` and a temp `registry` are created and mirror them):

```ts
describe('activity hooks', () => {
  it('remaps on rename and move, removes on trash, and skips failed mutations', async () => {
    const activity = { noteOrganized: vi.fn(async () => undefined), noteMoved: vi.fn(async () => undefined), noteRemoved: vi.fn(async () => undefined) };
    const tracked = new FileWriter({ registry, trashItem: async () => undefined, activity });
    await writeFile(path.join(root, 'a.md'), '# a');
    await mkdir(path.join(root, 'Dest'));
    const renamed = await tracked.rename(path.join(root, 'a.md'), 'b.md');
    expect(activity.noteMoved).toHaveBeenCalledWith(path.join(root, 'a.md'), renamed);
    const moved = await tracked.move(renamed, path.join(root, 'Dest'));
    expect(activity.noteMoved).toHaveBeenLastCalledWith(renamed, moved);
    await expect(tracked.rename(moved, 'bad/name')).rejects.toThrow();
    expect(activity.noteMoved).toHaveBeenCalledTimes(2);
    await tracked.moveToTrash(moved);
    expect(activity.noteRemoved).toHaveBeenCalledWith(moved);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/tests/unit/fs/metadataService.test.ts src/tests/unit/fs/fileWriter.test.ts` → FAIL (`activity` is not a known dependency / recorder never called).

- [ ] **Step 3: Implement**

`MetadataService.ts`: add `import type { ActivityRecorder } from '@/main/activity/ActivityService';`, add `activity?: ActivityRecorder;` to `MetadataServiceDependencies`. In `saveProperties`, `addRelated` (after `await this.write(source)`), and `removeRelated` (after `await this.write(owner)`), insert before the returning `readInternal`:

```ts
await this.deps.activity?.noteOrganized(state.path);      // saveProperties
await this.deps.activity?.noteOrganized(source.path);     // addRelated
await this.deps.activity?.noteOrganized(current.path);    // removeRelated
```

In `addRelated`, the early `return this.readInternal(source.path)` for an already-existing connection is a no-op and must not record.

`FileWriter.ts`: add `activity?: ActivityRecorder;` to `FileWriterDependencies`. In `renameInternal` and `moveInternal`, after the successful rename (every branch that returns `destination`), call `await this.deps.activity?.noteMoved(source, destination);` before `return destination`. The `destination === source` early returns record nothing. In `moveToTrashInternal`, after a successful `trashItem` (both the unmanaged branch and the paired bundle branch), call `await this.deps.activity?.noteRemoved(resolved);`.

`src/main.ts`: after `diskReader` is constructed and before `metadataService`:

```ts
import { ActivityStore } from "@/main/activity/ActivityStore";
import { ActivityService } from "@/main/activity/ActivityService";
import { ActivityHandlers } from "@/main/activity/ActivityHandlers";
import { activityStorePath } from "@/main/library/libraryPaths";

const userDataDir = process.env.OPAL_TEST_USER_DATA_DIR || app.getPath("userData");
const activityStore = new ActivityStore({ storePath: activityStorePath(userDataDir) });
const activityService = new ActivityService({
  registry: rootRegistry,
  store: activityStore,
  statEntry: (target) => diskReader.statEntry(target),
  onChanged: () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("activity:changed", {});
  },
});
const metadataService = new MetadataService({ registry: rootRegistry, activity: activityService });
```

Pass `activity: activityService` into `new FileWriter({...})`. Construct `const activityHandlers = new ActivityHandlers({ ipc: ipcMain, service: activityService });`. Inside `app.whenReady`, after `await rootRegistry.load();` add `await activityStore.load();` and after `metadataHandlers.registerAll();` add `activityHandlers.registerAll();`. Replace the three existing `process.env.OPAL_TEST_USER_DATA_DIR || app.getPath("userData")` expressions with `userDataDir` (define it before `windowStateStore`).

- [ ] **Step 4: Run tests, type check**

Run: `npx vitest run src/tests/unit/fs src/tests/unit/activity src/tests/unit/ipcContract.test.ts` → PASS. Run `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `13`.

- [ ] **Step 5: Commit**

```bash
git add src/main/fs/MetadataService.ts src/main/fs/FileWriter.ts src/main.ts src/tests/unit/fs/metadataService.test.ts src/tests/unit/fs/fileWriter.test.ts
git commit -m "feat(activity): record organize events from metadata and file mutations"
```

---

### Task 5: Collection-aware `FilesLocation` and snapshots

**Files:**
- Modify: `src/renderer/features/disk-explorer/navigation/filesLocation.ts`
- Modify: `src/renderer/features/disk-explorer/navigation/filesLocationSnapshots.ts`
- Modify: `src/renderer/features/shell/components/WorkspaceSidebar.tsx` (serialize call), `src/renderer/features/disk-explorer/components/DiskFolderView.tsx` (snapshot key), `FilesRoute.tsx` (only enough to compile; full behavior in Task 8)
- Test: `src/tests/unit/filesLocation.test.ts` (extend), `src/tests/unit/filesLocationSnapshots` cases inside the same file or a new `filesLocationCollections.test.ts`

**Interfaces (produces):**

```ts
export type FilesCollection = { kind: 'directory'; directory: string } | { kind: 'recent' };
export const RECENT_COLLECTION: FilesCollection;
export function directoryCollection(directory: string): FilesCollection;
export function collectionDirectory(collection: FilesCollection): string | null;
export function locationDirectory(location: FilesLocation): string | null;
export function collectionKey(collection: FilesCollection): string;      // 'recent' | `directory:${path}`
export function sameCollection(a: FilesCollection | null, b: FilesCollection | null): boolean;
export interface FilesBrowseLocation { mode: 'browse'; collection: FilesCollection }
export interface FilesFocusLocation { mode: 'focus'; collection: FilesCollection; file: string }
export function browseCollection(collection: FilesCollection, history?: FilesHistoryMutation): FilesNavigationIntent;
export function browseRecent(history?): FilesNavigationIntent;
export function focusInCollection(collection: FilesCollection, file: string, history?): FilesNavigationIntent;
// browseFiles(directory) and focusFile(directory, file) keep their signatures and build directory collections.
```

- [ ] **Step 1: Write failing tests** (append to `filesLocation.test.ts`)

```ts
describe('collections', () => {
  const roots = ['/Vault'];
  it('keeps directory URLs byte-for-byte stable', () => {
    expect(serializeFilesLocation({ mode: 'browse', collection: { kind: 'directory', directory: '/Vault/A' } })).toBe('?mode=browse&dir=%2FVault%2FA');
    expect(serializeFilesLocation({ mode: 'focus', collection: { kind: 'directory', directory: '/Vault' }, file: '/Vault/a.md' })).toBe('?mode=focus&dir=%2FVault&file=%2FVault%2Fa.md');
  });
  it('round-trips recent browse and focus locations', () => {
    const browse = { mode: 'browse' as const, collection: RECENT_COLLECTION };
    expect(serializeFilesLocation(browse)).toBe('?mode=browse&collection=recent');
    expect(parseFilesLocation('?mode=browse&collection=recent', roots)).toEqual(browse);
    const focus = { mode: 'focus' as const, collection: RECENT_COLLECTION, file: '/Vault/a.md' };
    expect(parseFilesLocation(serializeFilesLocation(focus), roots)).toEqual(focus);
    expect(parseFilesLocation('?mode=focus&collection=recent&file=%2FElsewhere%2Fa.md', roots)).toBeNull();
    expect(parseFilesLocation('?mode=browse&collection=unknown', roots)).toBeNull();
    expect(parseFilesLocation('?mode=browse&collection=recent', [])).toBeNull();
  });
  it('remaps only paths and leaves the recent collection alone', () => {
    const focus = { mode: 'focus' as const, collection: RECENT_COLLECTION, file: '/Vault/Old/a.md' };
    expect(remapFilesLocation(focus, '/Vault/Old', '/Vault/New')).toEqual({ location: { ...focus, file: '/Vault/New/a.md' }, history: 'replace' });
    expect(remapFilesLocation({ mode: 'browse', collection: RECENT_COLLECTION }, '/Vault/Old', '/Vault/New').history).toBe('none');
  });
  it('exposes directory helpers', () => {
    expect(locationDirectory({ mode: 'browse', collection: RECENT_COLLECTION })).toBeNull();
    expect(locationDirectory(browseFiles('/Vault/A').location)).toBe('/Vault/A');
    expect(collectionKey(RECENT_COLLECTION)).toBe('recent');
    expect(sameCollection(directoryCollection('/Vault/A/'), directoryCollection('/Vault/A'))).toBe(true);
    expect(sameCollection(RECENT_COLLECTION, null)).toBe(false);
  });
  it('snapshots scope paths to directory collections only and survive root retention', () => {
    const store = createFilesLocationSnapshotStore();
    const recent = { mode: 'browse' as const, collection: RECENT_COLLECTION };
    store.capture(recent, { selectedPaths: ['/Vault/a.md', '/Other/b.md'], focusedPath: '/Vault/a.md', scroll: { view: 'details', offset: 40 } });
    expect(store.read(recent)?.selectedPaths).toEqual(['/Vault/a.md', '/Other/b.md']);
    store.retainRoots(['/Vault']);
    expect(store.read(recent)).toEqual({ selectedPaths: ['/Vault/a.md'], focusedPath: '/Vault/a.md', scroll: { view: 'details', offset: 40 } });
    store.removeSubtrees(['/Vault/a.md']);
    expect(store.read(recent)?.selectedPaths).toEqual([]);
    store.capture({ mode: 'focus', collection: RECENT_COLLECTION, file: '/Vault/gone.md' }, { selectedPaths: [], focusedPath: null, scroll: null });
    store.removeSubtrees(['/Vault/gone.md']);
    expect(store.size()).toBe(1);
  });
});
```

Import `RECENT_COLLECTION, locationDirectory, collectionKey, sameCollection, directoryCollection, createFilesLocationSnapshotStore` in the test.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/tests/unit/filesLocation.test.ts` → FAIL (type errors / missing exports).

- [ ] **Step 3: Implement the model**

In `filesLocation.ts`:

```ts
export type FilesCollection =
  | { kind: 'directory'; directory: string }
  | { kind: 'recent' };

export const RECENT_COLLECTION: FilesCollection = { kind: 'recent' };
export function directoryCollection(directory: string): FilesCollection {
  return { kind: 'directory', directory: normalizeFsPath(directory) };
}
export function collectionDirectory(collection: FilesCollection): string | null {
  return collection.kind === 'directory' ? collection.directory : null;
}
export function locationDirectory(location: FilesLocation): string | null {
  return collectionDirectory(location.collection);
}
export function collectionKey(collection: FilesCollection): string {
  return collection.kind === 'directory' ? `directory:${normalizeFsPath(collection.directory)}` : collection.kind;
}
export function sameCollection(a: FilesCollection | null, b: FilesCollection | null): boolean {
  return !!a && !!b && collectionKey(a) === collectionKey(b);
}

export interface FilesBrowseLocation { mode: 'browse'; collection: FilesCollection }
export interface FilesFocusLocation { mode: 'focus'; collection: FilesCollection; file: string }
```

`normalizeFilesLocation(candidate, roots)`: return null when no roots. Normalize the collection: for `directory`, apply the existing absolute/within-root checks to `collection.directory`; for `recent`, accept. For focus, normalize `file`, require absolute and within one root; when the collection is a directory also require `file !== directory` and both within one root (existing rule).

`parseFilesLocation`: read `collection` param; if `'recent'` → `RECENT_COLLECTION`; else if `dir` present → `directoryCollection(dir)`; else null. Reject any other `collection` value.

`serializeFilesLocation`: `mode` first; then `dir` for directory collections or `collection=recent`; then `file` for focus.

`browseFiles(directory, history)` → `browseCollection(directoryCollection(directory), history)`. `focusFile(directory, file, history)` → `focusInCollection(directoryCollection(directory), file, history)`. Add `browseRecent(history = 'push')`.

`remapFilesLocation`: remap `collection.directory` when kind is directory, and `file` when focus.

`filesLocationFromState`/`stateFromFilesLocation`: update to build/read directory collections (they are only used by `filesLocation.test.ts`; keep them consistent).

In `filesLocationSnapshots.ts`: `sanitizeFilesLocationSnapshot` scopes with `const scope = options.location ? locationDirectory(options.location) : null; if (scope && !isFsPathAtOrBelow(scope, path)) return false;`. `removeSubtrees`: `const directory = locationDirectory(record.location); if ((directory && isRemoved(directory)) || (record.location.mode === 'focus' && isRemoved(record.location.file)))`. `retainRoots`: build `locationPaths` from `locationDirectory` (skip null) plus `file` for focus; when the array is empty the record is retained.

`WorkspaceSidebar.tsx`: `serializeFilesLocation({ mode: 'browse', collection: directoryCollection(currentDirectory) })`. `DiskFolderView.tsx`: `filesLocationSnapshots.read({ mode: 'browse', collection: directoryCollection(dirPath) })` and the same in `saveScroll`. `FilesRoute.tsx`: replace each `{ mode: 'browse', directory: X }` with `{ mode: 'browse', collection: directoryCollection(X) }`, each `{ mode: 'focus', directory, file }` with `{ mode: 'focus', collection: directoryCollection(directory), file }`, and each `.directory` read with `locationDirectory(loc)` guarded for null (Task 8 finishes the behavior; this step only needs it to compile and keep existing tests green).

- [ ] **Step 4: Run the navigation suites and type check**

Run: `npx vitest run src/tests/unit/filesLocation.test.ts src/tests/unit/filesRoute.test.tsx src/tests/unit/filesNavigation.test.tsx src/tests/unit/workspaceSidebar.test.tsx src/tests/unit/diskFolderView.test.tsx` → PASS. `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `13`.

- [ ] **Step 5: Commit**

```bash
git add -A src/renderer/features/disk-explorer/navigation src/renderer/features/disk-explorer/components src/renderer/features/shell/components/WorkspaceSidebar.tsx src/tests/unit/filesLocation.test.ts
git commit -m "refactor(files): represent the browsed collection explicitly in navigation"
```

---

### Task 6: `currentCollection` in `diskStore`

**Files:**
- Modify: `src/renderer/features/disk-explorer/store/diskStore.ts`, `src/renderer/features/disk-explorer/store/diskPathState.ts`
- Test: `src/tests/unit/diskStore.test.ts` (extend)

**Interfaces (produces):** `DiskState.currentCollection: FilesCollection | null`; `DiskActions.navigateToRecent(): void`. Invariant: `currentDirectory === collectionDirectory(currentCollection)` whenever `currentCollection` is set.

- [ ] **Step 1: Write failing tests** (append to `diskStore.test.ts`, using its existing reset pattern)

```ts
describe('collections', () => {
  it('navigateToDirectory and navigateToRecent keep currentDirectory consistent and clear selection', () => {
    useDiskStore.getState().navigateToDirectory('/Vault/A');
    expect(useDiskStore.getState().currentCollection).toEqual({ kind: 'directory', directory: '/Vault/A' });
    useDiskStore.getState().select('/Vault/A/x.md');
    useDiskStore.getState().navigateToRecent();
    const state = useDiskStore.getState();
    expect(state.currentCollection).toEqual({ kind: 'recent' });
    expect(state.currentDirectory).toBeNull();
    expect(state.selectedPaths).toEqual([]);
    expect(state.focusedPath).toBeNull();
  });
  it('loadRoots keeps a recent collection current instead of substituting a root', async () => {
    installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })) });
    useDiskStore.getState().navigateToRecent();
    await useDiskStore.getState().loadRoots();
    expect(useDiskStore.getState().currentCollection).toEqual({ kind: 'recent' });
    expect(useDiskStore.getState().currentDirectory).toBeNull();
  });
  it('remaps and removes the current directory collection with its path', () => {
    useDiskStore.getState().navigateToDirectory('/Vault/Old');
    pathMutationCoordinator.applyAppMutation({ kind: 'rename', oldPath: '/Vault/Old', newPath: '/Vault/New' });
    expect(useDiskStore.getState().currentCollection).toEqual({ kind: 'directory', directory: '/Vault/New' });
    useDiskStore.setState({ roots: ['/Vault'] });
    pathMutationCoordinator.applyExternalRemoval(['/Vault/New']);
    expect(useDiskStore.getState().currentCollection).toEqual({ kind: 'directory', directory: '/Vault' });
  });
});
```

- [ ] **Step 2: Run to verify failure** → `npx vitest run src/tests/unit/diskStore.test.ts` FAIL.

- [ ] **Step 3: Implement**

`diskStore.ts`: import `type FilesCollection, directoryCollection, collectionDirectory` from `../navigation/filesLocation`. Add `currentCollection: FilesCollection | null` (initial `null`). `navigateToDirectory` sets `currentCollection: directoryCollection(dirPath)` alongside `currentDirectory`. Add:

```ts
navigateToRecent: () =>
  set({
    currentCollection: { kind: 'recent' },
    currentDirectory: null,
    focusedPath: null,
    selectedPath: null,
    selectedPaths: [],
    quickPreviewPath: null,
    isQuickLookOpen: false,
  }),
```

`loadRoots`: when `state.currentCollection?.kind === 'recent'`, return `currentDirectory: null` and keep the collection; otherwise compute `currentDirectory` as today and set `currentCollection: currentDirectory ? directoryCollection(currentDirectory) : null`. `openFolder`: set `currentCollection: directoryCollection(root)` with `currentDirectory: root`.

`diskPathState.ts`: in `remapDiskState` and `removePathsFromDiskState`, after computing `currentDirectory`, set `currentCollection: state.currentCollection?.kind === 'recent' ? state.currentCollection : currentDirectory ? directoryCollection(currentDirectory) : null`.

- [ ] **Step 4: Run** `npx vitest run src/tests/unit/diskStore.test.ts src/tests/unit/filesRoute.test.tsx src/tests/unit/filesNavigation.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/features/disk-explorer/store src/tests/unit/diskStore.test.ts
git commit -m "feat(files): track the current collection in the disk store"
```

---

### Task 7: `recentStore`, `recordOpened`, relative time

**Files:**
- Create: `src/renderer/features/disk-explorer/store/recentStore.ts`
- Create: `src/renderer/features/disk-explorer/activity/recordActivity.ts`
- Create: `src/common/relativeTime.ts`
- Test: `src/tests/unit/recentStore.test.ts`, `src/tests/unit/relativeTime.test.ts`

**Interfaces (produces):**

```ts
// recentStore
interface RecentState { result: RecentResult | null; loading: boolean; error: string | null }
interface RecentActions { load(): Promise<void>; clear(): Promise<void>; reset(): void }
export const useRecentStore: UseBoundStore<StoreApi<RecentState & RecentActions>>;
// recordActivity
export function recordOpened(path: string): void;   // no-op when window.activityAPI is absent; never throws
// relativeTime
export function formatRelativeTime(then: number, now: number): string;
export function activityReason(kind: ActivityKind, at: number, now: number): string; // "Opened 10 minutes ago"
```

- [ ] **Step 1: Write failing tests**

```ts
// src/tests/unit/relativeTime.test.ts
import { describe, expect, it } from 'vitest';
import { activityReason, formatRelativeTime } from '@/common/relativeTime';
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
describe('formatRelativeTime', () => {
  const now = Date.UTC(2026, 8, 6, 12, 0, 0);
  it('rounds to friendly units', () => {
    expect(formatRelativeTime(now - 10_000, now)).toBe('just now');
    expect(formatRelativeTime(now - 1 * MIN, now)).toBe('1 minute ago');
    expect(formatRelativeTime(now - 10 * MIN, now)).toBe('10 minutes ago');
    expect(formatRelativeTime(now - 3 * HOUR, now)).toBe('3 hours ago');
    expect(formatRelativeTime(now - 26 * HOUR, now)).toBe('yesterday');
    expect(formatRelativeTime(now - 5 * DAY, now)).toBe('5 days ago');
    expect(formatRelativeTime(now + MIN, now)).toBe('just now');
  });
  it('falls back to a local date beyond two weeks', () => {
    expect(formatRelativeTime(now - 30 * DAY, now)).toMatch(/\d/);
    expect(formatRelativeTime(now - 30 * DAY, now)).not.toMatch(/ago/);
  });
  it('prefixes the activity kind', () => {
    expect(activityReason('opened', now - 10 * MIN, now)).toBe('Opened 10 minutes ago');
    expect(activityReason('organized', now - 26 * HOUR, now)).toBe('Organized yesterday');
    expect(activityReason('edited', now, now)).toBe('Edited just now');
  });
});
```

```ts
// src/tests/unit/recentStore.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRecentStore } from '@/renderer/features/disk-explorer/store/recentStore';
import { recordOpened } from '@/renderer/features/disk-explorer/activity/recordActivity';
import { installActivityApi, recentItem, recentResult } from '@/tests/helpers/activityApi';

beforeEach(() => { useRecentStore.getState().reset(); });

describe('recentStore', () => {
  it('loads results and clears errors', async () => {
    installActivityApi({ recent: vi.fn(async () => ({ success: true as const, data: recentResult([recentItem({ entry: { path: '/V/a.md', name: 'a.md' } })]) })) });
    await useRecentStore.getState().load();
    expect(useRecentStore.getState().result?.items.map((row) => row.entry.path)).toEqual(['/V/a.md']);
    expect(useRecentStore.getState().loading).toBe(false);
  });
  it('reports failures without discarding the last good result', async () => {
    installActivityApi({ recent: vi.fn(async () => ({ success: false as const, error: 'nope' })) });
    useRecentStore.setState({ result: recentResult() });
    await useRecentStore.getState().load();
    expect(useRecentStore.getState()).toMatchObject({ error: 'nope', result: recentResult() });
  });
  it('ignores a stale response that resolves after a newer request', async () => {
    let resolveFirst!: (value: unknown) => void;
    const first = new Promise((resolve) => { resolveFirst = resolve; });
    const recent = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(async () => ({ success: true as const, data: recentResult([recentItem({ entry: { path: '/V/new.md', name: 'new.md' } })]) }));
    installActivityApi({ recent });
    const pending = useRecentStore.getState().load();
    await useRecentStore.getState().load();
    resolveFirst({ success: true, data: recentResult([recentItem({ entry: { path: '/V/old.md', name: 'old.md' } })]) });
    await pending;
    expect(useRecentStore.getState().result?.items[0].entry.path).toBe('/V/new.md');
  });
  it('clear asks main and reloads', async () => {
    const api = installActivityApi();
    await useRecentStore.getState().clear();
    expect(api.clear).toHaveBeenCalled();
    expect(api.recent).toHaveBeenCalled();
  });
});

describe('recordOpened', () => {
  it('forwards explicit opens and tolerates a missing bridge', () => {
    const api = installActivityApi();
    recordOpened('/V/a.md');
    expect(api.record).toHaveBeenCalledWith('/V/a.md', 'opened');
    delete (window as unknown as { activityAPI?: unknown }).activityAPI;
    expect(() => recordOpened('/V/a.md')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure** → FAIL (modules missing).

- [ ] **Step 3: Implement**

```ts
// src/common/relativeTime.ts
import type { ActivityKind } from '@/types/activity';

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;

/** Coarse, stable phrasing; timestamps are UTC epoch ms and dates render locally. */
export function formatRelativeTime(then: number, now: number): string {
  const elapsed = now - then;
  if (elapsed < 45_000) return 'just now';
  if (elapsed < HOUR) { const minutes = Math.max(1, Math.round(elapsed / MINUTE)); return `${minutes} minute${minutes === 1 ? '' : 's'} ago`; }
  if (elapsed < DAY) { const hours = Math.max(1, Math.round(elapsed / HOUR)); return `${hours} hour${hours === 1 ? '' : 's'} ago`; }
  if (elapsed < 2 * DAY) return 'yesterday';
  if (elapsed < 14 * DAY) return `${Math.round(elapsed / DAY)} days ago`;
  return new Date(then).toLocaleDateString();
}

const LABEL: Record<ActivityKind, string> = { opened: 'Opened', organized: 'Organized', edited: 'Edited' };

export function activityReason(kind: ActivityKind, at: number, now: number): string {
  return `${LABEL[kind]} ${formatRelativeTime(at, now)}`;
}
```

```ts
// src/renderer/features/disk-explorer/activity/recordActivity.ts
/**
 * Explicit-open recording. Fire and forget: navigation never waits on activity,
 * and a missing bridge (standalone tests, storybook-style harnesses) is silent.
 */
export function recordOpened(path: string): void {
  const api = typeof window !== 'undefined' ? window.activityAPI : undefined;
  if (!api) return;
  try {
    void Promise.resolve(api.record(path, 'opened')).then((result) => {
      if (result && !result.success) console.warn(`Activity not recorded: ${result.error}`);
    }).catch((error) => console.warn('Activity not recorded', error));
  } catch (error) {
    console.warn('Activity not recorded', error);
  }
}
```

```ts
// src/renderer/features/disk-explorer/store/recentStore.ts
import { create } from 'zustand';
import type { RecentResult } from '@/types/activity';

export interface RecentState { result: RecentResult | null; loading: boolean; error: string | null }
export interface RecentActions { load(): Promise<void>; clear(): Promise<void>; reset(): void }
export type RecentStore = RecentState & RecentActions;

let request = 0;

export const useRecentStore = create<RecentStore>((set) => ({
  result: null,
  loading: false,
  error: null,
  load: async () => {
    const token = ++request;
    set({ loading: true });
    let response: Awaited<ReturnType<typeof window.activityAPI.recent>>;
    try { response = await window.activityAPI.recent({}); } catch { response = { success: false, error: 'Could not load recent activity.' }; }
    if (token !== request) return;
    if (!response.success) { set({ loading: false, error: response.error }); return; }
    set({ loading: false, error: null, result: response.data });
  },
  clear: async () => {
    const response = await window.activityAPI.clear();
    if (!response.success) { set({ error: response.error }); return; }
    await useRecentStore.getState().load();
  },
  reset: () => { request++; set({ result: null, loading: false, error: null }); },
}));
```

- [ ] **Step 4: Run** `npx vitest run src/tests/unit/recentStore.test.ts src/tests/unit/relativeTime.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/common/relativeTime.ts src/renderer/features/disk-explorer/store/recentStore.ts src/renderer/features/disk-explorer/activity src/tests/unit/recentStore.test.ts src/tests/unit/relativeTime.test.ts
git commit -m "feat(files): add recent results store and activity recording helper"
```

---

### Task 8: Extract `CollectionView` from `DiskFolderView`

**Files:**
- Create: `src/renderer/features/disk-explorer/components/CollectionView.tsx`
- Modify: `src/renderer/features/disk-explorer/components/DiskFolderView.tsx`
- Test: existing `diskFolderView.test.tsx`, `multiSelect.test.tsx`, `dragAndDrop.test.tsx`, `gridNavigation.test.tsx`, `emptyStates.test.tsx` must stay green (behavior-preserving refactor)

**Interfaces (produces):**

```ts
export type CollectionViewMode = 'gallery' | 'list';
export interface CollectionRowDecoration { detail: string; secondary?: string }
export interface CollectionViewProps {
  location: FilesBrowseLocation;               // snapshot key
  entries: DiskEntry[];                        // visible: already filtered/sorted
  suggestedMode: CollectionViewMode;
  filter: string;                              // for the no-match empty state
  onClearFilter: () => void;
  emptyState: React.ReactNode;                 // rendered when entries are empty and no filter
  decorate?: (entry: DiskEntry) => CollectionRowDecoration | null;
  countLabel?: string;                         // defaults to "N items"
}
export const CollectionView: React.FC<CollectionViewProps>;
```

- [ ] **Step 1: Move the rendering**

Move everything from the current `DiskFolderView` return statement downward (header with count and mode buttons, empty states, `FixedSizeGrid`/`FixedSizeList`, `VirtualGalleryItem`, `VirtualListItem`, `ModeButton`, `GalleryTile`, `ListRow`, `useDropTarget`, `ICONS`, `ROW_HEIGHT`, `TILE`) into `CollectionView.tsx`. Inside `CollectionView`: read the snapshot with `useState(() => filesLocationSnapshots.read(location))`, keep `mode`, `viewportRef`, `gridRef`, `listRef`, the selection scroll effect, `handleClick`, `saveScroll` (patching `location`), `activate` (via `useFilesNavigation`), `density`, `selectedPath`, `selectedPaths` from `useDiskStore`. Keep every `data-testid` exactly as today.

In `ListRow`, when `decoration` is provided render:

```tsx
<span className="flex min-w-0 flex-1 flex-col">
  <span className="truncate">{entry.name}</span>
  {decoration?.secondary ? <span className="truncate text-2xs text-muted-foreground">{decoration.secondary}</span> : null}
</span>
<span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
  {decoration ? decoration.detail : entry.isDirectory ? '—' : formatBytes(entry.size)}
</span>
```

In `GalleryTile`, under the name, render `{decoration ? <span className="truncate px-1 text-2xs text-muted-foreground">{decoration.detail}</span> : null}`. Pass `decoration={data.decorate?.(entry) ?? null}` from the virtual item components through `CollectionItemData`.

`DiskFolderView` keeps: `loadDirectory` effect, filter reset on `dirPath` change, `suggestedMode`, `visibleEntries`, skeleton when `!entries`, and returns:

```tsx
<CollectionView
  location={{ mode: 'browse', collection: directoryCollection(dirPath) }}
  entries={visibleEntries}
  suggestedMode={suggestedMode}
  filter={filter}
  onClearFilter={() => setFilter('')}
  emptyState={<EmptyState Icon={FolderOpen} title="This folder is empty" description="Add files here or open a different folder to keep browsing." />}
/>
```

The no-match empty state (with `disk-folder-no-matches` and `disk-folder-clear-filter`) lives inside `CollectionView` since every collection filters the same way.

- [ ] **Step 2: Run the affected suites**

Run: `npx vitest run src/tests/unit/diskFolderView.test.tsx src/tests/unit/multiSelect.test.tsx src/tests/unit/dragAndDrop.test.tsx src/tests/unit/gridNavigation.test.tsx src/tests/unit/emptyStates.test.tsx src/tests/unit/filesNavigation.test.tsx src/tests/unit/diskExplorer.test.tsx src/tests/unit/diskExplorerPanes.test.tsx` → PASS with no assertion changes.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/features/disk-explorer/components/CollectionView.tsx src/renderer/features/disk-explorer/components/DiskFolderView.tsx
git commit -m "refactor(files): extract CollectionView from the folder view"
```

---

### Task 9: Recent surface, route handling and explorer integration

**Files:**
- Create: `src/renderer/features/disk-explorer/components/RecentView.tsx`
- Modify: `FilesRoute.tsx`, `DiskExplorer.tsx`, `navigation/FilesNavigationContext.tsx`
- Test: `src/tests/unit/recentView.test.tsx`, extend `src/tests/unit/filesNavigation.test.tsx`

**Interfaces:**
- Consumes `useRecentStore`, `recordOpened`, `activityReason`, `CollectionView`, `RECENT_COLLECTION`, `browseFiles`, `directoryCollection`, `locationDirectory`, `sameCollection`.
- Produces `RecentView: React.FC` (self-contained surface: header + collection); `FilesNavigationActions` unchanged in shape.

- [ ] **Step 1: Write failing tests**

```tsx
// src/tests/unit/recentView.test.tsx
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { FilesRoute } from '@/renderer/features/disk-explorer/components/FilesRoute';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useRecentStore } from '@/renderer/features/disk-explorer/store/recentStore';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { filesLocationSnapshots } from '@/renderer/features/disk-explorer/navigation/filesLocationSnapshots';
import { entry, installDiskApi } from '@/tests/helpers/diskApi';
import { installActivityApi, recentItem, recentResult } from '@/tests/helpers/activityApi';

const ROOT = '/Vault';
const NOTE = '/Vault/Notes/brief.md';
const PDF = '/Vault/Papers/paper.pdf';
const NOW = Date.UTC(2026, 8, 6, 12, 0, 0);

function Harness() {
  const location = useLocation();
  return (<><output data-testid="location">{location.search}</output><FilesRoute /></>);
}
function renderAt(search: string) {
  return render(<MemoryRouter initialEntries={[`/files${search}`]}><Harness /></MemoryRouter>);
}
const rows = () => recentResult([
  recentItem({ entry: { path: NOTE, name: 'brief.md', kind: 'markdown' }, touchedAt: NOW - 10 * 60_000, touchedKind: 'opened', openedAt: NOW - 10 * 60_000 }),
  recentItem({ entry: { path: PDF, name: 'paper.pdf', kind: 'pdf' }, touchedAt: NOW - 26 * 3_600_000, touchedKind: 'organized', organizedAt: NOW - 26 * 3_600_000 }),
]);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
  filesLocationSnapshots.clear();
  useRecentStore.getState().reset();
  installDiskApi({
    listRoots: vi.fn(async () => ({ success: true as const, data: [ROOT] })),
    readDirectory: vi.fn(async (path: string) => ({ success: true as const, data: { path, entries: path === '/Vault/Notes' ? [entry({ path: NOTE, name: 'brief.md', kind: 'markdown' })] : [] } })),
    stat: vi.fn(async (path: string) => ({ success: true as const, data: entry({ path, name: path.split('/').pop()!, kind: 'markdown' }) })),
  });
  installActivityApi({ recent: vi.fn(async () => ({ success: true as const, data: rows() })) });
  useDiskStore.setState({ roots: [], listings: {}, currentDirectory: null, currentCollection: null, focusedPath: null, selectedPath: null, selectedPaths: [], filter: '', loading: { isLoading: false, error: null } });
  useTabsStore.setState({ openPaths: [], openedPath: null, activePath: null, previewPath: null });
});

describe('RecentView', () => {
  it('lists recent items newest first with reasons and locations, without recording', async () => {
    renderAt('?mode=browse&collection=recent');
    expect(await screen.findByText('Opened 10 minutes ago')).toBeInTheDocument();
    expect(screen.getByText('Organized yesterday')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
    const items = screen.getAllByTestId(/disk-folder-entry-/);
    expect(items[0]).toHaveAttribute('data-testid', `disk-folder-entry-${NOTE}`);
    expect(window.activityAPI.record).not.toHaveBeenCalled();
    expect(useDiskStore.getState().currentCollection).toEqual({ kind: 'recent' });
  });

  it('shows the empty state when there is no activity', async () => {
    installActivityApi({ recent: vi.fn(async () => ({ success: true as const, data: recentResult() })) });
    renderAt('?mode=browse&collection=recent');
    expect(await screen.findByText('Items you open or work on will appear here.')).toBeInTheDocument();
  });

  it('opens a result in the recent collection, records the open once, and returns to Recent with selection', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAt('?mode=browse&collection=recent');
    const row = await screen.findByTestId(`disk-folder-entry-${NOTE}`);
    await user.click(row);
    await user.dblClick(row);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`?mode=focus&collection=recent&file=${encodeURIComponent(NOTE)}`));
    expect(window.activityAPI.record).toHaveBeenCalledTimes(1);
    expect(window.activityAPI.record).toHaveBeenCalledWith(NOTE, 'opened');
    await user.click(await screen.findByRole('button', { name: 'Return to folder' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?mode=browse&collection=recent'));
    await waitFor(() => expect(useDiskStore.getState().selectedPaths).toEqual([NOTE]));
    expect(window.activityAPI.record).toHaveBeenCalledTimes(1);
  });

  it('Show in folder navigates to the parent with the item selected and records the folder', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAt('?mode=browse&collection=recent');
    await user.click(await screen.findByTestId(`disk-folder-entry-${NOTE}`));
    await user.click(screen.getByRole('button', { name: 'Show in folder' }));
    await waitFor(() => expect(useDiskStore.getState().currentDirectory).toBe('/Vault/Notes'));
    await waitFor(() => expect(useDiskStore.getState().selectedPaths).toEqual([NOTE]));
    expect(window.activityAPI.record).toHaveBeenCalledWith('/Vault/Notes', 'opened');
  });

  it('reloads when main reports changed activity and clears on request', async () => {
    let changed: (() => void) | null = null;
    const api = installActivityApi({
      recent: vi.fn(async () => ({ success: true as const, data: rows() })),
      onChanged: vi.fn((callback: () => void) => { changed = callback; return () => undefined; }),
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAt('?mode=browse&collection=recent');
    await screen.findByText('Opened 10 minutes ago');
    const calls = (api.recent as ReturnType<typeof vi.fn>).mock.calls.length;
    act(() => changed?.());
    await waitFor(() => expect((api.recent as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls));
    await user.click(screen.getByRole('button', { name: 'Clear recent activity' }));
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(api.clear).toHaveBeenCalled();
  });

  it('shows a retryable error when loading fails', async () => {
    installActivityApi({ recent: vi.fn(async () => ({ success: false as const, error: 'nope' })) });
    renderAt('?mode=browse&collection=recent');
    expect(await screen.findByRole('alert')).toHaveTextContent('nope');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
```

Append to `filesNavigation.test.tsx` (the existing directory harness; add `installActivityApi()` to its `beforeEach` and import the helper):

```tsx
it('records explicit opens and navigations but not restoration, Back or return', async () => {
  const api = installActivityApi();
  await setup();
  expect(api.record).not.toHaveBeenCalled();
  const user = userEvent.setup();
  await user.dblClick(screen.getByTestId(`disk-folder-entry-${FOLDER}`));
  await waitFor(() => expect(useDiskStore.getState().currentDirectory).toBe(FOLDER));
  expect(api.record).toHaveBeenCalledWith(FOLDER, 'opened');
  await user.click(screen.getByRole('button', { name: 'Back' }));
  await waitFor(() => expect(useDiskStore.getState().currentDirectory).toBe(ROOT));
  await user.dblClick(screen.getByTestId(`disk-folder-entry-${NOTE}`));
  await waitFor(() => expect(useTabsStore.getState().openedPath).toBe(NOTE));
  expect(api.record).toHaveBeenCalledWith(NOTE, 'opened');
  await user.click(screen.getByRole('button', { name: 'Return to folder' }));
  await waitFor(() => expect(useTabsStore.getState().openedPath).toBeNull());
  expect(api.record).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run to verify failure** → `npx vitest run src/tests/unit/recentView.test.tsx src/tests/unit/filesNavigation.test.tsx` FAIL.

- [ ] **Step 3: Implement `RecentView`**

```tsx
// src/renderer/features/disk-explorer/components/RecentView.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { Clock, FolderOpen, RotateCw, Search, X } from 'lucide-react';
import { activityReason } from '@/common/relativeTime';
import { filterEntries } from '@/common/filterEntries';
import { parentFsPath, basenameFsPath } from '@/common/fsPaths';
import type { DiskEntry } from '@/types/disk';
import { Button } from '@/renderer/shared/ui';
import { useDiskStore } from '../store/diskStore';
import { useRecentStore } from '../store/recentStore';
import { RECENT_COLLECTION, directoryCollection } from '../navigation/filesLocation';
import { filesLocationSnapshots } from '../navigation/filesLocationSnapshots';
import { useFilesNavigation } from '../navigation/FilesNavigationContext';
import { CollectionView } from './CollectionView';
import { EmptyState } from './EmptyState';
import { GallerySkeleton } from './Skeleton';

function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export const RecentView: React.FC = () => {
  const navigation = useFilesNavigation();
  const result = useRecentStore((state) => state.result);
  const loading = useRecentStore((state) => state.loading);
  const error = useRecentStore((state) => state.error);
  const load = useRecentStore((state) => state.load);
  const clear = useRecentStore((state) => state.clear);
  const filter = useDiskStore((state) => state.filter);
  const setFilter = useDiskStore((state) => state.setFilter);
  const selectedPaths = useDiskStore((state) => state.selectedPaths);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [dismissedWarnings, setDismissedWarnings] = useState<string[]>([]);
  const now = useNow();

  useEffect(() => window.activityAPI?.onChanged?.(() => { void load(); }) ?? undefined, [load]);
  useEffect(() => window.diskAPI.onChanged(() => { void load(); }), [load]);

  const byPath = useMemo(() => new Map((result?.items ?? []).map((item) => [item.entry.path, item])), [result]);
  const entries = useMemo(() => filterEntries((result?.items ?? []).map((item) => item.entry), filter), [result, filter]);
  const decorate = (entry: DiskEntry) => {
    const item = byPath.get(entry.path);
    if (!item) return null;
    const parent = parentFsPath(entry.path);
    return { detail: activityReason(item.touchedKind, item.touchedAt, now), secondary: parent ? basenameFsPath(parent) : undefined };
  };
  const showInFolder = () => {
    const target = selectedPaths.length === 1 ? selectedPaths[0] : null;
    const parent = target ? parentFsPath(target) : null;
    if (!target || !parent) return;
    filesLocationSnapshots.patch({ mode: 'browse', collection: directoryCollection(parent) }, { selectedPaths: [target], focusedPath: target });
    navigation.navigateDirectory(parent);
  };
  const warnings = (result?.warnings ?? []).filter((warning) => !dismissedWarnings.includes(warning));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div data-disk-shortcuts-ignore="true" className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <Clock aria-hidden className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Recent</h2>
        <div className="relative ml-2">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <input type="text" value={filter} onChange={(event) => setFilter(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setFilter(''); }} placeholder="Filter" aria-label="Filter recent items" data-testid="filter-input" className="w-40 rounded-md border border-transparent bg-muted/50 py-1 pl-7 pr-6 text-xs focus:border-ring focus:outline-none" />
          {filter ? <button type="button" onClick={() => setFilter('')} aria-label="Clear filter" className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground"><X className="h-3 w-3" /></button> : null}
        </div>
        <div className="flex-1" />
        <Button size="compact" variant="ghost" disabled={selectedPaths.length !== 1} onClick={showInFolder}>Show in folder</Button>
        {confirmingClear ? (
          <span role="group" aria-label="Confirm clearing recent activity" className="flex items-center gap-1 text-xs">
            <span>Clear all recent activity? Files are not affected.</span>
            <Button size="compact" variant="destructive" onClick={() => { setConfirmingClear(false); void clear(); }}>Clear</Button>
            <Button size="compact" variant="ghost" onClick={() => setConfirmingClear(false)}>Cancel</Button>
          </span>
        ) : (
          <Button size="compact" variant="ghost" disabled={!result || result.items.length === 0} onClick={() => setConfirmingClear(true)}>Clear recent activity</Button>
        )}
      </div>
      {warnings.length > 0 ? (
        <div role="status" className="flex shrink-0 items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
          <div className="flex-1">{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>
          <button type="button" aria-label="Dismiss" onClick={() => setDismissedWarnings((previous) => [...previous, ...warnings])} className="rounded p-1"><X className="h-3 w-3" /></button>
        </div>
      ) : null}
      {error && !result ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p role="alert" className="text-sm text-destructive">{error}</p>
          <Button variant="outline" onClick={() => void load()}><RotateCw aria-hidden className="h-4 w-4" />Retry</Button>
        </div>
      ) : !result && loading ? (
        <GallerySkeleton />
      ) : (
        <CollectionView
          location={{ mode: 'browse', collection: RECENT_COLLECTION }}
          entries={entries}
          suggestedMode="list"
          filter={filter}
          onClearFilter={() => setFilter('')}
          decorate={decorate}
          countLabel={result?.truncated ? `${entries.length} of ${result.total} items` : undefined}
          emptyState={<EmptyState Icon={FolderOpen} title="Nothing recent yet" description="Items you open or work on will appear here." />}
        />
      )}
    </div>
  );
};
```

Check `Button` variants in `src/renderer/shared/ui` and use the closest existing names (`destructive` may need to be `outline`).

- [ ] **Step 4: Integrate in `FilesRoute`**

Replace the directory-only application effect with collection handling:

```ts
const snapshot = filesLocationSnapshots.read({ mode: 'browse', collection: next.collection });
restoring.current = true;
applied.current = next;
const state = useDiskStore.getState();
const directory = collectionDirectory(next.collection);
if (directory) state.navigateToDirectory(directory); else state.navigateToRecent();
if (next.mode === 'focus') useTabsStore.getState().openFile(next.file);
else useTabsStore.setState({ openedPath: null, activePath: null });
let cancelled = false;
const visiblePaths: Promise<string[] | null> = directory
  ? state.loadDirectory(directory).then(() => useDiskStore.getState().listings[directory]?.map((entry) => entry.path) ?? null)
  : useRecentStore.getState().load().then(() => useRecentStore.getState().result?.items.map((item) => item.entry.path) ?? []);
void visiblePaths.then((paths) => {
  if (cancelled) return;
  if (!paths) { /* existing fallback branch, using `directory!` for parent lookup */ return; }
  if (next.mode === 'browse') { /* existing selection restoration using `paths` */ }
  restoring.current = false;
  setReadyKey(key);
});
```

`capture()`: compare `sameCollection(state.currentCollection, current.collection)` instead of `currentDirectory === current.directory`.

`prepareAppMutation`: unchanged (uses `remapFilesLocation`). `preparePathRemoval`: compute `const directory = locationDirectory(previous)`; when `directory` is null (recent), only a removed focus file matters and the fallback is `{ mode: 'browse', collection: RECENT_COLLECTION }`; otherwise keep the existing parent-walk fallback building `directoryCollection`.

Replace `directoryForFile` with:

```ts
const collectionForFile = React.useCallback((file: string, current: FilesCollection | null): FilesCollection | null => {
  if (current?.kind === 'recent') return current;
  const allowedRoots = useDiskStore.getState().roots;
  const directory = current?.kind === 'directory' ? current.directory : null;
  if (directory && allowedRoots.some((root) => isFsPathAtOrBelow(root, directory) && isFsPathAtOrBelow(root, file))) return current;
  const parent = parentFsPath(file);
  return parent ? directoryCollection(parent) : null;
}, []);
```

Actions:

```ts
navigateDirectory: (directory) => { recordOpened(directory); go({ mode: 'browse', collection: directoryCollection(directory) }); },
openFile: (file) => {
  const collection = collectionForFile(file, applied.current?.collection ?? useDiskStore.getState().currentCollection);
  if (collection) { recordOpened(file); go({ mode: 'focus', collection, file }); }
},
returnToFolder: () => { if (applied.current) go({ mode: 'browse', collection: applied.current.collection }); },
closeFile: (path) => { /* same as today, building { mode: 'focus', collection, file } via collectionForFile(file, active.collection) or { mode: 'browse', collection: active.collection } */ },
```

Loading label: `key !== readyKey ? <div role="status">Loading…</div>` (keep "Loading folder…" text so existing tests that look for it still pass; check `filesNavigation.test.tsx` and `filesRoute.test.tsx` for the string before changing it).

- [ ] **Step 5: Integrate in `DiskExplorer`**

- Read `currentCollection` from `useDiskStore`; `const isRecent = currentCollection?.kind === 'recent'`.
- Read `recentItems = useRecentStore((state) => state.result?.items ?? EMPTY)`.
- `visibleEntries`: `if (isRecent) return filterEntries(recentItems.map((item) => item.entry), filter);` before the directory branch.
- `selectedEntry`: after searching `listings`, fall back to `recentItems.find((item) => item.entry.path === selectedPath)?.entry ?? null`.
- Render branch: `openedPath ? focus : isRecent ? (<><div className="flex items-center justify-between gap-2 border-b border-border/60 shrink-0 min-w-0"><div className="min-w-0 flex-1" /><PreviewToggle /></div><div className="min-h-0 flex-1 overflow-hidden"><RecentView /></div></>) : activeDirectory ? folder : empty`. Simplest: render `<RecentView />` in the collection slot and move the existing Preview toggle button into a small local `PreviewToggle` component used by both branches, placed for Recent at the right of `RecentView`'s header by passing `trailing={<PreviewToggle />}` — add an optional `trailing?: React.ReactNode` prop to `RecentView` rendered after the Clear control.
- The `Cmd+A` handler already uses `visibleEntries`; `Cmd+Up` already returns when `activeDirectory` is null.

- [ ] **Step 6: Run the suites**

Run: `npx vitest run src/tests/unit/recentView.test.tsx src/tests/unit/filesNavigation.test.tsx src/tests/unit/filesRoute.test.tsx src/tests/unit/diskExplorer.test.tsx src/tests/unit/diskExplorerPanes.test.tsx src/tests/unit/workspaceSidebar.test.tsx` → PASS. `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `13`.

- [ ] **Step 7: Commit**

```bash
git add -A src/renderer/features/disk-explorer src/tests/unit/recentView.test.tsx src/tests/unit/filesNavigation.test.tsx
git commit -m "feat(files): add the Recent collection with open and back continuity"
```

---

### Task 10: Sidebar entry

**Files:**
- Modify: `src/renderer/features/shell/components/SidebarItem.tsx`, `src/renderer/features/shell/components/WorkspaceSidebar.tsx`
- Test: `src/tests/unit/workspaceSidebar.test.tsx` (extend)

**Interfaces:** `SidebarItem` treats an explicitly passed `active` boolean as authoritative (overrides `NavLink` path matching) so Files and Recent, which share `/files`, never both highlight.

- [ ] **Step 1: Write failing test** (append; mirror the file's `renderSidebar(withFiles)` helper and `installDiskApi` setup, adding `installActivityApi()`)

```tsx
it('offers Recent and highlights it instead of Files while browsing Recent', async () => {
  const user = userEvent.setup();
  renderSidebar(true);
  const recent = await screen.findByRole('link', { name: 'Recent' });
  await user.click(recent);
  await waitFor(() => expect(useDiskStore.getState().currentCollection).toEqual({ kind: 'recent' }));
  expect(recent).toHaveClass('bg-surface-selected');
  expect(screen.getByRole('link', { name: 'Files' })).not.toHaveClass('bg-surface-selected');
});
```

- [ ] **Step 2: Run to verify failure** → `npx vitest run src/tests/unit/workspaceSidebar.test.tsx` FAIL (no Recent link).

- [ ] **Step 3: Implement**

`SidebarItem.tsx`: change the `NavLink` className callback to `cn(rowStyles, (active === undefined ? isActive : active) && 'bg-surface-selected text-foreground', className)` and the prop type to `active?: boolean` with no default.

`WorkspaceSidebar.tsx`: import `Clock` from lucide, `RECENT_COLLECTION`, `directoryCollection` from the navigation module; read `currentCollection` from `useDiskStore` and `location` from `useShell()`. Compute `const onFiles = location.pathname === FILES_ROUTE_PATH; const isRecent = currentCollection?.kind === 'recent';`. Render after the Files item:

```tsx
<SidebarItem
  to={{ pathname: FILES_ROUTE_PATH, search: serializeFilesLocation({ mode: 'browse', collection: RECENT_COLLECTION }) }}
  icon={Clock}
  label="Recent"
  active={onFiles && isRecent}
  onActivate={onNavigate}
/>
```

and pass `active={onFiles && !isRecent}` to the Files item. Leave Notes and Settings without `active` so they keep path matching.

- [ ] **Step 4: Run** `npx vitest run src/tests/unit/workspaceSidebar.test.tsx src/tests/unit/appShell.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/features/shell/components/SidebarItem.tsx src/renderer/features/shell/components/WorkspaceSidebar.tsx src/tests/unit/workspaceSidebar.test.tsx
git commit -m "feat(shell): add Recent to the workspace sidebar"
```

---

### Task 11: Verification and record

**Files:**
- Create: `docs/superpowers/plans/2026-09-06-recent-activity-verification.md`

- [ ] **Step 1: Full unit and contract run**

Run: `npm test` → all pass (expected 726 + new tests). Record the count.

- [ ] **Step 2: Type and lint**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `13`. Run: `npm run lint 2>&1 | tail -3` → `15 problems (0 errors, 15 warnings)`.

- [ ] **Step 3: Electron suite**

Run: `npm run test:e2e 2>&1 | tail -20` → 9 passed, under 60 s. Then `npm test` again is NOT required, but any later `npx vitest run` needs `npm test` first (native ABI).

- [ ] **Step 4: Disposable acceptance**

With `OPAL_TEST_USER_DATA_DIR=<tmp>` and a temp vault seeded like `e2e/helpers/tempVault.ts`, launch the built app (`npm run dev` in the worktree, or the Playwright fixture) and check acceptance criteria 1, 2, 3, 6, 11, 13 from the handoff: open a PDF then a note → Recent lists the note first with a reason; restart → Recent remains, unchanged timestamps; save a description → "Organized just now"; Back from an opened result restores selection; rename through Opal keeps the row; Clear leaves files intact. Do not touch the user's real profile or running app.

- [ ] **Step 5: Write the verification note and commit**

Record counts, what was checked, and known limits (no edited activity, no replacement detection for unannotated items, absolute paths per machine, scroll offset after reorder). Commit:

```bash
git add docs/superpowers/plans/2026-09-06-recent-activity-verification.md
git commit -m "docs: record recent activity verification"
```

---

## Self-review

- **Spec coverage:** library directory (T1), identity/replacement/duplicates (T2), activity table triggers (T2 renderer opens via T9 actions; organize via T4; trash removal via T4; no recording on restore/back/return proven in T9), coalescing/eviction/atomic write/corrupt-preservation/persistence-error (T1), query ordering/limit/closed roots (T2), IPC validation (T3), navigation model and stable URLs (T5), snapshots for Recent (T5), `currentCollection` (T6), recentStore stale guard (T7), CollectionView reuse and stable row keys (T8), RecentView states, Show in folder, Clear, warnings, change subscription (T9), sidebar (T10), verification (T11).
- **Placeholders:** none; every code step carries the code. Task 8 is a move of existing code with named pieces.
- **Type consistency:** `ActivityRecorder` methods `noteOrganized/noteMoved/noteRemoved` used identically in T2 and T4; `recordOpened` name shared by service (main) and helper (renderer) but in different processes and modules; `RECENT_COLLECTION`, `directoryCollection`, `collectionDirectory`, `locationDirectory`, `sameCollection` consistent across T5, T6, T9, T10; `recentResult`/`recentItem` helpers consistent across T3, T7, T9.
