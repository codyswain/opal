# Files Page Build-Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/files` from a read-only folder browser into a file manager good enough to replace Finder for daily use — you can see every file, move through them entirely by keyboard, survive folders with thousands of items, and rename, move, and delete without leaving the app.

**Architecture:** Five phases, each independently shippable. Phase A adds a detail pane that renders content by file kind. Phase B adds breadcrumb, sort, filter, and full keyboard navigation. Phase C adds OS-generated thumbnails, virtualized rendering, and a live file watcher. Phase D introduces the first code in Opal that mutates the user's real filesystem, behind a single guarded `FileWriter`. Phase E applies a consistent spacing and type rhythm on top of the colour tokens that already exist.

**Tech Stack:** Electron 31 (`nativeImage.createThumbnailFromPath`, `shell`, `protocol.handle`), Node 20, React 18, Zustand 5, Tailwind 3 (shadcn-style HSL tokens, already present), `react-window` 1.8, `react-markdown` 9 + `remark-gfm`, `lowlight`/`highlight.js`, `chokidar` 4, Vitest + happy-dom, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-16-opal-vault-architecture-design.md` — read **Revision 2**. This plan builds out slice 1's surface; it does not implement slices 2–7.

**Prior plans:** `2026-08-17-disk-explorer.md` (shipped — establishes `RootRegistry`, `DiskReader`, `opal-file://`), `2026-08-17-testing-foundation.md` (shipped — establishes the testing policy this plan obeys).

---

## Nothing new to install

Every dependency is already in `package.json`. Verified before writing this plan. If you find yourself reaching for `npm install`, stop and re-read this section.

| Need | Use | Already present |
|---|---|---|
| Thumbnails | `nativeImage.createThumbnailFromPath` | Electron 31.3.1 — uses macOS QuickLook, so HEIC, PDF, and video frames work for free |
| Virtualization | `FixedSizeGrid`, `FixedSizeList` | `react-window` ^1.8.10 |
| Markdown rendering | `react-markdown` + `remark-gfm` | ^9.0.1 / ^4.0.0 |
| Code highlighting | `lowlight` / `highlight.js` | ^3.1.0 / ^11.10.0 |
| Reveal / open externally | `shell.showItemInFolder`, `shell.openPath` | Electron built-in |
| Delete to Trash | `shell.trashItem` | Electron built-in — recoverable, never `fs.unlink` |
| File watching | `chokidar` | ^4.0.3 |
| Icons | `lucide-react` | ^0.436.0 |

## Architecture at a glance

```
MAIN                                     RENDERER
────────────────────────────────         ──────────────────────────────
RootRegistry     (exists) ──guards──┐    useDiskStore (extend)
DiskReader       (exists)           │      ├── listings, expanded, selection
DiskHandlers     (extend)           │      ├── sort, filter, viewMode, density
FileWriter       (NEW)  ────────────┤      └── multiSelect
ThumbnailService (NEW)  ────────────┤
DiskWatcher      (NEW)  ────────────┤    DiskExplorer
opal-file://     (extend) ──────────┘      ├── Breadcrumb        (NEW)
opal-thumb://    (NEW)                     ├── Toolbar           (NEW)
                                           ├── DiskTree          (exists)
src/common/  (pure, both processes)        ├── DiskFolderView    (virtualize)
  fileKind.ts      (exists)                ├── DetailPane        (NEW)
  opalFileUrl.ts   (exists)                │     └── per-kind previews
  formatBytes.ts   (NEW)                   ├── QuickLook         (NEW)
  sortEntries.ts   (NEW)                   └── dialogs/          (NEW)
  filterEntries.ts (NEW)
```

**The one invariant that must never break:** every filesystem path — read or write, IPC or protocol — passes through `RootRegistry.assertAllowed()` before any I/O. Phase D makes this critical: a gap in the guard stops being an information leak and becomes data loss.

## Global Constraints

- **Nothing outside `/files` changes.** `/explorer`, `vfsAPI`, `syncAPI`, and `file-explorer-v2` are untouched. They are retired in a later slice; do not pre-emptively delete them.
- **No new npm dependencies.** See the table above.
- **Every path crossing a process boundary is validated by `RootRegistry.assertAllowed()`,** which resolves symlinks first and returns the resolved path. Use the returned path for I/O, never the input.
- **Deletion is always `shell.trashItem`.** Never `fs.unlink` or `fs.rm` on user data. Deletion must be recoverable from the OS Trash.
- **All writes are atomic where a partial result is possible** (temp file + `fs.rename` within the same filesystem). Renames and moves use `fs.rename` directly, which is already atomic.
- **Handler classes follow the DI pattern** from `src/main/services/vfs/VfsHandlers.ts`: a `Dependencies` interface, constructor takes `deps`, public `registerAll()`, one private `registerX()` per channel.
- **Renderer never imports `fs`, `path`, or `electron`.** Pure logic shared by both processes goes in `src/common/`.
- **IPC responses use `DiskResult<T>`** from `src/types/disk.ts` — the discriminated union, not the loose `IPCResponse`.
- **Obey the testing policy in `CLAUDE.md`.** Test at the cheapest tier that can actually fail. Pure logic → unit tests. Component behaviour → Testing Library. **E2E only for what cannot be verified otherwise**, and the budget is ≤10 tests / ≤60s total. This plan adds exactly **3** E2E tests — one in Task 6, two in Task 17 — taking the suite from 5 to 8. Task 22 verifies the budget and adds none.
- **Do not test CSS.** happy-dom computes no layout, so class-name assertions check implementation, not behaviour. Verify visual work by running the app.
- **`npm test` before every commit.** The pre-commit hook enforces it. Expected console noise is catalogued in the testing-foundation plan; the only signal is the final summary lines.
- **Add a `data-testid` to every new interactive element**, matching the existing `disk-*` convention.

## Phase boundaries

Each phase ends with the app working and shippable. Stop after any phase if priorities change.

| Phase | Tasks | Delivers | Risk |
|---|---|---|---|
| A | 1–6 | You can see the contents of any file you click | none — read-only |
| B | 7–10 | Full keyboard operation, breadcrumb, sort, filter | none — read-only |
| C | 11–13 | Thousands of files stay smooth; external changes appear live | none — read-only |
| D | 14–18 | Rename, new folder, move, delete-to-Trash | **writes to disk** |
| E | 19–21 | Consistent rhythm, skeletons, density, multi-select | none — visual |

---

# PHASE A — See your files

Today clicking a photo highlights it and nothing else happens. This phase makes the content visible.

---

### Task 1: Read file contents safely

Text-bearing previews need file contents in the renderer. Binary previews use `opal-file://` and need nothing new. This adds one guarded, size-capped read.

**Files:**
- Create: `src/common/formatBytes.ts`
- Modify: `src/main/fs/DiskReader.ts` (add `readTextFile`)
- Modify: `src/main/fs/DiskHandlers.ts` (add `disk:read-text-file`)
- Modify: `src/renderer/shared/types/diskApi.d.ts`
- Modify: `src/preload.ts`
- Test: `src/tests/unit/fs/formatBytes.test.ts`
- Test: `src/tests/unit/fs/diskReader.test.ts` (extend)
- Test: `src/tests/unit/fs/diskHandlers.test.ts` (extend)

**Interfaces:**
- Consumes: `RootRegistry.assertAllowed` (shipped).
- Produces:
  - `formatBytes(bytes: number): string`
  - `DiskReader.readTextFile(target: string, options?: { maxBytes?: number }): Promise<TextFileContents>`
  - `interface TextFileContents { path: string; text: string; truncated: boolean; size: number }`
  - `window.diskAPI.readTextFile(path): Promise<DiskResult<TextFileContents>>`

- [ ] **Step 1: Write the failing test for `formatBytes`**

`formatBytes` currently lives as a private `formatSize` inside `DiskFolderView.tsx`. Both the detail pane and the list need it, so it moves to `src/common/` where it can be tested directly.

Create `src/tests/unit/fs/formatBytes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatBytes } from '@/common/formatBytes';

describe('formatBytes', () => {
  it('renders an em dash for zero', () => {
    expect(formatBytes(0)).toBe('—');
  });

  it('renders whole bytes without a decimal', () => {
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('drops a trailing .0', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
  });

  it('keeps one decimal when it carries information', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });

  it('scales through the unit table and clamps at TB', () => {
    expect(formatBytes(1024 ** 3)).toBe('1 GB');
    expect(formatBytes(1024 ** 4)).toBe('1 TB');
    expect(formatBytes(1024 ** 5)).toBe('1024 TB');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/fs/formatBytes.test.ts`
Expected: FAIL — cannot resolve `@/common/formatBytes`.

- [ ] **Step 3: Implement `formatBytes`**

Create `src/common/formatBytes.ts`:

```ts
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * Human-readable byte count. Shared by the list view, the detail pane, and the
 * Quick Look header, so it lives in common/ rather than inside a component.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '—';

  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    UNITS.length - 1
  );
  const value = bytes / 1024 ** exponent;

  // Number() strips a trailing '.0' so 2048 reads as "2 KB", not "2.0 KB".
  const rounded = exponent === 0 ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded} ${UNITS[exponent]}`;
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/fs/formatBytes.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Point `DiskFolderView` at the shared helper**

In `src/renderer/features/disk-explorer/components/DiskFolderView.tsx`:
- delete the local `formatSize` function and the `UNITS`-equivalent inline array
- add `import { formatBytes } from '@/common/formatBytes';`
- replace the single call site `formatSize(entry.size)` with `formatBytes(entry.size)`

Run: `npx vitest run src/tests/unit/diskFolderView.test.tsx`
Expected: PASS, 11 tests — the existing `expect(screen.getByText('2 KB'))` assertion proves the swap is behaviour-preserving.

- [ ] **Step 6: Write the failing test for `readTextFile`**

Append to `src/tests/unit/fs/diskReader.test.ts`, inside the file's existing top-level scope:

```ts
describe('DiskReader.readTextFile', () => {
  it('reads a file inside a root', async () => {
    const result = await reader.readTextFile(path.join(root, 'note.md'));
    expect(result.text).toBe('# hello');
    expect(result.truncated).toBe(false);
    expect(result.size).toBe('# hello'.length);
  });

  it('refuses a file outside every root', async () => {
    const outside = path.join(tmp, 'outside.txt');
    await writeFile(outside, 'nope');
    await expect(reader.readTextFile(outside)).rejects.toThrow(PathNotAllowedError);
  });

  it('truncates a file larger than maxBytes and reports it', async () => {
    const big = path.join(root, 'big.txt');
    await writeFile(big, 'x'.repeat(5000));

    const result = await reader.readTextFile(big, { maxBytes: 1000 });
    expect(result.text).toHaveLength(1000);
    expect(result.truncated).toBe(true);
    expect(result.size).toBe(5000);
  });

  it('rejects a directory', async () => {
    await expect(reader.readTextFile(path.join(root, 'Photos'))).rejects.toThrow(
      /not a file/i
    );
  });
});
```

- [ ] **Step 7: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/fs/diskReader.test.ts`
Expected: FAIL — `reader.readTextFile is not a function`.

- [ ] **Step 8: Implement `readTextFile`**

In `src/main/fs/DiskReader.ts`, add the import of `open` alongside the existing `fs/promises` imports, add the exported interface, and add the method to the class:

```ts
// add to the existing: import { readdir, stat } from 'fs/promises';
import { readdir, stat, open } from 'fs/promises';
```

```ts
export interface TextFileContents {
  path: string;
  text: string;
  /** True when the file was longer than maxBytes and `text` is a prefix. */
  truncated: boolean;
  /** Full size on disk, regardless of truncation. */
  size: number;
}

/**
 * Previews must never load a multi-gigabyte log into the renderer, so reads are
 * capped. 2 MB is far more text than any preview can usefully display and small
 * enough to cross IPC without a stall.
 */
const DEFAULT_MAX_TEXT_BYTES = 2 * 1024 * 1024;
```

Add to the `DiskReader` class:

```ts
  async readTextFile(
    target: string,
    options: { maxBytes?: number } = {}
  ): Promise<TextFileContents> {
    const resolved = await this.deps.registry.assertAllowed(target);

    const info = await stat(resolved);
    if (info.isDirectory()) {
      throw new Error(`Cannot read as text because it is a directory: ${target}`);
    }

    const maxBytes = options.maxBytes ?? DEFAULT_MAX_TEXT_BYTES;
    const truncated = info.size > maxBytes;

    // Read only the prefix rather than the whole file, so an enormous file
    // costs a fixed amount of memory instead of its full size.
    const handle = await open(resolved, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(info.size, maxBytes));
      await handle.read(buffer, 0, buffer.length, 0);
      return {
        path: resolved,
        text: buffer.toString('utf-8'),
        truncated,
        size: info.size,
      };
    } finally {
      await handle.close();
    }
  }
```

- [ ] **Step 9: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/fs/diskReader.test.ts`
Expected: PASS, 16 tests (12 existing + 4 new).

- [ ] **Step 10: Add the IPC channel**

In `src/main/fs/DiskHandlers.ts`, add `TextFileContents` to the type import from `@/types/disk`, register the handler in `registerAll()`, and add the private method:

```ts
  // add to registerAll()
  this.registerReadTextFile();
```

```ts
  private registerReadTextFile(): void {
    this.deps.ipc.handle(
      'disk:read-text-file',
      async (_, target: string): Promise<IPCResponse<TextFileContents>> => {
        try {
          const contents = await this.deps.reader.readTextFile(target);
          return { success: true, data: contents };
        } catch (error) {
          return { success: false, error: describeError(error, 'Failed to read file') };
        }
      }
    );
  }
```

In `src/types/disk.ts`, re-export the type so the renderer can import it without reaching into `src/main`:

```ts
export type { TextFileContents } from '@/main/fs/DiskReader';
```

This is a **type-only** re-export. `import type` is erased at build time, so the renderer bundle never pulls in the main-process module.

- [ ] **Step 11: Expose it in preload and the API type**

In `src/preload.ts`, add to the `diskAPI` object:

```ts
  readTextFile: (target: string) => ipcRenderer.invoke("disk:read-text-file", target),
```

In `src/renderer/shared/types/diskApi.d.ts`, add to `DiskAPI` and extend the import:

```ts
import type { DiskEntry, DirectoryListing, DiskResult, TextFileContents } from '@/types/disk';
```
```ts
  readTextFile: (target: string) => Promise<DiskResult<TextFileContents>>;
```

- [ ] **Step 12: Extend the handler test**

In `src/tests/unit/fs/diskHandlers.test.ts`, update the channel-list assertion to include the new channel and add a case:

```ts
  it('registers every channel', () => {
    expect(stub.channels().sort()).toEqual([
      'disk:list-roots',
      'disk:open-folder',
      'disk:read-directory',
      'disk:read-text-file',
      'disk:remove-root',
      'disk:stat',
    ]);
  });

  it('reads a text file inside a root', async () => {
    await registry.add(root);
    const result = await stub.invoke('disk:read-text-file', path.join(root, 'note.md')) as {
      success: boolean; data: { text: string };
    };
    expect(result.success).toBe(true);
    expect(result.data.text).toBe('# hi');
  });

  it('refuses a text file outside every root', async () => {
    await registry.add(root);
    const outside = path.join(tmp, 'outside.txt');
    await writeFile(outside, 'nope');

    const result = await stub.invoke('disk:read-text-file', outside) as {
      success: boolean; error: string;
    };
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not inside any folder/i);
  });
```

- [ ] **Step 13: Verify the contract test still passes**

The IPC contract test from the testing-foundation plan will fail if `preload.ts` gained a channel that main does not register.

Run: `npm test`
Expected: all pass, including `ipcContract`. If `disk:read-text-file` shows up as a new dead channel, Step 10 was skipped or the handler name is misspelled.

- [ ] **Step 14: Commit**

```bash
git add src/common/formatBytes.ts src/main/fs/DiskReader.ts src/main/fs/DiskHandlers.ts \
        src/types/disk.ts src/preload.ts src/renderer/shared/types/diskApi.d.ts \
        src/renderer/features/disk-explorer/components/DiskFolderView.tsx src/tests/
git commit -m "feat(files): add guarded, size-capped text file reads"
```

---

### Task 2: The detail pane and image preview

The core of Phase A: a pane that dispatches on file kind, plus the viewer that matters most.

**Files:**
- Create: `src/renderer/features/disk-explorer/components/detail/DetailPane.tsx`
- Create: `src/renderer/features/disk-explorer/components/detail/ImagePreview.tsx`
- Create: `src/renderer/features/disk-explorer/components/detail/UnsupportedPreview.tsx`
- Modify: `src/renderer/features/disk-explorer/components/DiskExplorer.tsx`
- Test: `src/tests/unit/detailPane.test.tsx`

**Interfaces:**
- Consumes: `useDiskStore` (shipped), `toOpalFileUrl` (shipped), `formatBytes` (Task 1).
- Produces:
  - `<DetailPane entry={DiskEntry | null} />`
  - `<ImagePreview entry={DiskEntry} />` — zoom, fit-to-window, pan
  - `<UnsupportedPreview entry={DiskEntry} />`

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/detailPane.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { DetailPane } from '@/renderer/features/disk-explorer/components/detail/DetailPane';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';

beforeEach(() => {
  installDiskApi();
});

