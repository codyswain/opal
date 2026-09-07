import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, unlink } from 'fs/promises';
import path from 'path';
import os from 'os';

vi.mock('electron', () => ({
  app: {
    getPath: () => os.tmpdir(),
  },
}));

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/main/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

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

describe('metadata observation', () => {
  it('observes directory carriers beneath hidden root ancestors and ignores hidden subtrees', async () => {
    await watcher.closeAll();
    root = path.join(tmp, '.worktrees', 'root');
    await mkdir(path.join(root, '.hidden'), { recursive: true });
    const onMetadataChanged = vi.fn();
    watcher = new DiskWatcher({ onChanged, onMetadataChanged, debounceMs: 50 });
    await watcher.watch(root);
    await writeFile(path.join(root, '.opal.yaml'), 'schema: 1');
    await settle();
    expect(onChanged).toHaveBeenCalledWith([root]);
    expect(onMetadataChanged).toHaveBeenCalled();
    onChanged.mockClear();
    onMetadataChanged.mockClear();
    await writeFile(path.join(root, '.hidden', '.opal.yaml'), 'hidden');
    await settle();
    expect(onChanged).not.toHaveBeenCalled();
    expect(onMetadataChanged).not.toHaveBeenCalled();
  });
});
