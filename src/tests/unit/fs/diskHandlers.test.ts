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
