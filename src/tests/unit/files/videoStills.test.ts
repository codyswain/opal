import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { VideoStills, videoOf, type Fetch } from '@/main/files/videoStills';

let dir: string;

beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'opal-stills-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const picture = (bytes = 'jpeg-bytes', type = 'image/jpeg') => new Response(Buffer.from(bytes), { status: 200, headers: { 'content-type': type } });

describe('video stills', () => {
  it('reads YouTube and Loom addresses and nothing else', () => {
    expect(videoOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12')).toEqual({ service: 'youtube', id: 'dQw4w9WgXcQ' });
    expect(videoOf('https://youtu.be/dQw4w9WgXcQ')).toEqual({ service: 'youtube', id: 'dQw4w9WgXcQ' });
    expect(videoOf('https://youtube.com/shorts/abcDEF12345')).toEqual({ service: 'youtube', id: 'abcDEF12345' });
    expect(videoOf('https://www.loom.com/share/0123456789abcdef0123456789abcdef')).toEqual({ service: 'loom', id: '0123456789abcdef0123456789abcdef' });
    expect(videoOf('https://www.youtube.com/watch?v=../../etc')).toBeNull();
    expect(videoOf('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(videoOf('file:///etc/passwd')).toBeNull();
  });

  it('fetches a YouTube still once from its image host and keeps it in app data', async () => {
    const fetch = vi.fn<Fetch>(async () => picture());
    const stills = new VideoStills({ dir, fetch });
    expect(await stills.still('https://youtu.be/dQw4w9WgXcQ', { cached: true })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    const url = await stills.still('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(url).toBe(`data:image/jpeg;base64,${Buffer.from('jpeg-bytes').toString('base64')}`);
    expect(fetch).toHaveBeenCalledWith('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', expect.objectContaining({ redirect: 'error' }));
    expect(await stills.still('https://youtu.be/dQw4w9WgXcQ', { cached: true })).toBe(url);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await readdir(dir)).toHaveLength(1);
  });

  it('keeps only pictures, and only Loom stills on Loom\'s own hosts', async () => {
    const html = new VideoStills({ dir, fetch: vi.fn<Fetch>(async () => picture('<html>', 'text/html')) });
    await expect(html.still('https://youtu.be/dQw4w9WgXcQ')).rejects.toThrow('something other than a picture');
    const loom = (thumbnail: string) => vi.fn<Fetch>(async (url) => (url.includes('oembed')
      ? new Response(JSON.stringify({ thumbnail_url: thumbnail }), { headers: { 'content-type': 'application/json' } })
      : picture()));
    const share = 'https://www.loom.com/share/0123456789abcdef0123456789abcdef';
    const good = loom('https://cdn.loom.com/sessions/thumbnails/abc.jpg');
    expect(await new VideoStills({ dir, fetch: good }).still(share)).toMatch(/^data:image\/jpeg;base64,/);
    expect(good).toHaveBeenLastCalledWith('https://cdn.loom.com/sessions/thumbnails/abc.jpg', expect.anything());
    await rm(dir, { recursive: true, force: true });
    await expect(new VideoStills({ dir, fetch: loom('https://evil.example/x.jpg') }).still(share)).rejects.toThrow('no preview');
  });
});
