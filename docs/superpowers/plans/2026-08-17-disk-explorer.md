# Disk Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opal can open a real folder on disk, browse it lazily as a tree, and render it — images streaming straight off disk into a gallery — without touching the existing app.

**Architecture:** A new read-only main-process module (`src/main/fs/`) reads real directories behind an allowed-roots guard. A custom `opal-file://` protocol streams file bytes to the renderer so `<img src>` never sees a base64 data URL. A new renderer feature (`src/renderer/features/disk-explorer/`) holds its own Zustand store and components. The existing virtual VFS is untouched and keeps running alongside; this slice adds a second, parallel way to look at data and removes nothing.

**Tech Stack:** Electron 31 (`protocol.handle`, `dialog`), Node 20 (`fs/promises`, `stream.Readable.toWeb`), React 18, Zustand 5, Tailwind, Vitest + happy-dom, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-16-opal-vault-architecture-design.md` — read **Revision 2** first; it supersedes Part I's framing and build order. This plan implements Revision 2's slice 1 only.

## Global Constraints

- **Read-only.** No task in this plan writes, moves, renames, or deletes anything on the user's disk. Writing arrives in slice 2.
- **Additive.** No existing file's behavior changes except `src/main.ts` (CSP + wiring) and `src/preload.ts` (one new API namespace). The virtual VFS, `vfsAPI`, `syncAPI`, and `file-explorer-v2` are not modified, not deleted, and not regressed.
- **Every filesystem path crossing IPC or the protocol handler is validated against the allowed-roots registry.** No exceptions. A path that fails validation is rejected, never clamped or coerced.
- **Absolute paths are POSIX-normalized** (`/` separators, no trailing slash except at filesystem root, symlinks resolved via `fs.realpath` before validation).
- **Main/renderer separation is strict.** No renderer file imports `fs`, `path`, or `electron`. All disk access goes through `window.diskAPI` or `opal-file://`.
- **IPC responses use the existing envelope:** `IPCResponse<T>` from `@/types/ipc` — `{ success: true, data: T }` or `{ success: false, error: string }`.
- **Handler classes follow the existing dependency-injection pattern** established by `src/main/services/vfs/VfsHandlers.ts`: a `Dependencies` interface, constructor takes `deps`, a public `registerAll()`, one private `registerX()` per channel.
- **Tests live under `src/tests/`** and are picked up by `vitest.config.ts` (`src/tests/**/*.{test,spec}.{ts,tsx}`). E2E lives under `e2e/tests/`.
- **Pre-commit runs `eslint --fix` and the full vitest suite** on every staged `*.ts`/`*.tsx` (husky + lint-staged). A commit will not land with failing tests.
- **`npm test` rebuilds better-sqlite3 from source first.** It is slow. For fast iteration use `npx vitest run <path>` directly; use `npm test` before committing.

---

### Task 1: File kind classification and path safety

Pure functions with no I/O. Everything downstream depends on these, and they are the only place path-traversal defense lives.

**Files:**
- Create: `src/common/fileKind.ts`
- Create: `src/main/fs/paths.ts`
- Test: `src/tests/unit/fs/fileKind.test.ts`
- Test: `src/tests/unit/fs/paths.test.ts`

**Why `src/common/`:** `fileKind.ts` has no imports at all — no `fs`, no `path`, no
`electron`. Both processes need it (main to classify directory entries, renderer to pick
an icon), and `src/common/` already exists for exactly this. `paths.ts` imports Node's
`path`, so it stays main-only.

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type FileKind = 'directory' | 'image' | 'markdown' | 'text' | 'pdf' | 'video' | 'audio' | 'other'`
  - `classifyFile(name: string): FileKind` — extension-based, never returns `'directory'`
  - `IMAGE_EXTENSIONS: ReadonlySet<string>` (and `VIDEO_`, `AUDIO_`, `TEXT_`, `MARKDOWN_` equivalents)
  - `normalizePath(p: string): string`
  - `isInsideRoot(root: string, target: string): boolean`

- [ ] **Step 1: Write the failing tests for `classifyFile`**

Create `src/tests/unit/fs/fileKind.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyFile } from '@/common/fileKind';

describe('classifyFile', () => {
  it('classifies common image extensions', () => {
    expect(classifyFile('IMG_2041.jpg')).toBe('image');
    expect(classifyFile('photo.JPEG')).toBe('image');
    expect(classifyFile('icon.png')).toBe('image');
    expect(classifyFile('animation.gif')).toBe('image');
    expect(classifyFile('shot.webp')).toBe('image');
    expect(classifyFile('raw.heic')).toBe('image');
    expect(classifyFile('vector.svg')).toBe('image');
  });

  it('classifies markdown separately from other text', () => {
    expect(classifyFile('note.md')).toBe('markdown');
    expect(classifyFile('README.markdown')).toBe('markdown');
    expect(classifyFile('data.txt')).toBe('text');
    expect(classifyFile('config.json')).toBe('text');
  });

  it('classifies video, audio, and pdf', () => {
    expect(classifyFile('clip.mp4')).toBe('video');
    expect(classifyFile('movie.mov')).toBe('video');
    expect(classifyFile('song.mp3')).toBe('audio');
    expect(classifyFile('voice.m4a')).toBe('audio');
    expect(classifyFile('paper.pdf')).toBe('pdf');
  });

  it('falls back to other for unknown and extensionless names', () => {
    expect(classifyFile('archive.zip')).toBe('other');
    expect(classifyFile('Makefile')).toBe('other');
    expect(classifyFile('binary')).toBe('other');
  });

  it('is case-insensitive and handles multi-dot names', () => {
    expect(classifyFile('IMG.JPG')).toBe('image');
    expect(classifyFile('archive.tar.gz')).toBe('other');
    expect(classifyFile('my.notes.md')).toBe('markdown');
  });

  it('treats a dotfile name as extensionless, not as an extension', () => {
    expect(classifyFile('.gitignore')).toBe('other');
    expect(classifyFile('.env')).toBe('other');
  });

  it('never returns directory', () => {
    expect(classifyFile('some-folder')).not.toBe('directory');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/fs/fileKind.test.ts`
Expected: FAIL — cannot resolve `@/common/fileKind`.

- [ ] **Step 3: Implement `fileKind.ts`**

Create `src/common/fileKind.ts`:

```ts
/**
 * Extension-based file classification. Deliberately cheap: no magic-byte
 * sniffing, no I/O. A wrong guess costs a suboptimal preview, never
 * correctness, so the cost of being wrong does not justify reading bytes.
 */

export type FileKind =
  | 'directory'
  | 'image'
  | 'markdown'
  | 'text'
  | 'pdf'
  | 'video'
  | 'audio'
  | 'other';

export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'heic', 'heif', 'avif', 'svg', 'ico',
]);

export const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set(['md', 'markdown', 'mdx']);

export const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  'txt', 'json', 'yaml', 'yml', 'toml', 'csv', 'tsv', 'log',
  'ts', 'tsx', 'js', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp',
  'css', 'scss', 'html', 'xml', 'sh', 'zsh', 'sql',
]);

export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  'mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v',
]);

export const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set([
  'mp3', 'm4a', 'wav', 'flac', 'aac', 'ogg', 'opus',
]);

/**
 * Returns the lowercased extension without the dot, or '' when the name has
 * none. A leading dot marks a hidden file, not an extension: '.gitignore' has
 * no extension.
 */
export function extensionOf(name: string): string {
  const lastDot = name.lastIndexOf('.');
  if (lastDot <= 0) return '';
  return name.slice(lastDot + 1).toLowerCase();
}

