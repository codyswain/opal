// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { protocol } from 'electron';
import { toOpalFileUrl } from '@/common/opalFileUrl';
import { RootRegistry } from '@/main/fs/RootRegistry';
import { registerOpalFileProtocol } from '@/main/protocol/opalFile';

vi.mock('electron', () => ({ protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() } }));
vi.mock('@/main/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const BYTES = Buffer.from('png image bytes');
const OID = createHash('sha256').update(BYTES).digest('hex');
const POINTER = `version https://git-lfs.github.com/spec/v1\noid sha256:${OID}\nsize ${BYTES.length}\n`;

describe('opal-file protocol', () => {
  let temporary: string, root: string;
  let serve: (request: { url: string }) => Promise<Response>;
  const get = (file: string) => serve({ url: toOpalFileUrl(file) });

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'opal-protocol-'));
    const registry = new RootRegistry({ storePath: path.join(temporary, 'roots.json') });
    await mkdir(path.join(temporary, 'vault/.git'), { recursive: true });
    await mkdir(path.join(temporary, 'vault/Library/files'), { recursive: true });
    root = await registry.add(path.join(temporary, 'vault'));
    vi.mocked(protocol.handle).mockClear();
    registerOpalFileProtocol({ registry });
    serve = vi.mocked(protocol.handle).mock.calls[0][1] as unknown as typeof serve;
  });
  afterEach(async () => { await rm(temporary, { recursive: true, force: true }); });

  it('serves a placeholder from git\'s object store once its bytes are here, and 404 until then', async () => {
    const frame = path.join(root, 'Library/files/frame.png');
    await writeFile(frame, POINTER);
    expect((await get(frame)).status).toBe(404);

    const object = path.join(root, '.git/lfs/objects', OID.slice(0, 2), OID.slice(2, 4), OID);
    await mkdir(path.dirname(object), { recursive: true });
    await writeFile(object, BYTES);
    const response = await get(frame);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Content-Length')).toBe(String(BYTES.length));
    expect(Buffer.from(await response.arrayBuffer())).toEqual(BYTES);
  });

  it('serves a plain file as it is, and nothing outside the opened folders', async () => {
    const photo = path.join(root, 'Library/files/photo.png');
    await writeFile(photo, BYTES);
    expect(Buffer.from(await (await get(photo)).arrayBuffer())).toEqual(BYTES);
    await writeFile(path.join(temporary, 'outside.png'), BYTES);
    expect((await get(path.join(temporary, 'outside.png'))).status).toBe(403);
  });
});
