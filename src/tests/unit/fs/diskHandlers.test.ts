import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return os.tmpdir();
      return os.tmpdir();
    },
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

import type { IpcMain } from 'electron';
import { RootRegistry } from '@/main/fs/RootRegistry';
import { DiskReader } from '@/main/fs/DiskReader';
import { DiskHandlers } from '@/main/fs/DiskHandlers';
import { FileWriter } from '@/main/fs/FileWriter';

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
let showItemInFolder: ReturnType<typeof vi.fn>;
let openPath: ReturnType<typeof vi.fn>;
let watchRoot: ReturnType<typeof vi.fn>;
let unwatchRoot: ReturnType<typeof vi.fn>;
let writer: FileWriter;

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
  showItemInFolder = vi.fn();
  openPath = vi.fn(async () => '');
  watchRoot = vi.fn(async () => undefined);
  unwatchRoot = vi.fn(async () => undefined);
  writer = new FileWriter({ registry, trashItem: vi.fn(async () => undefined) });

  new DiskHandlers({
    ipc: stub.ipc,
    registry,
    reader: new DiskReader({ registry }),
    showOpenDialog,
    shell: { showItemInFolder, openPath },
    watcher: { watch: watchRoot, unwatch: unwatchRoot },
    writer,
  }).registerAll();
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('DiskHandlers', () => {
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

  it('opens a folder chosen in the dialog and returns it as a root', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [root] });

    const result = await stub.invoke('disk:open-folder') as {
      success: boolean;
      data: { root: string | null };
    };

    expect(result.success).toBe(true);
    expect(result.data.root).toContain('Vault');
    expect(registry.list()).toHaveLength(1);
    expect(watchRoot).toHaveBeenCalledTimes(1);
  });

  it('keeps the opened root even if starting its watcher fails', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [root] });
    watchRoot.mockRejectedValue(new Error('watch failed'));

    const result = await stub.invoke('disk:open-folder') as {
      success: boolean;
      data: { root: string | null };
    };

    expect(result.success).toBe(true);
    expect(result.data.root).toContain('Vault');
    expect(registry.list()).toHaveLength(1);
    expect(watchRoot).toHaveBeenCalledTimes(1);
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

  it('creates a directory', async () => {
    await registry.add(root);
    const result = await stub.invoke('disk:create-directory', root, 'New') as {
      success: boolean;
      data: { path: string };
    };

    expect(result.success).toBe(true);
    expect(result.data.path.endsWith('New')).toBe(true);
  });

  it('surfaces an invalid name as a readable error', async () => {
    await registry.add(root);
    const result = await stub.invoke('disk:create-directory', root, '../evil') as {
      success: boolean;
      error: string;
    };

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not a valid file name/i);
  });

  it('surfaces a collision as a readable error', async () => {
    await registry.add(root);
    const result = await stub.invoke('disk:rename', path.join(root, 'note.md'), 'Photos') as {
      success: boolean;
      error: string;
    };

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already exists/i);
  });

  it('renames a file', async () => {
    await registry.add(root);
    const result = await stub.invoke('disk:rename', path.join(root, 'note.md'), 'renamed.md') as {
      success: boolean;
      data: { path: string };
    };

    expect(result.success).toBe(true);
    expect(result.data.path.endsWith('renamed.md')).toBe(true);
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

  it('stats a single file', async () => {
    await registry.add(root);
    const result = await stub.invoke('disk:stat', path.join(root, 'Photos', 'a.jpg')) as {
      success: boolean; data: { name: string; kind: string };
    };
    expect(result.success).toBe(true);
    expect(result.data.name).toBe('a.jpg');
    expect(result.data.kind).toBe('image');
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
      success: boolean;
      error: string;
    };
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no application/i);
  });

  it('removes a root', async () => {
    const stored = await registry.add(root);
    const result = await stub.invoke('disk:remove-root', stored) as { success: boolean };
    expect(result.success).toBe(true);
    expect(registry.list()).toEqual([]);
    expect(unwatchRoot).toHaveBeenCalledWith(stored);
  });
});
