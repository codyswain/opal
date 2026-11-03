// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import { mkdir, mkdtemp, rename, rm, utimes, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { contentTypeFor, toOpalFileUrl } from '@/common/opalFileUrl';
import { RootRegistry } from '@/main/fs/RootRegistry';
import { DOCUMENT_POLICY, parseRange, serveOpalFile } from '@/main/protocol/opalFile';

vi.mock('electron', () => ({ protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() } }));
vi.mock('@/main/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const BYTES = Buffer.from('0123456789abcdefghij');
const OID = createHash('sha256').update(BYTES).digest('hex');
const POINTER = `version https://git-lfs.github.com/spec/v1\noid sha256:${OID}\nsize ${BYTES.length}\n`;

describe('parseRange', () => {
  it('reads one range, an open end and a suffix, and clamps the end to the file', () => {
    expect(parseRange('bytes=2-5', 20)).toEqual({ start: 2, end: 5 });
    expect(parseRange('bytes=15-', 20)).toEqual({ start: 15, end: 19 });
    expect(parseRange('bytes=-4', 20)).toEqual({ start: 16, end: 19 });
    expect(parseRange('bytes=-400', 20)).toEqual({ start: 0, end: 19 });
    expect(parseRange('bytes=10-400', 20)).toEqual({ start: 10, end: 19 });
  });

  it('asks for the whole file for several ranges, other units, nonsense and a zero-byte file', () => {
    expect(parseRange('bytes=0-1,4-5', 20)).toBe('whole');
    expect(parseRange('items=0-1', 20)).toBe('whole');
    expect(parseRange('bytes=5-2', 20)).toBe('whole');
    expect(parseRange('bytes=-', 20)).toBe('whole');
    expect(parseRange(null, 20)).toBe('whole');
    expect(parseRange('bytes=0-', 0)).toBe('whole');
  });

  it('is unsatisfiable at or past the end, and for an empty suffix', () => {
    expect(parseRange('bytes=20-', 20)).toBe('unsatisfiable');
    expect(parseRange('bytes=25-30', 20)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 20)).toBe('unsatisfiable');
  });
});

