// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { RootRegistry } from '@/main/fs/RootRegistry';
import type { RunFile } from '@/main/files/FileStore';
import { FilesService, type FilesPlatform } from '@/main/files/FilesService';
import { Renditions, SIPS } from '@/main/files/renditions';
import { DiskCache, hasClearCorner, Thumbnails, type Picture, type RunBytes, type ThumbnailProvider } from '@/main/files/thumbnails';
import { jobQueue } from '@/main/mapLimited';
import type { FileInfo } from '@/types/files';

/** The fixture provider's picture: a PNG signature and the file's name, so a test can tell which file was drawn. */
const fixture = (file: string): Picture => ({ bytes: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(path.basename(file))]), type: 'image/png' });
const decode = (url: string | null) => (url ? Buffer.from(url.split(',')[1], 'base64').subarray(8).toString() : null);

const info = (file: string, extra: Partial<FileInfo> = {}): FileInfo => ({
  path: file, name: path.basename(file), size: 10, mtimeMs: 1000, kind: 'other', status: 'local', ...extra,
});

describe('thumbnails', () => {
  let temporary: string, cache: DiskCache;
  let provider: ReturnType<typeof vi.fn<ThumbnailProvider>>;
  const thumbnails = (overrides: Partial<ConstructorParameters<typeof Thumbnails>[0]> = {}) =>
    new Thumbnails({ cache, limiter: jobQueue(3), provider, materialize: async (file) => file, ...overrides });

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'opal-thumbnails-'));
    cache = new DiskCache(path.join(temporary, 'cache'));
    provider = vi.fn<ThumbnailProvider>(async (file) => fixture(file));
  });
  afterEach(async () => { await rm(temporary, { recursive: true, force: true }); });

  it('draws a picture once and answers the next ask from the cache in app data', async () => {
    const pictures = thumbnails();
    const url = await pictures.thumbnail(info('/vault/deck.pptx'), 96);
    expect(url?.startsWith('data:image/png;base64,')).toBe(true);
    expect(decode(url)).toBe('deck.pptx');
    expect(provider).toHaveBeenCalledWith('/vault/deck.pptx', 128);
    expect(await readdir(path.join(temporary, 'cache'))).toHaveLength(1);
    expect(decode(await thumbnails().thumbnail(info('/vault/deck.pptx'), 100))).toBe('deck.pptx');
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('never shows the icon Quick Look answers for a deck, document, PDF or movie it cannot draw', async () => {
    provider.mockImplementation(async (file) => ({ ...fixture(file), clearCorner: true }));
    const pictures = thumbnails();
    for (const name of ['deck.pptx', 'report.docx', 'sheet.xlsx', 'plan.pdf', 'clip.mov', 'talk.key']) {
      expect(await pictures.thumbnail(info(`/vault/${name}`), 96), name).toBeNull();
    }
    // Pictures and models can be see-through at their corners and still be the file's own picture.
    for (const name of ['logo.png', 'bracket.stl']) expect(decode(await pictures.thumbnail(info(`/vault/${name}`), 96)), name).toBe(name);
    // An opaque picture of a deck is kept.
    provider.mockImplementation(async (file) => ({ ...fixture(file), clearCorner: false }));
    expect(decode(await pictures.thumbnail(info('/vault/kept.pptx'), 96))).toBe('kept.pptx');
  });

  it('finds a see-through corner in a bitmap of four bytes a pixel', () => {
    const opaque = () => Buffer.alloc(8 * 8 * 4, 255);
    expect(hasClearCorner(opaque(), 8, 8)).toBe(false);
    for (const [x, y] of [[0, 0], [7, 0], [0, 7], [7, 7]]) {
      const bitmap = opaque();
      bitmap[(y * 8 + x) * 4 + 3] = 20;
      expect(hasClearCorner(bitmap, 8, 8), `${x},${y}`).toBe(true);
    }
    const middle = opaque();
    middle[(3 * 8 + 3) * 4 + 3] = 0;
    expect(hasClearCorner(middle, 8, 8)).toBe(false);
    expect(hasClearCorner(Buffer.alloc(4), 8, 8)).toBe(false);
  });

  it('draws nothing for HTML, SVG, text and archives, nor for a file that is not here', async () => {
    const pictures = thumbnails();
    for (const name of ['page.html', 'page.htm', 'icon.svg', 'notes.txt', 'data.csv', 'backup.zip', 'script.sh']) {
      expect(await pictures.thumbnail(info(`/vault/${name}`), 96), name).toBeNull();
    }
    expect(await pictures.thumbnail(info('/vault/deck.pptx', { status: 'lfs-missing', oid: 'a'.repeat(64) }), 96)).toBeNull();
    expect(await pictures.thumbnail(info('/vault/deck.pptx', { status: 'missing' }), 96)).toBeNull();
    expect(provider).not.toHaveBeenCalled();
  });

  it('runs no more than three at once, visible cards first', async () => {
    let running = 0;
    let most = 0;
    const order: string[] = [];
    provider.mockImplementation(async (file) => {
      running += 1;
      most = Math.max(most, running);
      order.push(path.basename(file));
      await new Promise((resolve) => setTimeout(resolve, 20));
      running -= 1;
      return fixture(file);
    });
    const pictures = thumbnails();
    const asks = Array.from({ length: 8 }, (_, index) => pictures.thumbnail(info(`/vault/far-${index}.pdf`), 96));
    asks.push(pictures.thumbnail(info('/vault/seen.pdf'), 96, { visible: true }));
    await Promise.all(asks);
    expect(most).toBe(3);
    expect(order.indexOf('seen.pdf')).toBe(3);
  });

  it('gives up on a hung job after its timeout, answers null, and does not try that file again', async () => {
    provider.mockImplementation(() => new Promise(() => undefined));
    const pictures = thumbnails({ timeoutMs: 50 });
    const started = Date.now();
    expect(await pictures.thumbnail(info('/vault/hung.mov'), 96)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(await pictures.thumbnail(info('/vault/hung.mov'), 96)).toBeNull();
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('keeps a picture macOS finishes after the timeout, and draws it only once', async () => {
    provider.mockImplementation(async (file) => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return fixture(file);
    });
    const pictures = thumbnails({ timeoutMs: 20 });
    expect(await pictures.thumbnail(info('/vault/deck.key'), 96)).toBeNull();
    // Still drawing: no second Quick Look for the same file.
    expect(await pictures.thumbnail(info('/vault/deck.key'), 96)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(decode(await pictures.thumbnail(info('/vault/deck.key'), 96))).toBe('deck.key');
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('caches a failure until the file changes', async () => {
    provider.mockResolvedValueOnce(null);
    const pictures = thumbnails();
    expect(await pictures.thumbnail(info('/vault/odd.key'), 96)).toBeNull();
    expect(await pictures.thumbnail(info('/vault/odd.key'), 96)).toBeNull();
    expect(provider).toHaveBeenCalledTimes(1);
    expect(decode(await pictures.thumbnail(info('/vault/odd.key', { mtimeMs: 2000 }), 96))).toBe('odd.key');
  });

  it('keys an LFS file by its object id, so the same object at two paths is drawn once', async () => {
    const oid = 'b'.repeat(64);
    const pictures = thumbnails();
    await pictures.thumbnail(info('/vault/a/clip.mp4', { status: 'lfs-present', oid, mtimeMs: 1 }), 96);
    await pictures.thumbnail(info('/vault/b/clip.mp4', { status: 'lfs-present', oid, mtimeMs: 2 }), 96);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(DiskCache.keyFor(info('/x', { oid }), 'v')).toBe(DiskCache.keyFor(info('/y', { oid, size: 99 }), 'v'));
    expect(DiskCache.keyFor(info('/x'), 'v')).not.toBe(DiskCache.keyFor(info('/x', { mtimeMs: 5 }), 'v'));
  });

  it('takes Bambu\'s plate picture out of a 3MF with unzip, run without a shell', async () => {
    const png = fixture('plate_1.png').bytes;
    const unzip = vi.fn<RunBytes>(async () => png);
    const pictures = thumbnails({ runBytes: unzip });
    expect(decode(await pictures.thumbnail(info('/vault/bracket.a1b2c3d4.gcode.3mf'), 96))).toBe('plate_1.png');
    expect(unzip).toHaveBeenCalledWith('/usr/bin/unzip', ['-p', '/vault/bracket.a1b2c3d4.gcode.3mf', 'Metadata/plate_1.png'], expect.objectContaining({ timeout: expect.any(Number) }));
    expect(provider).not.toHaveBeenCalled();
    unzip.mockResolvedValueOnce(Buffer.from('caution: filename not matched'));
    expect(await pictures.thumbnail(info('/vault/plain.3mf'), 96)).toBeNull();
  });

  it('keeps the cache under its limit, removing the least recently used first', async () => {
    const small = new DiskCache(path.join(temporary, 'small'), 100);
    await small.set('old', Buffer.alloc(40));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await small.set('used', Buffer.alloc(40));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await small.get('old');
    await small.set('new', Buffer.alloc(40));
    expect((await readdir(path.join(temporary, 'small'))).sort()).toEqual(['new', 'old']);
  });
});

describe('display copies', () => {
  let temporary: string, cache: DiskCache;
  let sips: ReturnType<typeof vi.fn<RunFile>>;
  /** sips' stand-in writes a PNG header of the size it was asked for. */
  const png = (width: number, height: number) => {
    const bytes = Buffer.alloc(33);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    bytes.writeUInt32BE(width, 16);
    bytes.writeUInt32BE(height, 20);
    return bytes;
  };

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'opal-renditions-'));
    cache = new DiskCache(path.join(temporary, 'cache'));
    sips = vi.fn<RunFile>(async (_file, args) => {
      const width = args.includes('--resampleWidth') ? Number(args[args.indexOf('--resampleWidth') + 1]) : 4032;
      await writeFile(args[args.length - 1], png(width, Math.round((width * 3) / 4)));
      return { stdout: '', stderr: '' };
    });
  });
  afterEach(async () => { await rm(temporary, { recursive: true, force: true }); });

  const renditions = () => new Renditions({ cache, limiter: jobQueue(3), materialize: async (file) => file, run: sips });

  it('shows a HEIC through a JPEG copy, and leaves the vault file alone', async () => {
    const copy = await renditions().rendition(info('/vault/IMG_2041.HEIC', { kind: 'image', width: 4032, height: 3024 }));
    expect(copy).toMatchObject({ url: expect.stringMatching(/^data:image\/jpeg;base64,/), width: 4032, height: 3024 });
    expect(sips).toHaveBeenCalledWith(SIPS, ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', '/vault/IMG_2041.HEIC', '--out', expect.stringMatching(/copy\.jpg$/)], expect.objectContaining({ timeout: expect.any(Number) }));
    expect(sips.mock.calls[0][1].at(-1)?.startsWith('/vault')).toBe(false);
  });

  it('makes a smaller copy of a picture more than twice the column, and none otherwise', async () => {
    const shot = info('/vault/5k.png', { kind: 'image', width: 5120, height: 2880 });
    const copy = await renditions().rendition(shot, 700);
    // Twice the column, rounded up to a step of 400 so a window a few pixels wider reuses the copy.
    expect(copy).toMatchObject({ url: expect.stringMatching(/^data:image\/png;base64,/), width: 1600 });
    expect(sips.mock.calls[0][1]).toEqual(['-s', 'format', 'png', '--resampleWidth', '1600', '/vault/5k.png', '--out', expect.stringMatching(/copy\.png$/)]);
    expect(await renditions().rendition(info('/vault/small.png', { kind: 'image', width: 1200 }), 700)).toBeNull();
    expect(await renditions().rendition(info('/vault/anim.gif', { kind: 'image', width: 5000 }), 700)).toBeNull();
    expect(await renditions().rendition(shot)).toBeNull();
  });

  it('makes one copy for nearby column widths, not one per pixel', async () => {
    const pictures = renditions();
    const shot = info('/vault/5k.png', { kind: 'image', width: 5120, height: 2880 });
    for (const width of [700, 699, 698, 650, 420, 421]) await pictures.rendition(shot, width);
    expect(sips.mock.calls.map((call) => call[1][call[1].indexOf('--resampleWidth') + 1])).toEqual(['1600', '1200']);
  });

  it('answers null when sips fails, and does not run it again for that file', async () => {
    sips.mockRejectedValue(new Error('sips: unsupported'));
    const pictures = renditions();
    expect(await pictures.rendition(info('/vault/scan.tiff', { kind: 'image' }))).toBeNull();
    expect(await pictures.rendition(info('/vault/scan.tiff', { kind: 'image' }))).toBeNull();
    expect(sips).toHaveBeenCalledTimes(1);
  });
});

describe('the files service', () => {
  let temporary: string, root: string, service: FilesService, platform: FilesPlatform;

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'opal-files-pictures-'));
    const registry = new RootRegistry({ storePath: path.join(temporary, 'roots.json') });
    await mkdir(path.join(temporary, 'vault/.git'), { recursive: true });
    await mkdir(path.join(temporary, 'vault/Library/files'), { recursive: true });
    root = await registry.add(path.join(temporary, 'vault'));
    platform = {
      openPath: vi.fn(async () => ''), showItemInFolder: vi.fn(), appName: vi.fn(async () => null), quickLook: vi.fn(),
      thumbnail: vi.fn(async (file: string) => fixture(file)), copyFileToClipboard: vi.fn(), saveDialog: vi.fn(async () => null), startDrag: vi.fn(async () => undefined),
    };
    service = new FilesService({ registry, links: { invalidateDirectories: vi.fn() }, platform, appData: path.join(temporary, 'app-data') });
  });
  afterEach(async () => { await rm(temporary, { recursive: true, force: true }); });

  it('draws an LFS file from a read-only copy named as the page shows it, so Quick Look knows its type, and never from the placeholder', async () => {
    const bytes = Buffer.from('PK deck');
    const oid = createHash('sha256').update(bytes).digest('hex');
    await writeFile(path.join(root, 'Library/files/deck.a1b2c3d4.pptx'), `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${bytes.length}\n`);
    expect(await service.thumbnail(path.join(root, 'Library/files/deck.a1b2c3d4.pptx'), 96)).toBeNull();
    const object = path.join(root, '.git/lfs/objects', oid.slice(0, 2), oid.slice(2, 4), oid);
    await mkdir(path.dirname(object), { recursive: true });
    await writeFile(object, bytes);
    const url = await service.thumbnail(path.join(root, 'Library/files/deck.a1b2c3d4.pptx'), 96);
    expect(decode(url)).toBe('deck.pptx');
    const drawn = vi.mocked(platform.thumbnail).mock.calls[0][0];
    expect(drawn.startsWith(path.join(temporary, 'app-data'))).toBe(true);
    expect(await readFile(drawn)).toEqual(bytes);
  });

  it('refuses paths outside the opened folders', async () => {
    await writeFile(path.join(temporary, 'outside.png'), 'x');
    await expect(service.thumbnail(path.join(temporary, 'outside.png'), 96)).rejects.toThrow(/not inside/);
    await expect(service.rendition(path.join(temporary, 'outside.png'), 700)).rejects.toThrow(/not inside/);
  });
});