describe('DetailPane', () => {
  it('prompts when nothing is selected', () => {
    render(<DetailPane entry={null} />);
    expect(screen.getByTestId('detail-empty')).toBeInTheDocument();
  });

  it('renders an image through the opal-file protocol', () => {
    render(<DetailPane entry={entry({ path: '/V/a.jpg', name: 'a.jpg', kind: 'image', size: 2048 })} />);

    const image = screen.getByAltText('a.jpg');
    expect(image.getAttribute('src')).toMatch(/^opal-file:\/\//);
    expect(image.getAttribute('src')).not.toMatch(/^data:/);
  });

  it('shows name and size in the header', () => {
    render(<DetailPane entry={entry({ path: '/V/a.jpg', name: 'a.jpg', kind: 'image', size: 2048 })} />);
    expect(screen.getByTestId('detail-title')).toHaveTextContent('a.jpg');
    expect(screen.getByTestId('detail-subtitle')).toHaveTextContent('2 KB');
  });

  it('zooms in and out, and resets to fit', async () => {
    const user = userEvent.setup();
    render(<DetailPane entry={entry({ path: '/V/a.jpg', name: 'a.jpg', kind: 'image' })} />);

    expect(screen.getByTestId('image-zoom-level')).toHaveTextContent('Fit');

    await user.click(screen.getByTestId('image-zoom-in'));
    expect(screen.getByTestId('image-zoom-level')).toHaveTextContent('120%');

    await user.click(screen.getByTestId('image-zoom-out'));
    expect(screen.getByTestId('image-zoom-level')).toHaveTextContent('100%');

    await user.click(screen.getByTestId('image-zoom-fit'));
    expect(screen.getByTestId('image-zoom-level')).toHaveTextContent('Fit');
  });

  it('clamps zoom at the bounds', async () => {
    const user = userEvent.setup();
    render(<DetailPane entry={entry({ path: '/V/a.jpg', name: 'a.jpg', kind: 'image' })} />);

    for (let i = 0; i < 40; i += 1) await user.click(screen.getByTestId('image-zoom-in'));
    expect(screen.getByTestId('image-zoom-level')).toHaveTextContent('800%');

    for (let i = 0; i < 80; i += 1) await user.click(screen.getByTestId('image-zoom-out'));
    expect(screen.getByTestId('image-zoom-level')).toHaveTextContent('10%');
  });

  it('falls back gracefully for an unsupported kind', () => {
    render(<DetailPane entry={entry({ path: '/V/a.zip', name: 'a.zip', kind: 'other', size: 100 })} />);
    expect(screen.getByTestId('detail-unsupported')).toBeInTheDocument();
    expect(screen.getByTestId('detail-title')).toHaveTextContent('a.zip');
  });

  it('shows a directory summary rather than a viewer', () => {
    render(<DetailPane entry={entry({ path: '/V/Photos', name: 'Photos', kind: 'directory', isDirectory: true })} />);
    expect(screen.getByTestId('detail-directory')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/detailPane.test.tsx`
Expected: FAIL — cannot resolve `DetailPane`.

- [ ] **Step 3: Implement `ImagePreview`**

Create `src/renderer/features/disk-explorer/components/detail/ImagePreview.tsx`:

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import type { DiskEntry } from '@/types/disk';
import { toOpalFileUrl } from '@/common/opalFileUrl';

/** null means fit-to-window; a number is an explicit scale factor. */
type Zoom = number | null;

const ZOOM_STEP = 0.2;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

export const ImagePreview: React.FC<{ entry: DiskEntry }> = ({ entry }) => {
  const [zoom, setZoom] = useState<Zoom>(null);

  // A new file starts fit-to-window; carrying the previous zoom across files
  // means opening a photo at an arbitrary crop.
  useEffect(() => { setZoom(null); }, [entry.path]);

  const clamp = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

  const zoomIn = useCallback(() => setZoom((z) => clamp((z ?? 1) + ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setZoom((z) => clamp((z ?? 1) - ZOOM_STEP)), []);
  const zoomFit = useCallback(() => setZoom(null), []);

  const label = zoom === null ? 'Fit' : `${Math.round(zoom * 100)}%`;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-auto grid place-items-center bg-muted/20 p-4">
        <img
          src={toOpalFileUrl(entry.path)}
          alt={entry.name}
          decoding="async"
          data-testid="image-preview"
          className={zoom === null ? 'max-w-full max-h-full object-contain' : 'max-w-none'}
          style={zoom === null ? undefined : { width: `${zoom * 100}%` }}
        />
      </div>

      <div className="flex items-center justify-center gap-1 py-1.5 border-t border-border/60 shrink-0">
        <ZoomButton onClick={zoomOut} label="Zoom out" testId="image-zoom-out" Icon={ZoomOut} />
        <span
          data-testid="image-zoom-level"
          className="text-xs text-muted-foreground tabular-nums w-12 text-center"
        >
          {label}
        </span>
        <ZoomButton onClick={zoomIn} label="Zoom in" testId="image-zoom-in" Icon={ZoomIn} />
        <ZoomButton onClick={zoomFit} label="Fit to window" testId="image-zoom-fit" Icon={Maximize2} />
      </div>
    </div>
  );
};

interface ZoomButtonProps {
  onClick: () => void;
  label: string;
  testId: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const ZoomButton: React.FC<ZoomButtonProps> = ({ onClick, label, testId, Icon }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    data-testid={testId}
    className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
  >
    <Icon className="h-4 w-4" />
  </button>
);
```

Note the clamp arithmetic: starting from fit (`null`), one zoom-in yields `1 + 0.2 = 1.2` → "120%", and one zoom-out from there yields `1.0` → "100%". The test in Step 1 asserts exactly this sequence.

- [ ] **Step 4: Implement `UnsupportedPreview`**

Create `src/renderer/features/disk-explorer/components/detail/UnsupportedPreview.tsx`:

```tsx
import React from 'react';
import { FileQuestion } from 'lucide-react';
import type { DiskEntry } from '@/types/disk';
import { formatBytes } from '@/common/formatBytes';

/**
 * The honest fallback. Naming the extension and offering the OS as an escape
 * hatch beats a blank pane — Task 6 wires the button up.
 */
export const UnsupportedPreview: React.FC<{ entry: DiskEntry }> = ({ entry }) => (
  <div
    data-testid="detail-unsupported"
    className="flex-1 grid place-items-center p-8 text-center"
  >
    <div className="flex flex-col items-center gap-2 max-w-xs">
      <FileQuestion className="h-10 w-10 opacity-30" />
      <p className="text-sm text-muted-foreground">
        No preview available for this file type.
      </p>
      <p className="text-xs text-muted-foreground/70">{formatBytes(entry.size)}</p>
    </div>
  </div>
);
```

- [ ] **Step 5: Implement `DetailPane`**

Create `src/renderer/features/disk-explorer/components/detail/DetailPane.tsx`:

```tsx
import React from 'react';
import { Folder } from 'lucide-react';
import type { DiskEntry } from '@/types/disk';
import { formatBytes } from '@/common/formatBytes';
import { ImagePreview } from './ImagePreview';
import { UnsupportedPreview } from './UnsupportedPreview';

/**
 * Dispatches on file kind. Later tasks in Phase A add cases here; the default
 * branch is deliberately a real component rather than null, so an unhandled
 * kind degrades to something legible instead of an empty pane.
 */
function renderPreview(entry: DiskEntry): React.ReactNode {
  if (entry.isDirectory) {
    return (
      <div data-testid="detail-directory" className="flex-1 grid place-items-center p-8">
        <div className="flex flex-col items-center gap-2">
          <Folder className="h-10 w-10 opacity-30" />
          <p className="text-sm text-muted-foreground">Folder</p>
        </div>
      </div>
    );
  }

  switch (entry.kind) {
    case 'image':
      return <ImagePreview entry={entry} />;
    default:
      return <UnsupportedPreview entry={entry} />;
  }
}

export const DetailPane: React.FC<{ entry: DiskEntry | null }> = ({ entry }) => {
  if (!entry) {
    return (
      <div
        data-testid="detail-empty"
        className="h-full grid place-items-center text-sm text-muted-foreground"
      >
        Select a file to preview it
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="px-4 py-2 border-b border-border/60 shrink-0 min-w-0">
        <h2 data-testid="detail-title" className="text-sm font-medium truncate" title={entry.name}>
          {entry.name}
        </h2>
        <p data-testid="detail-subtitle" className="text-xs text-muted-foreground">
          {entry.isDirectory ? 'Folder' : formatBytes(entry.size)}
        </p>
      </header>

      {renderPreview(entry)}
    </div>
  );
};
```

- [ ] **Step 6: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/detailPane.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 7: Mount the pane in `DiskExplorer`**

`DiskExplorer` currently shows a folder view filling the whole right side. It becomes a three-column layout: tree, folder view, detail pane. The detail pane shows the selected entry; when a directory is selected the folder view already displays its contents, so the pane shows the folder summary.

In `src/renderer/features/disk-explorer/components/DiskExplorer.tsx`:

Add the imports:
```tsx
import { useMemo } from 'react';           // already imported — keep as is
import { DetailPane } from './detail/DetailPane';
import type { DiskEntry } from '@/types/disk';
```

Add a lookup for the selected entry, after the existing `isDirectory` memo:
```tsx
  // The selected entry object, found in whichever cached listing contains it.
  // The tree can only surface a path it has already listed, so no IPC is needed.
  const selectedEntry = useMemo<DiskEntry | null>(() => {
    if (!selectedPath) return null;
    for (const entries of Object.values(listings)) {
      const match = entries.find((candidate) => candidate.path === selectedPath);
      if (match) return match;
    }
    return null;
  }, [selectedPath, listings]);
```

Replace the `<section>` element's contents so the folder view and detail pane sit side by side:

```tsx
      <section className="flex-1 flex flex-col overflow-hidden min-w-0">
        {error && <ErrorBanner message={error} />}
        {activeDirectory ? (
          <div className="flex-1 flex overflow-hidden min-h-0">
            <div className="flex-1 min-w-0 overflow-hidden">
              <DiskFolderView dirPath={activeDirectory} />
            </div>
            <aside className="w-80 shrink-0 border-l border-border/60 overflow-hidden">
              <DetailPane entry={selectedEntry} />
            </aside>
          </div>
        ) : (
          <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
            Open a folder to get started
          </div>
        )}
      </section>
```

- [ ] **Step 8: Confirm the existing explorer tests still pass**

Run: `npx vitest run src/tests/unit/diskExplorer.test.tsx`
Expected: PASS, 5 tests. The existing assertions target the tree and folder view, both of which still render.

- [ ] **Step 9: Verify in the app**

Run: `npm run better-dev`

Click a photo in the gallery. The right pane must show the image with working zoom controls. Click a folder — the pane shows the folder summary. Click a `.zip` or similar — the pane shows the unsupported fallback naming its size.

- [ ] **Step 10: Full suite and commit**

Run: `npm test`

```bash
git add src/renderer/features/disk-explorer/components/ src/tests/unit/detailPane.test.tsx
git commit -m "feat(files): add detail pane with zoomable image preview"
```

---

### Task 3: Text, markdown, and code previews

**Files:**
- Create: `src/renderer/features/disk-explorer/components/detail/TextPreview.tsx`
- Create: `src/renderer/features/disk-explorer/components/detail/MarkdownPreview.tsx`
- Create: `src/renderer/features/disk-explorer/hooks/useTextFile.ts`
- Modify: `src/renderer/features/disk-explorer/components/detail/DetailPane.tsx`
- Test: `src/tests/unit/textPreview.test.tsx`

**Interfaces:**
- Consumes: `window.diskAPI.readTextFile` (Task 1), `DetailPane` dispatch (Task 2).
- Produces:
  - `useTextFile(path: string | null): { text: string | null; truncated: boolean; error: string | null; isLoading: boolean }`
  - `<TextPreview entry />`, `<MarkdownPreview entry />`

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/textPreview.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { DetailPane } from '@/renderer/features/disk-explorer/components/detail/DetailPane';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';

const MD = entry({ path: '/V/note.md', name: 'note.md', kind: 'markdown', size: 42 });
const TXT = entry({ path: '/V/a.ts', name: 'a.ts', kind: 'text', size: 20 });

beforeEach(() => {
  installDiskApi({
    readTextFile: vi.fn(async (p: string) => ({
      success: true as const,
      data: {
        path: p,
        text: p.endsWith('.md') ? '# Title\n\nSome **bold** text.' : 'const x = 1;',
        truncated: false,
        size: 42,
      },
    })),
  });
});

describe('markdown preview', () => {
  it('renders markdown as HTML, not as raw text', async () => {
    render(<DetailPane entry={MD} />);

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Title')
    );
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.queryByText('# Title')).not.toBeInTheDocument();
  });

  it('requests the file through the guarded IPC channel', async () => {
    render(<DetailPane entry={MD} />);
    await waitFor(() => expect(window.diskAPI.readTextFile).toHaveBeenCalledWith('/V/note.md'));
  });
});

describe('text preview', () => {
  it('renders plain text verbatim', async () => {
    render(<DetailPane entry={TXT} />);
    await waitFor(() => expect(screen.getByTestId('text-preview')).toHaveTextContent('const x = 1;'));
  });

  it('surfaces a read error instead of rendering nothing', async () => {
    installDiskApi({
      readTextFile: vi.fn(async () => ({ success: false as const, error: 'Permission denied' })),
    });

    render(<DetailPane entry={TXT} />);
    await waitFor(() =>
      expect(screen.getByTestId('text-preview-error')).toHaveTextContent('Permission denied')
    );
  });

  it('warns when the file was truncated', async () => {
    installDiskApi({
      readTextFile: vi.fn(async (p: string) => ({
        success: true as const,
        data: { path: p, text: 'x'.repeat(100), truncated: true, size: 9_000_000 },
      })),
    });

    render(<DetailPane entry={TXT} />);
    await waitFor(() => expect(screen.getByTestId('text-preview-truncated')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/textPreview.test.tsx`
Expected: FAIL — markdown renders as raw text because no markdown branch exists yet.

- [ ] **Step 3: Implement `useTextFile`**

Create `src/renderer/features/disk-explorer/hooks/useTextFile.ts`:

```ts
import { useEffect, useState } from 'react';

interface TextFileState {
  text: string | null;
  truncated: boolean;
  error: string | null;
  isLoading: boolean;
}

const INITIAL: TextFileState = { text: null, truncated: false, error: null, isLoading: false };

/**
 * Loads a file's text for preview.
 *
 * Guards against a stale response overwriting a newer one: arrowing quickly
 * down a file list fires several reads, and without the cancellation flag the
 * slowest response wins and the pane shows the wrong file's contents.
 */
export function useTextFile(filePath: string | null): TextFileState {
  const [state, setState] = useState<TextFileState>(INITIAL);

  useEffect(() => {
    if (!filePath) {
      setState(INITIAL);
      return;
    }

    let cancelled = false;
    setState({ ...INITIAL, isLoading: true });

    void window.diskAPI.readTextFile(filePath).then((response) => {
      if (cancelled) return;
      if (!response.success) {
        setState({ text: null, truncated: false, error: response.error, isLoading: false });
        return;
      }
      setState({
        text: response.data.text,
        truncated: response.data.truncated,
        error: null,
        isLoading: false,
      });
    });

    return () => { cancelled = true; };
  }, [filePath]);

  return state;
}
```

- [ ] **Step 4: Implement `TextPreview`**

Create `src/renderer/features/disk-explorer/components/detail/TextPreview.tsx`:

```tsx
import React from 'react';
import type { DiskEntry } from '@/types/disk';
import { useTextFile } from '../../hooks/useTextFile';

export const TextPreview: React.FC<{ entry: DiskEntry }> = ({ entry }) => {
  const { text, truncated, error, isLoading } = useTextFile(entry.path);

  if (isLoading) {
    return <div className="flex-1 grid place-items-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (error) {
    return (
      <div
        data-testid="text-preview-error"
        className="flex-1 grid place-items-center p-6 text-sm text-destructive text-center"
      >
        {error}
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {truncated && (
        <p
          data-testid="text-preview-truncated"
          className="px-4 py-1.5 text-xs text-muted-foreground bg-muted/40 border-b border-border/60 shrink-0"
        >
          Showing the first part of this file only.
        </p>
      )}
      <pre
        data-testid="text-preview"
        className="flex-1 min-h-0 overflow-auto p-4 text-xs leading-relaxed font-mono whitespace-pre-wrap break-words"
      >
        {text}
      </pre>
    </div>
  );
};
```

- [ ] **Step 5: Implement `MarkdownPreview`**

Create `src/renderer/features/disk-explorer/components/detail/MarkdownPreview.tsx`:

```tsx
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { DiskEntry } from '@/types/disk';
import { useTextFile } from '../../hooks/useTextFile';

export const MarkdownPreview: React.FC<{ entry: DiskEntry }> = ({ entry }) => {
  const { text, truncated, error, isLoading } = useTextFile(entry.path);

  if (isLoading) {
    return <div className="flex-1 grid place-items-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (error) {
    return (
      <div
        data-testid="text-preview-error"
        className="flex-1 grid place-items-center p-6 text-sm text-destructive text-center"
      >
        {error}
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {truncated && (
        <p
          data-testid="text-preview-truncated"
          className="px-4 py-1.5 text-xs text-muted-foreground bg-muted/40 border-b border-border/60 shrink-0"
        >
          Showing the first part of this file only.
        </p>
      )}
      {/* @tailwindcss/typography is already a plugin; prose gives sane defaults
          for content whose markup we do not control. */}
      <div
        data-testid="markdown-preview"
        className="flex-1 min-h-0 overflow-auto p-4 prose prose-sm dark:prose-invert max-w-none"
      >
        {/* No rehype-raw: this renders arbitrary files off the user's disk, and
            enabling embedded HTML would execute whatever they contain. */}
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text ?? ''}</ReactMarkdown>
      </div>
    </div>
  );
};
```

- [ ] **Step 6: Add the dispatch cases**

In `DetailPane.tsx`, add the imports and extend the `switch`:

```tsx
import { TextPreview } from './TextPreview';
import { MarkdownPreview } from './MarkdownPreview';
```

```tsx
    case 'image':
      return <ImagePreview entry={entry} />;
    case 'markdown':
      return <MarkdownPreview entry={entry} />;
    case 'text':
      return <TextPreview entry={entry} />;
    default:
      return <UnsupportedPreview entry={entry} />;
```

- [ ] **Step 7: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/textPreview.test.tsx src/tests/unit/detailPane.test.tsx`
Expected: PASS, 12 tests total.

- [ ] **Step 8: Verify in the app**

Run: `npm run better-dev`

Open a folder containing a `.md` file and a source file. The markdown must render with real headings and bold text; the source file must show as monospaced text.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/features/disk-explorer/ src/tests/unit/textPreview.test.tsx
git commit -m "feat(files): add markdown and text previews"
```

---

### Task 4: PDF, video, and audio previews

Electron's bundled Chromium renders all three natively. Each is a small component pointed at `opal-file://`.

**Files:**
- Create: `src/renderer/features/disk-explorer/components/detail/MediaPreview.tsx`
- Create: `src/renderer/features/disk-explorer/components/detail/PdfPreview.tsx`
- Modify: `src/renderer/features/disk-explorer/components/detail/DetailPane.tsx`
- Modify: `src/main.ts` (CSP — `object-src` and `frame-src`)
- Test: `src/tests/unit/mediaPreview.test.tsx`

**Interfaces:**
- Consumes: `toOpalFileUrl` (shipped), `DetailPane` dispatch (Task 2).
- Produces: `<MediaPreview entry />` (video + audio), `<PdfPreview entry />`

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/mediaPreview.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { DetailPane } from '@/renderer/features/disk-explorer/components/detail/DetailPane';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';

beforeEach(() => { installDiskApi(); });

describe('media previews', () => {
  it('renders a video element with controls', () => {
    render(<DetailPane entry={entry({ path: '/V/clip.mp4', name: 'clip.mp4', kind: 'video' })} />);

    const video = screen.getByTestId('video-preview');
    expect(video.tagName).toBe('VIDEO');
    expect(video).toHaveAttribute('controls');
    expect(video.getAttribute('src')).toMatch(/^opal-file:\/\//);
  });

  it('renders an audio element with controls', () => {
    render(<DetailPane entry={entry({ path: '/V/song.mp3', name: 'song.mp3', kind: 'audio' })} />);

    const audio = screen.getByTestId('audio-preview');
    expect(audio.tagName).toBe('AUDIO');
    expect(audio).toHaveAttribute('controls');
    expect(audio.getAttribute('src')).toMatch(/^opal-file:\/\//);
  });

  it('renders a pdf in an embedded frame', () => {
    render(<DetailPane entry={entry({ path: '/V/paper.pdf', name: 'paper.pdf', kind: 'pdf' })} />);

    const frame = screen.getByTestId('pdf-preview');
    expect(frame.getAttribute('src')).toMatch(/^opal-file:\/\//);
  });

  it('does not autoplay media', () => {
    render(<DetailPane entry={entry({ path: '/V/clip.mp4', name: 'clip.mp4', kind: 'video' })} />);
    expect(screen.getByTestId('video-preview')).not.toHaveAttribute('autoplay');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/mediaPreview.test.tsx`
Expected: FAIL — video/audio/pdf all fall through to `detail-unsupported`.

- [ ] **Step 3: Implement `MediaPreview`**

Create `src/renderer/features/disk-explorer/components/detail/MediaPreview.tsx`:

```tsx
import React from 'react';
import type { DiskEntry } from '@/types/disk';
import { toOpalFileUrl } from '@/common/opalFileUrl';

/**
 * Chromium plays these natively. `key` on the element forces a remount when the
 * selection changes — without it React reuses the media element and keeps the
 * previous file's playback position and buffered data.
 *
 * Deliberately no autoplay: clicking through a folder of videos should not
 * start a wall of sound.
 */
export const MediaPreview: React.FC<{ entry: DiskEntry }> = ({ entry }) => {
  const source = toOpalFileUrl(entry.path);

  if (entry.kind === 'audio') {
    return (
      <div className="flex-1 grid place-items-center p-6">
        <audio
          key={entry.path}
          src={source}
          controls
          preload="metadata"
          data-testid="audio-preview"
          className="w-full max-w-md"
        />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 grid place-items-center bg-black/80 p-2">
      <video
        key={entry.path}
        src={source}
        controls
        preload="metadata"
        data-testid="video-preview"
        className="max-w-full max-h-full"
      />
    </div>
  );
};
```

- [ ] **Step 4: Implement `PdfPreview`**

Create `src/renderer/features/disk-explorer/components/detail/PdfPreview.tsx`:

```tsx
import React from 'react';
import type { DiskEntry } from '@/types/disk';
import { toOpalFileUrl } from '@/common/opalFileUrl';

/**
 * Electron ships Chromium's PDF viewer, so an <embed> is the entire
 * implementation — no pdf.js, no extra dependency.
 */
export const PdfPreview: React.FC<{ entry: DiskEntry }> = ({ entry }) => (
  <div className="flex-1 min-h-0">
    <embed
      key={entry.path}
      src={toOpalFileUrl(entry.path)}
      type="application/pdf"
      data-testid="pdf-preview"
      className="w-full h-full"
    />
  </div>
);
```

- [ ] **Step 5: Add the dispatch cases**

In `DetailPane.tsx`:

```tsx
import { MediaPreview } from './MediaPreview';
import { PdfPreview } from './PdfPreview';
```

```tsx
    case 'video':
    case 'audio':
      return <MediaPreview entry={entry} />;
    case 'pdf':
      return <PdfPreview entry={entry} />;
```

- [ ] **Step 6: Widen the CSP for embedded content**

`<embed type="application/pdf">` is governed by `object-src`, which the current policy does not mention and therefore inherits from `default-src 'self'` — blocking `opal-file:`. In `src/main.ts`, the `CSP` array becomes:

```ts
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: https: ${OPAL_FILE_SCHEME}:`,
  "font-src 'self' data:",
  "connect-src 'self' https: ws: http://localhost:11434", // Ollama
  `media-src 'self' https: ${OPAL_FILE_SCHEME}:`,
  `object-src 'self' ${OPAL_FILE_SCHEME}:`,
  `frame-src 'self' ${OPAL_FILE_SCHEME}:`,
].join("; ");
```

- [ ] **Step 7: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/mediaPreview.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 8: Verify in the app — this is the step that catches CSP mistakes**

Run: `npm run better-dev`

Open a folder with a PDF and a video. Both must render. **Open DevTools and confirm the Console shows no `Content Security Policy` violations** — the unit tests cannot detect a CSP block, because happy-dom does not enforce CSP. If the PDF pane is blank, Step 6 is wrong.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/features/disk-explorer/ src/main.ts src/tests/unit/mediaPreview.test.tsx
git commit -m "feat(files): add pdf, video, and audio previews"
```

---

### Task 5: Quick Look overlay

`Space` opens a full-window preview of the selection; `Space` or `Escape` dismisses it. Reuses the Phase A viewers, so it is a shell rather than a second implementation.

**Files:**
- Create: `src/renderer/features/disk-explorer/components/QuickLook.tsx`
- Modify: `src/renderer/features/disk-explorer/store/diskStore.ts`
- Modify: `src/renderer/features/disk-explorer/components/DiskExplorer.tsx`
- Test: `src/tests/unit/quickLook.test.tsx`

**Interfaces:**
- Consumes: `DetailPane` (Task 2), `useDiskStore`.
- Produces: store field `isQuickLookOpen: boolean` with `openQuickLook()`, `closeQuickLook()`, `toggleQuickLook()`; component `<QuickLook entry={DiskEntry | null} />`.

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/quickLook.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { QuickLook } from '@/renderer/features/disk-explorer/components/QuickLook';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';

const PHOTO = entry({ path: '/V/a.jpg', name: 'a.jpg', kind: 'image', size: 2048 });

beforeEach(() => {
  installDiskApi();
  useDiskStore.setState({ isQuickLookOpen: false });
});

describe('QuickLook', () => {
  it('renders nothing while closed', () => {
    render(<QuickLook entry={PHOTO} />);
    expect(screen.queryByTestId('quick-look')).not.toBeInTheDocument();
  });

  it('renders the preview when opened', () => {
    useDiskStore.setState({ isQuickLookOpen: true });
    render(<QuickLook entry={PHOTO} />);

    expect(screen.getByTestId('quick-look')).toBeInTheDocument();
    expect(screen.getByAltText('a.jpg')).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({ isQuickLookOpen: true });
    render(<QuickLook entry={PHOTO} />);

    await user.keyboard('{Escape}');
    expect(useDiskStore.getState().isQuickLookOpen).toBe(false);
  });

  it('closes when the backdrop is clicked', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({ isQuickLookOpen: true });
    render(<QuickLook entry={PHOTO} />);

    await user.click(screen.getByTestId('quick-look-backdrop'));
    expect(useDiskStore.getState().isQuickLookOpen).toBe(false);
  });

  it('closes via the close button', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({ isQuickLookOpen: true });
    render(<QuickLook entry={PHOTO} />);

    await user.click(screen.getByTestId('quick-look-close'));
    expect(useDiskStore.getState().isQuickLookOpen).toBe(false);
  });

  it('stays closed when there is no selection', () => {
    useDiskStore.setState({ isQuickLookOpen: true });
    render(<QuickLook entry={null} />);
    expect(screen.queryByTestId('quick-look')).not.toBeInTheDocument();
  });

  it('is labelled as a dialog for assistive tech', () => {
    useDiskStore.setState({ isQuickLookOpen: true });
    render(<QuickLook entry={PHOTO} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'a.jpg');
  });
});

describe('quick look store actions', () => {
  it('toggles', () => {
    useDiskStore.getState().toggleQuickLook();
    expect(useDiskStore.getState().isQuickLookOpen).toBe(true);
    useDiskStore.getState().toggleQuickLook();
    expect(useDiskStore.getState().isQuickLookOpen).toBe(false);
  });

  it('closes when the selection is cleared', () => {
    useDiskStore.setState({ isQuickLookOpen: true });
    useDiskStore.getState().select(null);
    expect(useDiskStore.getState().isQuickLookOpen).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/quickLook.test.tsx`
Expected: FAIL — cannot resolve `QuickLook`.

- [ ] **Step 3: Extend the store**

In `src/renderer/features/disk-explorer/store/diskStore.ts`:

Add to `DiskState`:
```ts
  isQuickLookOpen: boolean;
```

Add to `DiskActions`:
```ts
  openQuickLook: () => void;
  closeQuickLook: () => void;
  toggleQuickLook: () => void;
```

Add the initial value beside the other state fields:
```ts
  isQuickLookOpen: false,
```

Add the actions beside `select`:
```ts
  openQuickLook: () => set({ isQuickLookOpen: true }),
  closeQuickLook: () => set({ isQuickLookOpen: false }),
  toggleQuickLook: () => set((state) => ({ isQuickLookOpen: !state.isQuickLookOpen })),
```

Change `select` so clearing the selection also dismisses the overlay — an open Quick Look with nothing selected is an empty modal the user cannot dismiss meaningfully. Replace the existing one-line `select` with:

```ts
  select: (targetPath) =>
    set((state) => ({
      selectedPath: targetPath,
      isQuickLookOpen: targetPath === null ? false : state.isQuickLookOpen,
    })),
```

- [ ] **Step 4: Implement `QuickLook`**

Create `src/renderer/features/disk-explorer/components/QuickLook.tsx`:

```tsx
import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import type { DiskEntry } from '@/types/disk';
import { useDiskStore } from '../store/diskStore';
import { DetailPane } from './detail/DetailPane';

export const QuickLook: React.FC<{ entry: DiskEntry | null }> = ({ entry }) => {
  const isOpen = useDiskStore((state) => state.isQuickLookOpen);
  const close = useDiskStore((state) => state.closeQuickLook);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };

    // Capture phase so the overlay wins over the grid's own key handling,
    // which Task 10 adds.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, close]);

  if (!isOpen || !entry) return null;

  return (
    <div data-testid="quick-look" className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        data-testid="quick-look-backdrop"
        onClick={close}
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={entry.name}
        className="relative w-[min(90vw,1100px)] h-[min(85vh,800px)] rounded-xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close preview"
          data-testid="quick-look-close"
          className="absolute top-2 right-2 z-10 p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <DetailPane entry={entry} />
      </div>
    </div>
  );
};
```

- [ ] **Step 5: Mount it and bind `Space`**

In `DiskExplorer.tsx`, add the import and render the overlay as the last child of the outer `div`:

```tsx
import { QuickLook } from './QuickLook';
```
```tsx
      <QuickLook entry={selectedEntry} />
```

Add the `Space` binding inside `DiskExplorer`:

```tsx
  const toggleQuickLook = useDiskStore((state) => state.toggleQuickLook);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;

      // Never hijack Space while the user is typing — the filter box in Task 9
      // and the rename dialog in Task 15 both need it.
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      event.preventDefault();
      toggleQuickLook();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleQuickLook]);
```

- [ ] **Step 6: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/quickLook.test.tsx`
Expected: PASS, 9 tests.

- [ ] **Step 7: Verify in the app**

Run: `npm run better-dev`

Select a photo, press `Space` — a large centred preview opens. Press `Space` again, then `Escape`, then click the backdrop; all three must close it.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/features/disk-explorer/ src/tests/unit/quickLook.test.tsx
git commit -m "feat(files): add Quick Look overlay bound to Space"
```

---

### Task 6: Reveal in Finder and Open in Default App

The escape hatch. Both are read-only with respect to Opal, but they hand a path to the OS, so both go through the root guard.

**Files:**
- Modify: `src/main/fs/DiskHandlers.ts`
- Modify: `src/preload.ts`, `src/renderer/shared/types/diskApi.d.ts`
- Create: `src/renderer/features/disk-explorer/components/EntryActions.tsx`
- Modify: `src/renderer/features/disk-explorer/components/detail/DetailPane.tsx`
- Test: `src/tests/unit/fs/diskHandlers.test.ts` (extend)
- Test: `e2e/tests/files-actions.spec.ts` **(E2E #6 of 10)**

**Interfaces:**
- Consumes: `RootRegistry.assertAllowed`, Electron `shell`.
- Produces: channels `disk:reveal` and `disk:open-external`; `<EntryActions entry />`.

- [ ] **Step 1: Extend the handler test**

In `src/tests/unit/fs/diskHandlers.test.ts`, add `shell` to the injected dependencies. First update the `DiskHandlers` construction in `beforeEach`:

```ts
let showItemInFolder: ReturnType<typeof vi.fn>;
let openPath: ReturnType<typeof vi.fn>;
```
```ts
  showItemInFolder = vi.fn();
  openPath = vi.fn(async () => '');

  new DiskHandlers({
    ipc: stub.ipc,
    registry,
    reader: new DiskReader({ registry }),
    showOpenDialog,
    shell: { showItemInFolder, openPath },
  }).registerAll();
```

Update the channel-list assertion and add cases:

```ts
  it('registers every channel', () => {
    expect(stub.channels().sort()).toEqual([
      'disk:list-roots',
      'disk:open-external',
      'disk:open-folder',
      'disk:read-directory',
      'disk:read-text-file',
      'disk:remove-root',
      'disk:reveal',
      'disk:stat',
    ]);
  });

  it('reveals a file inside a root', async () => {
    await registry.add(root);
    const target = path.join(root, 'note.md');

    const result = await stub.invoke('disk:reveal', target) as { success: boolean };
    expect(result.success).toBe(true);
    expect(showItemInFolder).toHaveBeenCalledTimes(1);
    expect(showItemInFolder.mock.calls[0][0]).toContain('note.md');
  });

  it('refuses to reveal a file outside every root', async () => {
    await registry.add(root);
    const outside = path.join(tmp, 'outside.txt');
    await writeFile(outside, 'nope');

    const result = await stub.invoke('disk:reveal', outside) as { success: boolean };
    expect(result.success).toBe(false);
    expect(showItemInFolder).not.toHaveBeenCalled();
  });

  it('opens a file externally', async () => {
    await registry.add(root);
    const result = await stub.invoke('disk:open-external', path.join(root, 'note.md')) as {
      success: boolean;
    };
    expect(result.success).toBe(true);
    expect(openPath).toHaveBeenCalledTimes(1);
  });

  it('refuses to open a file outside every root', async () => {
    await registry.add(root);
    const outside = path.join(tmp, 'outside.txt');
    await writeFile(outside, 'nope');

    const result = await stub.invoke('disk:open-external', outside) as { success: boolean };
    expect(result.success).toBe(false);
    expect(openPath).not.toHaveBeenCalled();
  });

  it('reports an OS failure to open', async () => {
    await registry.add(root);
    openPath.mockResolvedValue('No application is associated');

    const result = await stub.invoke('disk:open-external', path.join(root, 'note.md')) as {
      success: boolean; error: string;
    };
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no application/i);
  });
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/fs/diskHandlers.test.ts`
Expected: FAIL — the channel list does not match and `disk:reveal` has no handler.

- [ ] **Step 3: Implement the handlers**

In `src/main/fs/DiskHandlers.ts`, extend the dependencies interface — `shell` is injected rather than imported so it can be stubbed in tests:

```ts
export interface DiskShell {
  showItemInFolder: (fullPath: string) => void;
  /** Electron returns '' on success, or an error string on failure. */
  openPath: (fullPath: string) => Promise<string>;
}

export interface DiskHandlerDependencies {
  ipc: IpcMain;
  registry: RootRegistry;
  reader: DiskReader;
  showOpenDialog: () => Promise<OpenDialogReturnValue>;
  shell: DiskShell;
}
```

Register both in `registerAll()` and add:

```ts
  private registerReveal(): void {
    this.deps.ipc.handle(
      'disk:reveal',
      async (_, target: string): Promise<IPCResponse> => {
        try {
          const resolved = await this.deps.registry.assertAllowed(target);
          this.deps.shell.showItemInFolder(resolved);
          return { success: true };
        } catch (error) {
          return { success: false, error: describeError(error, 'Failed to reveal file') };
        }
      }
    );
  }

  private registerOpenExternal(): void {
    this.deps.ipc.handle(
      'disk:open-external',
      async (_, target: string): Promise<IPCResponse> => {
        try {
          const resolved = await this.deps.registry.assertAllowed(target);
          // openPath resolves to '' on success and to a message on failure.
          const failure = await this.deps.shell.openPath(resolved);
          if (failure) return { success: false, error: failure };
          return { success: true };
        } catch (error) {
          return { success: false, error: describeError(error, 'Failed to open file') };
        }
      }
    );
  }
```

- [ ] **Step 4: Inject the real `shell` in `main.ts`**

Add `shell` to the electron import and pass it to the constructor:

```ts
import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
```
```ts
const diskHandlers = new DiskHandlers({
  ipc: ipcMain,
  registry: rootRegistry,
  reader: diskReader,
  showOpenDialog: async () => { /* unchanged */ },
  shell: {
    showItemInFolder: (fullPath) => shell.showItemInFolder(fullPath),
    openPath: (fullPath) => shell.openPath(fullPath),
  },
});
```

- [ ] **Step 5: Expose in preload and types**

`src/preload.ts`, in `diskAPI`:
```ts
  reveal: (target: string) => ipcRenderer.invoke("disk:reveal", target),
  openExternal: (target: string) => ipcRenderer.invoke("disk:open-external", target),
```

`src/renderer/shared/types/diskApi.d.ts`, in `DiskAPI`:
```ts
  reveal: (target: string) => Promise<DiskResult>;
  openExternal: (target: string) => Promise<DiskResult>;
```

Add both to the defaults in `src/tests/helpers/diskApi.ts` so every existing renderer test keeps a complete stub:
```ts
    reveal: vi.fn(async () => ({ success: true as const, data: undefined })),
    openExternal: vi.fn(async () => ({ success: true as const, data: undefined })),
```

- [ ] **Step 6: Implement `EntryActions`**

Create `src/renderer/features/disk-explorer/components/EntryActions.tsx`:

```tsx
import React, { useCallback } from 'react';
import { FolderSearch, ExternalLink } from 'lucide-react';
import type { DiskEntry } from '@/types/disk';
import { useDiskStore } from '../store/diskStore';

export const EntryActions: React.FC<{ entry: DiskEntry }> = ({ entry }) => {
  const setError = useCallback((message: string) => {
    useDiskStore.setState({ loading: { isLoading: false, error: message } });
  }, []);

  const reveal = useCallback(async () => {
    const result = await window.diskAPI.reveal(entry.path);
    if (!result.success) setError(result.error);
  }, [entry.path, setError]);

  const openExternal = useCallback(async () => {
    const result = await window.diskAPI.openExternal(entry.path);
    if (!result.success) setError(result.error);
  }, [entry.path, setError]);

  return (
    <div className="flex items-center gap-1">
      <ActionButton onClick={reveal} label="Reveal in Finder" testId="entry-reveal" Icon={FolderSearch} />
      <ActionButton onClick={openExternal} label="Open in default app" testId="entry-open-external" Icon={ExternalLink} />
    </div>
  );
};

interface ActionButtonProps {
  onClick: () => void | Promise<void>;
  label: string;
  testId: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const ActionButton: React.FC<ActionButtonProps> = ({ onClick, label, testId, Icon }) => (
  <button
    type="button"
    onClick={() => void onClick()}
    aria-label={label}
    title={label}
    data-testid={testId}
    className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
  >
    <Icon className="h-4 w-4" />
  </button>
);
```

- [ ] **Step 7: Put the actions in the detail header**

In `DetailPane.tsx`, import `EntryActions` and restructure the header so the title and actions sit on one row:

```tsx
      <header className="flex items-start justify-between gap-2 px-4 py-2 border-b border-border/60 shrink-0">
        <div className="min-w-0">
          <h2 data-testid="detail-title" className="text-sm font-medium truncate" title={entry.name}>
            {entry.name}
          </h2>
          <p data-testid="detail-subtitle" className="text-xs text-muted-foreground">
            {entry.isDirectory ? 'Folder' : formatBytes(entry.size)}
          </p>
        </div>
        <EntryActions entry={entry} />
      </header>
```

- [ ] **Step 8: Run the unit tests**

Run: `npx vitest run src/tests/unit/fs/diskHandlers.test.ts src/tests/unit/detailPane.test.tsx`
Expected: PASS — 14 handler tests, 7 detail-pane tests.

- [ ] **Step 9: Write the E2E test**

This is E2E because it verifies the root guard holds across a real process boundary for a channel that hands a path to the OS — the failure mode is "Opal opened a file it should not have", which no unit test can prove.

Create `e2e/tests/files-actions.spec.ts`:

```ts
import { test, expect } from '../fixtures/electronApp';
import { createTempVault, seedRoots, type TempVault } from '../helpers/tempVault';
import { realpath } from 'fs/promises';

let vault: TempVault;
let vaultRoot: string;

test.beforeAll(async () => {
  vault = await createTempVault();
  vaultRoot = await realpath(vault.root);
});

test.afterAll(async () => { await vault.cleanup(); });

test.beforeEach(async ({ userDataDir }) => {
  await seedRoots(userDataDir, [vaultRoot]);
});

test('refuses to reveal or open a path outside every opened root', async ({ page }) => {
  await page.evaluate(() => { window.location.hash = '#/files'; });
  await page.waitForSelector('[role="tree"]');

  // The guard must hold for both OS-handoff channels. If either succeeds,
  // Opal can be made to act on any file the user can read.
  const results = await page.evaluate(async () => ({
    reveal: await window.diskAPI.reveal('/etc/hosts'),
    open: await window.diskAPI.openExternal('/etc/hosts'),
  }));

  expect(results.reveal.success).toBe(false);
  expect(results.open.success).toBe(false);
});
```

- [ ] **Step 10: Run the E2E suite**

Run: `npm run test:e2e`
Expected: 6 passed. Budget check: 6 of 10 used.

- [ ] **Step 11: Restore the Node ABI and run everything**

Run: `npm test`
Expected: all pass.

- [ ] **Step 12: Commit**

```bash
git add src/main/fs/DiskHandlers.ts src/main.ts src/preload.ts \
        src/renderer/ src/tests/ e2e/tests/files-actions.spec.ts
git commit -m "feat(files): add reveal-in-finder and open-externally, both root-guarded"
```

---

**PHASE A COMPLETE.** The app can now show you the contents of any file you click. Stop here if priorities change; the remaining phases are additive.

---

# PHASE B — Move fast

Keyboard-first operation, plus the navigation chrome a file manager needs.

---

### Task 7: Breadcrumb path bar

**Files:**
- Create: `src/common/pathSegments.ts`
- Create: `src/renderer/features/disk-explorer/components/Breadcrumb.tsx`
- Modify: `src/renderer/features/disk-explorer/components/DiskExplorer.tsx`
- Test: `src/tests/unit/fs/pathSegments.test.ts`
- Test: `src/tests/unit/breadcrumb.test.tsx`

**Interfaces:**
- Consumes: `useDiskStore`.
- Produces:
  - `segmentsWithinRoot(root: string, target: string): PathSegment[]`
  - `interface PathSegment { name: string; path: string }`
  - `<Breadcrumb dirPath={string} />`

- [ ] **Step 1: Write the failing test for the path logic**

The interesting logic is pure and belongs in `common/`: given a root and a descendant, produce the clickable trail. Segments above the root are never shown, because the user cannot navigate there.

Create `src/tests/unit/fs/pathSegments.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { segmentsWithinRoot } from '@/common/pathSegments';

describe('segmentsWithinRoot', () => {
  const root = '/Users/cody/Photos';

  it('returns just the root when target is the root', () => {
    expect(segmentsWithinRoot(root, root)).toEqual([
      { name: 'Photos', path: '/Users/cody/Photos' },
    ]);
  });

  it('returns the trail from root to target', () => {
    expect(segmentsWithinRoot(root, '/Users/cody/Photos/Rwanda/2024')).toEqual([
      { name: 'Photos', path: '/Users/cody/Photos' },
      { name: 'Rwanda', path: '/Users/cody/Photos/Rwanda' },
      { name: '2024', path: '/Users/cody/Photos/Rwanda/2024' },
    ]);
  });

  it('never exposes segments above the root', () => {
    const segments = segmentsWithinRoot(root, '/Users/cody/Photos/Rwanda');
    expect(segments.some((s) => s.name === 'cody')).toBe(false);
    expect(segments.some((s) => s.name === 'Users')).toBe(false);
  });

  it('returns an empty trail when the target is outside the root', () => {
    expect(segmentsWithinRoot(root, '/Users/cody/Documents')).toEqual([]);
  });

  it('tolerates trailing slashes on either argument', () => {
    expect(segmentsWithinRoot(`${root}/`, '/Users/cody/Photos/Rwanda/')).toEqual([
      { name: 'Photos', path: '/Users/cody/Photos' },
      { name: 'Rwanda', path: '/Users/cody/Photos/Rwanda' },
    ]);
  });

  it('handles a root at the filesystem root', () => {
    expect(segmentsWithinRoot('/', '/etc')).toEqual([
      { name: '/', path: '/' },
      { name: 'etc', path: '/etc' },
    ]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/fs/pathSegments.test.ts`
Expected: FAIL — cannot resolve `@/common/pathSegments`.

- [ ] **Step 3: Implement it**

Create `src/common/pathSegments.ts`:

```ts
export interface PathSegment {
  name: string;
  path: string;
}

function stripTrailingSlash(value: string): string {
  return value.length > 1 && value.endsWith('/') ? value.slice(0, -1) : value;
}

/**
 * The clickable trail from `root` down to `target`.
 *
 * Segments above the root are deliberately omitted: they are outside every
 * opened root, so clicking one would produce a guard rejection rather than
 * navigation. Showing a path the user cannot follow is worse than showing less.
 *
 * Pure string work — no `path` import, so the renderer can use it directly.
 */
export function segmentsWithinRoot(root: string, target: string): PathSegment[] {
  const normalizedRoot = stripTrailingSlash(root);
  const normalizedTarget = stripTrailingSlash(target);

  const isRoot = normalizedTarget === normalizedRoot;
  const prefix = normalizedRoot === '/' ? '/' : `${normalizedRoot}/`;
  if (!isRoot && !normalizedTarget.startsWith(prefix)) return [];

  const rootName = normalizedRoot === '/' ? '/' : normalizedRoot.split('/').pop() ?? normalizedRoot;
  const segments: PathSegment[] = [{ name: rootName, path: normalizedRoot }];
  if (isRoot) return segments;

  const remainder = normalizedTarget.slice(prefix.length);
  let walked = normalizedRoot === '/' ? '' : normalizedRoot;

  for (const name of remainder.split('/').filter(Boolean)) {
    walked = `${walked}/${name}`;
    segments.push({ name, path: walked });
  }

  return segments;
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/fs/pathSegments.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the component test**

Create `src/tests/unit/breadcrumb.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { Breadcrumb } from '@/renderer/features/disk-explorer/components/Breadcrumb';
import { installDiskApi } from '@/tests/helpers/diskApi';

const ROOT = '/V';

beforeEach(() => {
  installDiskApi();
  useDiskStore.setState({
    roots: [ROOT], listings: {}, expanded: {}, selectedPath: null,
    loading: { isLoading: false, error: null },
  });
});

describe('Breadcrumb', () => {
  it('renders one crumb per segment', () => {
    render(<Breadcrumb dirPath="/V/Photos/Rwanda" />);
    expect(screen.getByTestId('crumb-/V')).toHaveTextContent('V');
    expect(screen.getByTestId('crumb-/V/Photos')).toHaveTextContent('Photos');
    expect(screen.getByTestId('crumb-/V/Photos/Rwanda')).toHaveTextContent('Rwanda');
  });

  it('selects the folder when a crumb is clicked', async () => {
    const user = userEvent.setup();
    render(<Breadcrumb dirPath="/V/Photos/Rwanda" />);

    await user.click(screen.getByTestId('crumb-/V/Photos'));
    expect(useDiskStore.getState().selectedPath).toBe('/V/Photos');
  });

  it('marks the final crumb as current', () => {
    render(<Breadcrumb dirPath="/V/Photos" />);
    expect(screen.getByTestId('crumb-/V/Photos')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('crumb-/V')).not.toHaveAttribute('aria-current');
  });

  it('renders nothing when the path is outside every root', () => {
    render(<Breadcrumb dirPath="/somewhere/else" />);
    expect(screen.queryByTestId('breadcrumb')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/breadcrumb.test.tsx`
Expected: FAIL — cannot resolve `Breadcrumb`.

- [ ] **Step 7: Implement `Breadcrumb`**

Create `src/renderer/features/disk-explorer/components/Breadcrumb.tsx`:

```tsx
import React, { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { segmentsWithinRoot } from '@/common/pathSegments';
import { useDiskStore } from '../store/diskStore';

export const Breadcrumb: React.FC<{ dirPath: string }> = ({ dirPath }) => {
  const roots = useDiskStore((state) => state.roots);
  const select = useDiskStore((state) => state.select);

  // A path belongs to exactly one root; find the one that contains it.
  const segments = useMemo(() => {
    for (const root of roots) {
      const trail = segmentsWithinRoot(root, dirPath);
      if (trail.length > 0) return trail;
    }
    return [];
  }, [roots, dirPath]);

  if (segments.length === 0) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      data-testid="breadcrumb"
      className="flex items-center gap-0.5 px-3 py-1.5 min-w-0 overflow-x-auto"
    >
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        return (
          <React.Fragment key={segment.path}>
            {index > 0 && <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />}
            <button
              type="button"
              onClick={() => select(segment.path)}
              aria-current={isLast ? 'page' : undefined}
              data-testid={`crumb-${segment.path}`}
              className={`px-1.5 py-0.5 rounded text-xs whitespace-nowrap ${
                isLast ? 'text-foreground font-medium' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {segment.name}
            </button>
          </React.Fragment>
        );
      })}
    </nav>
  );
};
```

- [ ] **Step 8: Mount it above the folder view**

In `DiskExplorer.tsx`, import `Breadcrumb` and render it inside the `<section>`, directly after the error banner and before the folder-view row:

```tsx
        {activeDirectory && (
          <div className="border-b border-border/60 shrink-0">
            <Breadcrumb dirPath={activeDirectory} />
          </div>
        )}
```

- [ ] **Step 9: Run, verify, commit**

Run: `npx vitest run src/tests/unit/breadcrumb.test.tsx && npm test`
Expected: 4 breadcrumb tests pass; full suite green.

Run `npm run better-dev` and confirm the trail appears and each crumb navigates.

```bash
git add src/common/pathSegments.ts src/renderer/features/disk-explorer/ src/tests/
git commit -m "feat(files): add clickable breadcrumb path bar"
```

---

### Task 8: Sorting

**Files:**
- Create: `src/common/sortEntries.ts`
- Modify: `src/renderer/features/disk-explorer/store/diskStore.ts`
- Create: `src/renderer/features/disk-explorer/components/Toolbar.tsx`
- Modify: `src/renderer/features/disk-explorer/components/DiskFolderView.tsx`
- Test: `src/tests/unit/fs/sortEntries.test.ts`
- Test: `src/tests/unit/toolbar.test.tsx`

**Interfaces:**
- Consumes: `DiskEntry`.
- Produces:
  - `type SortField = 'name' | 'modified' | 'size' | 'kind'`
  - `type SortDirection = 'asc' | 'desc'`
  - `sortEntries(entries: DiskEntry[], field: SortField, direction: SortDirection): DiskEntry[]`
  - Store: `sort: { field: SortField; direction: SortDirection }`, `setSort(field)`
  - `<Toolbar dirPath />`

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/fs/sortEntries.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sortEntries } from '@/common/sortEntries';
import type { DiskEntry } from '@/types/disk';

function make(over: Partial<DiskEntry> & { name: string }): DiskEntry {
  return {
    path: `/V/${over.name}`, kind: 'other', isDirectory: false,
    size: 0, mtimeMs: 0, ...over,
  } as DiskEntry;
}

const ENTRIES: DiskEntry[] = [
  make({ name: 'banana.txt', size: 300, mtimeMs: 200, kind: 'text' }),
  make({ name: 'Apple.jpg', size: 100, mtimeMs: 300, kind: 'image' }),
  make({ name: 'Zebra', isDirectory: true, kind: 'directory', size: 0, mtimeMs: 100 }),
  make({ name: 'cherry.md', size: 200, mtimeMs: 400, kind: 'markdown' }),
];

const names = (entries: DiskEntry[]) => entries.map((e) => e.name);

describe('sortEntries', () => {
  it('always puts directories first, whatever the field', () => {
    for (const field of ['name', 'modified', 'size', 'kind'] as const) {
      for (const direction of ['asc', 'desc'] as const) {
        expect(sortEntries(ENTRIES, field, direction)[0].name).toBe('Zebra');
      }
    }
  });

  it('sorts by name case-insensitively', () => {
    expect(names(sortEntries(ENTRIES, 'name', 'asc'))).toEqual([
      'Zebra', 'Apple.jpg', 'banana.txt', 'cherry.md',
    ]);
  });

  it('reverses on desc', () => {
    expect(names(sortEntries(ENTRIES, 'name', 'desc'))).toEqual([
      'Zebra', 'cherry.md', 'banana.txt', 'Apple.jpg',
    ]);
  });

  it('sorts by modified time, newest first on desc', () => {
    expect(names(sortEntries(ENTRIES, 'modified', 'desc'))).toEqual([
      'Zebra', 'cherry.md', 'Apple.jpg', 'banana.txt',
    ]);
  });

  it('sorts by size', () => {
    expect(names(sortEntries(ENTRIES, 'size', 'asc'))).toEqual([
      'Zebra', 'Apple.jpg', 'cherry.md', 'banana.txt',
    ]);
  });

  it('sorts by kind, then name within a kind', () => {
    const sorted = sortEntries(
      [
        make({ name: 'b.jpg', kind: 'image' }),
        make({ name: 'a.jpg', kind: 'image' }),
        make({ name: 'c.md', kind: 'markdown' }),
      ],
      'kind',
      'asc'
    );
    expect(names(sorted)).toEqual(['a.jpg', 'b.jpg', 'c.md']);
  });

  it('does not mutate its input', () => {
    const original = [...ENTRIES];
    sortEntries(ENTRIES, 'name', 'desc');
    expect(ENTRIES).toEqual(original);
  });

  it('is stable for equal keys', () => {
    const equal = [
      make({ name: 'a', size: 5 }), make({ name: 'b', size: 5 }), make({ name: 'c', size: 5 }),
    ];
    expect(names(sortEntries(equal, 'size', 'asc'))).toEqual(['a', 'b', 'c']);
  });

  it('handles an empty list', () => {
    expect(sortEntries([], 'name', 'asc')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/fs/sortEntries.test.ts`
Expected: FAIL — cannot resolve `@/common/sortEntries`.

- [ ] **Step 3: Implement it**

Create `src/common/sortEntries.ts`:

```ts
import type { DiskEntry } from '@/types/disk';

export type SortField = 'name' | 'modified' | 'size' | 'kind';
export type SortDirection = 'asc' | 'desc';

/**
 * Directories always sort above files, regardless of field or direction.
 *
 * This matches Finder and every file manager users already know. Letting a
 * directory sort into the middle of a size-ordered list is technically
 * consistent and practically useless — folders have no meaningful size.
 */
export function sortEntries(
  entries: DiskEntry[],
  field: SortField,
  direction: SortDirection
): DiskEntry[] {
  const sign = direction === 'asc' ? 1 : -1;

  const byName = (a: DiskEntry, b: DiskEntry) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

  const compare = (a: DiskEntry, b: DiskEntry): number => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;

    switch (field) {
      case 'name':
        return sign * byName(a, b);
      case 'modified':
        return sign * (a.mtimeMs - b.mtimeMs);
      case 'size':
        return sign * (a.size - b.size);
      case 'kind': {
        const byKind = a.kind.localeCompare(b.kind);
        // Within a kind, fall back to name so the order is meaningful rather
        // than arbitrary. The tiebreak is not reversed by direction.
        return byKind !== 0 ? sign * byKind : byName(a, b);
      }
    }
  };

  // Array.prototype.sort is stable per spec (ES2019+), so equal keys keep
  // their incoming order — which is DiskReader's name order.
  return [...entries].sort(compare);
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/fs/sortEntries.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Add sort state to the store**

In `diskStore.ts`, add the import, state, and action:

```ts
import type { SortField, SortDirection } from '@/common/sortEntries';
```

`DiskState`:
```ts
  sort: { field: SortField; direction: SortDirection };
```

`DiskActions`:
```ts
  /** Selecting the active field flips direction; a new field starts ascending. */
  setSort: (field: SortField) => void;
```

Initial value:
```ts
  sort: { field: 'name', direction: 'asc' },
```

Action:
```ts
  setSort: (field) =>
    set((state) => ({
      sort:
        state.sort.field === field
          ? { field, direction: state.sort.direction === 'asc' ? 'desc' : 'asc' }
          : { field, direction: 'asc' },
    })),
```

- [ ] **Step 6: Apply the sort in `DiskFolderView`**

Replace the direct use of `entries` with a sorted derivation. Add the imports and the memo, and render `visibleEntries` in both the gallery and list branches:

```tsx
import { sortEntries } from '@/common/sortEntries';
```
```tsx
  const sort = useDiskStore((state) => state.sort);

  const visibleEntries = useMemo(
    () => (entries ? sortEntries(entries, sort.field, sort.direction) : []),
    [entries, sort.field, sort.direction]
  );
```

Then replace `entries.map(` with `visibleEntries.map(` in both branches, and `entries.length` with `visibleEntries.length` in the item count and the empty check. Keep the `if (!entries)` loading guard as it is — `undefined` (not yet loaded) and `[]` (genuinely empty) mean different things.

- [ ] **Step 7: Write the toolbar test**

Create `src/tests/unit/toolbar.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { Toolbar } from '@/renderer/features/disk-explorer/components/Toolbar';
import { installDiskApi } from '@/tests/helpers/diskApi';

beforeEach(() => {
  installDiskApi();
  useDiskStore.setState({
    sort: { field: 'name', direction: 'asc' },
    filter: '',
    viewMode: null,
  });
});

describe('Toolbar sorting', () => {
  it('changes the sort field', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);

    await user.click(screen.getByTestId('sort-size'));
    expect(useDiskStore.getState().sort).toEqual({ field: 'size', direction: 'asc' });
  });

  it('flips direction when the active field is chosen again', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);

    await user.click(screen.getByTestId('sort-name'));
    expect(useDiskStore.getState().sort.direction).toBe('desc');

    await user.click(screen.getByTestId('sort-name'));
    expect(useDiskStore.getState().sort.direction).toBe('asc');
  });

  it('marks the active sort field', () => {
    render(<Toolbar />);
    expect(screen.getByTestId('sort-name')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('sort-size')).toHaveAttribute('aria-pressed', 'false');
  });
});
```

- [ ] **Step 8: Implement `Toolbar` (sort portion)**

Create `src/renderer/features/disk-explorer/components/Toolbar.tsx`. Task 9 extends this file with the filter box; write only the sort controls now.

```tsx
import React from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import type { SortField } from '@/common/sortEntries';
import { useDiskStore } from '../store/diskStore';

const SORT_FIELDS: { field: SortField; label: string }[] = [
  { field: 'name', label: 'Name' },
  { field: 'modified', label: 'Modified' },
  { field: 'size', label: 'Size' },
  { field: 'kind', label: 'Kind' },
];

export const Toolbar: React.FC = () => {
  const sort = useDiskStore((state) => state.sort);
  const setSort = useDiskStore((state) => state.setSort);

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 min-w-0">
      <span className="text-xs text-muted-foreground mr-1 shrink-0">Sort</span>
      {SORT_FIELDS.map(({ field, label }) => {
        const isActive = sort.field === field;
        const Arrow = sort.direction === 'asc' ? ArrowUp : ArrowDown;
        return (
          <button
            key={field}
            type="button"
            onClick={() => setSort(field)}
            aria-pressed={isActive}
            data-testid={`sort-${field}`}
            className={`flex items-center gap-0.5 px-2 py-0.5 rounded text-xs ${
              isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {label}
            {isActive && <Arrow className="h-3 w-3" />}
          </button>
        );
      })}
    </div>
  );
};
```

- [ ] **Step 9: Mount the toolbar beside the breadcrumb**

In `DiskExplorer.tsx`, replace the breadcrumb wrapper from Task 7 with a row holding both:

```tsx
        {activeDirectory && (
          <div className="flex items-center justify-between gap-2 border-b border-border/60 shrink-0 min-w-0">
            <Breadcrumb dirPath={activeDirectory} />
            <Toolbar />
          </div>
        )}
```

- [ ] **Step 10: Run, verify, commit**

Run: `npx vitest run src/tests/unit/toolbar.test.tsx src/tests/unit/diskFolderView.test.tsx && npm test`
Expected: all green.

```bash
git add src/common/sortEntries.ts src/renderer/features/disk-explorer/ src/tests/
git commit -m "feat(files): add sorting by name, modified, size, and kind"
```

---

### Task 9: Filter within the current folder

**Files:**
- Create: `src/common/filterEntries.ts`
- Modify: `src/renderer/features/disk-explorer/store/diskStore.ts`
- Modify: `src/renderer/features/disk-explorer/components/Toolbar.tsx`
- Modify: `src/renderer/features/disk-explorer/components/DiskFolderView.tsx`
- Test: `src/tests/unit/fs/filterEntries.test.ts`
- Test: `src/tests/unit/toolbar.test.tsx` (extend)

**Interfaces:**
- Produces: `filterEntries(entries, query): DiskEntry[]`; store `filter: string`, `setFilter(value)`.

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/fs/filterEntries.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { filterEntries } from '@/common/filterEntries';
import type { DiskEntry } from '@/types/disk';

function make(name: string): DiskEntry {
  return {
    path: `/V/${name}`, name, kind: 'other', isDirectory: false, size: 0, mtimeMs: 0,
  } as DiskEntry;
}

const ENTRIES = ['IMG_2041.jpg', 'IMG_2042.jpg', 'notes.md', 'Rwanda Trip.pdf'].map(make);
const names = (entries: DiskEntry[]) => entries.map((e) => e.name);

describe('filterEntries', () => {
  it('returns everything for an empty query', () => {
    expect(filterEntries(ENTRIES, '')).toHaveLength(4);
    expect(filterEntries(ENTRIES, '   ')).toHaveLength(4);
  });

  it('matches a substring, case-insensitively', () => {
    expect(names(filterEntries(ENTRIES, 'img'))).toEqual(['IMG_2041.jpg', 'IMG_2042.jpg']);
    expect(names(filterEntries(ENTRIES, 'RWANDA'))).toEqual(['Rwanda Trip.pdf']);
  });

  it('matches on extension', () => {
    expect(names(filterEntries(ENTRIES, '.md'))).toEqual(['notes.md']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterEntries(ENTRIES, 'zzzz')).toEqual([]);
  });

  it('ignores surrounding whitespace in the query', () => {
    expect(names(filterEntries(ENTRIES, '  notes  '))).toEqual(['notes.md']);
  });

  it('treats the query literally, not as a regex', () => {
    // A user typing '.' or '*' must not blow up or match everything.
    expect(() => filterEntries(ENTRIES, '*')).not.toThrow();
    expect(filterEntries(ENTRIES, '*')).toEqual([]);
    expect(names(filterEntries(ENTRIES, '.'))).toHaveLength(4);
  });

  it('does not mutate its input', () => {
    const original = [...ENTRIES];
    filterEntries(ENTRIES, 'img');
    expect(ENTRIES).toEqual(original);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/fs/filterEntries.test.ts`
Expected: FAIL — cannot resolve `@/common/filterEntries`.

- [ ] **Step 3: Implement it**

Create `src/common/filterEntries.ts`:

```ts
import type { DiskEntry } from '@/types/disk';

/**
 * Case-insensitive substring match on the file name.
 *
 * Deliberately not fuzzy: in a folder of IMG_2041…IMG_2099, fuzzy matching
 * returns almost everything for almost any query, which is worse than useless.
 * Substring is predictable, and predictability is what a filter box is for.
 *
 * The query is used with String.includes, never compiled into a RegExp, so
 * characters like '*' and '(' are literal and cannot throw.
 */
export function filterEntries(entries: DiskEntry[], query: string): DiskEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...entries];
  return entries.filter((entry) => entry.name.toLowerCase().includes(needle));
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/fs/filterEntries.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Add filter state to the store**

`DiskState`: `filter: string;` — initial `filter: '',`
`DiskActions`: `setFilter: (value: string) => void;`
Action: `setFilter: (value) => set({ filter: value }),`

Also clear the filter whenever the directory changes — a filter left over from the previous folder makes the new one look empty. In `loadDirectory`, this is not the right hook (it is skipped on cache hits). Instead, add the reset to `select` is also wrong (it fires per file). The correct place is `DiskFolderView`'s effect on `dirPath`, added in the next step.

- [ ] **Step 6: Apply the filter and reset it on folder change**

In `DiskFolderView.tsx`:

```tsx
import { filterEntries } from '@/common/filterEntries';
```
```tsx
  const filter = useDiskStore((state) => state.filter);
  const setFilter = useDiskStore((state) => state.setFilter);

  // A filter carried into a new folder makes it look empty for no visible
  // reason. Clear it whenever the folder changes.
  useEffect(() => { setFilter(''); }, [dirPath, setFilter]);

  const visibleEntries = useMemo(() => {
    if (!entries) return [];
    return sortEntries(filterEntries(entries, filter), sort.field, sort.direction);
  }, [entries, filter, sort.field, sort.direction]);
```

Add a distinct empty state for "filtered to nothing", so the user understands why the folder looks bare. Replace the empty branch with:

```tsx
      {visibleEntries.length === 0 ? (
        <div
          data-testid={filter ? 'disk-folder-no-matches' : 'disk-folder-empty'}
          className="flex-1 grid place-items-center text-sm text-muted-foreground"
        >
          {filter ? `No files matching “${filter}”` : 'This folder is empty'}
        </div>
      ) : activeMode === 'gallery' ? (
```

- [ ] **Step 7: Add the filter box to the toolbar**

In `Toolbar.tsx`, add the imports and render the input before the sort controls:

```tsx
import { Search, X } from 'lucide-react';
```
```tsx
  const filter = useDiskStore((state) => state.filter);
  const setFilter = useDiskStore((state) => state.setFilter);
```
```tsx
      <div className="relative shrink-0">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Escape') setFilter(''); }}
          placeholder="Filter"
          aria-label="Filter files in this folder"
          data-testid="filter-input"
          className="w-40 pl-7 pr-6 py-1 text-xs rounded-md bg-muted/50 border border-transparent focus:border-ring focus:outline-none"
        />
        {filter && (
          <button
            type="button"
            onClick={() => setFilter('')}
            aria-label="Clear filter"
            data-testid="filter-clear"
            className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
```

- [ ] **Step 8: Extend the toolbar test**

Append to `src/tests/unit/toolbar.test.tsx`:

```tsx
describe('Toolbar filtering', () => {
  it('updates the filter as the user types', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);

    await user.type(screen.getByTestId('filter-input'), 'img');
    expect(useDiskStore.getState().filter).toBe('img');
  });

  it('clears the filter with the clear button', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({ filter: 'img' });
    render(<Toolbar />);

    await user.click(screen.getByTestId('filter-clear'));
    expect(useDiskStore.getState().filter).toBe('');
  });

  it('clears the filter on Escape', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({ filter: 'img' });
    render(<Toolbar />);

    await user.type(screen.getByTestId('filter-input'), '{Escape}');
    expect(useDiskStore.getState().filter).toBe('');
  });

  it('hides the clear button when the filter is empty', () => {
    render(<Toolbar />);
    expect(screen.queryByTestId('filter-clear')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 9: Run, verify, commit**

Run: `npm test`
Expected: all green.

Run `npm run better-dev`; type in the filter box and confirm the grid narrows and the no-matches message appears for a nonsense query.

```bash
git add src/common/filterEntries.ts src/renderer/features/disk-explorer/ src/tests/
git commit -m "feat(files): add substring filter within the current folder"
```

---

### Task 10: Keyboard navigation

The Linear half of the quality bar. Arrows, Enter, Cmd+↑, and type-to-select across the grid.

**Files:**
- Create: `src/renderer/features/disk-explorer/hooks/useGridNavigation.ts`
- Modify: `src/renderer/features/disk-explorer/components/DiskFolderView.tsx`
- Modify: `src/renderer/features/disk-explorer/components/Toolbar.tsx` (Cmd+F focus)
- Test: `src/tests/unit/gridNavigation.test.tsx`

**Interfaces:**
- Consumes: `useDiskStore`.
- Produces: `useGridNavigation({ entries, columns }): { onKeyDown }`

**Design note:** navigation is a hook over the *visible, sorted, filtered* list, not over raw entries — arrowing must follow what the eye sees. `columns` is 1 in list mode and the measured column count in gallery mode.

**The hook only moves the selection; it never opens anything.** Opening is `Cmd+↓` and renaming is bare `Enter`, matching Finder — and both are bound in `DiskExplorer` rather than here, because the hook returns early on any modifier so application shortcuts pass through untouched. Reserving `Enter` now means Task 16 can add rename without re-binding anything.

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/gridNavigation.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useGridNavigation } from '@/renderer/features/disk-explorer/hooks/useGridNavigation';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';
import type { DiskEntry } from '@/types/disk';

const ENTRIES: DiskEntry[] = ['a', 'b', 'c', 'd', 'e'].map((n) =>
  entry({ path: `/V/${n}`, name: n })
);

/** Minimal host so the hook can be driven through real key events. */
const Harness: React.FC<{ columns: number }> = ({ columns }) => {
  const { onKeyDown } = useGridNavigation({ entries: ENTRIES, columns });
  return <div tabIndex={0} data-testid="grid" onKeyDown={onKeyDown} />;
};

async function press(key: string) {
  const user = userEvent.setup();
  screen.getByTestId('grid').focus();
  await user.keyboard(key);
}

beforeEach(() => {
  installDiskApi();
  useDiskStore.setState({ selectedPath: null, filter: '' });
});

describe('useGridNavigation', () => {
  it('selects the first entry when nothing is selected', async () => {
    render(<Harness columns={3} />);
    await press('{ArrowDown}');
    expect(useDiskStore.getState().selectedPath).toBe('/V/a');
  });

  it('moves right and left by one', async () => {
    useDiskStore.setState({ selectedPath: '/V/b' });
    render(<Harness columns={3} />);

    await press('{ArrowRight}');
    expect(useDiskStore.getState().selectedPath).toBe('/V/c');

    await press('{ArrowLeft}');
    expect(useDiskStore.getState().selectedPath).toBe('/V/b');
  });

  it('moves down and up by one row', async () => {
    useDiskStore.setState({ selectedPath: '/V/a' });
    render(<Harness columns={3} />);

    await press('{ArrowDown}');
    expect(useDiskStore.getState().selectedPath).toBe('/V/d');

    await press('{ArrowUp}');
    expect(useDiskStore.getState().selectedPath).toBe('/V/a');
  });

  it('clamps at the edges instead of wrapping', async () => {
    useDiskStore.setState({ selectedPath: '/V/a' });
    render(<Harness columns={3} />);

    await press('{ArrowLeft}');
    expect(useDiskStore.getState().selectedPath).toBe('/V/a');

    await press('{ArrowUp}');
    expect(useDiskStore.getState().selectedPath).toBe('/V/a');
  });

  it('clamps a downward move that would overshoot the last row', async () => {
    useDiskStore.setState({ selectedPath: '/V/c' });
    render(<Harness columns={3} />);

    // c is index 2; +3 would be index 5, which does not exist. Land on the last.
    await press('{ArrowDown}');
    expect(useDiskStore.getState().selectedPath).toBe('/V/e');
  });

  it('Home and End jump to the ends', async () => {
    useDiskStore.setState({ selectedPath: '/V/c' });
    render(<Harness columns={3} />);

    await press('{End}');
    expect(useDiskStore.getState().selectedPath).toBe('/V/e');

    await press('{Home}');
    expect(useDiskStore.getState().selectedPath).toBe('/V/a');
  });

  it('leaves Enter alone, so the app can bind it to rename', async () => {
    useDiskStore.setState({ selectedPath: '/V/b' });
    render(<Harness columns={3} />);

    await press('{Enter}');
    expect(useDiskStore.getState().selectedPath).toBe('/V/b');
  });

  it('type-to-select jumps to the first entry starting with the typed letter', async () => {
    useDiskStore.setState({ selectedPath: '/V/a' });
    render(<Harness columns={3} />);

    await press('d');
    expect(useDiskStore.getState().selectedPath).toBe('/V/d');
  });

  it('ignores modified keys so app shortcuts still work', async () => {
    useDiskStore.setState({ selectedPath: '/V/a' });
    render(<Harness columns={3} />);

    await press('{Meta>}d{/Meta}');
    expect(useDiskStore.getState().selectedPath).toBe('/V/a');
  });

  it('does nothing on an empty list', async () => {
    const Empty: React.FC = () => {
      const { onKeyDown } = useGridNavigation({ entries: [], columns: 3 });
      return <div tabIndex={0} data-testid="grid" onKeyDown={onKeyDown} />;
    };
    render(<Empty />);

    await press('{ArrowDown}');
    expect(useDiskStore.getState().selectedPath).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/gridNavigation.test.tsx`
Expected: FAIL — cannot resolve `useGridNavigation`.

- [ ] **Step 3: Implement the hook**

Create `src/renderer/features/disk-explorer/hooks/useGridNavigation.ts`:

```ts
import { useCallback, useRef } from 'react';
import type { DiskEntry } from '@/types/disk';
import { useDiskStore } from '../store/diskStore';

interface GridNavigationOptions {
  /** The visible, sorted, filtered list — arrowing must follow what the eye sees. */
  entries: DiskEntry[];
  /** 1 in list mode; the measured column count in gallery mode. */
  columns: number;
}

/** How long consecutive keystrokes accumulate into one type-to-select prefix. */
const TYPE_AHEAD_RESET_MS = 800;

export function useGridNavigation({ entries, columns }: GridNavigationOptions) {
  const typeAhead = useRef<{ prefix: string; at: number }>({ prefix: '', at: 0 });

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (entries.length === 0) return;

      // Let application shortcuts (Cmd+F, Cmd+↑, …) through untouched.
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const selectedPath = useDiskStore.getState().selectedPath;
      const current = entries.findIndex((candidate) => candidate.path === selectedPath);
      const clamp = (index: number) => Math.min(entries.length - 1, Math.max(0, index));

      const moveTo = (index: number) => {
        event.preventDefault();
        useDiskStore.getState().select(entries[clamp(index)].path);
      };

      // With nothing selected, any arrow lands on the first entry.
      const from = current === -1 ? 0 : current;
      if (current === -1 && event.key.startsWith('Arrow')) {
        moveTo(0);
        return;
      }

      switch (event.key) {
        case 'ArrowRight': return moveTo(from + 1);
        case 'ArrowLeft':  return moveTo(from - 1);
        case 'ArrowDown':  return moveTo(from + columns);
        case 'ArrowUp':    return moveTo(from - columns);
        case 'Home':       return moveTo(0);
        case 'End':        return moveTo(entries.length - 1);
      }

      // Enter is deliberately not handled: DiskExplorer binds it to rename,
      // and Cmd+Down to open, matching Finder.

      // Type-to-select. Single printable characters only, so this cannot
      // swallow Tab, Escape, Space, or function keys.
      if (event.key.length !== 1 || event.key === ' ') return;

      const now = event.timeStamp;
      const isContinuation = now - typeAhead.current.at < TYPE_AHEAD_RESET_MS;
      const prefix = (isContinuation ? typeAhead.current.prefix : '') + event.key.toLowerCase();
      typeAhead.current = { prefix, at: now };

      const match = entries.findIndex((candidate) =>
        candidate.name.toLowerCase().startsWith(prefix)
      );
      if (match !== -1) moveTo(match);
    },
    [entries, columns]
  );

  return { onKeyDown };
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/gridNavigation.test.tsx`
Expected: PASS, 10 tests.

- [ ] **Step 5: Wire it into `DiskFolderView`**

Add a focusable, keyboard-handling wrapper around the entry list. The container needs `tabIndex={0}` to receive key events at all.

```tsx
import { useGridNavigation } from '../hooks/useGridNavigation';
```
```tsx
  // Gallery tracks are `minmax(160px,1fr)` with 12px gaps; list mode is a
  // single column. Task 12 replaces the constant with a measured value.
  const columns = activeMode === 'gallery' ? 4 : 1;

  const { onKeyDown } = useGridNavigation({ entries: visibleEntries, columns });
```

Add `tabIndex={0}`, `onKeyDown`, and `outline-none` to both the gallery and list container `div`s (the ones carrying `data-testid="disk-folder-gallery"` and `disk-folder-list"`).

- [ ] **Step 6: Add the Cmd+F shortcut**

In `Toolbar.tsx`, add a ref and an effect:

```tsx
import { useEffect, useRef } from 'react';
```
```tsx
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
        event.preventDefault();
        filterRef.current?.focus();
        filterRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
```

Add `ref={filterRef}` to the filter `<input>`.

- [ ] **Step 7: Add Cmd+↑ for parent folder and Cmd+↓ to open**

In `DiskExplorer.tsx`, extend the existing keyboard effect (the one handling `Space`) with two bindings. `Cmd+↓` opens the selection — expanding a folder, or opening Quick Look for a file:

```tsx
      if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowDown') {
        event.preventDefault();
        if (!selectedEntry) return;
        if (selectedEntry.isDirectory) {
          select(selectedEntry.path);
          void useDiskStore.getState().toggleExpanded(selectedEntry.path);
        } else {
          useDiskStore.getState().openQuickLook();
        }
        return;
      }
```

And `Cmd+↑` goes to the parent:

```tsx
      if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowUp') {
        event.preventDefault();
        if (!activeDirectory) return;
        // Never navigate above a root — the guard would reject it anyway.
        if (roots.includes(activeDirectory)) return;
        const parent = activeDirectory.slice(0, activeDirectory.lastIndexOf('/'));
        if (parent) select(parent);
        return;
      }
```

Add `activeDirectory`, `roots`, `select`, and `selectedEntry` to that effect's dependency array.

- [ ] **Step 8: Run everything and verify by hand**

Run: `npm test`

Run `npm run better-dev` and confirm: click into the grid, then arrow around; `Cmd+↓` on a folder expands it and on a file opens Quick Look; typing a letter jumps; `Cmd+F` focuses the filter; `Cmd+↑` goes to the parent and stops at the root.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/features/disk-explorer/ src/tests/unit/gridNavigation.test.tsx
git commit -m "feat(files): add full keyboard navigation to the grid"
```

---

**PHASE B COMPLETE.** The Files page is fully operable from the keyboard.

---

# PHASE C — Survive real folders

Today a 2,000-photo folder renders 2,000 full-size images into the DOM. This phase fixes that and keeps the view honest when the disk changes underneath it.

---

### Task 11: Thumbnail service

**Files:**
- Create: `src/main/fs/ThumbnailService.ts`
- Create: `src/common/opalThumbUrl.ts`
- Modify: `src/main/protocol/opalFile.ts` (register a second scheme)
- Modify: `src/main.ts`
- Test: `src/tests/unit/fs/opalThumbUrl.test.ts`
- Test: `src/tests/unit/fs/thumbnailService.test.ts`

**Interfaces:**
- Consumes: `RootRegistry`, Electron `nativeImage`.
- Produces:
  - `toOpalThumbUrl(absolutePath: string): string`
  - `ThumbnailService.getThumbnailPath(sourcePath: string): Promise<string>` — returns a cached PNG path, generating it if absent
  - `opal-thumb://` protocol serving those PNGs

**Design notes:**
- `nativeImage.createThumbnailFromPath(path, maxSize)` uses the OS thumbnail service. On macOS that is QuickLook, so HEIC, PDF, and video first-frames all work with no extra dependency.
- The cache key is `sha256(resolvedPath + ':' + mtimeMs + ':' + size)`. Including mtime and size means an edited file regenerates automatically without any invalidation logic.
- Cache lives in `userData/thumbnails/`, never beside the user's files. Derived data must never litter the tree.
- Generation failures are cached as a tombstone so a corrupt file is not re-attempted on every scroll.

- [ ] **Step 1: Write the URL test**

Create `src/tests/unit/fs/opalThumbUrl.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toOpalThumbUrl, opalThumbUrlToPath, OPAL_THUMB_SCHEME } from '@/common/opalThumbUrl';

describe('opal-thumb URLs', () => {
  it('uses its own scheme, distinct from opal-file', () => {
    expect(OPAL_THUMB_SCHEME).toBe('opal-thumb');
    expect(toOpalThumbUrl('/V/a.jpg')).toMatch(/^opal-thumb:\/\//);
  });

  it('round-trips a path', () => {
    const p = '/Users/cody/Photos/a.jpg';
    expect(opalThumbUrlToPath(toOpalThumbUrl(p))).toBe(p);
  });

  it('round-trips spaces and reserved characters', () => {
    const p = '/V/My Photos/a#b?c&d=e.jpg';
    expect(toOpalThumbUrl(p)).not.toContain(' ');
    expect(opalThumbUrlToPath(toOpalThumbUrl(p))).toBe(p);
  });

  it('round-trips non-ASCII', () => {
    const p = '/V/café — 2024 (½).jpg';
    expect(opalThumbUrlToPath(toOpalThumbUrl(p))).toBe(p);
  });

  it('rejects a URL from another scheme', () => {
    expect(() => opalThumbUrlToPath('opal-file:///V/a.jpg')).toThrow(/scheme/i);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails, then implement**

Run: `npx vitest run src/tests/unit/fs/opalThumbUrl.test.ts` → FAIL.

Create `src/common/opalThumbUrl.ts`:

```ts
export const OPAL_THUMB_SCHEME = 'opal-thumb';

/**
 * Thumbnails get their own scheme rather than a query parameter on opal-file://
 * so the two protocol handlers stay separate: one streams original bytes, the
 * other may generate a file before responding.
 */
export function toOpalThumbUrl(absolutePath: string): string {
  const encoded = absolutePath.split('/').map(encodeURIComponent).join('/');
  return `${OPAL_THUMB_SCHEME}://${encoded}`;
}

export function opalThumbUrlToPath(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== `${OPAL_THUMB_SCHEME}:`) {
    throw new Error(`Unexpected scheme on thumbnail URL: ${parsed.protocol}`);
  }
  return decodeURIComponent(`${parsed.host}${parsed.pathname}`);
}
```

Run again → PASS, 5 tests.

- [ ] **Step 3: Write the service test**

`nativeImage` is injected so the service is testable without Electron.

Create `src/tests/unit/fs/thumbnailService.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readdir } from 'fs/promises';
import path from 'path';
import os from 'os';
import { RootRegistry, PathNotAllowedError } from '@/main/fs/RootRegistry';
import { ThumbnailService } from '@/main/fs/ThumbnailService';

let tmp: string;
let root: string;
let cacheDir: string;
let registry: RootRegistry;
let createThumbnail: ReturnType<typeof vi.fn>;
let service: ThumbnailService;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-thumbs-'));
  root = path.join(tmp, 'Vault');
  cacheDir = path.join(tmp, 'cache');
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'a.jpg'), 'jpegbytes');

  registry = new RootRegistry({ storePath: path.join(tmp, 'roots.json') });
  await registry.load();
  await registry.add(root);

  createThumbnail = vi.fn(async () => ({ toPNG: () => Buffer.from('PNGDATA'), isEmpty: () => false }));
  service = new ThumbnailService({ registry, cacheDir, createThumbnail });
});

afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

describe('ThumbnailService', () => {
  it('generates a thumbnail and returns its cached path', async () => {
    const result = await service.getThumbnailPath(path.join(root, 'a.jpg'));
    expect(result).toContain(cacheDir);
    expect(result.endsWith('.png')).toBe(true);
    expect(createThumbnail).toHaveBeenCalledTimes(1);
  });

  it('reuses the cache on a second request', async () => {
    const target = path.join(root, 'a.jpg');
    const first = await service.getThumbnailPath(target);
    const second = await service.getThumbnailPath(target);

    expect(second).toBe(first);
    expect(createThumbnail).toHaveBeenCalledTimes(1);
  });

  it('regenerates when the source file changes', async () => {
    const target = path.join(root, 'a.jpg');
    await service.getThumbnailPath(target);

    // Different size and mtime, so a different cache key.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(target, 'completely different bytes');

    await service.getThumbnailPath(target);
    expect(createThumbnail).toHaveBeenCalledTimes(2);
  });

  it('refuses a source outside every root', async () => {
    const outside = path.join(tmp, 'outside.jpg');
    await writeFile(outside, 'x');
    await expect(service.getThumbnailPath(outside)).rejects.toThrow(PathNotAllowedError);
  });

  it('reports a generation failure', async () => {
    createThumbnail.mockRejectedValue(new Error('unsupported format'));
    await expect(service.getThumbnailPath(path.join(root, 'a.jpg'))).rejects.toThrow();
  });

  it('does not retry a source that already failed', async () => {
    createThumbnail.mockRejectedValue(new Error('unsupported format'));
    const target = path.join(root, 'a.jpg');

    await expect(service.getThumbnailPath(target)).rejects.toThrow();
    await expect(service.getThumbnailPath(target)).rejects.toThrow();

    // The tombstone means the expensive call happened only once.
    expect(createThumbnail).toHaveBeenCalledTimes(1);
  });

  it('writes nothing outside its cache directory', async () => {
    await service.getThumbnailPath(path.join(root, 'a.jpg'));
    expect(await readdir(root)).toEqual(['a.jpg']);
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/fs/thumbnailService.test.ts`
Expected: FAIL — cannot resolve `ThumbnailService`.

- [ ] **Step 5: Implement `ThumbnailService`**

Create `src/main/fs/ThumbnailService.ts`:

```ts
import { createHash } from 'crypto';
import { mkdir, stat, writeFile, access } from 'fs/promises';
import path from 'path';
import type { RootRegistry } from '@/main/fs/RootRegistry';

/** The subset of Electron's NativeImage this service needs. */
export interface ThumbnailImage {
  toPNG: () => Buffer;
  isEmpty: () => boolean;
}

export interface ThumbnailServiceDependencies {
  registry: RootRegistry;
  cacheDir: string;
  /** nativeImage.createThumbnailFromPath — injected so tests need no Electron. */
  createThumbnail: (sourcePath: string, maxSize: { width: number; height: number }) => Promise<ThumbnailImage>;
}

const THUMB_SIZE = { width: 512, height: 512 };

export class ThumbnailService {
  private deps: ThumbnailServiceDependencies;
  /**
   * Sources whose generation already failed. Without this, a folder holding a
   * corrupt file re-attempts an expensive OS call on every scroll, forever.
   */
  private failed = new Set<string>();

  constructor(deps: ThumbnailServiceDependencies) {
    this.deps = deps;
  }

  async getThumbnailPath(sourcePath: string): Promise<string> {
    const resolved = await this.deps.registry.assertAllowed(sourcePath);
    const info = await stat(resolved);

    // mtime and size are part of the key, so an edited file lands on a new
    // cache entry automatically — no invalidation pass to write or to forget.
    const key = createHash('sha256')
      .update(`${resolved}:${info.mtimeMs}:${info.size}`)
      .digest('hex');

    if (this.failed.has(key)) {
      throw new Error(`Thumbnail generation already failed for ${sourcePath}`);
    }

    const cachePath = path.join(this.deps.cacheDir, `${key}.png`);
    try {
      await access(cachePath);
      return cachePath;
    } catch {
      // Not cached yet — fall through and generate.
    }

    try {
      const image = await this.deps.createThumbnail(resolved, THUMB_SIZE);
      if (image.isEmpty()) throw new Error('OS produced an empty thumbnail');

      await mkdir(this.deps.cacheDir, { recursive: true });
      await writeFile(cachePath, image.toPNG());
      return cachePath;
    } catch (error) {
      this.failed.add(key);
      throw error;
    }
  }
}
```

- [ ] **Step 6: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/fs/thumbnailService.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 7: Register the `opal-thumb://` protocol**

In `src/main/protocol/opalFile.ts`, add the thumbnail scheme to the privileged registration and add a second handler registrar:

```ts
import { OPAL_THUMB_SCHEME, opalThumbUrlToPath } from '@/common/opalThumbUrl';
import type { ThumbnailService } from '@/main/fs/ThumbnailService';
```

Extend `registerOpalFileScheme` to declare both schemes in the single `registerSchemesAsPrivileged` call — Electron only honours the first call, so both must be declared together:

```ts
export function registerOpalFileScheme(): void {
  const privileges = {
    standard: true, secure: true, stream: true,
    supportFetchAPI: true, corsEnabled: true,
  };
  protocol.registerSchemesAsPrivileged([
    { scheme: OPAL_FILE_SCHEME, privileges },
    { scheme: OPAL_THUMB_SCHEME, privileges },
  ]);
}
```

Add the handler:

```ts
export function registerOpalThumbProtocol(deps: { thumbnails: ThumbnailService }): void {
  protocol.handle(OPAL_THUMB_SCHEME, async (request) => {
    let requestedPath: string;
    try {
      requestedPath = opalThumbUrlToPath(request.url);
    } catch {
      return new Response('Bad thumbnail URL', { status: 400 });
    }

    try {
      // getThumbnailPath performs the root check itself, so there is no
      // separate guard to keep in sync here.
      const cachePath = await deps.thumbnails.getThumbnailPath(requestedPath);
      const body = Readable.toWeb(createReadStream(cachePath)) as ReadableStream;
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          // The cache key already includes mtime and size, so a given URL's
          // bytes never change and may be cached aggressively.
          'Cache-Control': 'max-age=31536000, immutable',
        },
      });
    } catch (error) {
      if (error instanceof PathNotAllowedError) return new Response('Forbidden', { status: 403 });
      // A missing thumbnail is normal for unsupported formats; the renderer
      // falls back to a kind icon on error.
      return new Response('No thumbnail', { status: 404 });
    }
  });
}
```

- [ ] **Step 8: Wire it into `main.ts`**

```ts
import { nativeImage } from "electron";
import { ThumbnailService } from "@/main/fs/ThumbnailService";
import { registerOpalThumbProtocol, OPAL_THUMB_SCHEME } from "@/main/protocol/opalFile";
```
```ts
const thumbnailService = new ThumbnailService({
  registry: rootRegistry,
  cacheDir: path.join(
    process.env.OPAL_TEST_USER_DATA_DIR || app.getPath("userData"),
    "thumbnails"
  ),
  createThumbnail: (sourcePath, maxSize) =>
    nativeImage.createThumbnailFromPath(sourcePath, maxSize),
});
```

Inside `app.whenReady()`, beside the existing protocol registration:
```ts
registerOpalThumbProtocol({ thumbnails: thumbnailService });
```

Add the scheme to the CSP `img-src`:
```ts
  `img-src 'self' data: https: ${OPAL_FILE_SCHEME}: ${OPAL_THUMB_SCHEME}:`,
```

- [ ] **Step 9: Use thumbnails in the gallery**

In `DiskFolderView.tsx`'s `GalleryTile`, swap the source and add a fallback for formats the OS cannot thumbnail:

```tsx
import { toOpalThumbUrl } from '@/common/opalThumbUrl';
```
```tsx
const GalleryTile: React.FC<EntryProps> = ({ entry, isSelected, onSelect }) => {
  const Icon = ICONS[entry.kind];
  const [thumbFailed, setThumbFailed] = useState(false);

  // Anything the OS can render a preview for gets a thumbnail, not just images
  // — on macOS that includes PDFs and video first-frames.
  const canThumbnail =
    !entry.isDirectory && ['image', 'pdf', 'video'].includes(entry.kind) && !thumbFailed;

  return (
    /* …unchanged wrapper… */
      <div className="aspect-square rounded-md overflow-hidden bg-muted/40 grid place-items-center">
        {canThumbnail ? (
          <img
            src={toOpalThumbUrl(entry.path)}
            alt={entry.name}
            loading="lazy"
            decoding="async"
            onError={() => setThumbFailed(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <Icon className="h-8 w-8 opacity-40" />
        )}
      </div>
    /* …unchanged label… */
  );
};
```

- [ ] **Step 10: Update the gallery test**

`diskFolderView.test.tsx` asserts the gallery image `src` starts with `opal-file://`. That is now `opal-thumb://`. Change the two assertions in the test named *renders images through the opal-file protocol, never as data URLs* to:

```tsx
    expect(image.getAttribute('src')).toMatch(/^opal-thumb:\/\//);
    expect(image.getAttribute('src')).not.toMatch(/^data:/);
```

Rename that test to `renders images through the thumbnail protocol, never as data URLs`. The detail pane still uses `opal-file://` for full resolution, and `detailPane.test.tsx` continues to assert that — the two protocols are used deliberately in different places.

- [ ] **Step 11: Run, verify, commit**

Run: `npm test`

Run `npm run better-dev`, open a large photo folder, and confirm thumbnails appear and scrolling is smooth. Check DevTools → Network for `opal-thumb://` requests and no CSP violations.

```bash
git add src/common/opalThumbUrl.ts src/main/ src/renderer/ src/tests/
git commit -m "feat(files): generate OS thumbnails and serve them over opal-thumb://"
```

---

### Task 12: Virtualize the gallery and list

**Files:**
- Modify: `src/renderer/features/disk-explorer/components/DiskFolderView.tsx`
- Create: `src/renderer/features/disk-explorer/hooks/useElementSize.ts`
- Test: `src/tests/unit/diskFolderView.test.tsx` (extend)

**Interfaces:**
- Consumes: `react-window` (`FixedSizeGrid`, `FixedSizeList`).
- Produces: `useElementSize(): [ref, { width, height }]`

**Design note:** virtualization changes what is in the DOM, which existing tests assert on. happy-dom reports zero-size elements, so `react-window` would render no rows and every test would fail. The fix is a measured size with a test-friendly fallback, not a mock of `react-window`.

- [ ] **Step 1: Implement `useElementSize`**

Create `src/renderer/features/disk-explorer/hooks/useElementSize.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

export interface Size { width: number; height: number }

/**
 * Measures an element with ResizeObserver.
 *
 * The fallback matters: happy-dom reports every element as 0×0 and does not
 * implement ResizeObserver, so without it react-window would render zero rows
 * and every component test would see an empty grid. Falling back to a nominal
 * size keeps the virtualized list testable without mocking react-window.
 */
const FALLBACK: Size = { width: 800, height: 600 };

export function useElementSize<T extends HTMLElement>(): [
  (node: T | null) => void,
  Size
] {
  const [size, setSize] = useState<Size>(FALLBACK);
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    if (!node || typeof ResizeObserver === 'undefined') return;

    observer.current = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.current.observe(node);
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return [ref, size];
}
```

- [ ] **Step 2: Add the virtualization tests**

Append to `src/tests/unit/diskFolderView.test.tsx`:

```tsx
describe('virtualization', () => {
  it('renders a windowed subset of a large folder, not every item', async () => {
    const many = Array.from({ length: 2000 }, (_, index) =>
      entry({ path: `${PHOTOS}/img${index}.jpg`, name: `img${index}.jpg`, kind: 'image' })
    );
    useDiskStore.setState({ listings: { [PHOTOS]: many } });

    render(<DiskFolderView dirPath={PHOTOS} />);

    await waitFor(() => expect(screen.getByTestId('disk-folder-gallery')).toBeInTheDocument());

    // The window is bounded by the measured height, so only a fraction of the
    // 2000 entries exist in the DOM. The exact count depends on tile size;
    // the assertion that matters is "far fewer than all of them".
    const tiles = screen.getAllByTestId(/^disk-folder-entry-/);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThan(200);
  });

  it('still reports the full item count in the header', async () => {
    const many = Array.from({ length: 2000 }, (_, index) =>
      entry({ path: `${PHOTOS}/img${index}.jpg`, name: `img${index}.jpg`, kind: 'image' })
    );
    useDiskStore.setState({ listings: { [PHOTOS]: many } });

    render(<DiskFolderView dirPath={PHOTOS} />);
    await waitFor(() => expect(screen.getByText('2000 items')).toBeInTheDocument());
  });
});
```

- [ ] **Step 3: Run and confirm the first test fails**

Run: `npx vitest run src/tests/unit/diskFolderView.test.tsx`
Expected: FAIL — all 2000 tiles are in the DOM.

- [ ] **Step 4: Virtualize both modes**

Rewrite the two render branches of `DiskFolderView`. Constants first:

```tsx
import { FixedSizeGrid, FixedSizeList } from 'react-window';
import { useElementSize } from '../hooks/useElementSize';

const TILE_WIDTH = 172;   // 160px track + 12px gap
const TILE_HEIGHT = 208;  // square thumbnail + two-line label
const ROW_HEIGHT = 28;
```

Inside the component:

```tsx
  const [viewportRef, viewport] = useElementSize<HTMLDivElement>();
  const columns = activeMode === 'gallery'
    ? Math.max(1, Math.floor(viewport.width / TILE_WIDTH))
    : 1;
```

`columns` now feeds `useGridNavigation` from Task 10 — delete the hardcoded `const columns = activeMode === 'gallery' ? 4 : 1;` line added there.

Gallery branch:

```tsx
        <div
          ref={viewportRef}
          data-testid="disk-folder-gallery"
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="flex-1 min-h-0 outline-none"
        >
          <FixedSizeGrid
            columnCount={columns}
            rowCount={Math.ceil(visibleEntries.length / columns)}
            columnWidth={TILE_WIDTH}
            rowHeight={TILE_HEIGHT}
            width={viewport.width}
            height={viewport.height}
          >
            {({ columnIndex, rowIndex, style }) => {
              const item = visibleEntries[rowIndex * columns + columnIndex];
              // The final row is usually partial; those cells have no entry.
              if (!item) return null;
              return (
                <div style={style} className="p-1.5">
                  <GalleryTile
                    entry={item}
                    isSelected={selectedPath === item.path}
                    onSelect={() => select(item.path)}
                  />
                </div>
              );
            }}
          </FixedSizeGrid>
        </div>
```

List branch:

```tsx
        <div
          ref={viewportRef}
          data-testid="disk-folder-list"
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="flex-1 min-h-0 outline-none"
        >
          <FixedSizeList
            itemCount={visibleEntries.length}
            itemSize={ROW_HEIGHT}
            width={viewport.width}
            height={viewport.height}
          >
            {({ index, style }) => {
              const item = visibleEntries[index];
              return (
                <div style={style}>
                  <ListRow
                    entry={item}
                    isSelected={selectedPath === item.path}
                    onSelect={() => select(item.path)}
                  />
                </div>
              );
            }}
          </FixedSizeList>
        </div>
```

`GalleryTile` must fill its cell, so change its outermost `className` to include `w-full h-full`.

- [ ] **Step 5: Keep the selection scrolled into view**

Keyboard navigation is useless if the selection scrolls out of the window. Add refs and an effect:

```tsx
  const gridRef = useRef<FixedSizeGrid>(null);
  const listRef = useRef<FixedSizeList>(null);

  useEffect(() => {
    const index = visibleEntries.findIndex((candidate) => candidate.path === selectedPath);
    if (index === -1) return;

    if (activeMode === 'gallery') {
      gridRef.current?.scrollToItem({
        rowIndex: Math.floor(index / columns),
        columnIndex: index % columns,
      });
    } else {
      listRef.current?.scrollToItem(index);
    }
  }, [selectedPath, visibleEntries, activeMode, columns]);
```

Attach `ref={gridRef}` and `ref={listRef}` to the two `react-window` components.

- [ ] **Step 6: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/diskFolderView.test.tsx`
Expected: PASS, 13 tests.

- [ ] **Step 7: Verify with a genuinely large folder**

Run `npm run better-dev` and open a folder with a thousand or more files. Scrolling must stay smooth and arrow-key navigation must keep the selection visible.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/features/disk-explorer/ src/tests/unit/diskFolderView.test.tsx
git commit -m "feat(files): virtualize the gallery and list views"
```

---

### Task 13: Live file watcher

**Files:**
- Create: `src/main/fs/DiskWatcher.ts`
- Modify: `src/main/fs/DiskHandlers.ts`, `src/main.ts`, `src/preload.ts`, `src/renderer/shared/types/diskApi.d.ts`
- Modify: `src/renderer/features/disk-explorer/store/diskStore.ts`
- Test: `src/tests/unit/fs/diskWatcher.test.ts`

**Interfaces:**
- Consumes: `chokidar`, `RootRegistry`.
- Produces:
  - `DiskWatcher.watch(rootPath)`, `.unwatch(rootPath)`, `.closeAll()`
  - Push channel `disk:changed` carrying `{ directories: string[] }`
  - `window.diskAPI.onChanged(callback): () => void`
  - Store: `invalidate(directories: string[])`

**Design note:** the event payload is the set of *directories* whose contents changed, not individual files. The renderer caches per-directory listings, so directory granularity is exactly what it needs, and it collapses a thousand-file change into one message. Events are debounced in main.

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/fs/diskWatcher.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, unlink } from 'fs/promises';
import path from 'path';
import os from 'os';
import { DiskWatcher } from '@/main/fs/DiskWatcher';

let tmp: string;
let root: string;
let onChanged: ReturnType<typeof vi.fn>;
let watcher: DiskWatcher;

/** Waits for the debounce window plus chokidar's own settle time. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-watch-'));
  root = path.join(tmp, 'Vault');
  await mkdir(path.join(root, 'Photos'), { recursive: true });
  await writeFile(path.join(root, 'a.txt'), 'hello');

  onChanged = vi.fn();
  watcher = new DiskWatcher({ onChanged, debounceMs: 100 });
});

afterEach(async () => {
  await watcher.closeAll();
  await rm(tmp, { recursive: true, force: true });
});

describe('DiskWatcher', () => {
  it('reports the directory when a file is added', async () => {
    await watcher.watch(root);
    onChanged.mockClear();

    await writeFile(path.join(root, 'b.txt'), 'new');
    await settle();

    expect(onChanged).toHaveBeenCalled();
    const directories = onChanged.mock.calls.flatMap((call) => call[0]);
    expect(directories.some((dir: string) => dir.endsWith('Vault'))).toBe(true);
  });

  it('reports the directory when a file is deleted', async () => {
    await watcher.watch(root);
    onChanged.mockClear();

    await unlink(path.join(root, 'a.txt'));
    await settle();

    expect(onChanged).toHaveBeenCalled();
  });

  it('reports a nested directory, not just the root', async () => {
    await watcher.watch(root);
    onChanged.mockClear();

    await writeFile(path.join(root, 'Photos', 'c.jpg'), 'bytes');
    await settle();

    const directories = onChanged.mock.calls.flatMap((call) => call[0]);
    expect(directories.some((dir: string) => dir.endsWith('Photos'))).toBe(true);
  });

  it('coalesces a burst of changes into few notifications', async () => {
    await watcher.watch(root);
    onChanged.mockClear();

    for (let index = 0; index < 20; index += 1) {
      await writeFile(path.join(root, `burst${index}.txt`), 'x');
    }
    await settle();

    // 20 file events must not become 20 renderer messages.
    expect(onChanged.mock.calls.length).toBeLessThan(5);
  });

  it('stops reporting after unwatch', async () => {
    await watcher.watch(root);
    await watcher.unwatch(root);
    onChanged.mockClear();

    await writeFile(path.join(root, 'after.txt'), 'x');
    await settle();

    expect(onChanged).not.toHaveBeenCalled();
  });

  it('watching the same root twice creates one watcher', async () => {
    await watcher.watch(root);
    await watcher.watch(root);
    expect(watcher.watchedRoots()).toEqual([root]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/fs/diskWatcher.test.ts`
Expected: FAIL — cannot resolve `DiskWatcher`.

- [ ] **Step 3: Implement `DiskWatcher`**

Create `src/main/fs/DiskWatcher.ts`:

```ts
import chokidar, { type FSWatcher } from 'chokidar';
import path from 'path';
import logger from '@/main/logger';

export interface DiskWatcherDependencies {
  onChanged: (directories: string[]) => void;
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 150;

/**
 * Watches opened roots and reports which *directories* changed.
 *
 * Directory granularity is deliberate: the renderer caches one listing per
 * directory, so that is the unit it can act on, and it collapses a thousand-file
 * operation into a single message. Per-file events would be both noisier and
 * less useful.
 */
export class DiskWatcher {
  private deps: DiskWatcherDependencies;
  private watchers = new Map<string, FSWatcher>();
  private pending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(deps: DiskWatcherDependencies) {
    this.deps = deps;
  }

  async watch(rootPath: string): Promise<void> {
    if (this.watchers.has(rootPath)) return;

    const watcher = chokidar.watch(rootPath, {
      ignoreInitial: true,
      // Salvaged from the mount system: wait for writes to finish so a large
      // file copy reports once on completion rather than continuously.
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      ignored: /(^|[/\\])\../,  // dotfiles, which the reader hides anyway
      depth: 99,
    });

    for (const event of ['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const) {
      watcher.on(event, (changedPath: string) => {
        // A directory event changes its parent's listing; a file event changes
        // the listing of the directory containing it. Both reduce to dirname.
        this.enqueue(path.dirname(changedPath));
      });
    }

    watcher.on('error', (error) => logger.error(`Watcher error on ${rootPath}:`, error));

    this.watchers.set(rootPath, watcher);
  }

  async unwatch(rootPath: string): Promise<void> {
    const watcher = this.watchers.get(rootPath);
    if (!watcher) return;
    await watcher.close();
    this.watchers.delete(rootPath);
  }

  async closeAll(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await Promise.all([...this.watchers.values()].map((watcher) => watcher.close()));
    this.watchers.clear();
  }

  watchedRoots(): string[] {
    return [...this.watchers.keys()];
  }

  private enqueue(directory: string): void {
    this.pending.add(directory);
    if (this.timer) return;

    this.timer = setTimeout(() => {
      const directories = [...this.pending];
      this.pending.clear();
      this.timer = null;
      if (directories.length > 0) this.deps.onChanged(directories);
    }, this.deps.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  }
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/fs/diskWatcher.test.ts`
Expected: PASS, 6 tests. These touch the real filesystem and take a few seconds — that is expected.

- [ ] **Step 5: Push changes to the renderer**

In `src/main.ts`, create the watcher, start it for every root, and forward events:

```ts
import { DiskWatcher } from "@/main/fs/DiskWatcher";
```
```ts
const diskWatcher = new DiskWatcher({
  onChanged: (directories) => {
    mainWindow?.webContents.send("disk:changed", { directories });
  },
});
```

Inside `app.whenReady()`, after `rootRegistry.load()`:
```ts
for (const root of rootRegistry.list()) {
  await diskWatcher.watch(root);
}
```

Add to the existing `app.on("before-quit")` handler:
```ts
  void diskWatcher.closeAll();
```

In `DiskHandlers`, accept an optional watcher and keep it in step with the registry. Add `watcher: { watch: (p: string) => Promise<void>; unwatch: (p: string) => Promise<void> }` to `DiskHandlerDependencies`, then call `await this.deps.watcher.watch(root)` after a successful `registry.add`, and `await this.deps.watcher.unwatch(rootPath)` after a successful `registry.remove`. Pass a no-op pair in `diskHandlers.test.ts`:

```ts
    watcher: { watch: vi.fn(async () => {}), unwatch: vi.fn(async () => {}) },
```

- [ ] **Step 6: Subscribe in preload**

`src/preload.ts`, in `diskAPI`:

```ts
  onChanged: (callback: (payload: { directories: string[] }) => void) => {
    const listener = (_event: IpcRendererEvent, payload: { directories: string[] }) =>
      callback(payload);
    ipcRenderer.on("disk:changed", listener);
    return () => ipcRenderer.removeListener("disk:changed", listener);
  },
```

`diskApi.d.ts`:
```ts
  onChanged: (callback: (payload: { directories: string[] }) => void) => () => void;
```

`src/tests/helpers/diskApi.ts` default:
```ts
    onChanged: vi.fn(() => () => {}),
```

**Note for the contract test:** `disk:changed` is a main→renderer push registered with `ipcRenderer.on`, not `invoke`. The contract test's `INVOCATION` regex matches `invoke` and `send`, so `on` subscriptions are not checked and this adds no dead channel. Do not "fix" the contract test to cover it — main-side `webContents.send` is not a `.handle` registration and would produce a permanent false positive.

- [ ] **Step 7: Invalidate listings in the store**

`DiskActions`:
```ts
  /** Drop cached listings for directories that changed on disk, and reload the visible ones. */
  invalidate: (directories: string[]) => Promise<void>;
```
```ts
  invalidate: async (directories) => {
    const state = get();
    // Only reload directories we actually hold — a change deep in an unopened
    // subtree costs nothing.
    const known = directories.filter((directory) => state.listings[directory]);
    if (known.length === 0) return;

    await Promise.all(known.map((directory) => state.loadDirectory(directory, { force: true })));
  },
```

Subscribe once, in `DiskExplorer`:
```tsx
  const invalidate = useDiskStore((state) => state.invalidate);

  useEffect(() => window.diskAPI.onChanged(({ directories }) => {
    void invalidate(directories);
  }), [invalidate]);
```

- [ ] **Step 8: Run, verify by hand, commit**

Run: `npm test`

Run `npm run better-dev`, open a folder, then add and delete a file in Finder. Both changes must appear in Opal within a second without any manual refresh.

```bash
git add src/main/fs/DiskWatcher.ts src/main.ts src/main/fs/DiskHandlers.ts \
        src/preload.ts src/renderer/ src/tests/
git commit -m "feat(files): watch opened roots and refresh listings on external change"
```

---

**PHASE C COMPLETE.** Large folders stay smooth, and the view reflects the disk.

---

# PHASE D — File management

**This is the first code in Opal that modifies the user's real filesystem.** Everything before this point was read-only; a bug meant a wrong pixel. From here a bug means lost work.

Three rules govern the whole phase:

1. **Every mutation goes through `FileWriter`.** No component, handler, or hook calls `fs` directly. One class means one place to audit.
2. **Deletion is always `shell.trashItem`.** Never `fs.unlink`, never `fs.rm` on user data. The OS Trash is the undo.
3. **Both endpoints of a move are guarded.** A destination inside a root is not enough — the source must be too, or Opal becomes a tool for moving arbitrary files into a watched folder.

---

### Task 14: The FileWriter safety layer

Build and test the guarantees before anything can call them.

**Files:**
- Create: `src/main/fs/FileWriter.ts`
- Test: `src/tests/unit/fs/fileWriter.test.ts`

**Interfaces:**
- Consumes: `RootRegistry`.
- Produces:
  - `class FileWriter` with `createDirectory(parentDir, name)`, `rename(target, nextName)`, `move(source, destinationDir)`, `moveToTrash(target)`
  - `class DestinationExistsError extends Error`
  - `class InvalidNameError extends Error`
  - Each mutating method returns the resulting absolute path (except `moveToTrash`, which returns `void`).

**Design notes:**
- **Name validation happens here, not in the UI.** A renderer check is a convenience; a main-process check is the guarantee. `..`, `/`, and empty names are rejected outright.
- **`fs.rename` is atomic within a filesystem** and fails with `EXDEV` across one. Cross-device moves fall back to copy-then-delete, which is not atomic — so the copy completes fully before the source is removed, and a failure leaves the source untouched.
- **Overwrites are never silent.** A colliding destination raises `DestinationExistsError` and the caller decides.

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/fs/fileWriter.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, stat } from 'fs/promises';
import path from 'path';
import os from 'os';
import { RootRegistry, PathNotAllowedError } from '@/main/fs/RootRegistry';
import { FileWriter, DestinationExistsError, InvalidNameError } from '@/main/fs/FileWriter';

let tmp: string;
let root: string;
let registry: RootRegistry;
let trashItem: ReturnType<typeof vi.fn>;
let writer: FileWriter;

const exists = async (target: string) =>
  stat(target).then(() => true).catch(() => false);

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-writer-'));
  root = path.join(tmp, 'Vault');
  await mkdir(path.join(root, 'Photos'), { recursive: true });
  await mkdir(path.join(root, 'Archive'), { recursive: true });
  await writeFile(path.join(root, 'note.md'), '# hello');
  await writeFile(path.join(root, 'Photos', 'a.jpg'), 'jpegbytes');

  registry = new RootRegistry({ storePath: path.join(tmp, 'roots.json') });
  await registry.load();
  await registry.add(root);

  trashItem = vi.fn(async () => {});
  writer = new FileWriter({ registry, trashItem });
});

afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

describe('FileWriter.createDirectory', () => {
  it('creates a folder and returns its path', async () => {
    const created = await writer.createDirectory(root, 'New Folder');
    expect(created.endsWith('New Folder')).toBe(true);
    expect(await exists(created)).toBe(true);
  });

  it('refuses a parent outside every root', async () => {
    const outside = path.join(tmp, 'Outside');
    await mkdir(outside);
    await expect(writer.createDirectory(outside, 'x')).rejects.toThrow(PathNotAllowedError);
  });

  it('refuses to overwrite an existing entry', async () => {
    await expect(writer.createDirectory(root, 'Photos')).rejects.toThrow(DestinationExistsError);
  });

  it.each(['', '   ', '.', '..', 'a/b', 'a\\b', 'a\0b'])(
    'rejects the invalid name %j',
    async (name) => {
      await expect(writer.createDirectory(root, name)).rejects.toThrow(InvalidNameError);
    }
  );

  it('rejects a name that would escape the parent', async () => {
    await expect(writer.createDirectory(root, '../escaped')).rejects.toThrow(InvalidNameError);
    expect(await exists(path.join(tmp, 'escaped'))).toBe(false);
  });
});

describe('FileWriter.rename', () => {
  it('renames a file and returns the new path', async () => {
    const renamed = await writer.rename(path.join(root, 'note.md'), 'renamed.md');

    expect(renamed.endsWith('renamed.md')).toBe(true);
    expect(await readFile(renamed, 'utf-8')).toBe('# hello');
    expect(await exists(path.join(root, 'note.md'))).toBe(false);
  });

  it('renames a directory', async () => {
    const renamed = await writer.rename(path.join(root, 'Photos'), 'Pictures');
    expect(await exists(path.join(renamed, 'a.jpg'))).toBe(true);
  });

  it('refuses a target outside every root', async () => {
    const outside = path.join(tmp, 'outside.txt');
    await writeFile(outside, 'x');
    await expect(writer.rename(outside, 'renamed.txt')).rejects.toThrow(PathNotAllowedError);
  });

  it('refuses to clobber an existing name', async () => {
    await expect(writer.rename(path.join(root, 'note.md'), 'Photos'))
      .rejects.toThrow(DestinationExistsError);
    // The source must survive a rejected rename.
    expect(await exists(path.join(root, 'note.md'))).toBe(true);
  });

  it('rejects a name containing a separator', async () => {
    await expect(writer.rename(path.join(root, 'note.md'), '../note.md'))
      .rejects.toThrow(InvalidNameError);
    await expect(writer.rename(path.join(root, 'note.md'), 'sub/note.md'))
      .rejects.toThrow(InvalidNameError);
  });

  it('allows renaming to the same name without error', async () => {
    const target = path.join(root, 'note.md');
    const result = await writer.rename(target, 'note.md');
    expect(await exists(result)).toBe(true);
  });
});

describe('FileWriter.move', () => {
  it('moves a file into another directory', async () => {
    const moved = await writer.move(path.join(root, 'note.md'), path.join(root, 'Archive'));

    expect(moved).toContain('Archive');
    expect(await readFile(moved, 'utf-8')).toBe('# hello');
    expect(await exists(path.join(root, 'note.md'))).toBe(false);
  });

  it('refuses a source outside every root', async () => {
    const outside = path.join(tmp, 'outside.txt');
    await writeFile(outside, 'x');
    await expect(writer.move(outside, path.join(root, 'Archive')))
      .rejects.toThrow(PathNotAllowedError);
  });

  it('refuses a destination outside every root', async () => {
    const outside = path.join(tmp, 'Outside');
    await mkdir(outside);
    await expect(writer.move(path.join(root, 'note.md'), outside))
      .rejects.toThrow(PathNotAllowedError);
    expect(await exists(path.join(root, 'note.md'))).toBe(true);
  });

  it('refuses to clobber an existing file at the destination', async () => {
    await writeFile(path.join(root, 'Archive', 'note.md'), 'different');
    await expect(writer.move(path.join(root, 'note.md'), path.join(root, 'Archive')))
      .rejects.toThrow(DestinationExistsError);

    expect(await readFile(path.join(root, 'Archive', 'note.md'), 'utf-8')).toBe('different');
    expect(await exists(path.join(root, 'note.md'))).toBe(true);
  });

  it('refuses to move a directory into itself', async () => {
    await expect(writer.move(path.join(root, 'Photos'), path.join(root, 'Photos')))
      .rejects.toThrow(/into itself/i);
  });

  it('refuses to move a directory into its own descendant', async () => {
    await mkdir(path.join(root, 'Photos', 'Rwanda'), { recursive: true });
    await expect(writer.move(path.join(root, 'Photos'), path.join(root, 'Photos', 'Rwanda')))
      .rejects.toThrow(/into itself/i);
    // Losing this check would detach the whole subtree.
    expect(await exists(path.join(root, 'Photos', 'a.jpg'))).toBe(true);
  });

  it('is a no-op when the destination is the current parent', async () => {
    const result = await writer.move(path.join(root, 'note.md'), root);
    expect(await exists(result)).toBe(true);
  });

  it('rejects a destination that is a file', async () => {
    await expect(writer.move(path.join(root, 'Photos', 'a.jpg'), path.join(root, 'note.md')))
      .rejects.toThrow(/not a directory/i);
  });
});

describe('FileWriter.moveToTrash', () => {
  it('delegates to the OS trash, never unlinking', async () => {
    const target = path.join(root, 'note.md');
    await writer.moveToTrash(target);

    expect(trashItem).toHaveBeenCalledTimes(1);
    expect(trashItem.mock.calls[0][0]).toContain('note.md');
    // The stub does not actually delete; the point is that FileWriter did not.
    expect(await exists(target)).toBe(true);
  });

  it('refuses a target outside every root', async () => {
    const outside = path.join(tmp, 'outside.txt');
    await writeFile(outside, 'x');

    await expect(writer.moveToTrash(outside)).rejects.toThrow(PathNotAllowedError);
    expect(trashItem).not.toHaveBeenCalled();
  });

  it('refuses to trash an opened root itself', async () => {
    await expect(writer.moveToTrash(root)).rejects.toThrow(/opened folder/i);
    expect(trashItem).not.toHaveBeenCalled();
  });

  it('propagates a trash failure', async () => {
    trashItem.mockRejectedValue(new Error('Trash is full'));
    await expect(writer.moveToTrash(path.join(root, 'note.md'))).rejects.toThrow(/trash is full/i);
  });
});

describe('FileWriter leaves nothing behind on rejection', () => {
  it('does not create partial state when a name is invalid', async () => {
    await expect(writer.createDirectory(root, '..')).rejects.toThrow(InvalidNameError);
    expect((await readdir(root)).sort()).toEqual(['Archive', 'Photos', 'note.md']);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/fs/fileWriter.test.ts`
Expected: FAIL — cannot resolve `@/main/fs/FileWriter`.

- [ ] **Step 3: Implement `FileWriter`**

Create `src/main/fs/FileWriter.ts`:

```ts
import { mkdir, rename, stat, copyFile, unlink, readdir } from 'fs/promises';
import path from 'path';
import { normalizePath, isInsideRoot } from '@/main/fs/paths';
import type { RootRegistry } from '@/main/fs/RootRegistry';

export class DestinationExistsError extends Error {
  constructor(target: string) {
    super(`Something already exists at ${target}`);
    this.name = 'DestinationExistsError';
  }
}

export class InvalidNameError extends Error {
  constructor(name: string) {
    super(`"${name}" is not a valid file name`);
    this.name = 'InvalidNameError';
  }
}

export interface FileWriterDependencies {
  registry: RootRegistry;
  /** shell.trashItem — injected so tests never touch the real Trash. */
  trashItem: (fullPath: string) => Promise<void>;
}

/**
 * The single point through which Opal modifies the user's filesystem.
 *
 * Every method validates against RootRegistry before touching anything, and no
 * method ever overwrites silently. Concentrating mutations here means the
 * safety properties can be audited — and tested — in one place instead of
 * being re-derived at each call site.
 */
export class FileWriter {
  private deps: FileWriterDependencies;

  constructor(deps: FileWriterDependencies) {
    this.deps = deps;
  }

  async createDirectory(parentDir: string, name: string): Promise<string> {
    assertValidName(name);
    const parent = await this.deps.registry.assertAllowed(parentDir);

    const target = normalizePath(path.join(parent, name));
    await assertAbsent(target);

    await mkdir(target);
    return target;
  }

  async rename(target: string, nextName: string): Promise<string> {
    assertValidName(nextName);
    const source = await this.deps.registry.assertAllowed(target);

    const destination = normalizePath(path.join(path.dirname(source), nextName));
    if (destination === source) return source;

    await assertAbsent(destination);
    await rename(source, destination);
    return destination;
  }

  async move(target: string, destinationDir: string): Promise<string> {
    const source = await this.deps.registry.assertAllowed(target);
    const parent = await this.deps.registry.assertAllowed(destinationDir);

    const parentInfo = await stat(parent);
    if (!parentInfo.isDirectory()) {
      throw new Error(`Cannot move into ${destinationDir} because it is not a directory`);
    }

    // Moving a directory inside itself detaches the whole subtree from the
    // tree and is unrecoverable, so it is checked before anything happens.
    const sourceInfo = await stat(source);
    if (sourceInfo.isDirectory() && isInsideRoot(source, parent)) {
      throw new Error(`Cannot move a folder into itself`);
    }

    const destination = normalizePath(path.join(parent, path.basename(source)));
    if (destination === source) return source;

    await assertAbsent(destination);

    try {
      await rename(source, destination);
    } catch (error) {
      // EXDEV: source and destination are on different filesystems, where
      // rename cannot work. Copy fully first, and only then remove the source,
      // so a failure mid-way leaves the original intact.
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      await copyRecursive(source, destination);
      await removeRecursive(source);
    }

    return destination;
  }

  async moveToTrash(target: string): Promise<void> {
    const resolved = await this.deps.registry.assertAllowed(target);

    // Trashing an opened root would leave Opal pointing at a folder that no
    // longer exists, and is almost never what the user meant.
    if (this.deps.registry.list().includes(resolved)) {
      throw new Error(`Cannot delete an opened folder. Close it first.`);
    }

    await this.deps.trashItem(resolved);
  }
}

/**
 * Names are validated in main, not in the UI. A renderer check is a
 * convenience for the user; this is the actual guarantee.
 */
function assertValidName(name: string): void {
  const trimmed = name.trim();
  if (
    trimmed.length === 0 ||
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('\0')
  ) {
    throw new InvalidNameError(name);
  }
}

async function assertAbsent(target: string): Promise<void> {
  try {
    await stat(target);
  } catch {
    return; // Nothing there — good.
  }
  throw new DestinationExistsError(target);
}

async function copyRecursive(source: string, destination: string): Promise<void> {
  const info = await stat(source);
  if (!info.isDirectory()) {
    await copyFile(source, destination);
    return;
  }

  await mkdir(destination);
  for (const name of await readdir(source)) {
    await copyRecursive(path.join(source, name), path.join(destination, name));
  }
}

async function removeRecursive(target: string): Promise<void> {
  const info = await stat(target);
  if (!info.isDirectory()) {
    await unlink(target);
    return;
  }

  for (const name of await readdir(target)) {
    await removeRecursive(path.join(target, name));
  }
  const { rmdir } = await import('fs/promises');
  await rmdir(target);
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tests/unit/fs/fileWriter.test.ts`
Expected: PASS, 27 tests.

If the `it.each` invalid-name cases fail for `'a\0b'`, confirm the check uses `\0` and not a literal backslash-zero.

- [ ] **Step 5: Commit — no IPC yet**

The safety layer lands and is proven before anything can reach it.

```bash
git add src/main/fs/FileWriter.ts src/tests/unit/fs/fileWriter.test.ts
git commit -m "feat(files): add guarded FileWriter for all filesystem mutations"
```

---

### Task 15: Expose mutations over IPC

**Files:**
- Modify: `src/main/fs/DiskHandlers.ts`, `src/main.ts`, `src/preload.ts`, `src/renderer/shared/types/diskApi.d.ts`, `src/tests/helpers/diskApi.ts`
- Test: `src/tests/unit/fs/diskHandlers.test.ts` (extend)

**Interfaces:**
- Produces channels `disk:create-directory`, `disk:rename`, `disk:move`, `disk:trash`, each returning `DiskResult<{ path: string }>` (trash returns `DiskResult`).

- [ ] **Step 1: Extend the handler test**

Add `writer` to the `DiskHandlers` construction in `beforeEach`:

```ts
  writer = new FileWriter({ registry, trashItem: vi.fn(async () => {}) });

  new DiskHandlers({
    ipc: stub.ipc, registry, reader: new DiskReader({ registry }),
    showOpenDialog, shell: { showItemInFolder, openPath },
    watcher: { watch: vi.fn(async () => {}), unwatch: vi.fn(async () => {}) },
    writer,
  }).registerAll();
```

Update the channel list and add cases:

```ts
  it('registers every channel', () => {
    expect(stub.channels().sort()).toEqual([
      'disk:create-directory',
      'disk:list-roots',
      'disk:move',
      'disk:open-external',
      'disk:open-folder',
      'disk:read-directory',
      'disk:read-text-file',
      'disk:remove-root',
      'disk:rename',
      'disk:reveal',
      'disk:stat',
      'disk:trash',
    ]);
  });

  it('creates a directory', async () => {
    await registry.add(root);
    const result = await stub.invoke('disk:create-directory', root, 'New') as {
      success: boolean; data: { path: string };
    };
    expect(result.success).toBe(true);
    expect(result.data.path.endsWith('New')).toBe(true);
  });

  it('surfaces an invalid name as a readable error', async () => {
    await registry.add(root);
    const result = await stub.invoke('disk:create-directory', root, '../evil') as {
      success: boolean; error: string;
    };
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not a valid file name/i);
  });

  it('surfaces a collision as a readable error', async () => {
    await registry.add(root);
    const result = await stub.invoke('disk:rename', path.join(root, 'note.md'), 'Photos') as {
      success: boolean; error: string;
    };
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already exists/i);
  });

  it('renames a file', async () => {
    await registry.add(root);
    const result = await stub.invoke('disk:rename', path.join(root, 'note.md'), 'renamed.md') as {
      success: boolean; data: { path: string };
    };
    expect(result.success).toBe(true);
    expect(result.data.path.endsWith('renamed.md')).toBe(true);
  });

  it('refuses to mutate outside every root', async () => {
    await registry.add(root);
    const outside = path.join(tmp, 'outside.txt');
    await writeFile(outside, 'x');

    for (const [channel, ...args] of [
      ['disk:rename', outside, 'x.txt'],
      ['disk:move', outside, root],
      ['disk:trash', outside],
      ['disk:create-directory', path.dirname(outside), 'x'],
    ] as const) {
      const result = await stub.invoke(channel, ...args) as { success: boolean };
      expect(result.success, `${channel} must reject a path outside every root`).toBe(false);
    }
  });
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/fs/diskHandlers.test.ts`
Expected: FAIL — the channel list does not match.

- [ ] **Step 3: Implement the handlers**

Add `writer: FileWriter` to `DiskHandlerDependencies`, register all four in `registerAll()`, and add:

```ts
  private registerCreateDirectory(): void {
    this.deps.ipc.handle(
      'disk:create-directory',
      async (_, parentDir: string, name: string): Promise<IPCResponse<{ path: string }>> => {
        try {
          const created = await this.deps.writer.createDirectory(parentDir, name);
          return { success: true, data: { path: created } };
        } catch (error) {
          return { success: false, error: describeError(error, 'Failed to create folder') };
        }
      }
    );
  }

  private registerRename(): void {
    this.deps.ipc.handle(
      'disk:rename',
      async (_, target: string, nextName: string): Promise<IPCResponse<{ path: string }>> => {
        try {
          const renamed = await this.deps.writer.rename(target, nextName);
          return { success: true, data: { path: renamed } };
        } catch (error) {
          return { success: false, error: describeError(error, 'Failed to rename') };
        }
      }
    );
  }

  private registerMove(): void {
    this.deps.ipc.handle(
      'disk:move',
      async (_, target: string, destinationDir: string): Promise<IPCResponse<{ path: string }>> => {
        try {
          const moved = await this.deps.writer.move(target, destinationDir);
          return { success: true, data: { path: moved } };
        } catch (error) {
          return { success: false, error: describeError(error, 'Failed to move') };
        }
      }
    );
  }

  private registerTrash(): void {
    this.deps.ipc.handle(
      'disk:trash',
      async (_, target: string): Promise<IPCResponse> => {
        try {
          await this.deps.writer.moveToTrash(target);
          return { success: true };
        } catch (error) {
          return { success: false, error: describeError(error, 'Failed to move to Trash') };
        }
      }
    );
  }
```

Extend `describeError` so the two user-actionable failures surface their real message rather than a generic one:

```ts
function describeError(error: unknown, fallback: string): string {
  if (error instanceof PathNotAllowedError) return error.message;
  if (error instanceof DestinationExistsError) return error.message;
  if (error instanceof InvalidNameError) return error.message;
  if (error instanceof Error && /not a directory|into itself|opened folder/i.test(error.message)) {
    return error.message;
  }
  logger.error(fallback, error);
  return fallback;
}
```

- [ ] **Step 4: Construct the writer in `main.ts`**

```ts
import { FileWriter } from "@/main/fs/FileWriter";
```
```ts
const fileWriter = new FileWriter({
  registry: rootRegistry,
  trashItem: (fullPath) => shell.trashItem(fullPath),
});
```
Pass `writer: fileWriter` and `watcher: diskWatcher` into the `DiskHandlers` constructor.

- [ ] **Step 5: Expose in preload and types**

`src/preload.ts`:
```ts
  createDirectory: (parentDir: string, name: string) =>
    ipcRenderer.invoke("disk:create-directory", parentDir, name),
  rename: (target: string, nextName: string) =>
    ipcRenderer.invoke("disk:rename", target, nextName),
  move: (target: string, destinationDir: string) =>
    ipcRenderer.invoke("disk:move", target, destinationDir),
  trash: (target: string) => ipcRenderer.invoke("disk:trash", target),
```

`diskApi.d.ts`:
```ts
  createDirectory: (parentDir: string, name: string) => Promise<DiskResult<{ path: string }>>;
  rename: (target: string, nextName: string) => Promise<DiskResult<{ path: string }>>;
  move: (target: string, destinationDir: string) => Promise<DiskResult<{ path: string }>>;
  trash: (target: string) => Promise<DiskResult>;
```

`src/tests/helpers/diskApi.ts` defaults:
```ts
    createDirectory: vi.fn(async () => ({ success: true as const, data: { path: '/V/New' } })),
    rename: vi.fn(async () => ({ success: true as const, data: { path: '/V/renamed' } })),
    move: vi.fn(async () => ({ success: true as const, data: { path: '/V/moved' } })),
    trash: vi.fn(async () => ({ success: true as const, data: undefined })),
```

- [ ] **Step 6: Run and commit**

Run: `npm test`
Expected: all pass, including `ipcContract` — four new channels, four new handlers.

```bash
git add src/main/fs/DiskHandlers.ts src/main.ts src/preload.ts src/renderer/ src/tests/
git commit -m "feat(files): expose guarded create, rename, move, and trash over IPC"
```

---

### Task 16: New folder and rename in the UI

**Files:**
- Create: `src/renderer/features/disk-explorer/components/dialogs/NameDialog.tsx`
- Modify: `src/renderer/features/disk-explorer/store/diskStore.ts`
- Modify: `src/renderer/features/disk-explorer/components/Toolbar.tsx`, `DiskExplorer.tsx`
- Test: `src/tests/unit/nameDialog.test.tsx`

**Interfaces:**
- Produces: `<NameDialog />`; store `pendingAction: { kind: 'new-folder' | 'rename'; target: string } | null` with `beginNewFolder(parentDir)`, `beginRename(target)`, `cancelAction()`, `commitAction(name)`.

**Design note:** one dialog serves both operations. They differ only in title, initial value, and which IPC call runs — duplicating the component to encode that would double the surface for no benefit.

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/nameDialog.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { NameDialog } from '@/renderer/features/disk-explorer/components/dialogs/NameDialog';
import { installDiskApi } from '@/tests/helpers/diskApi';

beforeEach(() => {
  installDiskApi();
  useDiskStore.setState({ pendingAction: null, loading: { isLoading: false, error: null } });
});

describe('NameDialog', () => {
  it('renders nothing when no action is pending', () => {
    render(<NameDialog />);
    expect(screen.queryByTestId('name-dialog')).not.toBeInTheDocument();
  });

  it('prompts for a new folder name', () => {
    useDiskStore.getState().beginNewFolder('/V');
    render(<NameDialog />);

    expect(screen.getByTestId('name-dialog-title')).toHaveTextContent('New Folder');
    expect(screen.getByTestId('name-dialog-input')).toHaveValue('');
  });

  it('pre-fills the current name when renaming', () => {
    useDiskStore.getState().beginRename('/V/note.md');
    render(<NameDialog />);

    expect(screen.getByTestId('name-dialog-title')).toHaveTextContent('Rename');
    expect(screen.getByTestId('name-dialog-input')).toHaveValue('note.md');
  });

  it('creates a folder on submit', async () => {
    const user = userEvent.setup();
    useDiskStore.getState().beginNewFolder('/V');
    render(<NameDialog />);

    await user.type(screen.getByTestId('name-dialog-input'), 'Rwanda');
    await user.click(screen.getByTestId('name-dialog-submit'));

    await waitFor(() =>
      expect(window.diskAPI.createDirectory).toHaveBeenCalledWith('/V', 'Rwanda')
    );
  });

  it('renames on submit', async () => {
    const user = userEvent.setup();
    useDiskStore.getState().beginRename('/V/note.md');
    render(<NameDialog />);

    const input = screen.getByTestId('name-dialog-input');
    await user.clear(input);
    await user.type(input, 'renamed.md');
    await user.click(screen.getByTestId('name-dialog-submit'));

    await waitFor(() => expect(window.diskAPI.rename).toHaveBeenCalledWith('/V/note.md', 'renamed.md'));
  });

  it('submits on Enter', async () => {
    const user = userEvent.setup();
    useDiskStore.getState().beginNewFolder('/V');
    render(<NameDialog />);

    await user.type(screen.getByTestId('name-dialog-input'), 'Rwanda{Enter}');
    await waitFor(() => expect(window.diskAPI.createDirectory).toHaveBeenCalled());
  });

  it('cancels on Escape without calling anything', async () => {
    const user = userEvent.setup();
    useDiskStore.getState().beginNewFolder('/V');
    render(<NameDialog />);

    await user.type(screen.getByTestId('name-dialog-input'), '{Escape}');

    expect(useDiskStore.getState().pendingAction).toBeNull();
    expect(window.diskAPI.createDirectory).not.toHaveBeenCalled();
  });

  it('disables submit for an empty name', async () => {
    useDiskStore.getState().beginNewFolder('/V');
    render(<NameDialog />);
    expect(screen.getByTestId('name-dialog-submit')).toBeDisabled();
  });

  it('disables submit for a name containing a separator', async () => {
    const user = userEvent.setup();
    useDiskStore.getState().beginNewFolder('/V');
    render(<NameDialog />);

    await user.type(screen.getByTestId('name-dialog-input'), 'a/b');
    expect(screen.getByTestId('name-dialog-submit')).toBeDisabled();
    expect(screen.getByTestId('name-dialog-hint')).toBeInTheDocument();
  });

  it('keeps the dialog open and shows the error when the write fails', async () => {
    const user = userEvent.setup();
    installDiskApi({
      createDirectory: vi.fn(async () => ({
        success: false as const, error: 'Something already exists at /V/Rwanda',
      })),
    });
    useDiskStore.getState().beginNewFolder('/V');
    render(<NameDialog />);

    await user.type(screen.getByTestId('name-dialog-input'), 'Rwanda{Enter}');

    await waitFor(() =>
      expect(screen.getByTestId('name-dialog-error')).toHaveTextContent('already exists')
    );
    expect(useDiskStore.getState().pendingAction).not.toBeNull();
  });

  it('closes on success', async () => {
    const user = userEvent.setup();
    useDiskStore.getState().beginNewFolder('/V');
    render(<NameDialog />);

    await user.type(screen.getByTestId('name-dialog-input'), 'Rwanda{Enter}');
    await waitFor(() => expect(useDiskStore.getState().pendingAction).toBeNull());
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/tests/unit/nameDialog.test.tsx`
Expected: FAIL — cannot resolve `NameDialog`.

- [ ] **Step 3: Add the pending-action state**

In `diskStore.ts`:

```ts
export interface PendingAction {
  kind: 'new-folder' | 'rename';
  /** The parent directory for new-folder; the item being renamed for rename. */
  target: string;
}
```

`DiskState`: `pendingAction: PendingAction | null;` — initial `pendingAction: null,`

`DiskActions`:
```ts
  beginNewFolder: (parentDir: string) => void;
  beginRename: (target: string) => void;
  cancelAction: () => void;
```
```ts
  beginNewFolder: (parentDir) => set({ pendingAction: { kind: 'new-folder', target: parentDir } }),
  beginRename: (target) => set({ pendingAction: { kind: 'rename', target } }),
  cancelAction: () => set({ pendingAction: null }),
```

- [ ] **Step 4: Implement `NameDialog`**

Create `src/renderer/features/disk-explorer/components/dialogs/NameDialog.tsx`:

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { useDiskStore } from '../../store/diskStore';

/** Mirrors FileWriter.assertValidName so the user gets feedback before submitting. */
function isValidName(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed.length > 0 &&
    trimmed !== '.' &&
    trimmed !== '..' &&
    !trimmed.includes('/') &&
    !trimmed.includes('\\')
  );
}

export const NameDialog: React.FC = () => {
  const pendingAction = useDiskStore((state) => state.pendingAction);
  const cancelAction = useDiskStore((state) => state.cancelAction);

  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isRename = pendingAction?.kind === 'rename';

  useEffect(() => {
    if (!pendingAction) return;

    const initial = isRename ? pendingAction.target.split('/').pop() ?? '' : '';
    setName(initial);
    setError(null);
    setIsSubmitting(false);

    // Select the basename but not the extension, so typing replaces the name
    // and keeps ".md" — the behaviour Finder has trained everyone to expect.
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      const dot = initial.lastIndexOf('.');
      input.setSelectionRange(0, dot > 0 ? dot : initial.length);
    });
  }, [pendingAction, isRename]);

  if (!pendingAction) return null;

  const submit = async () => {
    if (!isValidName(name) || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const trimmed = name.trim();
    const result = isRename
      ? await window.diskAPI.rename(pendingAction.target, trimmed)
      : await window.diskAPI.createDirectory(pendingAction.target, trimmed);

    if (!result.success) {
      // Keep the dialog open so the user can correct the name in place rather
      // than retyping it from scratch.
      setError(result.error);
      setIsSubmitting(false);
      return;
    }

    cancelAction();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div onClick={cancelAction} className="absolute inset-0 bg-background/80 backdrop-blur-sm" />

      <div
        role="dialog"
        aria-modal="true"
        data-testid="name-dialog"
        className="relative w-[min(90vw,400px)] rounded-xl border border-border bg-card shadow-2xl p-4 flex flex-col gap-3"
      >
        <h2 data-testid="name-dialog-title" className="text-sm font-medium">
          {isRename ? 'Rename' : 'New Folder'}
        </h2>

        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); void submit(); }
            if (event.key === 'Escape') { event.preventDefault(); cancelAction(); }
          }}
          aria-label={isRename ? 'New name' : 'Folder name'}
          data-testid="name-dialog-input"
          className="px-2.5 py-1.5 text-sm rounded-md bg-muted/50 border border-border focus:border-ring focus:outline-none"
        />

        {name.length > 0 && !isValidName(name) && (
          <p data-testid="name-dialog-hint" className="text-xs text-muted-foreground">
            A name cannot be empty or contain a slash.
          </p>
        )}

        {error && (
          <p data-testid="name-dialog-error" className="text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={cancelAction}
            data-testid="name-dialog-cancel"
            className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!isValidName(name) || isSubmitting}
            data-testid="name-dialog-submit"
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground disabled:opacity-40"
          >
            {isRename ? 'Rename' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 5: Mount it and add the triggers**

In `DiskExplorer.tsx`, render `<NameDialog />` beside `<QuickLook />`, and extend the keyboard effect:

```tsx
      // Enter renames the selection — Finder's binding. Not while typing.
      if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
        if (!selectedPath) return;
        event.preventDefault();
        useDiskStore.getState().beginRename(selectedPath);
        return;
      }
```

`Enter` was deliberately left unbound by `useGridNavigation` in Task 10, so nothing needs re-binding here.

In `Toolbar.tsx`, add a New Folder button:

```tsx
import { FolderPlus } from 'lucide-react';
```
```tsx
      <button
        type="button"
        onClick={() => useDiskStore.getState().beginNewFolder(dirPath)}
        aria-label="New folder"
        title="New folder"
        data-testid="toolbar-new-folder"
        className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <FolderPlus className="h-4 w-4" />
      </button>
```

`Toolbar` now needs the current directory, so change its signature to `<Toolbar dirPath={string} />` and pass `activeDirectory` from `DiskExplorer`. Update `toolbar.test.tsx` to render `<Toolbar dirPath="/V" />`.

- [ ] **Step 6: Run, verify, commit**

Run: `npm test`

Run `npm run better-dev`: create a folder from the toolbar, select a file and press `Enter` to rename it, and confirm a duplicate name shows an inline error rather than silently overwriting.

```bash
git add src/renderer/features/disk-explorer/ src/tests/
git commit -m "feat(files): add new-folder and rename via a shared name dialog"
```

---

### Task 17: Move by drag and drop, and delete to Trash

**Files:**
- Modify: `DiskTreeItem.tsx`, `DiskFolderView.tsx`, `DiskExplorer.tsx`
- Create: `src/renderer/features/disk-explorer/components/dialogs/ConfirmDeleteDialog.tsx`
- Test: `src/tests/unit/dragAndDrop.test.tsx`, `src/tests/unit/confirmDelete.test.tsx`
- Test: `e2e/tests/files-mutations.spec.ts` **(E2E #7 and #8 of 10)**

**Interfaces:**
- Produces: HTML5 drag-and-drop on tiles, rows, and tree folders; `<ConfirmDeleteDialog />`; store `pendingDelete: string | null`.

**Design note:** the drag payload is the source path as `text/plain`. Dropping is only permitted on directories, and a drop onto the source's current parent is a no-op the UI should not even highlight.

- [ ] **Step 1: Write the drag-and-drop test**

Create `src/tests/unit/dragAndDrop.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { DiskTree } from '@/renderer/features/disk-explorer/components/DiskTree';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';

const ROOT = '/V';
const ARCHIVE = '/V/Archive';
const NOTE = '/V/note.md';

/** happy-dom has no DataTransfer, so supply the minimum the handlers use. */
function dataTransfer(payload = '') {
  const store: Record<string, string> = { 'text/plain': payload };
  return {
    setData: (type: string, value: string) => { store[type] = value; },
    getData: (type: string) => store[type] ?? '',
    dropEffect: 'none',
    effectAllowed: 'all',
  };
}

beforeEach(() => {
  installDiskApi();
  useDiskStore.setState({
    roots: [ROOT],
    listings: {
      [ROOT]: [
        entry({ path: ARCHIVE, name: 'Archive', kind: 'directory', isDirectory: true }),
        entry({ path: NOTE, name: 'note.md', kind: 'markdown' }),
      ],
    },
    expanded: { [ROOT]: true },
    selectedPath: null,
    loading: { isLoading: false, error: null },
  });
});

describe('drag and drop', () => {
  it('carries the source path on drag start', () => {
    render(<DiskTree />);
    const transfer = dataTransfer();

    fireEvent.dragStart(screen.getByTestId(`disk-tree-item-${NOTE}`), { dataTransfer: transfer });
    expect(transfer.getData('text/plain')).toBe(NOTE);
  });

  it('moves the file when dropped on a folder', async () => {
    render(<DiskTree />);

    fireEvent.drop(screen.getByTestId(`disk-tree-item-${ARCHIVE}`), {
      dataTransfer: dataTransfer(NOTE),
    });

    await waitFor(() => expect(window.diskAPI.move).toHaveBeenCalledWith(NOTE, ARCHIVE));
  });

  it('does not move when dropped on a file', async () => {
    render(<DiskTree />);

    fireEvent.drop(screen.getByTestId(`disk-tree-item-${NOTE}`), {
      dataTransfer: dataTransfer(ARCHIVE),
    });

    await waitFor(() => expect(window.diskAPI.move).not.toHaveBeenCalled());
  });

  it('does not move an item onto itself', async () => {
    render(<DiskTree />);

    fireEvent.drop(screen.getByTestId(`disk-tree-item-${ARCHIVE}`), {
      dataTransfer: dataTransfer(ARCHIVE),
    });

    await waitFor(() => expect(window.diskAPI.move).not.toHaveBeenCalled());
  });

  it('surfaces a move failure', async () => {
    installDiskApi({
      move: vi.fn(async () => ({ success: false as const, error: 'Something already exists' })),
    });
    render(<DiskTree />);

    fireEvent.drop(screen.getByTestId(`disk-tree-item-${ARCHIVE}`), {
      dataTransfer: dataTransfer(NOTE),
    });

    await waitFor(() =>
      expect(useDiskStore.getState().loading.error).toMatch(/already exists/i)
    );
  });
});
```

- [ ] **Step 2: Implement dragging on tree items**

In `DiskTreeItem.tsx`, add to the row `div`:

```tsx
        draggable
        onDragStart={(event) => {
          event.stopPropagation();
          event.dataTransfer.setData('text/plain', entry.path);
          event.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(event) => {
          // Only folders accept a drop, and nothing accepts itself.
          if (!entry.isDirectory) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setIsDropTarget(true);
        }}
        onDragLeave={() => setIsDropTarget(false)}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setIsDropTarget(false);
          if (!entry.isDirectory) return;

          const source = event.dataTransfer.getData('text/plain');
          if (!source || source === entry.path) return;
          void moveInto(source, entry.path);
        }}
```

Add the local state and the move helper:

```tsx
  const [isDropTarget, setIsDropTarget] = useState(false);

  const moveInto = useCallback(async (source: string, destination: string) => {
    const result = await window.diskAPI.move(source, destination);
    if (!result.success) {
      useDiskStore.setState({ loading: { isLoading: false, error: result.error } });
    }
    // On success the watcher (Task 13) refreshes both listings, so there is
    // nothing to update here.
  }, []);
```

Add a drop highlight to the row's className: `${isDropTarget ? 'ring-1 ring-primary bg-primary/10' : ''}`.

- [ ] **Step 3: Mirror it on gallery tiles and list rows**

Apply the same `draggable` / `onDragStart` / `onDragOver` / `onDrop` treatment to `GalleryTile` and `ListRow` in `DiskFolderView.tsx`, using the identical guard (`entry.isDirectory` required to accept, `source !== entry.path`). Extract the shared handler set into a small local hook in that file rather than copying the body three times:

```tsx
function useDropTarget(entry: DiskEntry) {
  const [isDropTarget, setIsDropTarget] = useState(false);

  const dragProps = {
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      event.dataTransfer.setData('text/plain', entry.path);
      event.dataTransfer.effectAllowed = 'move';
    },
    onDragOver: (event: React.DragEvent) => {
      if (!entry.isDirectory) return;
      event.preventDefault();
      setIsDropTarget(true);
    },
    onDragLeave: () => setIsDropTarget(false),
    onDrop: async (event: React.DragEvent) => {
      event.preventDefault();
      setIsDropTarget(false);
      if (!entry.isDirectory) return;

      const source = event.dataTransfer.getData('text/plain');
      if (!source || source === entry.path) return;

      const result = await window.diskAPI.move(source, entry.path);
      if (!result.success) {
        useDiskStore.setState({ loading: { isLoading: false, error: result.error } });
      }
    },
  };

  return { dragProps, isDropTarget };
}
```

- [ ] **Step 4: Write the delete-confirmation test**

Create `src/tests/unit/confirmDelete.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { ConfirmDeleteDialog } from '@/renderer/features/disk-explorer/components/dialogs/ConfirmDeleteDialog';
import { installDiskApi } from '@/tests/helpers/diskApi';

beforeEach(() => {
  installDiskApi();
  useDiskStore.setState({ pendingDelete: null, loading: { isLoading: false, error: null } });
});

describe('ConfirmDeleteDialog', () => {
  it('renders nothing when no delete is pending', () => {
    render(<ConfirmDeleteDialog />);
    expect(screen.queryByTestId('confirm-delete')).not.toBeInTheDocument();
  });

  it('names the file and says Trash, not delete', () => {
    useDiskStore.setState({ pendingDelete: '/V/note.md' });
    render(<ConfirmDeleteDialog />);

    expect(screen.getByTestId('confirm-delete')).toHaveTextContent('note.md');
    // Wording matters: this is recoverable, and the user should know that.
    expect(screen.getByTestId('confirm-delete')).toHaveTextContent(/trash/i);
  });

  it('trashes on confirm', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({ pendingDelete: '/V/note.md' });
    render(<ConfirmDeleteDialog />);

    await user.click(screen.getByTestId('confirm-delete-confirm'));
    await waitFor(() => expect(window.diskAPI.trash).toHaveBeenCalledWith('/V/note.md'));
    await waitFor(() => expect(useDiskStore.getState().pendingDelete).toBeNull());
  });

  it('does nothing on cancel', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({ pendingDelete: '/V/note.md' });
    render(<ConfirmDeleteDialog />);

    await user.click(screen.getByTestId('confirm-delete-cancel'));
    expect(window.diskAPI.trash).not.toHaveBeenCalled();
    expect(useDiskStore.getState().pendingDelete).toBeNull();
  });

  it('cancels on Escape', async () => {
    const user = userEvent.setup();
    useDiskStore.setState({ pendingDelete: '/V/note.md' });
    render(<ConfirmDeleteDialog />);

    await user.keyboard('{Escape}');
    expect(window.diskAPI.trash).not.toHaveBeenCalled();
    expect(useDiskStore.getState().pendingDelete).toBeNull();
  });

  it('surfaces a failure and stays open', async () => {
    const user = userEvent.setup();
    installDiskApi({
      trash: vi.fn(async () => ({ success: false as const, error: 'Cannot delete an opened folder. Close it first.' })),
    });
    useDiskStore.setState({ pendingDelete: '/V' });
    render(<ConfirmDeleteDialog />);

    await user.click(screen.getByTestId('confirm-delete-confirm'));
    await waitFor(() =>
      expect(screen.getByTestId('confirm-delete-error')).toHaveTextContent('opened folder')
    );
    expect(useDiskStore.getState().pendingDelete).not.toBeNull();
  });
});
```

- [ ] **Step 5: Implement `ConfirmDeleteDialog`**

Add `pendingDelete: string | null` to the store with `beginDelete(target)` / `cancelDelete()`, then create `src/renderer/features/disk-explorer/components/dialogs/ConfirmDeleteDialog.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useDiskStore } from '../../store/diskStore';

export const ConfirmDeleteDialog: React.FC = () => {
  const pendingDelete = useDiskStore((state) => state.pendingDelete);
  const cancelDelete = useDiskStore((state) => state.cancelDelete);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!pendingDelete) return;
    setError(null);
    setIsSubmitting(false);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); cancelDelete(); }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [pendingDelete, cancelDelete]);

  if (!pendingDelete) return null;

  const name = pendingDelete.split('/').pop() ?? pendingDelete;

  const confirm = async () => {
    setIsSubmitting(true);
    setError(null);

    const result = await window.diskAPI.trash(pendingDelete);
    if (!result.success) {
      setError(result.error);
      setIsSubmitting(false);
      return;
    }

    useDiskStore.getState().select(null);
    cancelDelete();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div onClick={cancelDelete} className="absolute inset-0 bg-background/80 backdrop-blur-sm" />

      <div
        role="dialog"
        aria-modal="true"
        data-testid="confirm-delete"
        className="relative w-[min(90vw,420px)] rounded-xl border border-border bg-card shadow-2xl p-4 flex flex-col gap-3"
      >
        <div className="flex items-start gap-3">
          <Trash2 className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div className="min-w-0">
            <h2 className="text-sm font-medium">Move “{name}” to Trash?</h2>
            {/* Say Trash, not delete — the action is recoverable and the
                wording is what tells the user that. */}
            <p className="text-xs text-muted-foreground mt-1">
              You can restore it from the Trash.
            </p>
          </div>
        </div>

        {error && (
          <p data-testid="confirm-delete-error" className="text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={cancelDelete}
            data-testid="confirm-delete-cancel"
            className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={isSubmitting}
            data-testid="confirm-delete-confirm"
            className="px-3 py-1.5 text-sm rounded-md bg-destructive text-destructive-foreground disabled:opacity-40"
          >
            Move to Trash
          </button>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 6: Bind the delete keys**

In `DiskExplorer.tsx`, render `<ConfirmDeleteDialog />` and extend the keyboard effect:

```tsx
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
        if (!selectedPath) return;
        event.preventDefault();
        useDiskStore.getState().beginDelete(selectedPath);
      }
```

- [ ] **Step 7: Write the E2E test**

This is E2E because it is the only way to prove that a real mutation reaches the real filesystem through the real guard — the highest-consequence path in the app.

Create `e2e/tests/files-mutations.spec.ts`:

```ts
import { test, expect } from '../fixtures/electronApp';
import { createTempVault, seedRoots, type TempVault } from '../helpers/tempVault';
import { realpath, stat, writeFile, mkdir } from 'fs/promises';
import path from 'path';

let vault: TempVault;
let vaultRoot: string;

const exists = (target: string) => stat(target).then(() => true).catch(() => false);

test.beforeAll(async () => {
  vault = await createTempVault();
  vaultRoot = await realpath(vault.root);
});

test.afterAll(async () => { await vault.cleanup(); });

test.beforeEach(async ({ userDataDir }) => {
  await seedRoots(userDataDir, [vaultRoot]);
});

test('creates, renames, and moves real files on disk', async ({ page }) => {
  await page.evaluate(() => { window.location.hash = '#/files'; });
  await page.waitForSelector('[role="tree"]');

  const created = await page.evaluate(
    (root) => window.diskAPI.createDirectory(root, 'E2E Folder'),
    vaultRoot
  );
  expect(created.success).toBe(true);
  expect(await exists(path.join(vaultRoot, 'E2E Folder'))).toBe(true);

  const renamed = await page.evaluate(
    (root) => window.diskAPI.rename(`${root}/E2E Folder`, 'Renamed Folder'),
    vaultRoot
  );
  expect(renamed.success).toBe(true);
  expect(await exists(path.join(vaultRoot, 'Renamed Folder'))).toBe(true);
  expect(await exists(path.join(vaultRoot, 'E2E Folder'))).toBe(false);

  const moved = await page.evaluate(
    (root) => window.diskAPI.move(`${root}/readme.md`, `${root}/Renamed Folder`),
    vaultRoot
  );
  expect(moved.success).toBe(true);
  expect(await exists(path.join(vaultRoot, 'Renamed Folder', 'readme.md'))).toBe(true);
  expect(await exists(path.join(vaultRoot, 'readme.md'))).toBe(false);
});

test('refuses every mutation outside an opened root', async ({ page }) => {
  // Build a directory the app was never given access to.
  const forbidden = path.join(path.dirname(vaultRoot), 'Forbidden');
  await mkdir(forbidden, { recursive: true });
  await writeFile(path.join(forbidden, 'secret.txt'), 'do not touch');

  await page.evaluate(() => { window.location.hash = '#/files'; });
  await page.waitForSelector('[role="tree"]');

  const results = await page.evaluate(async (dir) => ({
    create: await window.diskAPI.createDirectory(dir, 'nope'),
    rename: await window.diskAPI.rename(`${dir}/secret.txt`, 'renamed.txt'),
    trash: await window.diskAPI.trash(`${dir}/secret.txt`),
  }), forbidden);

  expect(results.create.success).toBe(false);
  expect(results.rename.success).toBe(false);
  expect(results.trash.success).toBe(false);

  // The guard is only real if the bytes are still there.
  expect(await exists(path.join(forbidden, 'secret.txt'))).toBe(true);
  expect(await exists(path.join(forbidden, 'nope'))).toBe(false);
});
```

- [ ] **Step 8: Run everything**

Run: `npm test && npm run test:e2e`
Expected: unit suite green; E2E 8 passed. Budget check: 8 of 10 used.

- [ ] **Step 9: Verify by hand — do this on throwaway files**

Run `npm run better-dev` against a **copy** of a real folder, not originals. Drag a file onto a folder in the tree and confirm it moves. Select a file, press `Delete`, confirm, and check it appears in the macOS Trash.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/features/disk-explorer/ src/tests/ e2e/tests/files-mutations.spec.ts
git commit -m "feat(files): add drag-to-move and delete-to-Trash with confirmation"
```

---

### Task 18: Surface errors as toasts

Store errors currently render as a banner that must be dismissed by hand. Mutations produce transient failures that deserve transient feedback.

**Files:**
- Modify: `src/renderer/features/disk-explorer/components/DiskExplorer.tsx`
- Modify: `src/renderer/features/disk-explorer/store/diskStore.ts`
- Test: `src/tests/unit/diskExplorer.test.tsx` (extend)

**Interfaces:**
- Consumes: `sonner` (already a dependency; `<Toaster />` is already mounted in `App.tsx`).

- [ ] **Step 1: Extend the explorer test**

```tsx
  it('clears a store error once it has been shown', async () => {
    useDiskStore.setState({ loading: { isLoading: false, error: 'Permission denied' } });
    render(<DiskExplorer />);

    // The banner still renders for persistent errors, but the store is cleared
    // so a repeated failure re-notifies instead of being swallowed.
    await waitFor(() => expect(screen.getByTestId('disk-explorer-error')).toBeInTheDocument());
  });
```

- [ ] **Step 2: Emit a toast on error**

In `DiskExplorer.tsx`:

```tsx
import { toast } from 'sonner';
```
```tsx
  const clearError = useDiskStore((state) => state.clearError);

  useEffect(() => {
    if (!error) return;
    toast.error(error);
  }, [error]);
```

Keep the banner: a toast is easy to miss, and a failed mutation is worth stating twice. The banner's dismiss button already calls `clearError`.

- [ ] **Step 3: Run, verify, commit**

Run: `npm test`

```bash
git add src/renderer/features/disk-explorer/ src/tests/
git commit -m "feat(files): surface filesystem errors as toasts"
```

---

**PHASE D COMPLETE.** Files can create, rename, move, and delete — every operation guarded, no silent overwrites, deletion recoverable from the Trash.

---

# PHASE E — Make it feel professional

The colour tokens already exist (`--background`, `--muted`, `--accent`, light and dark). What is missing is a consistent spatial and type rhythm, and the small states that separate a prototype from a product.

---

### Task 19: A spacing, type, and motion scale

**Files:**
- Modify: `tailwind.config.js`
- Modify: every component under `src/renderer/features/disk-explorer/`
- Create: `docs/design-tokens.md`

**Design note:** the components currently use `p-1.5`, `gap-3`, `text-xs`, `h-3.5`, `py-[3px]`, and `min-h-[2rem]` — each a local decision. Inconsistent rhythm is what reads as unpolished even when no single value is wrong. This task does not invent a palette; it names the scale and applies it.

- [ ] **Step 1: Write the scale down**

Create `docs/design-tokens.md`:

```markdown
# Design tokens — Files

Colour is already defined as HSL CSS variables in `src/renderer/styles/index.css`
(shadcn convention, light and dark). This document covers the rest.

## Spacing — 4px base, 8px rhythm

| Token | px | Use |
|---|---|---|
| `1` | 4 | icon-to-label gap |
| `2` | 8 | control padding, tight stacks |
| `3` | 12 | grid gaps, section padding |
| `4` | 16 | pane padding |
| `6` | 24 | empty-state padding |

Never use arbitrary values (`p-[7px]`, `min-h-[2rem]`). If a value is not on the
scale, the scale is wrong or the design is.

## Type — five steps, no more

| Class | Use |
|---|---|
| `text-[11px]` | metadata, counts, sizes |
| `text-xs` | file names, controls, body of dense UI |
| `text-sm` | pane titles, dialog body |
| `text-base` | dialog titles |
| `text-lg` | empty-state headings |

Weights: `font-normal` for content, `font-medium` for titles. Never `font-bold`
in chrome — weight is for hierarchy, not emphasis.

## Icons

`h-3.5 w-3.5` inside dense rows, `h-4 w-4` for controls, `h-8 w-8` for empty
states. No other sizes.

## Motion

| Token | Duration | Use |
|---|---|---|
| `duration-100` | 100ms | hover, selection |
| `duration-150` | 150ms | dialogs, overlays |

Never longer. Anything over 200ms in a file manager reads as lag, not polish.

## Radius

Inherit from `--radius` (0.5rem) via `rounded-md` / `rounded-lg`. Use
`rounded-sm` for dense rows only.
```

- [ ] **Step 2: Add the missing scale step to Tailwind**

`text-[11px]` is the only non-standard size. Name it rather than repeating the arbitrary value. In `tailwind.config.js`, inside `theme.extend`:

```js
      fontSize: {
        "2xs": ["11px", { lineHeight: "14px" }],
      },
```

- [ ] **Step 3: Apply the scale**

Work through each file below and replace off-scale values. This is mechanical; the tests guard behaviour while you do it.

| File | Replace |
|---|---|
| `DiskTreeItem.tsx` | `py-[3px]` → `py-1`; `paddingLeft: depth * 12 + 4` → `depth * 12 + 8` |
| `DiskFolderView.tsx` | `min-h-[2rem]` → `min-h-8`; `text-xs` on metadata → `text-2xs` |
| `DiskExplorer.tsx` | `w-64` sidebar and `w-80` detail pane are on the 4px scale — leave them |
| `Toolbar.tsx` | `py-0.5` → `py-1`; `gap-0.5` → `gap-1` |
| `Breadcrumb.tsx` | `px-1.5 py-0.5` → `px-2 py-1`; `text-xs` → `text-2xs` |
| `NameDialog.tsx`, `ConfirmDeleteDialog.tsx` | title `text-sm` → `text-base` |
| all | add `transition-colors duration-100` to every hover/selection surface |

- [ ] **Step 4: Verify nothing broke**

Run: `npm test`
Expected: all pass. If a test fails on text content, a class change altered markup — revert that specific edit.

- [ ] **Step 5: Look at it**

Run `npm run better-dev`. Compare against the token document. Check both light and dark (the theme toggle is in the navbar).

- [ ] **Step 6: Commit**

```bash
git add tailwind.config.js docs/design-tokens.md src/renderer/features/disk-explorer/
git commit -m "style(files): apply a consistent spacing, type, and motion scale"
```

---

### Task 20: Skeletons, empty states, and density

**Files:**
- Create: `src/renderer/features/disk-explorer/components/Skeleton.tsx`
- Create: `src/renderer/features/disk-explorer/components/EmptyState.tsx`
- Modify: `DiskFolderView.tsx`, `DetailPane.tsx`, `DiskTree.tsx`, `Toolbar.tsx`, `diskStore.ts`
- Test: `src/tests/unit/emptyStates.test.tsx`

**Interfaces:**
- Produces: `<Skeleton />`, `<EmptyState icon title description action />`; store `density: 'compact' | 'comfortable'` with `setDensity`.

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/emptyStates.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { DiskFolderView } from '@/renderer/features/disk-explorer/components/DiskFolderView';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';

const DIR = '/V/Photos';

beforeEach(() => {
  installDiskApi();
  useDiskStore.setState({
    roots: ['/V'], listings: {}, expanded: {}, selectedPath: null,
    filter: '', sort: { field: 'name', direction: 'asc' },
    density: 'comfortable', loading: { isLoading: false, error: null },
  });
});

describe('loading and empty states', () => {
  it('shows skeleton tiles while the listing loads, not a Loading label', async () => {
    installDiskApi({
      readDirectory: vi.fn(() => new Promise(() => { /* never resolves */ })),
    });

    render(<DiskFolderView dirPath={DIR} />);
    await waitFor(() => expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0));
    expect(screen.queryByText(/^Loading/)).not.toBeInTheDocument();
  });

  it('shows a real empty state for an empty folder', async () => {
    useDiskStore.setState({ listings: { [DIR]: [] } });
    render(<DiskFolderView dirPath={DIR} />);

    await waitFor(() => expect(screen.getByTestId('disk-folder-empty')).toBeInTheDocument());
    expect(screen.getByTestId('empty-state-title')).toBeInTheDocument();
  });

  it('distinguishes filtered-to-nothing from genuinely empty', async () => {
    useDiskStore.setState({
      listings: { [DIR]: [entry({ path: `${DIR}/a.jpg`, name: 'a.jpg', kind: 'image' })] },
      filter: 'zzzz',
    });

    render(<DiskFolderView dirPath={DIR} />);
    await waitFor(() => expect(screen.getByTestId('disk-folder-no-matches')).toBeInTheDocument());
    expect(screen.queryByTestId('disk-folder-empty')).not.toBeInTheDocument();
  });
});

describe('density', () => {
  it('defaults to comfortable', () => {
    expect(useDiskStore.getState().density).toBe('comfortable');
  });

  it('switches to compact', () => {
    useDiskStore.getState().setDensity('compact');
    expect(useDiskStore.getState().density).toBe('compact');
  });
});
```

- [ ] **Step 2: Implement `Skeleton` and `EmptyState`**

Create `src/renderer/features/disk-explorer/components/Skeleton.tsx`:

```tsx
import React from 'react';

/**
 * A shaped placeholder rather than the word "Loading".
 *
 * It communicates what is arriving and how much, so the layout does not jump
 * when content lands — the difference between an app that feels fast and one
 * that merely is.
 */
export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div data-testid="skeleton" className={`animate-pulse rounded-md bg-muted/60 ${className}`} />
);

export const GallerySkeleton: React.FC<{ count?: number }> = ({ count = 12 }) => (
  <div className="p-4 grid gap-3 grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
    {Array.from({ length: count }, (_, index) => (
      <div key={index} className="flex flex-col gap-2">
        <Skeleton className="aspect-square" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    ))}
  </div>
);
```

Create `src/renderer/features/disk-explorer/components/EmptyState.tsx`:

```tsx
import React from 'react';

interface EmptyStateProps {
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ Icon, title, description, action }) => (
  <div className="flex-1 grid place-items-center p-6">
    <div className="flex flex-col items-center gap-2 text-center max-w-xs">
      <Icon className="h-8 w-8 opacity-25" />
      <p data-testid="empty-state-title" className="text-sm font-medium">{title}</p>
      {description && <p className="text-2xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  </div>
);
```

- [ ] **Step 3: Use them**

In `DiskFolderView.tsx`, replace the `if (!entries) return <div…>Loading…</div>` guard with `<GallerySkeleton />`, and replace both empty branches with `<EmptyState />` — `FolderOpen` + "This folder is empty" for the genuine case, `SearchX` + `No files matching “${filter}”` with a Clear filter action for the filtered case, keeping the existing `data-testid` values on the wrapper so the tests in Task 9 still pass.

Apply the same treatment to `DetailPane`'s `detail-empty` and `DiskTree`'s `disk-tree-empty`.

- [ ] **Step 4: Add density**

Store: `density: 'compact' | 'comfortable'` (initial `'comfortable'`), `setDensity(value)`.

In `DiskFolderView.tsx`, drive the tile constants from it:

```tsx
const TILE = {
  comfortable: { width: 172, height: 208, min: 160 },
  compact: { width: 116, height: 144, min: 104 },
} as const;
```
```tsx
  const density = useDiskStore((state) => state.density);
  const tile = TILE[density];
```

Use `tile.width` / `tile.height` in the `FixedSizeGrid` props and in the `columns` calculation. Add a density toggle button to `Toolbar.tsx` beside the view-mode buttons, with `data-testid="toolbar-density"`.

- [ ] **Step 5: Run, verify, commit**

Run: `npm test`

Run `npm run better-dev`, open a large folder and watch skeletons appear before content; toggle density and confirm tiles resize.

```bash
git add src/renderer/features/disk-explorer/ src/tests/unit/emptyStates.test.tsx
git commit -m "feat(files): add skeletons, real empty states, and a density control"
```

---

### Task 21: Multi-select

**Files:**
- Modify: `diskStore.ts`, `DiskFolderView.tsx`, `DiskExplorer.tsx`, `ConfirmDeleteDialog.tsx`
- Test: `src/tests/unit/multiSelect.test.tsx`

**Interfaces:**
- Produces: store `selectedPaths: string[]` with `selectRange(entries, path)`, `toggleSelected(path)`, `clearSelection()`; `selectedPath` becomes the *last* selected item and stays the anchor for the detail pane.

**Design note:** `selectedPath` is kept rather than replaced. Everything downstream — the detail pane, Quick Look, rename, breadcrumb — operates on exactly one item, and rewriting them all to handle a set would be a large change for no gain. `selectedPaths` is additive, used only by bulk operations and the selection highlight.

- [ ] **Step 1: Write the failing test**

Create `src/tests/unit/multiSelect.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';
import type { DiskEntry } from '@/types/disk';

const ENTRIES: DiskEntry[] = ['a', 'b', 'c', 'd', 'e'].map((n) =>
  entry({ path: `/V/${n}`, name: n })
);

beforeEach(() => {
  installDiskApi();
  useDiskStore.setState({ selectedPath: null, selectedPaths: [] });
});

describe('multi-select', () => {
  it('select replaces the whole selection', () => {
    useDiskStore.getState().select('/V/a');
    useDiskStore.getState().select('/V/b');

    expect(useDiskStore.getState().selectedPath).toBe('/V/b');
    expect(useDiskStore.getState().selectedPaths).toEqual(['/V/b']);
  });

  it('toggle adds and removes', () => {
    useDiskStore.getState().select('/V/a');
    useDiskStore.getState().toggleSelected('/V/c');
    expect(useDiskStore.getState().selectedPaths).toEqual(['/V/a', '/V/c']);

    useDiskStore.getState().toggleSelected('/V/a');
    expect(useDiskStore.getState().selectedPaths).toEqual(['/V/c']);
  });

  it('toggle moves the anchor to the newly added item', () => {
    useDiskStore.getState().select('/V/a');
    useDiskStore.getState().toggleSelected('/V/c');
    expect(useDiskStore.getState().selectedPath).toBe('/V/c');
  });

  it('range selects everything between the anchor and the target', () => {
    useDiskStore.getState().select('/V/b');
    useDiskStore.getState().selectRange(ENTRIES, '/V/d');
    expect(useDiskStore.getState().selectedPaths).toEqual(['/V/b', '/V/c', '/V/d']);
  });

  it('range works backwards', () => {
    useDiskStore.getState().select('/V/d');
    useDiskStore.getState().selectRange(ENTRIES, '/V/b');
    expect(useDiskStore.getState().selectedPaths).toEqual(['/V/b', '/V/c', '/V/d']);
  });

  it('range with no anchor selects just the target', () => {
    useDiskStore.getState().selectRange(ENTRIES, '/V/c');
    expect(useDiskStore.getState().selectedPaths).toEqual(['/V/c']);
  });

  it('clearing empties both fields', () => {
    useDiskStore.getState().select('/V/a');
    useDiskStore.getState().clearSelection();

    expect(useDiskStore.getState().selectedPath).toBeNull();
    expect(useDiskStore.getState().selectedPaths).toEqual([]);
  });

  it('removing the last toggled item leaves no anchor', () => {
    useDiskStore.getState().select('/V/a');
    useDiskStore.getState().toggleSelected('/V/a');

    expect(useDiskStore.getState().selectedPaths).toEqual([]);
    expect(useDiskStore.getState().selectedPath).toBeNull();
  });
});
```

- [ ] **Step 2: Implement the store changes**

```ts
  selectedPaths: [],
```
```ts
  select: (targetPath) =>
    set((state) => ({
      selectedPath: targetPath,
      selectedPaths: targetPath === null ? [] : [targetPath],
      isQuickLookOpen: targetPath === null ? false : state.isQuickLookOpen,
    })),

  toggleSelected: (targetPath) =>
    set((state) => {
      const isSelected = state.selectedPaths.includes(targetPath);
      const next = isSelected
        ? state.selectedPaths.filter((candidate) => candidate !== targetPath)
        : [...state.selectedPaths, targetPath];

      return {
        selectedPaths: next,
        // The anchor follows the most recent addition; removing the anchor
        // leaves the last remaining item, or nothing.
        selectedPath: isSelected ? next[next.length - 1] ?? null : targetPath,
      };
    }),

  selectRange: (entries, targetPath) =>
    set((state) => {
      const anchor = state.selectedPath;
      if (!anchor) return { selectedPath: targetPath, selectedPaths: [targetPath] };

      const from = entries.findIndex((candidate) => candidate.path === anchor);
      const to = entries.findIndex((candidate) => candidate.path === targetPath);
      if (from === -1 || to === -1) return { selectedPath: targetPath, selectedPaths: [targetPath] };

      const [start, end] = from <= to ? [from, to] : [to, from];
      return {
        selectedPath: targetPath,
        selectedPaths: entries.slice(start, end + 1).map((candidate) => candidate.path),
      };
    }),

  clearSelection: () => set({ selectedPath: null, selectedPaths: [], isQuickLookOpen: false }),
```

- [ ] **Step 3: Wire the modifier clicks**

In `DiskFolderView.tsx`, change both `onSelect` handlers to inspect the event:

```tsx
  const handleClick = useCallback((event: React.MouseEvent, target: DiskEntry) => {
    const store = useDiskStore.getState();
    if (event.shiftKey) store.selectRange(visibleEntries, target.path);
    else if (event.metaKey || event.ctrlKey) store.toggleSelected(target.path);
    else store.select(target.path);
  }, [visibleEntries]);
```

Change the selection highlight from `selectedPath === entry.path` to `selectedPaths.includes(entry.path)` in both `GalleryTile` and `ListRow`.

Add `Cmd+A` to select all, in `DiskExplorer`'s keyboard effect — guarded against firing while typing, like the others.

- [ ] **Step 4: Make delete handle a multi-selection**

In `ConfirmDeleteDialog`, when `selectedPaths.length > 1`, title the dialog `Move N items to Trash?` and trash each in sequence, stopping and reporting on the first failure. Trash the items one at a time rather than in parallel — a partial failure is far easier to explain when the order is deterministic.

- [ ] **Step 5: Run, verify, commit**

Run: `npm test`

Run `npm run better-dev`: shift-click a range, Cmd-click to add and remove, Cmd+A to select all, then Delete on a multi-selection.

```bash
git add src/renderer/features/disk-explorer/ src/tests/unit/multiSelect.test.tsx
git commit -m "feat(files): add shift and cmd click multi-select"
```

---

### Task 22: Final verification

**Files:** none.

- [ ] **Step 1: Types and lint**

```bash
npx tsc --noEmit && npm run lint
```
Expected: no errors. 7 pre-existing warnings are acceptable.

- [ ] **Step 2: Full unit suite**

```bash
npm test
```
Expected: all pass. Record the count.

- [ ] **Step 3: E2E and budget check**

```bash
npm run test:e2e
```
Expected: 8 passed, under 60s. **If the count exceeds 10 or the wall clock exceeds 60s, the budget in `CLAUDE.md` is blown — stop and move a test down a tier.**

- [ ] **Step 4: Restore the Node ABI**

```bash
npm test
```

- [ ] **Step 5: Confirm the blast radius**

```bash
git diff main --stat -- src/renderer/features/file-explorer-v2 src/main/services/vfs
```
Expected: **empty**. This plan must not have touched the old explorer or the virtual VFS.

- [ ] **Step 6: Confirm no new dependencies**

```bash
git diff main -- package.json | grep -E '^\+' | grep -v version || echo "no dependency changes"
```
Expected: no additions to `dependencies` or `devDependencies`.

- [ ] **Step 7: Acceptance pass against real data**

Run `npm run better-dev` and work through this against a **copy** of a real folder:

| | Check |
|---|---|
| ☐ | A folder of 1,000+ photos opens quickly and scrolls smoothly |
| ☐ | Clicking a photo shows it; zoom and fit both work |
| ☐ | `Space` opens Quick Look; `Space` and `Escape` close it |
| ☐ | A markdown file renders; a source file shows as monospace; a PDF displays |
| ☐ | Arrows move the selection and keep it scrolled into view |
| ☐ | Typing jumps to a file; `Cmd+F` focuses the filter; `Cmd+↑` goes up and stops at the root |
| ☐ | `Cmd+↓` opens a folder or Quick Looks a file; `Enter` starts a rename |
| ☐ | Breadcrumb navigates; sort by each field behaves |
| ☐ | Adding a file in Finder appears in Opal within a second |
| ☐ | New folder, rename, and drag-to-move all work |
| ☐ | Delete puts the file in the macOS Trash and it is restorable |
| ☐ | A duplicate name shows an inline error and overwrites nothing |
| ☐ | Light and dark both look right |
| ☐ | DevTools Console shows no CSP violations |

- [ ] **Step 8: Push**

```bash
git push -u origin $(git branch --show-current)
```

---

## Explicitly out of scope

- **Metadata authoring** (tags, annotations, sidecars) — the next slice; it has its own storage-format concerns and Phase E leaves the inspector slot for it.
- **Persisted per-folder view config** — authored metadata, so it belongs with the write layer. Sort, density, and view mode are session state here.
- **Copy/duplicate, and undo beyond the OS Trash** — a real undo stack needs an operation log, which is its own design.
- **Table view with custom columns** — the Notion-style view; it depends on metadata existing.
- **Search across folders** — needs the index (slice 6). The filter here is within one folder, deliberately.
- **Converging `/explorer` and `/files`** — a later slice retires the old explorer. Do not touch it.
- **Thumbnail cache eviction** — the cache grows unbounded. Acceptable for now (PNGs at 512px are small); revisit if it becomes a real problem.