describe('opal-file responses', () => {
  let temporary: string, root: string, registry: RootRegistry;
  const get = (file: string, headers: Record<string, string> = {}, method = 'GET') =>
    serveOpalFile(new Request(toOpalFileUrl(file), { headers, method }), { registry });
  const text = async (response: Response) => Buffer.from(await response.arrayBuffer()).toString();

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'opal-range-'));
    registry = new RootRegistry({ storePath: path.join(temporary, 'roots.json') });
    await mkdir(path.join(temporary, 'vault/.git'), { recursive: true });
    await mkdir(path.join(temporary, 'vault/Library/files'), { recursive: true });
    root = await registry.add(path.join(temporary, 'vault'));
  });
  afterEach(async () => { await rm(temporary, { recursive: true, force: true }); });

  it('answers a range with 206, Content-Range and those bytes, and says it takes ranges', async () => {
    const clip = path.join(root, 'clip.mp4');
    await writeFile(clip, BYTES);
    const whole = await get(clip);
    expect(whole.status).toBe(200);
    expect(whole.headers.get('Accept-Ranges')).toBe('bytes');
    expect(whole.headers.get('Content-Length')).toBe('20');
    expect(await text(whole)).toBe(BYTES.toString());

    const part = await get(clip, { Range: 'bytes=2-5' });
    expect(part.status).toBe(206);
    expect(part.headers.get('Content-Range')).toBe('bytes 2-5/20');
    expect(part.headers.get('Content-Length')).toBe('4');
    expect(part.headers.get('Content-Type')).toBe('video/mp4');
    expect(await text(part)).toBe('2345');
  });

  it('answers a suffix range with the last bytes, and a suffix longer than the file with all of it', async () => {
    const clip = path.join(root, 'clip.mov');
    await writeFile(clip, BYTES);
    const tail = await get(clip, { Range: 'bytes=-3' });
    expect(tail.status).toBe(206);
    expect(tail.headers.get('Content-Range')).toBe('bytes 17-19/20');
    expect(await text(tail)).toBe('hij');
    const all = await get(clip, { Range: 'bytes=-500' });
    expect(all.headers.get('Content-Range')).toBe('bytes 0-19/20');
    expect(await text(all)).toBe(BYTES.toString());
  });

  it('answers 416 with bytes */size for a range starting at the end or past it', async () => {
    const clip = path.join(root, 'clip.mp4');
    await writeFile(clip, BYTES);
    for (const range of ['bytes=20-', 'bytes=21-30']) {
      const response = await get(clip, { Range: range });
      expect(response.status).toBe(416);
      expect(response.headers.get('Content-Range')).toBe('bytes */20');
      expect(await text(response)).toBe('');
    }
  });

  it('answers several ranges with the whole file', async () => {
    const clip = path.join(root, 'clip.mp4');
    await writeFile(clip, BYTES);
    const response = await get(clip, { Range: 'bytes=0-1,5-6' });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Range')).toBeNull();
    expect(await text(response)).toBe(BYTES.toString());
  });

  it('answers a zero-byte file with an empty 200, ranged or not', async () => {
    const empty = path.join(root, 'empty.mp4');
    await writeFile(empty, '');
    for (const headers of [{}, { Range: 'bytes=0-' }]) {
      const response = await get(empty, headers);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Length')).toBe('0');
      expect(await text(response)).toBe('');
    }
  });

  it('sends the whole file when If-Range names an older version, and the range when it names this one', async () => {
    const clip = path.join(root, 'clip.mp4');
    await writeFile(clip, BYTES);
    const first = await get(clip);
    const etag = first.headers.get('ETag') as string;
    const modified = first.headers.get('Last-Modified') as string;
    expect((await get(clip, { Range: 'bytes=0-1', 'If-Range': etag })).status).toBe(206);
    expect((await get(clip, { Range: 'bytes=0-1', 'If-Range': modified })).status).toBe(206);
    expect((await get(clip, { Range: 'bytes=0-1', 'If-Range': '"older"' })).status).toBe(200);
    expect((await get(clip, { Range: 'bytes=0-1', 'If-Range': 'Tue, 01 Jan 2002 00:00:00 GMT' })).status).toBe(200);
  });

  it('reads the file again on every request, so a replaced file is served as it is now', async () => {
    const clip = path.join(root, 'clip.mp4');
    await writeFile(clip, BYTES);
    const first = await get(clip, { Range: 'bytes=0-' });
    expect(first.headers.get('Content-Range')).toBe('bytes 0-19/20');
    await first.arrayBuffer();
    // Replaced the way a sync or an editor does: a new file renamed over the old one.
    await writeFile(path.join(root, 'next.tmp'), 'short');
    await utimes(path.join(root, 'next.tmp'), new Date(2030, 0, 1), new Date(2030, 0, 1));
    await rename(path.join(root, 'next.tmp'), clip);
    const second = await get(clip, { Range: 'bytes=0-', 'If-Range': first.headers.get('ETag') as string });
    expect(second.status).toBe(200);
    expect(second.headers.get('Content-Length')).toBe('5');
    expect(second.headers.get('ETag')).not.toBe(first.headers.get('ETag'));
    expect(await text(second)).toBe('short');
  });

  it('serves an LFS object by range, tagged with its object id', async () => {
    const clip = path.join(root, 'Library/files/clip.mp4');
    await writeFile(clip, POINTER);
    const object = path.join(root, '.git/lfs/objects', OID.slice(0, 2), OID.slice(2, 4), OID);
    await mkdir(path.dirname(object), { recursive: true });
    await writeFile(object, BYTES);
    const part = await get(clip, { Range: 'bytes=10-' });
    expect(part.status).toBe(206);
    expect(part.headers.get('Content-Range')).toBe('bytes 10-19/20');
    expect(part.headers.get('ETag')).toBe(`"${OID}"`);
    expect(await text(part)).toBe('abcdefghij');
  });

  it('answers HEAD with the headers and no body', async () => {
    const clip = path.join(root, 'clip.mp4');
    await writeFile(clip, BYTES);
    const response = await get(clip, {}, 'HEAD');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Length')).toBe('20');
    expect(await text(response)).toBe('');
  });

  it('sends nosniff and no Access-Control-Allow-Origin on every response, errors included', async () => {
    const clip = path.join(root, 'clip.mp4');
    await writeFile(clip, BYTES);
    await writeFile(path.join(root, 'Library/files/remote.png'), POINTER);
    await writeFile(path.join(temporary, 'outside.png'), BYTES);
    const responses = [
      await get(clip),
      await get(clip, { Range: 'bytes=1-2' }),
      await get(clip, { Range: 'bytes=99-' }),
      await get(path.join(root, 'Library/files/remote.png')),
      await get(path.join(temporary, 'outside.png')),
      await get(path.join(root, 'Library')),
      await serveOpalFile(new Request('opal-file://%E0%A4%A'), { registry }),
    ];
    expect(responses.map((response) => response.status)).toEqual([200, 206, 416, 404, 403, 400, 400]);
    for (const response of responses) {
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
  });

  it('sends HTML and SVG with a sandbox policy that loads nothing, and other types without one', async () => {
    await writeFile(path.join(root, 'page.html'), '<script>alert(1)</script>');
    await writeFile(path.join(root, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await writeFile(path.join(root, 'clip.mp4'), BYTES);
    const page = await get(path.join(root, 'page.html'));
    expect(page.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(page.headers.get('Content-Security-Policy')).toBe(DOCUMENT_POLICY);
    expect(DOCUMENT_POLICY.split('; ')).toEqual(['sandbox', "default-src 'none'", "style-src 'unsafe-inline'", 'img-src data:']);
    expect((await get(path.join(root, 'icon.svg'))).headers.get('Content-Security-Policy')).toBe(DOCUMENT_POLICY);
    expect((await get(path.join(root, 'clip.mp4'))).headers.get('Content-Security-Policy')).toBeNull();
  });

  it('names csv, tsv, vtt, aiff and stl', () => {
    expect(contentTypeFor('a.csv')).toBe('text/csv; charset=utf-8');
    expect(contentTypeFor('a.tsv')).toBe('text/tab-separated-values; charset=utf-8');
    expect(contentTypeFor('a.vtt')).toBe('text/vtt; charset=utf-8');
    expect(contentTypeFor('a.aiff')).toBe('audio/aiff');
    expect(contentTypeFor('a.aif')).toBe('audio/aiff');
    expect(contentTypeFor('a.stl')).toBe('model/stl');
  });
});
