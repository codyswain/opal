import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMain } from 'electron';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
}));

vi.mock('@/main/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { MetadataError } from '@/main/fs/MetadataCodec';
import { MetadataHandlers } from '@/main/fs/MetadataHandlers';
import type { MetadataService } from '@/main/fs/MetadataService';
import { metadata } from '@/tests/helpers/metadataApi';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

function ipcStub() {
  const handlers = new Map<string, Handler>();
  return {
    ipc: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) } as unknown as IpcMain,
    invoke(channel: string, ...args: unknown[]) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`Missing ${channel}`);
      return handler({}, ...args);
    },
    channels: () => [...handlers.keys()].sort(),
  };
}

describe('MetadataHandlers', () => {
  let stub: ReturnType<typeof ipcStub>;
  let service: {
    read: ReturnType<typeof vi.fn>;
    saveProperties: ReturnType<typeof vi.fn>;
    addRelated: ReturnType<typeof vi.fn>;
    removeRelated: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    stub = ipcStub();
    service = {
      read: vi.fn(async (target: string) => metadata({ path: target })),
      saveProperties: vi.fn(async (target: string) => metadata({ path: target })),
      addRelated: vi.fn(async (target: string) => metadata({ path: target })),
      removeRelated: vi.fn(async (target: string) => metadata({ path: target })),
    };
    new MetadataHandlers({ ipc: stub.ipc, service: service as unknown as MetadataService }).registerAll();
  });

  it('registers a separate metadata IPC surface', () => {
    expect(stub.channels()).toEqual([
      'metadata:add-related',
      'metadata:read',
      'metadata:remove-related',
      'metadata:save-properties',
    ]);
  });

  it('forwards valid property saves and returns their full Details', async () => {
    const result = await stub.invoke(
      'metadata:save-properties',
      '/V/note.md',
      { tags: ['work'], description: 'Useful' },
      'rev-1'
    );

    expect(service.saveProperties).toHaveBeenCalledWith(
      '/V/note.md',
      { tags: ['work'], description: 'Useful' },
      'rev-1'
    );
    expect(result).toEqual({ success: true, data: metadata() });
  });

  it.each([
    ['metadata:read', [null]],
    ['metadata:save-properties', ['/V/note.md', { tags: 'work', description: '' }, 'rev-1']],
    ['metadata:save-properties', ['/V/note.md', { tags: [], description: 2 }, 'rev-1']],
    ['metadata:add-related', ['/V/note.md', '']],
    ['metadata:remove-related', ['/V/note.md', 3]],
  ])('rejects malformed payloads for %s before calling the service', async (channel, args) => {
    const result = await stub.invoke(channel, ...args) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid metadata request/i);
    expect(service.read).not.toHaveBeenCalled();
    expect(service.saveProperties).not.toHaveBeenCalled();
    expect(service.addRelated).not.toHaveBeenCalled();
    expect(service.removeRelated).not.toHaveBeenCalled();
  });

  it('surfaces actionable metadata errors', async () => {
    service.read.mockRejectedValue(new MetadataError('Metadata is malformed.'));

    expect(await stub.invoke('metadata:read', '/V/note.md')).toEqual({
      success: false,
      error: 'Metadata is malformed.',
    });
  });
});
