import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const { mockHandle, mockRegisterSchemesAsPrivileged } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockRegisterSchemesAsPrivileged: vi.fn(),
}));

vi.mock('electron', () => ({
  protocol: {
    handle: mockHandle,
    registerSchemesAsPrivileged: mockRegisterSchemesAsPrivileged,
  },
}));

vi.mock('@/main/logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
  },
}));

import { registerOpalThumbProtocol } from '@/main/protocol/opalFile';

describe('registerOpalThumbProtocol', () => {
  let tmp: string;
  let cachePath: string;

  beforeEach(async () => {
    mockHandle.mockReset();
    mockRegisterSchemesAsPrivileged.mockReset();
    tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-thumb-protocol-'));
    cachePath = path.join(tmp, 'thumb.png');
    await writeFile(cachePath, 'PNGDATA');
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('serves thumbnails with a revalidating cache policy', async () => {
    const thumbnails = {
      getThumbnailPath: vi.fn(async () => cachePath),
    };

    registerOpalThumbProtocol({ thumbnails: thumbnails as never });
    const handler = mockHandle.mock.calls[0]?.[1] as
      | ((request: { url: string }) => Promise<Response>)
      | undefined;

    expect(handler).toBeTypeOf('function');

    const response = await handler!({ url: 'opal-thumb:///Vault/Photos/a.jpg' });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
  });
});