export function classifyFile(name: string): FileKind {
  const ext = extensionOf(name);
  if (!ext) return 'other';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  return 'other';
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/fs/fileKind.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the failing tests for path safety**

Create `src/tests/unit/fs/paths.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizePath, isInsideRoot } from '@/main/fs/paths';

describe('normalizePath', () => {
  it('strips a trailing slash', () => {
    expect(normalizePath('/Users/cody/Photos/')).toBe('/Users/cody/Photos');
  });

  it('preserves the filesystem root', () => {
    expect(normalizePath('/')).toBe('/');
  });

  it('collapses duplicate and dot segments', () => {
    expect(normalizePath('/Users//cody/./Photos')).toBe('/Users/cody/Photos');
    expect(normalizePath('/Users/cody/Docs/../Photos')).toBe('/Users/cody/Photos');
  });
});

describe('isInsideRoot', () => {
  const root = '/Users/cody/Photos';

  it('accepts the root itself', () => {
    expect(isInsideRoot(root, '/Users/cody/Photos')).toBe(true);
  });

  it('accepts descendants at any depth', () => {
    expect(isInsideRoot(root, '/Users/cody/Photos/a.jpg')).toBe(true);
    expect(isInsideRoot(root, '/Users/cody/Photos/Rwanda/2024/b.jpg')).toBe(true);
  });

  it('rejects ancestors and siblings', () => {
    expect(isInsideRoot(root, '/Users/cody')).toBe(false);
    expect(isInsideRoot(root, '/Users/cody/Documents/a.jpg')).toBe(false);
    expect(isInsideRoot(root, '/etc/passwd')).toBe(false);
  });

  it('rejects traversal that escapes the root', () => {
    expect(isInsideRoot(root, '/Users/cody/Photos/../../../etc/passwd')).toBe(false);
    expect(isInsideRoot(root, '/Users/cody/Photos/../Documents/a.jpg')).toBe(false);
  });

  it('rejects a sibling whose name merely starts with the root string', () => {
    expect(isInsideRoot(root, '/Users/cody/PhotosPrivate/a.jpg')).toBe(false);
    expect(isInsideRoot(root, '/Users/cody/Photos-backup')).toBe(false);
  });

  it('tolerates a trailing slash on either argument', () => {
    expect(isInsideRoot('/Users/cody/Photos/', '/Users/cody/Photos/a.jpg')).toBe(true);
    expect(isInsideRoot(root, '/Users/cody/Photos/sub/')).toBe(true);
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/fs/paths.test.ts`
Expected: FAIL — cannot resolve `@/main/fs/paths`.

- [ ] **Step 7: Implement `paths.ts`**

Create `src/main/fs/paths.ts`:

```ts
import path from 'path';

/**
 * Canonical form for every path that crosses a process boundary: absolute,
 * POSIX-separated, no trailing slash except at the filesystem root, with '.'
 * and '..' segments resolved lexically.
 *
 * This does NOT resolve symlinks — that requires I/O. Callers that make a
 * security decision must call fs.realpath first (see RootRegistry).
 */
export function normalizePath(p: string): string {
  const resolved = path.posix.normalize(p.split(path.sep).join(path.posix.sep));
  if (resolved.length > 1 && resolved.endsWith('/')) {
    return resolved.slice(0, -1);
  }
  return resolved;
}

/**
 * True when `target` is `root` or lives beneath it.
 *
 * Compares segment-wise rather than by string prefix, so '/a/Photos-backup'
 * is correctly rejected against root '/a/Photos' — a plain startsWith check
 * is the classic bug here and would let a sibling directory through.
 */
export function isInsideRoot(root: string, target: string): boolean {
  const normalizedRoot = normalizePath(root);
  const normalizedTarget = normalizePath(target);

  if (normalizedTarget === normalizedRoot) return true;

  const prefix = normalizedRoot === '/' ? '/' : `${normalizedRoot}/`;
  return normalizedTarget.startsWith(prefix);
}
```

- [ ] **Step 8: Run and confirm both suites pass**

Run: `npx vitest run src/tests/unit/fs/`
Expected: PASS, 16 tests across 2 files (7 + 9).

- [ ] **Step 9: Commit**

```bash
git add src/common/fileKind.ts src/main/fs/paths.ts src/tests/unit/fs/
git commit -m "feat(fs): add file kind classification and path containment checks"
```

---

### Task 2: Allowed-roots registry

The security boundary. Every path that crosses IPC or the protocol handler is checked here. Persists to JSON in `userData` so roots survive a restart.

**Files:**
- Create: `src/main/fs/RootRegistry.ts`
- Test: `src/tests/unit/fs/rootRegistry.test.ts`

**Interfaces:**
- Consumes: `normalizePath`, `isInsideRoot` from Task 1.
- Produces:
  - `interface RootRegistryDependencies { storePath: string }`
  - `class RootRegistry` with:
    - `async load(): Promise<void>`
    - `list(): string[]`
    - `async add(rootPath: string): Promise<string>` — returns the normalized real path it stored
    - `async remove(rootPath: string): Promise<void>`
    - `async assertAllowed(target: string): Promise<string>` — returns the resolved real path, or throws `PathNotAllowedError`
  - `class PathNotAllowedError extends Error`

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/fs/rootRegistry.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import { RootRegistry, PathNotAllowedError } from '@/main/fs/RootRegistry';

let tmp: string;
let storePath: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-roots-'));
  storePath = path.join(tmp, 'roots.json');
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('RootRegistry', () => {
  it('starts empty when no store file exists', async () => {
    const registry = new RootRegistry({ storePath });
    await registry.load();
    expect(registry.list()).toEqual([]);
  });

  it('adds a root and reports it', async () => {
    const photos = path.join(tmp, 'Photos');
    await mkdir(photos);

    const registry = new RootRegistry({ storePath });
    await registry.load();
    await registry.add(photos);

    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]).toContain('Photos');
  });

  it('persists roots across instances', async () => {
    const photos = path.join(tmp, 'Photos');
    await mkdir(photos);

    const first = new RootRegistry({ storePath });
    await first.load();
    await first.add(photos);

    const second = new RootRegistry({ storePath });
    await second.load();
    expect(second.list()).toHaveLength(1);
  });

  it('does not add the same root twice', async () => {
    const photos = path.join(tmp, 'Photos');
    await mkdir(photos);

    const registry = new RootRegistry({ storePath });
    await registry.load();
    await registry.add(photos);
    await registry.add(photos);
    await registry.add(`${photos}/`);

    expect(registry.list()).toHaveLength(1);
  });

  it('rejects adding a path that is not a directory', async () => {
    const file = path.join(tmp, 'a.txt');
    await writeFile(file, 'hi');

    const registry = new RootRegistry({ storePath });
    await registry.load();
    await expect(registry.add(file)).rejects.toThrow(/not a directory/i);
  });

  it('removes a root', async () => {
    const photos = path.join(tmp, 'Photos');
    await mkdir(photos);

    const registry = new RootRegistry({ storePath });
    await registry.load();
    const stored = await registry.add(photos);
    await registry.remove(stored);

    expect(registry.list()).toEqual([]);
  });

  it('allows a descendant of a root', async () => {
    const photos = path.join(tmp, 'Photos');
    await mkdir(path.join(photos, 'Rwanda'), { recursive: true });
    const image = path.join(photos, 'Rwanda', 'a.jpg');
    await writeFile(image, 'bytes');

    const registry = new RootRegistry({ storePath });
    await registry.load();
    await registry.add(photos);

    await expect(registry.assertAllowed(image)).resolves.toContain('a.jpg');
  });

  it('rejects a path outside every root', async () => {
    const photos = path.join(tmp, 'Photos');
    const secrets = path.join(tmp, 'Secrets');
    await mkdir(photos);
    await mkdir(secrets);
    const secret = path.join(secrets, 'passwords.txt');
    await writeFile(secret, 'hunter2');

    const registry = new RootRegistry({ storePath });
    await registry.load();
    await registry.add(photos);

    await expect(registry.assertAllowed(secret)).rejects.toThrow(PathNotAllowedError);
  });

  it('rejects traversal out of a root', async () => {
    const photos = path.join(tmp, 'Photos');
    const secrets = path.join(tmp, 'Secrets');
    await mkdir(photos);
    await mkdir(secrets);
    await writeFile(path.join(secrets, 'passwords.txt'), 'hunter2');

    const registry = new RootRegistry({ storePath });
    await registry.load();
    await registry.add(photos);

    const escape = path.join(photos, '..', 'Secrets', 'passwords.txt');
    await expect(registry.assertAllowed(escape)).rejects.toThrow(PathNotAllowedError);
  });

  it('rejects everything when no roots are registered', async () => {
    const registry = new RootRegistry({ storePath });
    await registry.load();
    await expect(registry.assertAllowed(tmp)).rejects.toThrow(PathNotAllowedError);
  });

  it('survives a corrupt store file by starting empty', async () => {
    await writeFile(storePath, 'not json at all');
    const registry = new RootRegistry({ storePath });
    await registry.load();
    expect(registry.list()).toEqual([]);
  });

  it('drops roots that no longer exist on disk when loading', async () => {
    const photos = path.join(tmp, 'Photos');
    await mkdir(photos);

    const first = new RootRegistry({ storePath });
    await first.load();
    await first.add(photos);

    await rm(photos, { recursive: true, force: true });

    const second = new RootRegistry({ storePath });
    await second.load();
    expect(second.list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/fs/rootRegistry.test.ts`
Expected: FAIL — cannot resolve `@/main/fs/RootRegistry`.

- [ ] **Step 3: Implement `RootRegistry.ts`**

Create `src/main/fs/RootRegistry.ts`:

```ts
import { readFile, writeFile, mkdir, realpath, stat } from 'fs/promises';
import path from 'path';
import { normalizePath, isInsideRoot } from '@/main/fs/paths';

export class PathNotAllowedError extends Error {
  constructor(target: string) {
    super(`Path is not inside any folder you have opened: ${target}`);
    this.name = 'PathNotAllowedError';
  }
}

export interface RootRegistryDependencies {
  /** Absolute path to the JSON file holding the root list. */
  storePath: string;
}

interface RootStoreFile {
  version: 1;
  roots: string[];
}

/**
 * The security boundary for all filesystem access.
 *
 * Opal may only read inside folders the user explicitly opened. Without this,
 * a compromised renderer could read any file the user can read, since both the
 * IPC surface and the opal-file:// protocol take arbitrary paths.
 *
 * Every check resolves symlinks first (fs.realpath), because a symlink inside
 * an allowed root can otherwise point anywhere on the disk.
 */
export class RootRegistry {
  private deps: RootRegistryDependencies;
  private roots: string[] = [];

  constructor(deps: RootRegistryDependencies) {
    this.deps = deps;
  }

  async load(): Promise<void> {
    let parsed: RootStoreFile | null = null;

    try {
      const raw = await readFile(this.deps.storePath, 'utf-8');
      parsed = JSON.parse(raw) as RootStoreFile;
    } catch {
      // Missing or corrupt store: start empty rather than fail to boot. Losing
      // the recent-folders list is a cosmetic problem; refusing to start is not.
      this.roots = [];
      return;
    }

    const candidates = Array.isArray(parsed?.roots) ? parsed.roots : [];

    // Drop roots that have since been deleted or unmounted, so a stale entry
    // never sits in the allow-list pointing at a path that could be recreated
    // by something else.
    const surviving: string[] = [];
    for (const candidate of candidates) {
      try {
        const real = normalizePath(await realpath(candidate));
        const info = await stat(real);
        if (info.isDirectory()) surviving.push(real);
      } catch {
        // Gone. Skip it.
      }
    }

    this.roots = [...new Set(surviving)];
  }

  list(): string[] {
    return [...this.roots];
  }

  async add(rootPath: string): Promise<string> {
    const real = normalizePath(await realpath(rootPath));
    const info = await stat(real);
    if (!info.isDirectory()) {
      throw new Error(`Cannot open as a folder because it is not a directory: ${rootPath}`);
    }

    if (!this.roots.includes(real)) {
      this.roots.push(real);
      await this.persist();
    }

    return real;
  }

  async remove(rootPath: string): Promise<void> {
    const normalized = normalizePath(rootPath);
    const next = this.roots.filter((root) => root !== normalized);
    if (next.length !== this.roots.length) {
      this.roots = next;
      await this.persist();
    }
  }

  /**
   * Resolves `target` and confirms it lives inside a registered root.
   * Returns the resolved real path — callers should use that, not the input,
   * so downstream I/O cannot be redirected by a symlink swapped in later.
   */
  async assertAllowed(target: string): Promise<string> {
    let real: string;
    try {
      real = normalizePath(await realpath(target));
    } catch {
      throw new PathNotAllowedError(target);
    }

    const allowed = this.roots.some((root) => isInsideRoot(root, real));
    if (!allowed) throw new PathNotAllowedError(target);

    return real;
  }

  private async persist(): Promise<void> {
    const payload: RootStoreFile = { version: 1, roots: this.roots };
    await mkdir(path.dirname(this.deps.storePath), { recursive: true });
    await writeFile(this.deps.storePath, JSON.stringify(payload, null, 2), 'utf-8');
  }
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/fs/rootRegistry.test.ts`
Expected: PASS, 12 tests.

Note: on macOS, `os.tmpdir()` is a symlink (`/var` → `/private/var`), so `realpath` returns `/private/var/...`. The tests use `toContain` and round-trip stored values rather than comparing against raw `tmp` for exactly this reason.

- [ ] **Step 5: Commit**

```bash
git add src/main/fs/RootRegistry.ts src/tests/unit/fs/rootRegistry.test.ts
git commit -m "feat(fs): add allowed-roots registry with symlink-safe containment checks"
```

---

### Task 3: Directory reader

Reads one directory level at a time. No recursion, no crawl — Revision 2's "browse everything, index nothing unless asked" starts here.

**Files:**
- Create: `src/types/disk.ts`
- Create: `src/main/fs/DiskReader.ts`
- Test: `src/tests/unit/fs/diskReader.test.ts`

**Interfaces:**
- Consumes: `classifyFile` (Task 1), `normalizePath` (Task 1), `RootRegistry` (Task 2).
- Produces:
  - `interface DiskEntry { path: string; name: string; kind: FileKind; isDirectory: boolean; size: number; mtimeMs: number; }`
  - `interface DirectoryListing { path: string; entries: DiskEntry[]; }`
  - `class DiskReader` with `async readDirectory(dirPath: string): Promise<DirectoryListing>` and `async statEntry(target: string): Promise<DiskEntry>`

- [ ] **Step 1: Create the shared type**

Create `src/types/disk.ts`:

```ts
import type { FileKind } from '@/common/fileKind';

export type { FileKind };

/** A single file or directory on disk, as seen by the renderer. */
export interface DiskEntry {
  /** Absolute, POSIX-normalized, symlinks resolved. */
  path: string;
  name: string;
  kind: FileKind;
  isDirectory: boolean;
  /** Bytes. 0 for directories. */
  size: number;
  mtimeMs: number;
}

export interface DirectoryListing {
  path: string;
  entries: DiskEntry[];
}

/**
 * A discriminated version of IPCResponse for the disk API.
 *
 * The shared `IPCResponse<T>` declares `data?: T`, so checking `success` does
 * not narrow `data` to non-undefined and every renderer access would need a
 * non-null assertion. This union is structurally compatible with what the
 * handlers return, and gives the renderer real narrowing instead.
 */
export type DiskResult<T = undefined> =
  | { success: true; data: T; error?: undefined }
  | { success: false; error: string; data?: undefined };
```

- [ ] **Step 2: Write the failing test**

Create `src/tests/unit/fs/diskReader.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import { RootRegistry, PathNotAllowedError } from '@/main/fs/RootRegistry';
import { DiskReader } from '@/main/fs/DiskReader';

let tmp: string;
let root: string;
let registry: RootRegistry;
let reader: DiskReader;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-reader-'));
  root = path.join(tmp, 'Vault');
  await mkdir(path.join(root, 'Photos'), { recursive: true });
  await writeFile(path.join(root, 'note.md'), '# hello');
  await writeFile(path.join(root, 'Photos', 'a.jpg'), 'jpegbytes');
  await writeFile(path.join(root, 'Photos', 'b.png'), 'pngbytes');
  await writeFile(path.join(root, '.hidden'), 'secret');

  registry = new RootRegistry({ storePath: path.join(tmp, 'roots.json') });
  await registry.load();
  await registry.add(root);
  reader = new DiskReader({ registry });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('DiskReader.readDirectory', () => {
  it('lists immediate children only', async () => {
    const listing = await reader.readDirectory(root);
    const names = listing.entries.map((e) => e.name).sort();
    expect(names).toEqual(['Photos', 'note.md']);
  });

  it('marks directories and classifies files', async () => {
    const listing = await reader.readDirectory(root);
    const photos = listing.entries.find((e) => e.name === 'Photos');
    const note = listing.entries.find((e) => e.name === 'note.md');

    expect(photos?.isDirectory).toBe(true);
    expect(photos?.kind).toBe('directory');
    expect(note?.isDirectory).toBe(false);
    expect(note?.kind).toBe('markdown');
  });

  it('omits dotfiles by default', async () => {
    const listing = await reader.readDirectory(root);
    expect(listing.entries.some((e) => e.name === '.hidden')).toBe(false);
  });

  it('sorts directories before files, then alphabetically', async () => {
    await mkdir(path.join(root, 'Archive'));
    await writeFile(path.join(root, 'aaa.md'), 'x');

    const listing = await reader.readDirectory(root);
    expect(listing.entries.map((e) => e.name)).toEqual([
      'Archive', 'Photos', 'aaa.md', 'note.md',
    ]);
  });

  it('reports size and mtime for files', async () => {
    const listing = await reader.readDirectory(path.join(root, 'Photos'));
    const a = listing.entries.find((e) => e.name === 'a.jpg');
    expect(a?.size).toBe('jpegbytes'.length);
    expect(a?.mtimeMs).toBeGreaterThan(0);
  });

  it('returns absolute resolved paths', async () => {
    const listing = await reader.readDirectory(root);
    for (const entry of listing.entries) {
      expect(path.isAbsolute(entry.path)).toBe(true);
      expect(entry.path.endsWith(entry.name)).toBe(true);
    }
  });

  it('reads a nested directory that is inside a root', async () => {
    const listing = await reader.readDirectory(path.join(root, 'Photos'));
    expect(listing.entries.map((e) => e.name).sort()).toEqual(['a.jpg', 'b.png']);
  });

  it('refuses a directory outside every root', async () => {
    const outside = path.join(tmp, 'Outside');
    await mkdir(outside);
    await expect(reader.readDirectory(outside)).rejects.toThrow(PathNotAllowedError);
  });

  it('rejects a path that is a file, not a directory', async () => {
    await expect(reader.readDirectory(path.join(root, 'note.md'))).rejects.toThrow(
      /not a directory/i
    );
  });

  it('returns an empty listing for an empty directory', async () => {
    const empty = path.join(root, 'Empty');
    await mkdir(empty);
    const listing = await reader.readDirectory(empty);
    expect(listing.entries).toEqual([]);
  });
});

describe('DiskReader.statEntry', () => {
  it('describes a single file', async () => {
    const entry = await reader.statEntry(path.join(root, 'Photos', 'a.jpg'));
    expect(entry.name).toBe('a.jpg');
    expect(entry.kind).toBe('image');
    expect(entry.isDirectory).toBe(false);
  });

  it('refuses a file outside every root', async () => {
    const outside = path.join(tmp, 'outside.txt');
    await writeFile(outside, 'nope');
    await expect(reader.statEntry(outside)).rejects.toThrow(PathNotAllowedError);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/fs/diskReader.test.ts`
Expected: FAIL — cannot resolve `@/main/fs/DiskReader`.

- [ ] **Step 4: Implement `DiskReader.ts`**

Create `src/main/fs/DiskReader.ts`:

```ts
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { classifyFile } from '@/common/fileKind';
import { normalizePath } from '@/main/fs/paths';
import type { RootRegistry } from '@/main/fs/RootRegistry';
import type { DiskEntry, DirectoryListing } from '@/types/disk';

export interface DiskReaderDependencies {
  registry: RootRegistry;
}

export interface ReadDirectoryOptions {
  /** Include dotfiles. Default false. */
  includeHidden?: boolean;
}

/**
 * Reads one directory level at a time. Never recurses.
 *
 * Laziness is a product decision, not just an optimization: Opal must be able
 * to point at a huge tree and stay responsive without indexing anything the
 * user did not ask it to index.
 */
export class DiskReader {
  private deps: DiskReaderDependencies;

  constructor(deps: DiskReaderDependencies) {
    this.deps = deps;
  }

  async readDirectory(
    dirPath: string,
    options: ReadDirectoryOptions = {}
  ): Promise<DirectoryListing> {
    const resolved = await this.deps.registry.assertAllowed(dirPath);

    const info = await stat(resolved);
    if (!info.isDirectory()) {
      throw new Error(`Cannot list because it is not a directory: ${dirPath}`);
    }

    const dirents = await readdir(resolved, { withFileTypes: true });
    const entries: DiskEntry[] = [];

    for (const dirent of dirents) {
      if (!options.includeHidden && dirent.name.startsWith('.')) continue;

      const childPath = normalizePath(path.join(resolved, dirent.name));

      // A child can vanish between readdir and stat (an external tool deleting
      // during a browse). One missing entry must not fail the whole listing.
      try {
        const childInfo = await stat(childPath);
        const isDirectory = childInfo.isDirectory();
        entries.push({
          path: childPath,
          name: dirent.name,
          kind: isDirectory ? 'directory' : classifyFile(dirent.name),
          isDirectory,
          size: isDirectory ? 0 : childInfo.size,
          mtimeMs: childInfo.mtimeMs,
        });
      } catch {
        continue;
      }
    }

    entries.sort(compareEntries);
    return { path: resolved, entries };
  }

  async statEntry(target: string): Promise<DiskEntry> {
    const resolved = await this.deps.registry.assertAllowed(target);
    const info = await stat(resolved);
    const isDirectory = info.isDirectory();
    const name = path.basename(resolved);

    return {
      path: resolved,
      name,
      kind: isDirectory ? 'directory' : classifyFile(name),
      isDirectory,
      size: isDirectory ? 0 : info.size,
      mtimeMs: info.mtimeMs,
    };
  }
}

/** Directories first, then case-insensitive name order — Finder's convention. */
function compareEntries(a: DiskEntry, b: DiskEntry): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}
```

- [ ] **Step 5: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/fs/diskReader.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add src/types/disk.ts src/main/fs/DiskReader.ts src/tests/unit/fs/diskReader.test.ts
git commit -m "feat(fs): add lazy directory reader with Finder-style sorting"
```

---

### Task 4: The `opal-file://` streaming protocol

Replaces base64-over-IPC. This is the task that makes a folder of photos usable, so it is where the "fast" claim is won or lost.

**Files:**
- Create: `src/common/opalFileUrl.ts` — pure URL and MIME helpers, no Node or Electron imports
- Create: `src/main/protocol/opalFile.ts` — Electron registration only
- Test: `src/tests/unit/fs/opalFileUrl.test.ts`

**Why the split:** the renderer must build the exact same URLs the main-process handler
parses. Duplicating the encoding in two files is a silent-failure hazard — a divergence
shows up only as assets mysteriously 404ing. Since the URL helpers import nothing, they
go in `src/common/` and both sides import the one implementation. It also keeps them
unit-testable: `src/main/protocol/opalFile.ts` imports `electron`, which does not resolve
under vitest, so anything testable must live outside it.

**Interfaces:**
- Consumes: `RootRegistry` (Task 2), `extensionOf` (Task 1).
- Produces, from `@/common/opalFileUrl`:
  - `OPAL_FILE_SCHEME = 'opal-file'`
  - `toOpalFileUrl(absolutePath: string): string`
  - `opalFileUrlToPath(url: string): string`
  - `contentTypeFor(name: string): string`
- Produces, from `@/main/protocol/opalFile`:
  - `registerOpalFileScheme(): void` — call before `app.whenReady()`
  - `registerOpalFileProtocol(deps: { registry: RootRegistry }): void` — call after ready

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/fs/opalFileUrl.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  toOpalFileUrl,
  opalFileUrlToPath,
  contentTypeFor,
  OPAL_FILE_SCHEME,
} from '@/common/opalFileUrl';

describe('opal-file URL round-trip', () => {
  it('uses the opal-file scheme', () => {
    expect(OPAL_FILE_SCHEME).toBe('opal-file');
    expect(toOpalFileUrl('/Users/cody/a.jpg')).toMatch(/^opal-file:\/\//);
  });

  it('round-trips a simple path', () => {
    const p = '/Users/cody/Photos/a.jpg';
    expect(opalFileUrlToPath(toOpalFileUrl(p))).toBe(p);
  });

  it('round-trips spaces', () => {
    const p = '/Users/cody/My Photos/holiday shot.jpg';
    expect(toOpalFileUrl(p)).not.toContain(' ');
    expect(opalFileUrlToPath(toOpalFileUrl(p))).toBe(p);
  });

  it('round-trips characters that are significant in URLs', () => {
    const p = '/Users/cody/Photos/a#b?c&d=e.jpg';
    expect(opalFileUrlToPath(toOpalFileUrl(p))).toBe(p);
  });

  it('round-trips non-ASCII names', () => {
    const p = '/Users/cody/Photos/Rwanda/café — 2024 (½).jpg';
    expect(opalFileUrlToPath(toOpalFileUrl(p))).toBe(p);
  });

  it('round-trips a path containing a percent sign', () => {
    const p = '/Users/cody/Photos/100%_done.jpg';
    expect(opalFileUrlToPath(toOpalFileUrl(p))).toBe(p);
  });

  it('rejects a URL from a different scheme', () => {
    expect(() => opalFileUrlToPath('file:///Users/cody/a.jpg')).toThrow(/scheme/i);
    expect(() => opalFileUrlToPath('https://example.com/a.jpg')).toThrow(/scheme/i);
  });
});

describe('contentTypeFor', () => {
  it('maps common image types', () => {
    expect(contentTypeFor('a.jpg')).toBe('image/jpeg');
    expect(contentTypeFor('a.JPEG')).toBe('image/jpeg');
    expect(contentTypeFor('a.png')).toBe('image/png');
    expect(contentTypeFor('a.gif')).toBe('image/gif');
    expect(contentTypeFor('a.webp')).toBe('image/webp');
    expect(contentTypeFor('a.svg')).toBe('image/svg+xml');
    expect(contentTypeFor('a.heic')).toBe('image/heic');
  });

  it('maps video, audio, pdf, markdown', () => {
    expect(contentTypeFor('a.mp4')).toBe('video/mp4');
    expect(contentTypeFor('a.mov')).toBe('video/quicktime');
    expect(contentTypeFor('a.mp3')).toBe('audio/mpeg');
    expect(contentTypeFor('a.pdf')).toBe('application/pdf');
    expect(contentTypeFor('a.md')).toBe('text/markdown; charset=utf-8');
  });

  it('falls back to octet-stream', () => {
    expect(contentTypeFor('a.unknownext')).toBe('application/octet-stream');
    expect(contentTypeFor('Makefile')).toBe('application/octet-stream');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/fs/opalFileUrl.test.ts`
Expected: FAIL — cannot resolve `@/common/opalFileUrl`.

- [ ] **Step 3: Implement the pure helpers**

Create `src/common/opalFileUrl.ts`:

```ts
import { extensionOf } from '@/common/fileKind';

export const OPAL_FILE_SCHEME = 'opal-file';

/**
 * Assets stream over a custom protocol rather than crossing IPC as base64.
 *
 * The alternative — reading a file, base64-encoding it (+33%), sending it as
 * a string, and decoding it in the renderer — costs several copies of every
 * byte and is unusable for a folder of photos. With a protocol, <img src>
 * pulls bytes straight off disk and Chromium handles decode and caching.
 *
 * The whole absolute path is carried as the URL path, percent-encoded. The
 * host component is left empty ('opal-file:///Users/...') so the URL parses
 * as a standard hierarchical URL.
 */
export function toOpalFileUrl(absolutePath: string): string {
  const encoded = absolutePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${OPAL_FILE_SCHEME}://${encoded}`;
}

export function opalFileUrlToPath(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== `${OPAL_FILE_SCHEME}:`) {
    throw new Error(`Unexpected scheme on asset URL: ${parsed.protocol}`);
  }
  // A registered "standard" scheme parses the first segment as the host, so
  // the absolute path is host + pathname recombined.
  const raw = `${parsed.host}${parsed.pathname}`;
  return decodeURIComponent(raw);
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', tiff: 'image/tiff', tif: 'image/tiff',
  heic: 'image/heic', heif: 'image/heif', avif: 'image/avif',
  svg: 'image/svg+xml', ico: 'image/x-icon',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime',
  webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', flac: 'audio/flac',
  aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/opus',
  pdf: 'application/pdf',
  md: 'text/markdown; charset=utf-8', markdown: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8', json: 'application/json; charset=utf-8',
};

export function contentTypeFor(name: string): string {
  return CONTENT_TYPES[extensionOf(name)] ?? 'application/octet-stream';
}
```

- [ ] **Step 4: Run and confirm the helpers pass**

Run: `npx vitest run src/tests/unit/fs/opalFileUrl.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Implement the Electron registration**

Create `src/main/protocol/opalFile.ts`:

```ts
import { protocol } from 'electron';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { Readable } from 'stream';
import {
  OPAL_FILE_SCHEME,
  opalFileUrlToPath,
  contentTypeFor,
} from '@/common/opalFileUrl';
import type { RootRegistry } from '@/main/fs/RootRegistry';
import { PathNotAllowedError } from '@/main/fs/RootRegistry';
import logger from '@/main/logger';

/**
 * Must run before app.whenReady(). Registering as `standard` gives the scheme
 * normal URL parsing and a proper origin; `stream` enables incremental bodies;
 * `secure` keeps it out of mixed-content warnings. bypassCSP is deliberately
 * NOT set — the scheme is added to the CSP allow-list in main.ts instead, so
 * the policy stays a real policy.
 */
export function registerOpalFileScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: OPAL_FILE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

export interface OpalFileProtocolDependencies {
  registry: RootRegistry;
}

/** Must run after app.whenReady(). */
export function registerOpalFileProtocol(deps: OpalFileProtocolDependencies): void {
  protocol.handle(OPAL_FILE_SCHEME, async (request) => {
    let requestedPath: string;
    try {
      requestedPath = opalFileUrlToPath(request.url);
    } catch {
      return new Response('Bad asset URL', { status: 400 });
    }

    let resolved: string;
    try {
      // Same guard as the IPC surface. Without it this protocol would serve
      // any file the user can read to anything running in the renderer.
      resolved = await deps.registry.assertAllowed(requestedPath);
    } catch (error) {
      if (error instanceof PathNotAllowedError) {
        return new Response('Forbidden', { status: 403 });
      }
      logger.error('opal-file: failed to authorize request', error);
      return new Response('Internal error', { status: 500 });
    }

    try {
      const info = await stat(resolved);
      if (info.isDirectory()) {
        return new Response('Not a file', { status: 400 });
      }

      const body = Readable.toWeb(createReadStream(resolved)) as ReadableStream;

      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': contentTypeFor(resolved),
          'Content-Length': String(info.size),
          // Bytes are addressed by path, and the path's contents can change,
          // so revalidate rather than cache indefinitely.
          'Cache-Control': 'no-cache',
        },
      });
    } catch (error) {
      logger.error(`opal-file: failed to read ${resolved}`, error);
      return new Response('Not found', { status: 404 });
    }
  });
}
```

- [ ] **Step 6: Verify lint and types are clean**

Run: `npx eslint src/common/opalFileUrl.ts src/main/protocol/opalFile.ts && npx tsc --noEmit`
Expected: both produce no output.

Two notes on this file:
- `registerOpalFileScheme` and `registerOpalFileProtocol` are not unit-tested — they are thin wrappers over Electron APIs that only exist inside a real Electron process. Task 10 covers them end to end.
- `Readable.toWeb` is typed as returning a Node `ReadableStream` from `stream/web`, while `Response` wants the DOM `ReadableStream`. The `as ReadableStream` cast bridges that; it is a types-only mismatch, not a runtime one.

- [ ] **Step 7: Commit**

```bash
git add src/common/opalFileUrl.ts src/main/protocol/opalFile.ts \
        src/tests/unit/fs/opalFileUrl.test.ts
git commit -m "feat(protocol): add opal-file:// streaming protocol for disk assets"
```

---

### Task 5: IPC surface — handlers, preload, main wiring

Connects the main-process modules to the renderer, and turns the protocol on.

**Files:**
- Create: `src/main/fs/DiskHandlers.ts`
- Modify: `src/preload.ts` (append one namespace)
- Modify: `src/main.ts` (CSP line, scheme registration, service construction, `registerAll`)
- Create: `src/renderer/shared/types/diskApi.d.ts`
- Test: `src/tests/unit/fs/diskHandlers.test.ts`

**Interfaces:**
- Consumes: `DiskReader` (Task 3), `RootRegistry` (Task 2), `toOpalFileUrl` (Task 4).
- Produces:
  - IPC channels: `disk:open-folder`, `disk:list-roots`, `disk:remove-root`, `disk:read-directory`, `disk:stat`
  - `window.diskAPI` with `openFolder()`, `listRoots()`, `removeRoot(path)`, `readDirectory(path)`, `stat(path)`
  - All return `IPCResponse<T>`.

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/fs/diskHandlers.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import type { IpcMain } from 'electron';
import { RootRegistry } from '@/main/fs/RootRegistry';
import { DiskReader } from '@/main/fs/DiskReader';
import { DiskHandlers } from '@/main/fs/DiskHandlers';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

/** Minimal ipcMain stand-in that records handlers so tests can invoke them. */
function createIpcStub() {
  const handlers = new Map<string, Handler>();
  const ipc = {
    handle: (channel: string, handler: Handler) => { handlers.set(channel, handler); },
  } as unknown as IpcMain;
  return {
    ipc,
    invoke: (channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`No handler registered for ${channel}`);
      return handler({}, ...args);
    },
    channels: () => [...handlers.keys()],
  };
}

let tmp: string;
let root: string;
let stub: ReturnType<typeof createIpcStub>;
let registry: RootRegistry;
let showOpenDialog: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-handlers-'));
  root = path.join(tmp, 'Vault');
  await mkdir(path.join(root, 'Photos'), { recursive: true });
  await writeFile(path.join(root, 'Photos', 'a.jpg'), 'jpegbytes');
  await writeFile(path.join(root, 'note.md'), '# hi');

  registry = new RootRegistry({ storePath: path.join(tmp, 'roots.json') });
  await registry.load();

  stub = createIpcStub();
  showOpenDialog = vi.fn();

  new DiskHandlers({
    ipc: stub.ipc,
    registry,
    reader: new DiskReader({ registry }),
    showOpenDialog,
  }).registerAll();
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('DiskHandlers', () => {
  it('registers every channel', () => {
    expect(stub.channels().sort()).toEqual([
      'disk:list-roots',
      'disk:open-folder',
      'disk:read-directory',
      'disk:remove-root',
      'disk:stat',
    ]);
  });

  it('opens a folder chosen in the dialog and returns it as a root', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [root] });

    const result = await stub.invoke('disk:open-folder') as {
      success: boolean;
      data: { root: string | null };
    };

    expect(result.success).toBe(true);
    expect(result.data.root).toContain('Vault');
    expect(registry.list()).toHaveLength(1);
  });

  it('reports a cancelled dialog as success with a null root', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

    const result = await stub.invoke('disk:open-folder') as {
      success: boolean;
      data: { root: string | null };
    };

    expect(result.success).toBe(true);
    expect(result.data.root).toBeNull();
    expect(registry.list()).toEqual([]);
  });

  it('lists registered roots', async () => {
    await registry.add(root);
    const result = await stub.invoke('disk:list-roots') as {
      success: boolean; data: string[];
    };
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
  });

  it('reads a directory inside a root', async () => {
    await registry.add(root);
    const result = await stub.invoke('disk:read-directory', path.join(root, 'Photos')) as {
      success: boolean;
      data: { entries: { name: string; kind: string }[] };
    };

    expect(result.success).toBe(true);
    expect(result.data.entries).toHaveLength(1);
    expect(result.data.entries[0].name).toBe('a.jpg');
    expect(result.data.entries[0].kind).toBe('image');
  });

  it('fails cleanly for a directory outside every root', async () => {
    await registry.add(root);
    const outside = path.join(tmp, 'Outside');
    await mkdir(outside);

    const result = await stub.invoke('disk:read-directory', outside) as {
      success: boolean; error: string;
    };

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not inside any folder/i);
  });

  it('does not leak internal error details for unexpected failures', async () => {
    await registry.add(root);
    const result = await stub.invoke('disk:read-directory', path.join(root, 'note.md')) as {
      success: boolean; error: string;
    };
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  it('stats a single file', async () => {
    await registry.add(root);
    const result = await stub.invoke('disk:stat', path.join(root, 'Photos', 'a.jpg')) as {
      success: boolean; data: { name: string; kind: string };
    };
    expect(result.success).toBe(true);
    expect(result.data.name).toBe('a.jpg');
    expect(result.data.kind).toBe('image');
  });

  it('removes a root', async () => {
    const stored = await registry.add(root);
    const result = await stub.invoke('disk:remove-root', stored) as { success: boolean };
    expect(result.success).toBe(true);
    expect(registry.list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/fs/diskHandlers.test.ts`
Expected: FAIL — cannot resolve `@/main/fs/DiskHandlers`.

- [ ] **Step 3: Implement `DiskHandlers.ts`**

Create `src/main/fs/DiskHandlers.ts`:

```ts
import type { IpcMain, OpenDialogReturnValue } from 'electron';
import type { IPCResponse } from '@/types/ipc';
import type { DiskEntry, DirectoryListing } from '@/types/disk';
import type { RootRegistry } from '@/main/fs/RootRegistry';
import { PathNotAllowedError } from '@/main/fs/RootRegistry';
import type { DiskReader } from '@/main/fs/DiskReader';
import logger from '@/main/logger';

export interface DiskHandlerDependencies {
  ipc: IpcMain;
  registry: RootRegistry;
  reader: DiskReader;
  /** Injected so the dialog can be stubbed in tests. */
  showOpenDialog: () => Promise<OpenDialogReturnValue>;
}

export class DiskHandlers {
  private deps: DiskHandlerDependencies;

  constructor(deps: DiskHandlerDependencies) {
    this.deps = deps;
  }

  registerAll(): void {
    this.registerOpenFolder();
    this.registerListRoots();
    this.registerRemoveRoot();
    this.registerReadDirectory();
    this.registerStat();
  }

  private registerOpenFolder(): void {
    this.deps.ipc.handle(
      'disk:open-folder',
      async (): Promise<IPCResponse<{ root: string | null }>> => {
        try {
          const result = await this.deps.showOpenDialog();
          if (result.canceled || result.filePaths.length === 0) {
            return { success: true, data: { root: null } };
          }
          const root = await this.deps.registry.add(result.filePaths[0]);
          return { success: true, data: { root } };
        } catch (error) {
          logger.error('Error opening folder:', error);
          return { success: false, error: 'Failed to open folder' };
        }
      }
    );
  }

  private registerListRoots(): void {
    this.deps.ipc.handle('disk:list-roots', async (): Promise<IPCResponse<string[]>> => {
      try {
        return { success: true, data: this.deps.registry.list() };
      } catch (error) {
        logger.error('Error listing roots:', error);
        return { success: false, error: 'Failed to list folders' };
      }
    });
  }

  private registerRemoveRoot(): void {
    this.deps.ipc.handle(
      'disk:remove-root',
      async (_, rootPath: string): Promise<IPCResponse> => {
        try {
          await this.deps.registry.remove(rootPath);
          return { success: true };
        } catch (error) {
          logger.error('Error removing root:', error);
          return { success: false, error: 'Failed to close folder' };
        }
      }
    );
  }

  private registerReadDirectory(): void {
    this.deps.ipc.handle(
      'disk:read-directory',
      async (_, dirPath: string): Promise<IPCResponse<DirectoryListing>> => {
        try {
          const listing = await this.deps.reader.readDirectory(dirPath);
          return { success: true, data: listing };
        } catch (error) {
          return { success: false, error: describeError(error, 'Failed to read folder') };
        }
      }
    );
  }

  private registerStat(): void {
    this.deps.ipc.handle(
      'disk:stat',
      async (_, target: string): Promise<IPCResponse<DiskEntry>> => {
        try {
          const entry = await this.deps.reader.statEntry(target);
          return { success: true, data: entry };
        } catch (error) {
          return { success: false, error: describeError(error, 'Failed to read file') };
        }
      }
    );
  }
}

/**
 * PathNotAllowedError is the one failure the user can act on ("you haven't
 * opened that folder"), so its message is surfaced. Everything else is logged
 * and reported generically rather than leaking internals to the renderer.
 */
function describeError(error: unknown, fallback: string): string {
  if (error instanceof PathNotAllowedError) return error.message;
  if (error instanceof Error && /not a directory/i.test(error.message)) {
    return error.message;
  }
  logger.error(fallback, error);
  return fallback;
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/fs/diskHandlers.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Add the renderer type declarations**

Create `src/renderer/shared/types/diskApi.d.ts`:

```ts
import type { DiskEntry, DirectoryListing, DiskResult } from '@/types/disk';

export interface DiskAPI {
  openFolder: () => Promise<DiskResult<{ root: string | null }>>;
  listRoots: () => Promise<DiskResult<string[]>>;
  removeRoot: (rootPath: string) => Promise<DiskResult>;
  readDirectory: (dirPath: string) => Promise<DiskResult<DirectoryListing>>;
  stat: (target: string) => Promise<DiskResult<DiskEntry>>;
}

declare global {
  interface Window {
    diskAPI: DiskAPI;
  }
}
```

- [ ] **Step 6: Expose the API in preload**

Append to `src/preload.ts`, after the existing `credentialAPI` block:

```ts
contextBridge.exposeInMainWorld("diskAPI", {
  openFolder: () => ipcRenderer.invoke("disk:open-folder"),
  listRoots: () => ipcRenderer.invoke("disk:list-roots"),
  removeRoot: (rootPath: string) => ipcRenderer.invoke("disk:remove-root", rootPath),
  readDirectory: (dirPath: string) => ipcRenderer.invoke("disk:read-directory", dirPath),
  stat: (target: string) => ipcRenderer.invoke("disk:stat", target),
});
```

- [ ] **Step 7: Wire main.ts — imports**

Add to the import block at the top of `src/main.ts`:

```ts
import { RootRegistry } from "@/main/fs/RootRegistry";
import { DiskReader } from "@/main/fs/DiskReader";
import { DiskHandlers } from "@/main/fs/DiskHandlers";
import {
  OPAL_FILE_SCHEME,
  registerOpalFileScheme,
  registerOpalFileProtocol,
} from "@/main/protocol/opalFile";
```

- [ ] **Step 8: Wire main.ts — CSP**

Replace the `CSP` array in `src/main.ts:38-46`. Only the `img-src` and `media-src` lines change:

```ts
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: https: ${OPAL_FILE_SCHEME}:`,
  "font-src 'self' data:",
  "connect-src 'self' https: ws: http://localhost:11434", // Ollama
  `media-src 'self' https: ${OPAL_FILE_SCHEME}:`,
].join("; ");
```

- [ ] **Step 9: Wire main.ts — register the scheme before ready**

`registerSchemesAsPrivileged` must run before the app is ready. Add this immediately after the CSP declaration, at module scope:

```ts
// Must run at module load, before app.whenReady() — Electron requires
// privileged schemes to be declared before the protocol layer initializes.
registerOpalFileScheme();
```

- [ ] **Step 10: Wire main.ts — construct services**

Add alongside the existing service construction (near `const vfsHandlers = new VFSHandlers(...)`):

```ts
// OPAL_TEST_USER_DATA_DIR lets the E2E suite point the roots file at a temp
// directory, mirroring the existing OPAL_TEST_DB_DIR convention. Without it,
// tests would write into the real app's user data and corrupt the user's
// actual list of opened folders.
const rootRegistry = new RootRegistry({
  storePath: path.join(
    process.env.OPAL_TEST_USER_DATA_DIR || app.getPath("userData"),
    "disk-roots.json"
  ),
});
const diskReader = new DiskReader({ registry: rootRegistry });
const diskHandlers = new DiskHandlers({
  ipc: ipcMain,
  registry: rootRegistry,
  reader: diskReader,
  showOpenDialog: async () => {
    const window = BrowserWindow.getFocusedWindow();
    const options = { properties: ["openDirectory" as const] };
    return window
      ? dialog.showOpenDialog(window, options)
      : dialog.showOpenDialog(options);
  },
});
```

- [ ] **Step 11: Wire main.ts — activate inside `app.whenReady()`**

Inside the existing `app.whenReady().then(async () => { ... })` callback, before `createWindow()`:

```ts
await rootRegistry.load();
registerOpalFileProtocol({ registry: rootRegistry });
diskHandlers.registerAll();
```

- [ ] **Step 12: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint --ext .ts,.tsx src/main src/preload.ts`
Expected: both clean.

- [ ] **Step 13: Run the full unit suite**

Run: `npm test`
Expected: PASS — every pre-existing test, plus the 59 added by Tasks 1–5 (16 + 12 + 12 + 10 + 9).

- [ ] **Step 14: Commit**

```bash
git add src/main/fs/DiskHandlers.ts src/renderer/shared/types/diskApi.d.ts \
        src/tests/unit/fs/diskHandlers.test.ts src/preload.ts src/main.ts
git commit -m "feat(fs): wire disk IPC surface and opal-file protocol into the app"
```

---

### Task 6: Renderer store

Holds opened roots, the lazily-loaded entry cache, expansion state, and selection. No component reaches `window.diskAPI` directly.

**Files:**
- Create: `src/renderer/features/disk-explorer/store/diskStore.ts`
- Test: `src/tests/unit/diskStore.test.ts`

**Interfaces:**
- Consumes: `window.diskAPI` (Task 5), `DiskEntry`/`DirectoryListing` (Task 3).
- Produces: `useDiskStore` with state `{ roots, listings, expanded, selectedPath, loading }` and actions `loadRoots`, `openFolder`, `closeRoot`, `loadDirectory`, `toggleExpanded`, `select`, `clearError`.

- [ ] **Step 1: Create the shared renderer test helper**

Every renderer test in Tasks 6–9 needs a fake `window.diskAPI` and a terse way to
build `DiskEntry` fixtures. Both live here so the four test files stay readable.

Create `src/tests/helpers/diskApi.ts`:

```ts
import { vi } from 'vitest';
import type { DiskAPI } from '@/renderer/shared/types/diskApi';
import type { DiskEntry } from '@/types/disk';

/**
 * Installs a fake diskAPI on the real `window`.
 *
 * Deliberately assigns a property instead of `vi.stubGlobal('window', {...})`:
 * spreading `globalThis.window` copies only enumerable own properties, which
 * drops most of the happy-dom DOM surface and breaks Testing Library's
 * render() in every component test.
 */
export function installDiskApi(overrides: Partial<DiskAPI> = {}): DiskAPI {
  const api: DiskAPI = {
    openFolder: vi.fn(async () => ({ success: true as const, data: { root: null } })),
    listRoots: vi.fn(async () => ({ success: true as const, data: [] })),
    removeRoot: vi.fn(async () => ({ success: true as const, data: undefined })),
    readDirectory: vi.fn(async (dirPath: string) => ({
      success: true as const,
      data: { path: dirPath, entries: [] },
    })),
    stat: vi.fn(),
    ...overrides,
  } as DiskAPI;

  (window as unknown as { diskAPI: DiskAPI }).diskAPI = api;
  return api;
}

/** Builds a DiskEntry with sensible defaults so tests only state what matters. */
export function entry(
  over: Partial<DiskEntry> & { path: string; name: string }
): DiskEntry {
  return { kind: 'other', isDirectory: false, size: 0, mtimeMs: 1, ...over };
}
```

- [ ] **Step 2: Write the failing test**

Create `src/tests/unit/diskStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';
import type { DiskEntry } from '@/types/disk';

const ROOT = '/Vault';
const PHOTOS = '/Vault/Photos';

const rootEntries: DiskEntry[] = [
  entry({ path: PHOTOS, name: 'Photos', kind: 'directory', isDirectory: true }),
  entry({ path: '/Vault/note.md', name: 'note.md', kind: 'markdown' }),
];

const photoEntries: DiskEntry[] = [
  entry({ path: '/Vault/Photos/a.jpg', name: 'a.jpg', kind: 'image', size: 100 }),
];

let readDirectory: ReturnType<typeof vi.fn>;
let openFolder: ReturnType<typeof vi.fn>;
let listRoots: ReturnType<typeof vi.fn>;
let removeRoot: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useDiskStore.setState({
    roots: [], listings: {}, expanded: {}, selectedPath: null,
    loading: { isLoading: false, error: null },
  });

  readDirectory = vi.fn(async (p: string) => ({
    success: true,
    data: { path: p, entries: p === ROOT ? rootEntries : photoEntries },
  }));
  openFolder = vi.fn(async () => ({ success: true, data: { root: ROOT } }));
  listRoots = vi.fn(async () => ({ success: true, data: [ROOT] }));
  removeRoot = vi.fn(async () => ({ success: true }));

  // Assign the property rather than replacing `window` wholesale. Spreading
  // `globalThis.window` drops every non-enumerable DOM property, which breaks
  // Testing Library's render() in the component tests that follow.
  installDiskApi({ readDirectory, openFolder, listRoots, removeRoot, stat: vi.fn() });
});

describe('useDiskStore', () => {
  it('loads roots on demand', async () => {
    await useDiskStore.getState().loadRoots();
    expect(useDiskStore.getState().roots).toEqual([ROOT]);
  });

  it('opens a folder, adds it as a root, and loads its listing', async () => {
    await useDiskStore.getState().openFolder();
    const state = useDiskStore.getState();
    expect(state.roots).toContain(ROOT);
    expect(state.listings[ROOT]).toHaveLength(2);
  });

  it('does not add a duplicate root when the same folder is opened twice', async () => {
    await useDiskStore.getState().openFolder();
    await useDiskStore.getState().openFolder();
    expect(useDiskStore.getState().roots).toEqual([ROOT]);
  });

  it('leaves state untouched when the dialog is cancelled', async () => {
    openFolder.mockResolvedValue({ success: true, data: { root: null } });
    await useDiskStore.getState().openFolder();
    expect(useDiskStore.getState().roots).toEqual([]);
  });

  it('caches a listing and does not re-read it', async () => {
    await useDiskStore.getState().loadDirectory(ROOT);
    await useDiskStore.getState().loadDirectory(ROOT);
    expect(readDirectory).toHaveBeenCalledTimes(1);
  });

  it('re-reads a listing when forced', async () => {
    await useDiskStore.getState().loadDirectory(ROOT);
    await useDiskStore.getState().loadDirectory(ROOT, { force: true });
    expect(readDirectory).toHaveBeenCalledTimes(2);
  });

  it('records an error when a read fails, without throwing', async () => {
    readDirectory.mockResolvedValue({ success: false, error: 'Nope' });
    await useDiskStore.getState().loadDirectory(ROOT);
    expect(useDiskStore.getState().loading.error).toBe('Nope');
    expect(useDiskStore.getState().listings[ROOT]).toBeUndefined();
  });

  it('loads children the first time a folder is expanded', async () => {
    await useDiskStore.getState().toggleExpanded(PHOTOS);
    expect(useDiskStore.getState().expanded[PHOTOS]).toBe(true);
    expect(useDiskStore.getState().listings[PHOTOS]).toHaveLength(1);
  });

  it('collapsing does not discard the cached listing', async () => {
    await useDiskStore.getState().toggleExpanded(PHOTOS);
    await useDiskStore.getState().toggleExpanded(PHOTOS);
    expect(useDiskStore.getState().expanded[PHOTOS]).toBe(false);
    expect(useDiskStore.getState().listings[PHOTOS]).toHaveLength(1);
    expect(readDirectory).toHaveBeenCalledTimes(1);
  });

  it('selects an entry', () => {
    useDiskStore.getState().select('/Vault/note.md');
    expect(useDiskStore.getState().selectedPath).toBe('/Vault/note.md');
  });

  it('clears a recorded error', async () => {
    readDirectory.mockResolvedValue({ success: false, error: 'Nope' });
    await useDiskStore.getState().loadDirectory(ROOT);
    expect(useDiskStore.getState().loading.error).toBe('Nope');

    useDiskStore.getState().clearError();
    expect(useDiskStore.getState().loading.error).toBeNull();
  });

  it('closes a root and drops its cached listing and selection', async () => {
    await useDiskStore.getState().openFolder();
    useDiskStore.getState().select('/Vault/note.md');
    await useDiskStore.getState().closeRoot(ROOT);

    const state = useDiskStore.getState();
    expect(state.roots).toEqual([]);
    expect(state.listings[ROOT]).toBeUndefined();
    expect(state.selectedPath).toBeNull();
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/diskStore.test.ts`
Expected: FAIL — cannot resolve the store module.

- [ ] **Step 4: Implement `diskStore.ts`**

Create `src/renderer/features/disk-explorer/store/diskStore.ts`:

```ts
import { create } from 'zustand';
import type { DiskEntry } from '@/types/disk';

export interface DiskState {
  /** Absolute paths of folders the user has opened. */
  roots: string[];
  /** Directory path -> its immediate children. Populated lazily. */
  listings: Record<string, DiskEntry[]>;
  /** Directory path -> whether it is expanded in the tree. */
  expanded: Record<string, boolean>;
  selectedPath: string | null;
  loading: { isLoading: boolean; error: string | null };
}

export interface DiskActions {
  loadRoots: () => Promise<void>;
  openFolder: () => Promise<void>;
  closeRoot: (rootPath: string) => Promise<void>;
  loadDirectory: (dirPath: string, options?: { force?: boolean }) => Promise<void>;
  toggleExpanded: (dirPath: string) => Promise<void>;
  select: (targetPath: string | null) => void;
  clearError: () => void;
}

export type DiskStore = DiskState & DiskActions;

export const useDiskStore = create<DiskStore>((set, get) => ({
  roots: [],
  listings: {},
  expanded: {},
  selectedPath: null,
  loading: { isLoading: false, error: null },

  loadRoots: async () => {
    const response = await window.diskAPI.listRoots();
    if (!response.success) {
      set({ loading: { isLoading: false, error: response.error } });
      return;
    }
    set({ roots: response.data, loading: { isLoading: false, error: null } });
  },

  openFolder: async () => {
    set({ loading: { isLoading: true, error: null } });
    const response = await window.diskAPI.openFolder();

    if (!response.success) {
      set({ loading: { isLoading: false, error: response.error } });
      return;
    }

    const root = response.data.root;
    if (!root) {
      // Dialog cancelled — not an error, and nothing changes.
      set({ loading: { isLoading: false, error: null } });
      return;
    }

    set((state) => ({
      roots: state.roots.includes(root) ? state.roots : [...state.roots, root],
      expanded: { ...state.expanded, [root]: true },
      loading: { isLoading: false, error: null },
    }));

    await get().loadDirectory(root, { force: true });
    get().select(root);
  },

  closeRoot: async (rootPath) => {
    const response = await window.diskAPI.removeRoot(rootPath);
    if (!response.success) {
      set({ loading: { isLoading: false, error: response.error } });
      return;
    }

    set((state) => {
      // Drop every cached listing beneath the closed root, so a later reopen
      // reads fresh rather than showing a stale tree.
      const listings = Object.fromEntries(
        Object.entries(state.listings).filter(([key]) => !isAtOrBelow(rootPath, key))
      );
      const expanded = Object.fromEntries(
        Object.entries(state.expanded).filter(([key]) => !isAtOrBelow(rootPath, key))
      );
      const selectionSurvives =
        state.selectedPath !== null && !isAtOrBelow(rootPath, state.selectedPath);

      return {
        roots: state.roots.filter((root) => root !== rootPath),
        listings,
        expanded,
        selectedPath: selectionSurvives ? state.selectedPath : null,
      };
    });
  },

  loadDirectory: async (dirPath, options = {}) => {
    if (!options.force && get().listings[dirPath]) return;

    set({ loading: { isLoading: true, error: null } });
    const response = await window.diskAPI.readDirectory(dirPath);

    if (!response.success) {
      set({ loading: { isLoading: false, error: response.error } });
      return;
    }

    set((state) => ({
      listings: { ...state.listings, [dirPath]: response.data.entries },
      loading: { isLoading: false, error: null },
    }));
  },

  toggleExpanded: async (dirPath) => {
    const willExpand = !get().expanded[dirPath];
    set((state) => ({ expanded: { ...state.expanded, [dirPath]: willExpand } }));

    // Read children on first expand only; collapsing keeps the cache so
    // re-expanding is instant.
    if (willExpand) await get().loadDirectory(dirPath);
  },

  select: (targetPath) => set({ selectedPath: targetPath }),

  clearError: () => set({ loading: { isLoading: false, error: null } }),
}));

function isAtOrBelow(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}/`);
}
```

- [ ] **Step 5: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/diskStore.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/features/disk-explorer/store/diskStore.ts \
        src/tests/unit/diskStore.test.ts src/tests/helpers/diskApi.ts
git commit -m "feat(disk-explorer): add renderer store with lazy directory loading"
```

---

### Task 7: Tree components

The left-hand tree. Lazy — a folder's children are fetched the first time it is expanded.

**Files:**
- Create: `src/renderer/features/disk-explorer/components/DiskTreeItem.tsx`
- Create: `src/renderer/features/disk-explorer/components/DiskTree.tsx`
- Test: `src/tests/unit/diskTree.test.tsx`

**Interfaces:**
- Consumes: `useDiskStore` (Task 6).
- Produces: `<DiskTree />` (no props — reads the store) and `<DiskTreeItem entry depth />`.

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/diskTree.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { DiskTree } from '@/renderer/features/disk-explorer/components/DiskTree';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';

const ROOT = '/Vault';
const PHOTOS = '/Vault/Photos';

beforeEach(() => {
  installDiskApi({
    readDirectory: vi.fn(async (p: string) => ({
      success: true as const,
      data: {
        path: p,
        entries: p === PHOTOS
          ? [entry({ path: `${PHOTOS}/a.jpg`, name: 'a.jpg', kind: 'image' })]
          : [],
      },
    })),
    listRoots: vi.fn(async () => ({ success: true as const, data: [] })),
  });

  useDiskStore.setState({
    roots: [ROOT],
    listings: {
      [ROOT]: [
        entry({ path: PHOTOS, name: 'Photos', kind: 'directory', isDirectory: true }),
        entry({ path: `${ROOT}/note.md`, name: 'note.md', kind: 'markdown' }),
      ],
    },
    expanded: { [ROOT]: true },
    selectedPath: null,
    loading: { isLoading: false, error: null },
  });
});

describe('DiskTree', () => {
  it('renders the root and its children', () => {
    render(<DiskTree />);
    expect(screen.getByText('Vault')).toBeInTheDocument();
    expect(screen.getByText('Photos')).toBeInTheDocument();
    expect(screen.getByText('note.md')).toBeInTheDocument();
  });

  it('does not render grandchildren before expansion', () => {
    render(<DiskTree />);
    expect(screen.queryByText('a.jpg')).not.toBeInTheDocument();
  });

  it('loads and renders children when a folder is expanded', async () => {
    const user = userEvent.setup();
    render(<DiskTree />);

    await user.click(screen.getByTestId('disk-tree-toggle-/Vault/Photos'));

    await waitFor(() => expect(screen.getByText('a.jpg')).toBeInTheDocument());
    expect(window.diskAPI.readDirectory).toHaveBeenCalledWith(PHOTOS);
  });

  it('selects an entry when its row is clicked', async () => {
    const user = userEvent.setup();
    render(<DiskTree />);

    await user.click(screen.getByTestId('disk-tree-item-/Vault/note.md'));

    expect(useDiskStore.getState().selectedPath).toBe(`${ROOT}/note.md`);
  });

  it('marks the selected row for assistive tech', async () => {
    const user = userEvent.setup();
    render(<DiskTree />);

    await user.click(screen.getByTestId('disk-tree-item-/Vault/note.md'));

    expect(screen.getByTestId('disk-tree-item-/Vault/note.md'))
      .toHaveAttribute('aria-selected', 'true');
  });

  it('prompts to open a folder when no roots exist', () => {
    useDiskStore.setState({ roots: [], listings: {}, expanded: {} });
    render(<DiskTree />);
    expect(screen.getByTestId('disk-tree-empty')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Add the missing test dependency**

`userEvent` is not yet installed.

```bash
npm install --save-dev @testing-library/user-event@^14.5.2
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `npx vitest run src/tests/unit/diskTree.test.tsx`
Expected: FAIL — cannot resolve `DiskTree`.

- [ ] **Step 4: Implement `DiskTreeItem.tsx`**

Create `src/renderer/features/disk-explorer/components/DiskTreeItem.tsx`:

```tsx
import React, { useCallback } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, FileText, Image as ImageIcon, Film, Music, File } from 'lucide-react';
import type { DiskEntry, FileKind } from '@/types/disk';
import { useDiskStore } from '../store/diskStore';

const ICONS: Record<FileKind, React.ComponentType<{ className?: string }>> = {
  directory: Folder,
  image: ImageIcon,
  markdown: FileText,
  text: FileText,
  pdf: File,
  video: Film,
  audio: Music,
  other: File,
};

interface DiskTreeItemProps {
  entry: DiskEntry;
  depth: number;
}

export const DiskTreeItem: React.FC<DiskTreeItemProps> = ({ entry, depth }) => {
  const isExpanded = useDiskStore((state) => Boolean(state.expanded[entry.path]));
  const isSelected = useDiskStore((state) => state.selectedPath === entry.path);
  const children = useDiskStore((state) => state.listings[entry.path]);
  const toggleExpanded = useDiskStore((state) => state.toggleExpanded);
  const select = useDiskStore((state) => state.select);

  const handleSelect = useCallback(() => select(entry.path), [select, entry.path]);

  const handleToggle = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      void toggleExpanded(entry.path);
    },
    [toggleExpanded, entry.path]
  );

  const Icon = entry.isDirectory && isExpanded ? FolderOpen : ICONS[entry.kind];
  const Chevron = isExpanded ? ChevronDown : ChevronRight;

  return (
    <>
      <div
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={entry.isDirectory ? isExpanded : undefined}
        data-testid={`disk-tree-item-${entry.path}`}
        onClick={handleSelect}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        className={[
          'flex items-center gap-1 py-[3px] pr-2 text-sm cursor-default select-none rounded-sm',
          isSelected
            ? 'bg-accent text-accent-foreground'
            : 'hover:bg-muted/60 text-foreground/90',
        ].join(' ')}
      >
        {entry.isDirectory ? (
          <button
            type="button"
            onClick={handleToggle}
            aria-label={isExpanded ? `Collapse ${entry.name}` : `Expand ${entry.name}`}
            data-testid={`disk-tree-toggle-${entry.path}`}
            className="p-0.5 rounded hover:bg-muted shrink-0"
          >
            <Chevron className="h-3 w-3" />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
        <span className="truncate">{entry.name}</span>
      </div>

      {entry.isDirectory && isExpanded && children?.map((child) => (
        <DiskTreeItem key={child.path} entry={child} depth={depth + 1} />
      ))}
    </>
  );
};
```

- [ ] **Step 5: Implement `DiskTree.tsx`**

Create `src/renderer/features/disk-explorer/components/DiskTree.tsx`:

```tsx
import React, { useEffect } from 'react';
import { FolderOpen } from 'lucide-react';
import { useDiskStore } from '../store/diskStore';
import { DiskTreeItem } from './DiskTreeItem';
import type { DiskEntry } from '@/types/disk';

/** A root is displayed as a tree item, so it needs the same shape as a child. */
function rootEntry(rootPath: string): DiskEntry {
  const name = rootPath.split('/').filter(Boolean).pop() ?? rootPath;
  return {
    path: rootPath, name, kind: 'directory', isDirectory: true, size: 0, mtimeMs: 0,
  };
}

export const DiskTree: React.FC = () => {
  const roots = useDiskStore((state) => state.roots);
  const loadRoots = useDiskStore((state) => state.loadRoots);
  const openFolder = useDiskStore((state) => state.openFolder);

  useEffect(() => { void loadRoots(); }, [loadRoots]);

  if (roots.length === 0) {
    return (
      <div
        data-testid="disk-tree-empty"
        className="flex flex-col items-center justify-center gap-3 h-full px-6 text-center"
      >
        <FolderOpen className="h-8 w-8 opacity-30" />
        <p className="text-sm text-muted-foreground">No folder open</p>
        <button
          type="button"
          onClick={() => void openFolder()}
          data-testid="disk-tree-open-folder"
          className="text-sm px-3 py-1.5 rounded-md bg-accent text-accent-foreground hover:opacity-90"
        >
          Open Folder
        </button>
      </div>
    );
  }

  return (
    <div role="tree" aria-label="Files on disk" className="py-1 overflow-auto h-full">
      {roots.map((root) => (
        <DiskTreeItem key={root} entry={rootEntry(root)} depth={0} />
      ))}
    </div>
  );
};
```

- [ ] **Step 6: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/diskTree.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/features/disk-explorer/components/ src/tests/unit/diskTree.test.tsx package.json package-lock.json
git commit -m "feat(disk-explorer): add lazy tree components"
```

---

### Task 8: Folder view with gallery, grid, and list modes

The payoff: a folder of photos rendered as a real gallery, streaming through `opal-file://`.

**Files:**
- Create: `src/renderer/features/disk-explorer/components/DiskFolderView.tsx`
- Test: `src/tests/unit/diskFolderView.test.tsx`

**Interfaces:**
- Consumes: `useDiskStore` (Task 6), `DiskEntry` (Task 3), `toOpalFileUrl` from `@/common/opalFileUrl` (Task 4).
- Produces: `<DiskFolderView dirPath />`

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/diskFolderView.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { DiskFolderView } from '@/renderer/features/disk-explorer/components/DiskFolderView';
import { toOpalFileUrl } from '@/common/opalFileUrl';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';
import type { DiskEntry } from '@/types/disk';

const PHOTOS = '/Vault/Photos';
const listing: DiskEntry[] = [
  entry({ path: `${PHOTOS}/Raw`, name: 'Raw', kind: 'directory', isDirectory: true }),
  entry({ path: `${PHOTOS}/a.jpg`, name: 'a.jpg', kind: 'image', size: 2048 }),
  entry({ path: `${PHOTOS}/b.png`, name: 'b.png', kind: 'image', size: 4096 }),
  entry({ path: `${PHOTOS}/notes.md`, name: 'notes.md', kind: 'markdown', size: 12 }),
];

beforeEach(() => {
  installDiskApi({
    readDirectory: vi.fn(async (p: string) => ({
      success: true as const,
      data: { path: p, entries: listing },
    })),
  });

  useDiskStore.setState({
    roots: ['/Vault'],
    listings: { [PHOTOS]: listing },
    expanded: {},
    selectedPath: null,
    loading: { isLoading: false, error: null },
  });
});

describe('asset URLs', () => {
  it('builds an opal-file URL', () => {
    expect(toOpalFileUrl('/Vault/Photos/a.jpg')).toBe('opal-file:///Vault/Photos/a.jpg');
  });

  it('encodes spaces and characters that are significant in URLs', () => {
    expect(toOpalFileUrl('/Vault/My Photos/a b.jpg')).not.toContain(' ');
    expect(toOpalFileUrl('/Vault/a#b.jpg')).toContain('%23');
  });
});

describe('DiskFolderView', () => {
  it('defaults an image-heavy folder to gallery mode', async () => {
    render(<DiskFolderView dirPath={PHOTOS} />);
    await waitFor(() => expect(screen.getByTestId('disk-folder-gallery')).toBeInTheDocument());
  });

  it('renders images through the opal-file protocol, never as data URLs', async () => {
    render(<DiskFolderView dirPath={PHOTOS} />);

    const image = await screen.findByAltText('a.jpg');
    expect(image.getAttribute('src')).toMatch(/^opal-file:\/\//);
    expect(image.getAttribute('src')).not.toMatch(/^data:/);
  });

  it('lazy-loads gallery images', async () => {
    render(<DiskFolderView dirPath={PHOTOS} />);
    const image = await screen.findByAltText('a.jpg');
    expect(image).toHaveAttribute('loading', 'lazy');
  });

  it('shows every entry including folders and non-images', async () => {
    render(<DiskFolderView dirPath={PHOTOS} />);
    await waitFor(() => expect(screen.getByText('Raw')).toBeInTheDocument());
    expect(screen.getByText('notes.md')).toBeInTheDocument();
  });

  it('switches to list mode and shows a size column', async () => {
    const user = userEvent.setup();
    render(<DiskFolderView dirPath={PHOTOS} />);

    await user.click(await screen.findByTestId('disk-folder-view-list'));

    expect(screen.getByTestId('disk-folder-list')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
  });

  it('selects an entry on click', async () => {
    const user = userEvent.setup();
    render(<DiskFolderView dirPath={PHOTOS} />);

    await user.click(await screen.findByTestId('disk-folder-entry-/Vault/Photos/a.jpg'));

    expect(useDiskStore.getState().selectedPath).toBe(`${PHOTOS}/a.jpg`);
  });

  it('defaults a folder with no images to list mode', async () => {
    const docs = '/Vault/Docs';
    useDiskStore.setState({
      listings: {
        [docs]: [entry({ path: `${docs}/a.md`, name: 'a.md', kind: 'markdown', size: 10 })],
      },
    });

    render(<DiskFolderView dirPath={docs} />);
    await waitFor(() => expect(screen.getByTestId('disk-folder-list')).toBeInTheDocument());
  });

  it('renders an empty state for an empty folder', async () => {
    const empty = '/Vault/Empty';
    useDiskStore.setState({ listings: { [empty]: [] } });

    render(<DiskFolderView dirPath={empty} />);
    await waitFor(() => expect(screen.getByTestId('disk-folder-empty')).toBeInTheDocument());
  });

  it('requests the listing when it is not already cached', async () => {
    useDiskStore.setState({ listings: {} });
    render(<DiskFolderView dirPath={PHOTOS} />);
    await waitFor(() => expect(window.diskAPI.readDirectory).toHaveBeenCalledWith(PHOTOS));
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/diskFolderView.test.tsx`
Expected: FAIL — cannot resolve `DiskFolderView`.

- [ ] **Step 3: Implement `DiskFolderView.tsx`**

Create `src/renderer/features/disk-explorer/components/DiskFolderView.tsx`:

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { LayoutGrid, List as ListIcon, Image as ImageIcon, Folder, FileText, Film, Music, File } from 'lucide-react';
import type { DiskEntry, FileKind } from '@/types/disk';
import { useDiskStore } from '../store/diskStore';
import { toOpalFileUrl } from '@/common/opalFileUrl';

type ViewMode = 'gallery' | 'list';

const ICONS: Record<FileKind, React.ComponentType<{ className?: string }>> = {
  directory: Folder, image: ImageIcon, markdown: FileText, text: FileText,
  pdf: File, video: Film, audio: Music, other: File,
};

function formatSize(bytes: number): string {
  if (bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  // Number() strips a trailing '.0' so 2048 reads as "2 KB", not "2.0 KB".
  const rounded = exponent === 0 ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded} ${units[exponent]}`;
}

interface DiskFolderViewProps {
  dirPath: string;
}

export const DiskFolderView: React.FC<DiskFolderViewProps> = ({ dirPath }) => {
  const entries = useDiskStore((state) => state.listings[dirPath]);
  const loadDirectory = useDiskStore((state) => state.loadDirectory);
  const select = useDiskStore((state) => state.select);
  const selectedPath = useDiskStore((state) => state.selectedPath);

  const [mode, setMode] = useState<ViewMode | null>(null);

  useEffect(() => { void loadDirectory(dirPath); }, [dirPath, loadDirectory]);

  // A folder that is mostly pictures wants to be looked at, not listed. The
  // user's explicit choice always wins once they make one.
  const suggestedMode: ViewMode = useMemo(() => {
    if (!entries || entries.length === 0) return 'list';
    const images = entries.filter((entry) => entry.kind === 'image').length;
    return images > 0 && images >= entries.length / 2 ? 'gallery' : 'list';
  }, [entries]);

  const activeMode = mode ?? suggestedMode;

  if (!entries) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/60 shrink-0">
        <span className="text-xs text-muted-foreground truncate">
          {entries.length} {entries.length === 1 ? 'item' : 'items'}
        </span>
        <div className="flex items-center gap-1">
          <ModeButton
            mode="gallery" active={activeMode === 'gallery'} onSelect={setMode}
            label="Gallery view" Icon={LayoutGrid}
          />
          <ModeButton
            mode="list" active={activeMode === 'list'} onSelect={setMode}
            label="List view" Icon={ListIcon}
          />
        </div>
      </div>

      {entries.length === 0 ? (
        <div data-testid="disk-folder-empty" className="flex-1 grid place-items-center text-sm text-muted-foreground">
          This folder is empty
        </div>
      ) : activeMode === 'gallery' ? (
        <div data-testid="disk-folder-gallery" className="flex-1 overflow-auto p-4 grid gap-3 grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
          {entries.map((entry) => (
            <GalleryTile
              key={entry.path} entry={entry}
              isSelected={selectedPath === entry.path}
              onSelect={() => select(entry.path)}
            />
          ))}
        </div>
      ) : (
        <div data-testid="disk-folder-list" className="flex-1 overflow-auto">
          {entries.map((entry) => (
            <ListRow
              key={entry.path} entry={entry}
              isSelected={selectedPath === entry.path}
              onSelect={() => select(entry.path)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface ModeButtonProps {
  mode: ViewMode;
  active: boolean;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  onSelect: (mode: ViewMode) => void;
}

const ModeButton: React.FC<ModeButtonProps> = ({ mode, active, label, Icon, onSelect }) => (
  <button
    type="button"
    aria-label={label}
    aria-pressed={active}
    data-testid={`disk-folder-view-${mode}`}
    onClick={() => onSelect(mode)}
    className={`p-1.5 rounded-md ${active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-muted-foreground'}`}
  >
    <Icon className="h-4 w-4" />
  </button>
);

interface EntryProps {
  entry: DiskEntry;
  isSelected: boolean;
  onSelect: () => void;
}

const GalleryTile: React.FC<EntryProps> = ({ entry, isSelected, onSelect }) => {
  const Icon = ICONS[entry.kind];

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      data-testid={`disk-folder-entry-${entry.path}`}
      className={`flex flex-col gap-1.5 text-left rounded-lg p-1.5 ${isSelected ? 'bg-accent/60 ring-1 ring-accent' : 'hover:bg-muted/50'}`}
    >
      <div className="aspect-square rounded-md overflow-hidden bg-muted/40 grid place-items-center">
        {entry.kind === 'image' ? (
          <img
            src={toOpalFileUrl(entry.path)}
            alt={entry.name}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        ) : (
          <Icon className="h-8 w-8 opacity-40" />
        )}
      </div>
      <span className="text-xs truncate px-0.5">{entry.name}</span>
    </button>
  );
};

const ListRow: React.FC<EntryProps> = ({ entry, isSelected, onSelect }) => {
  const Icon = ICONS[entry.kind];

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      data-testid={`disk-folder-entry-${entry.path}`}
      className={`w-full flex items-center gap-2 px-4 py-1.5 text-sm text-left ${isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'}`}
    >
      <Icon className="h-4 w-4 shrink-0 opacity-60" />
      <span className="flex-1 truncate">{entry.name}</span>
      <span className="text-xs text-muted-foreground tabular-nums shrink-0">
        {entry.isDirectory ? '—' : formatSize(entry.size)}
      </span>
    </button>
  );
};
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/diskFolderView.test.tsx`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/features/disk-explorer/ src/tests/unit/diskFolderView.test.tsx
git commit -m "feat(disk-explorer): add folder view with streaming gallery and list modes"
```

---

### Task 9: Mount the feature in the app

A `/files` route with the tree beside the folder view, reachable from the navbar and the command palette.

**Files:**
- Create: `src/renderer/features/disk-explorer/components/DiskExplorer.tsx`
- Create: `src/renderer/features/disk-explorer/index.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/features/navbar/config` (add the Files item)
- Test: `src/tests/unit/diskExplorer.test.tsx`

**Interfaces:**
- Consumes: `DiskTree` (Task 7), `DiskFolderView` (Task 8), `useDiskStore` (Task 6).
- Produces: `<DiskExplorer />`, re-exported from the feature's `index.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/diskExplorer.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { DiskExplorer } from '@/renderer/features/disk-explorer/components/DiskExplorer';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';

const ROOT = '/Vault';
const PHOTOS = '/Vault/Photos';

beforeEach(() => {
  installDiskApi({
    readDirectory: vi.fn(async (p: string) => ({
      success: true as const,
      data: {
        path: p,
        entries: p === PHOTOS
          ? [entry({ path: `${PHOTOS}/a.jpg`, name: 'a.jpg', kind: 'image' })]
          : [],
      },
    })),
    openFolder: vi.fn(async () => ({ success: true as const, data: { root: ROOT } })),
    listRoots: vi.fn(async () => ({ success: true as const, data: [ROOT] })),
  });

  useDiskStore.setState({
    roots: [ROOT],
    listings: {
      [ROOT]: [entry({ path: PHOTOS, name: 'Photos', kind: 'directory', isDirectory: true })],
    },
    expanded: { [ROOT]: true },
    selectedPath: null,
    loading: { isLoading: false, error: null },
  });
});

describe('DiskExplorer', () => {
  it('renders the tree alongside a folder view', () => {
    render(<DiskExplorer />);
    expect(screen.getByRole('tree')).toBeInTheDocument();
  });

  it('shows the selected folder in the detail pane', async () => {
    const user = userEvent.setup();
    render(<DiskExplorer />);

    await user.click(screen.getByTestId('disk-tree-item-/Vault/Photos'));

    await waitFor(() => expect(screen.getByAltText('a.jpg')).toBeInTheDocument());
  });

  it('shows the parent folder when a file is selected', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({
      listings: {
        [ROOT]: [entry({ path: `${ROOT}/note.md`, name: 'note.md', kind: 'markdown' })],
      },
    });

    render(<DiskExplorer />);
    await user.click(screen.getByTestId('disk-tree-item-/Vault/note.md'));

    await waitFor(() =>
      expect(screen.getByTestId('disk-folder-entry-/Vault/note.md')).toBeInTheDocument()
    );
  });

  it('surfaces a store error', async () => {
    useDiskStore.setState({ loading: { isLoading: false, error: 'Permission denied' } });
    render(<DiskExplorer />);
    expect(await screen.findByTestId('disk-explorer-error')).toHaveTextContent('Permission denied');
  });

  it('offers an open-folder action', () => {
    render(<DiskExplorer />);
    expect(screen.getByTestId('disk-explorer-open-folder')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/diskExplorer.test.tsx`
Expected: FAIL — cannot resolve `DiskExplorer`.

- [ ] **Step 3: Implement `DiskExplorer.tsx`**

Create `src/renderer/features/disk-explorer/components/DiskExplorer.tsx`:

```tsx
import React, { useMemo } from 'react';
import { FolderPlus, X } from 'lucide-react';
import { useDiskStore } from '../store/diskStore';
import { DiskTree } from './DiskTree';
import { DiskFolderView } from './DiskFolderView';

/** The detail pane always shows a directory: a selected file shows its parent. */
function directoryForSelection(
  selectedPath: string | null,
  isDirectory: (path: string) => boolean,
  roots: string[]
): string | null {
  if (!selectedPath) return roots[0] ?? null;
  if (isDirectory(selectedPath)) return selectedPath;

  const parent = selectedPath.slice(0, selectedPath.lastIndexOf('/'));
  return parent || roots[0] || null;
}

export const DiskExplorer: React.FC = () => {
  const roots = useDiskStore((state) => state.roots);
  const listings = useDiskStore((state) => state.listings);
  const selectedPath = useDiskStore((state) => state.selectedPath);
  const error = useDiskStore((state) => state.loading.error);
  const openFolder = useDiskStore((state) => state.openFolder);

  // A path is a directory if it is a root, or if any cached listing describes
  // it as one. That is enough without another IPC round-trip, because the tree
  // can only surface a path it has already listed.
  const isDirectory = useMemo(() => {
    const directories = new Set(roots);
    for (const entries of Object.values(listings)) {
      for (const entry of entries) {
        if (entry.isDirectory) directories.add(entry.path);
      }
    }
    return (candidate: string) => directories.has(candidate);
  }, [roots, listings]);

  const activeDirectory = directoryForSelection(selectedPath, isDirectory, roots);

  return (
    <div className="flex h-full w-full overflow-hidden">
      <aside className="w-64 shrink-0 border-r border-border/60 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 shrink-0">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Files
          </span>
          <button
            type="button"
            onClick={() => void openFolder()}
            aria-label="Open folder"
            data-testid="disk-explorer-open-folder"
            className="p-1 rounded hover:bg-muted text-muted-foreground"
          >
            <FolderPlus className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          <DiskTree />
        </div>
      </aside>

      <section className="flex-1 flex flex-col overflow-hidden">
        {error && <ErrorBanner message={error} />}
        {activeDirectory ? (
          <DiskFolderView dirPath={activeDirectory} />
        ) : (
          <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
            Open a folder to get started
          </div>
        )}
      </section>
    </div>
  );
};

const ErrorBanner: React.FC<{ message: string }> = ({ message }) => {
  const clearError = useDiskStore((state) => state.clearError);

  return (
    <div
      role="alert"
      data-testid="disk-explorer-error"
      className="flex items-center gap-2 px-4 py-2 text-sm bg-destructive/10 text-destructive border-b border-destructive/20 shrink-0"
    >
      <span className="flex-1">{message}</span>
      <button
        type="button"
        aria-label="Dismiss error"
        onClick={clearError}
        className="p-0.5 rounded hover:bg-destructive/20"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};
```

- [ ] **Step 4: Create the feature barrel**

Create `src/renderer/features/disk-explorer/index.ts`:

```ts
export { DiskExplorer } from './components/DiskExplorer';
export { DiskTree } from './components/DiskTree';
export { DiskFolderView } from './components/DiskFolderView';
export { useDiskStore } from './store/diskStore';
```

- [ ] **Step 5: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/diskExplorer.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Add the route to `App.tsx`**

Add the import beside the existing `Explorer` import:

```tsx
import { DiskExplorer } from "@/renderer/features/disk-explorer";
```

Add the route inside `<Routes>`, after the `/explorer` route:

```tsx
<Route path="/files" element={<DiskExplorer />} />
```

- [ ] **Step 7: Add the navbar entry**

Replace the whole of `src/renderer/features/navbar/config/navbarItems.ts`:

```ts
import { NavbarItemProps } from "../components/NavbarItem";
import { Book, HardDrive } from "lucide-react";

const navbarItems: NavbarItemProps[] = [
  // TODO: add this in
  // { to: "/", icon: Home, text: "Home" },
  { to: "/explorer", icon: Book, text: "Explorer"},
  { to: "/files", icon: HardDrive, text: "Files"},
];

export default navbarItems;
```

- [ ] **Step 8: Register a command-palette action**

Change the `DiskExplorer` import added in Step 6 to also pull in the store:

```tsx
import { DiskExplorer, useDiskStore } from "@/renderer/features/disk-explorer";
```

Then add a fourth entry to the `commands` array inside the existing `useEffect` in
`src/renderer/App.tsx`:

```tsx
{
  id: "files.openFolder",
  name: "Open Folder on Disk",
  type: "navigation",
  keywords: ["files", "folder", "open", "disk"],
  perform: () => { void useDiskStore.getState().openFolder(); },
},
```

`"navigation"` is a valid `CommandType` — the union in
`src/renderer/features/commands/services/commandRegistry.ts` is
`'paneToggle' | 'navigation' | 'action'`.

Note: `registerCommand` throws if an id is already registered, and the effect's cleanup
unregisters on unmount, so the id must stay unique and the entry must go inside the
existing array rather than in a second `useEffect`.

- [ ] **Step 9: Typecheck, lint, and run everything**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all clean, all passing.

- [ ] **Step 10: Verify in the real app**

Run: `npm run better-dev`

Confirm by hand:
1. The Files entry appears in the navbar and routes to the disk explorer.
2. "Open Folder" shows the native picker; choosing a folder populates the tree.
3. Expanding a folder loads children, and nothing is loaded before expansion.
4. A folder of photos renders as a gallery, and images actually appear.
5. DevTools → Network shows `opal-file://` requests; DevTools → Console shows no CSP violations.
6. The existing `/explorer` route still works exactly as before.

- [ ] **Step 11: Commit**

```bash
git add src/renderer/features/disk-explorer/ src/renderer/App.tsx \
        src/renderer/features/navbar/ src/tests/unit/diskExplorer.test.tsx
git commit -m "feat(disk-explorer): mount the Files route with navbar and command entries"
```

---

### Task 10: End-to-end test

Proves the whole path inside a real Electron process: real files on disk, the real protocol handler, real image decoding. This is the only place `opal-file://` is exercised for real.

**Files:**
- Modify: `e2e/fixtures/electronApp.ts` (add a `userData` override so tests never touch real app state)
- Create: `e2e/helpers/tempVault.ts`
- Create: `e2e/tests/disk-explorer.spec.ts`

**Interfaces:**
- Consumes: the built app; `OPAL_TEST_USER_DATA_DIR` (Task 5).
- Produces: `createTempVault()`, `seedRoots()`, and an extended `test` fixture exposing `userDataDir`.

- [ ] **Step 1: Extend the Playwright fixture with an isolated user-data dir**

The current fixture only isolates the database (`OPAL_TEST_DB_DIR`). Without an equivalent
for the roots file, the E2E run would write `disk-roots.json` into the real app's user data
and permanently add a temp folder to the user's list of opened folders.

Replace `e2e/fixtures/electronApp.ts` with:

```ts
import { test as base, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import { mkdtemp, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import fs from 'fs';

const PROJECT_ROOT = path.join(__dirname, '../..');
const MAIN_JS_PATH = path.join(PROJECT_ROOT, '.vite/build/main.js');

type ElectronFixtures = {
  /** Absolute path to this test's isolated user-data directory. */
  userDataDir: string;
  electronApp: ElectronApplication;
  page: Page;
};

export const test = base.extend<ElectronFixtures>({
  // Created before the app launches so a test can seed files (e.g. disk-roots.json)
  // that the main process reads during startup.
  // eslint-disable-next-line no-empty-pattern
  userDataDir: async ({}, use) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'opal-test-userdata-'));
    await use(dir);
    await rm(dir, { recursive: true, force: true });
  },

  electronApp: async ({ userDataDir }, use) => {
    if (!fs.existsSync(MAIN_JS_PATH)) {
      throw new Error(
        `Built main.js not found at ${MAIN_JS_PATH}. Run the Vite builds first:\n` +
        `  npx vite build --config vite.main.config.ts && npx vite build --config vite.preload.config.ts && npx vite build --config vite.renderer.config.ts`
      );
    }

    const testDbDir = await mkdtemp(path.join(os.tmpdir(), 'opal-test-'));

    const app = await electron.launch({
      args: [PROJECT_ROOT],
      env: {
        ...process.env,
        OPAL_TEST_DB_DIR: testDbDir,
        OPAL_TEST_USER_DATA_DIR: userDataDir,
      },
    });

    await use(app);

    await app.close();
    await rm(testDbDir, { recursive: true, force: true });
  },

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await use(page);
  },
});

export { expect } from '@playwright/test';
```

The only changes from the original are the new `userDataDir` fixture, its entry in
`ElectronFixtures`, `electronApp` depending on it, and the extra `env` var. The existing
`critical-path.spec.ts` keeps working untouched, since it never referenced `userDataDir`.

- [ ] **Step 2: Write the temp-vault helper**

Create `e2e/helpers/tempVault.ts`:

```ts
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * A real 1x1 PNG. The bytes matter: the protocol handler streams them and
 * Chromium has to actually decode the result, which a text placeholder would
 * not exercise — and decoding is precisely what this task must prove works.
 */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

export interface TempVault {
  root: string;
  cleanup: () => Promise<void>;
}

export async function createTempVault(): Promise<TempVault> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'opal-e2e-vault-'));
  const root = path.join(dir, 'TestVault');

  await mkdir(path.join(root, 'Photos'), { recursive: true });
  await writeFile(path.join(root, 'Photos', 'alpha.png'), PNG_1X1);
  await writeFile(path.join(root, 'Photos', 'beta.png'), PNG_1X1);
  await writeFile(path.join(root, 'readme.md'), '# Test Vault\n');

  return { root, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/**
 * Pre-registers a root by writing the store file the main process reads at
 * startup. This exists because Playwright cannot drive the native folder
 * picker, so "open a folder" has to be simulated at the persistence layer.
 *
 * Must be called before the app launches — RootRegistry.load() runs once,
 * inside app.whenReady().
 */
export async function seedRoots(userDataDir: string, roots: string[]): Promise<void> {
  await mkdir(userDataDir, { recursive: true });
  await writeFile(
    path.join(userDataDir, 'disk-roots.json'),
    JSON.stringify({ version: 1, roots }, null, 2),
    'utf-8'
  );
}
```

- [ ] **Step 3: Write the E2E spec**

Create `e2e/tests/disk-explorer.spec.ts`:

```ts
import { test, expect } from '../fixtures/electronApp';
import type { Page } from '@playwright/test';
import { createTempVault, seedRoots, type TempVault } from '../helpers/tempVault';
import { realpath } from 'fs/promises';

/**
 * The app uses a HashRouter loaded from a file:// URL, and the Playwright config
 * sets no baseURL, so page.goto('#/files') cannot resolve. Setting the hash
 * directly is the reliable way to navigate.
 */
async function gotoFiles(page: Page): Promise<void> {
  await page.evaluate(() => { window.location.hash = '#/files'; });
  await page.waitForSelector('[role="tree"], [data-testid="disk-tree-empty"]');
}

let vault: TempVault;
/** RootRegistry stores resolved real paths; on macOS /var is a symlink to /private/var. */
let vaultRoot: string;

test.beforeAll(async () => {
  vault = await createTempVault();
  vaultRoot = await realpath(vault.root);
});

test.afterAll(async () => {
  await vault.cleanup();
});

// Seeding must happen before the app starts. Depending on userDataDir here (rather
// than inside the test body) guarantees the file exists before electronApp launches,
// because Playwright resolves fixture dependencies in order.
test.beforeEach(async ({ userDataDir }) => {
  await seedRoots(userDataDir, [vaultRoot]);
});

test.describe('disk explorer', () => {
  test('browses a real folder and streams images over opal-file://', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (message) => {
      if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
    });

    await gotoFiles(page);

    await expect(page.getByTestId(`disk-tree-item-${vaultRoot}`)).toBeVisible();

    const photosPath = `${vaultRoot}/Photos`;
    await page.getByTestId(`disk-tree-toggle-${vaultRoot}`).click();
    await page.getByTestId(`disk-tree-item-${photosPath}`).click();

    await expect(page.getByTestId('disk-folder-gallery')).toBeVisible();

    const alpha = page.getByAltText('alpha.png');
    await expect(alpha).toBeVisible();

    // The src must be a streamed protocol URL, never a base64 data URL.
    await expect(alpha).toHaveAttribute('src', /^opal-file:\/\//);

    // And the bytes must have actually decoded. A broken image still renders an
    // <img> element and still reports "visible", but naturalWidth stays 0 — this
    // assertion is the one that would catch a protocol or CSP regression.
    await expect
      .poll(() => alpha.evaluate((img) => (img as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);

    expect(violations).toEqual([]);
  });

  test('does not read a directory before it is expanded', async ({ page }) => {
    await gotoFiles(page);

    await expect(page.getByTestId(`disk-tree-item-${vaultRoot}`)).toBeVisible();

    // Photos exists in the tree, but its children must not be in the DOM until
    // Photos is expanded — this is the lazy-loading guarantee.
    await expect(page.getByTestId(`disk-tree-item-${vaultRoot}/Photos`)).toBeVisible();
    await expect(page.getByText('alpha.png')).toHaveCount(0);
  });

  test('refuses to serve a file outside every opened root', async ({ page }) => {
    await gotoFiles(page);
    await expect(page.getByTestId(`disk-tree-item-${vaultRoot}`)).toBeVisible();

    // The allowed-roots guard is the security boundary. Fetching a path that was
    // never opened must be rejected by the protocol handler, not served.
    const status = await page.evaluate(async () => {
      const response = await fetch('opal-file:///etc/hosts');
      return response.status;
    });

    expect(status).toBe(403);
  });
});
```

- [ ] **Step 4: Rebuild better-sqlite3 for Electron**

E2E launches a real Electron process, which needs the native module built against
Electron's ABI rather than Node's. `npm test` builds it for Node, so this must run after
any unit-test run.

Run: `npx electron-rebuild -f -w better-sqlite3`

- [ ] **Step 5: Run the E2E suite**

Run: `npm run test:e2e`
Expected: PASS — the three new tests plus the existing critical-path tests.

- [ ] **Step 6: Commit**

```bash
git add e2e/helpers/tempVault.ts e2e/tests/disk-explorer.spec.ts e2e/fixtures/electronApp.ts
git commit -m "test(e2e): verify disk browsing, streaming, and the root guard end to end"
```

---


### Task 11: Final verification

No new code. Confirms the slice is whole and nothing regressed.

**Files:** none.

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Unit and integration tests**

Run: `npm test`
Expected: all pass. Record the count.

- [ ] **Step 4: E2E**

Run: `npx electron-rebuild -f -w better-sqlite3 && npm run test:e2e`
Expected: all pass.

- [ ] **Step 5: Confirm nothing was removed**

Run: `git diff main --stat`

Exactly six pre-existing files may appear as modified:

| File | Why |
|---|---|
| `src/main.ts` | CSP, scheme registration, service wiring |
| `src/preload.ts` | the `diskAPI` namespace |
| `src/renderer/App.tsx` | `/files` route + command entry |
| `src/renderer/features/navbar/config/navbarItems.ts` | the Files nav item |
| `e2e/fixtures/electronApp.ts` | isolated `userDataDir` |
| `package.json` / `package-lock.json` | `@testing-library/user-event` |

Any other file showing as modified means the read-only, additive constraint was violated. Stop and investigate before proceeding.

- [ ] **Step 6: Manual acceptance pass**

Run: `npm run better-dev`

- Point Opal at a real folder of your own photos, not a fixture.
- Confirm the gallery renders and scrolling stays smooth.
- Confirm a large folder (hundreds of images) opens without a visible freeze.
- Confirm `/explorer` and existing notes are untouched.

- [ ] **Step 7: Commit any fixes and push the branch**

```bash
git push -u origin feat/disk-explorer
```

---

## Deferred to later slices

Recorded so they are not mistaken for oversights:

- **Thumbnails.** Full images are streamed and scaled by CSS. Fast enough for hundreds of files because bytes stream and decode natively; a folder of thousands of large photos will want generated thumbnails in `.opal/cache/thumbs/`. Slice 3.
- **HTTP range requests.** The protocol returns whole bodies. Video seeking needs `Range` support. Slice 3, alongside a video viewer.
- **A file watcher.** Listings are cached until forced. External changes are not yet noticed. Slice 2, with the write path.
- **Writing.** No rename, move, delete, or metadata authoring. Slice 2.
- **Sidecars and frontmatter.** The storage format is fixed in the spec but nothing reads or writes it yet. Slice 2.
- **Search, indexing, embeddings.** Slice 6, opt-in per root.
- **Retiring the virtual VFS.** Slice 5, after notes migrate. It stays fully working until then.
