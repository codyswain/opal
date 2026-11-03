// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import { appendFile, mkdir, mkdtemp, rm, truncate, writeFile } from 'fs/promises';
import { deflateSync } from 'zlib';
import os from 'os';
import path from 'path';
import { imageSize } from '@/common/imageSize';
import { FileInfoReader, MDLS } from '@/main/files/fileInfo';
import type { RunFile } from '@/main/files/FileStore';
import { IMAGE_HEAD, PDF_WHOLE, pdfHeaders, readMediaHeaders } from '@/main/files/mediaHeaders';
import { jobQueue } from '@/main/mapLimited';
import { makePdf } from '../../../e2e/helpers/pdfFixture';
import { aiff, bmp, compressedPdf, flac, heif, linearizedPdf, movie, mp3, mp3Xing, ogg, wav, webm, webp } from '../helpers/mediaFixtures';

describe('file info from headers', () => {
  let temporary: string, root: string;
  /** mdls is not there, as on a Mac where Spotlight is off or has not seen the file yet. */
  let mdls: ReturnType<typeof vi.fn<RunFile>>;
  let reader: FileInfoReader;
  const put = async (name: string, bytes: Buffer) => {
    const file = path.join(root, name);
    await writeFile(file, bytes);
    return file;
  };

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'opal-file-info-'));
    root = path.join(temporary, 'vault');
    await mkdir(path.join(root, '.git'), { recursive: true });
    mdls = vi.fn<RunFile>(async () => { throw Object.assign(new Error('spawn /usr/bin/mdls ENOENT'), { code: 'ENOENT' }); });
    reader = new FileInfoReader({ limiter: jobQueue(3), run: mdls });
  });
  afterEach(async () => { await rm(temporary, { recursive: true, force: true }); });

  it('counts a PDF\'s pages from its page tree, its linearization header or a compressed object stream', async () => {
    expect(await reader.info(await put('q3.pdf', makePdf(['one', 'two', 'three'])))).toMatchObject({ kind: 'pdf', status: 'local', pages: 3 });
    expect(await reader.info(await put('lin.pdf', linearizedPdf(15)))).toMatchObject({ pages: 15 });
    expect(await reader.info(await put('word.pdf', compressedPdf(42)))).toMatchObject({ pages: 42 });
    // A nested Pages node counts less than the root.
    expect(pdfHeaders(Buffer.from('1 0 obj << /Type /Pages /Kids [2 0 R] /Count 9 >> endobj 2 0 obj << /Type /Pages /Parent 1 0 R /Count 4 >> endobj'))).toEqual({ pages: 9 });
  });

  it('reads a large PDF at both ends, where writers put the page tree\'s root, through the queue', async () => {
    const file = path.join(root, 'scan.pdf');
    const head = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n');
    const tail = Buffer.from('\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 212 >> endobj\n%%EOF\n');
    await writeFile(file, head);
    await truncate(file, PDF_WHOLE + 1024 * 1024);
    await appendFile(file, tail);
    const queue = jobQueue(3);
    const run = vi.spyOn(queue, 'run');
    expect(await new FileInfoReader({ limiter: queue, run: mdls }).info(file)).toMatchObject({ pages: 212 });
    expect(run).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ label: 'Reading scan.pdf' }));
  });

  it('reads a movie\'s duration and size, with its index at the end, turned, and in a version 1 header', async () => {
    expect(await reader.info(await put('clip.mp4', movie({ seconds: 12.5, width: 1920, height: 1080 })))).toMatchObject({ kind: 'video', duration: 12.5, width: 1920, height: 1080 });
    expect(await reader.info(await put('camera.mov', movie({ seconds: 3, width: 1280, height: 720, indexAtEnd: true })))).toMatchObject({ duration: 3, width: 1280, height: 720 });
    expect(await reader.info(await put('portrait.mov', movie({ seconds: 2, width: 1920, height: 1080, turned: true })))).toMatchObject({ width: 1080, height: 1920 });
    expect(await reader.info(await put('long.m4v', movie({ seconds: 7200, width: 640, height: 360, version1: true })))).toMatchObject({ duration: 7200 });
  });

  it('reads a WebM\'s duration and video size, also from a recording with no length', async () => {
    expect(await reader.info(await put('talk.webm', webm({ seconds: 95.5, width: 1280, height: 720 })))).toMatchObject({ kind: 'video', duration: 95.5, width: 1280, height: 720 });
    expect(await reader.info(await put('live.mkv', webm({ width: 640, height: 480, liveSegment: true })))).toMatchObject({ width: 640, height: 480 });
    expect((await reader.info(await put('live.mkv', webm({ width: 640, height: 480, liveSegment: true })))).duration).toBeUndefined();
  });

  it('reads audio durations from WAV, AIFF, FLAC, M4A, MP3, Opus and Vorbis headers', async () => {
    expect((await reader.info(await put('memo.wav', wav(90)))).duration).toBeCloseTo(90, 5);
    expect((await reader.info(await put('take.aiff', aiff(44100 * 30)))).duration).toBeCloseTo(30, 5);
    expect((await reader.info(await put('song.flac', flac(48000 * 200)))).duration).toBeCloseTo(200, 5);
    expect(await reader.info(await put('memo.m4a', movie({ seconds: 61, width: 0, height: 0 })))).toMatchObject({ kind: 'audio', duration: 61 });
    expect((await reader.info(await put('talk.mp3', mp3(160_000)))).duration).toBeCloseTo(10, 5);
    expect((await reader.info(await put('vbr.mp3', mp3Xing(1000)))).duration).toBeCloseTo((1000 * 1152) / 44100, 5);
    expect(await reader.info(await put('memo.opus', ogg('opus', 42)))).toMatchObject({ kind: 'audio', duration: 42 });
    expect(await reader.info(await put('song.ogg', ogg('vorbis', 180, 48000)))).toMatchObject({ kind: 'audio', duration: 180 });
  });

  it('reads widths for WebP, AVIF, HEIC, SVG and BMP', async () => {
    expect(imageSize(webp('VP8 ', 640, 480))).toEqual({ width: 640, height: 480, retina: false });
    expect(imageSize(webp('VP8L', 1024, 768))).toEqual({ width: 1024, height: 768, retina: false });
    expect(imageSize(webp('VP8X', 3000, 2000))).toEqual({ width: 3000, height: 2000, retina: false });
    expect(imageSize(heif('avif', 1600, 900))).toEqual({ width: 1600, height: 900, retina: false });
    expect(imageSize(heif('heic', 4032, 3024, true))).toEqual({ width: 3024, height: 4032, retina: false });
    expect(imageSize(bmp(300, 200))).toEqual({ width: 300, height: 200, retina: false });
    const svg = (attributes: string) => imageSize(Buffer.from(`<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" ${attributes}><rect/></svg>`));
    expect(svg('width="120" height="80"')).toEqual({ width: 120, height: 80, retina: false });
    expect(svg('viewBox="0 0 400 300"')).toEqual({ width: 400, height: 300, retina: false });
    expect(svg('width="100%" viewBox="0 0 24 24"')).toEqual({ width: 24, height: 24, retina: false });
    expect(svg('width="200px" viewBox="0 0 400 300"')).toEqual({ width: 200, height: 150, retina: false });
    expect(svg('')).toBeNull();
    expect(await reader.info(await put('shot.webp', webp('VP8X', 3000, 2000)))).toMatchObject({ kind: 'image', width: 3000, height: 2000 });
  });

  it('reads only the first 64 KB of a picture for its size', async () => {
    const asked: [number, number][] = [];
    const big = Buffer.concat([webp('VP8X', 8000, 6000), Buffer.alloc(40 * 1024 * 1024)]);
    const headers = await readMediaHeaders('huge.webp', big.length, async (position, length) => {
      asked.push([position, length]);
      return big.subarray(position, position + length);
    });
    expect(headers).toEqual({ width: 8000, height: 6000, retina: false });
    expect(asked).toEqual([[0, IMAGE_HEAD]]);
    expect(IMAGE_HEAD).toBe(64 * 1024);
    // A text file is never read as a picture, whatever it holds.
    expect(await readMediaHeaders('notes.txt', 40, async () => Buffer.from('<svg width="10" height="10"></svg>'))).toEqual({});
  });

  it('reads an LFS file from its object when it is here, and says when it is not', async () => {
    const bytes = movie({ seconds: 4, width: 640, height: 480 });
    const oid = createHash('sha256').update(bytes).digest('hex');
    const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${bytes.length}\n`;
    const file = await put('clip.mp4', Buffer.from(pointer));
    expect(await reader.info(file)).toEqual({ path: file, name: 'clip.mp4', kind: 'video', size: bytes.length, mtimeMs: expect.any(Number), oid, status: 'lfs-missing' });
    const object = path.join(root, '.git/lfs/objects', oid.slice(0, 2), oid.slice(2, 4), oid);
    await mkdir(path.dirname(object), { recursive: true });
    await writeFile(object, bytes);
    // Downloaded by git lfs fetch, which leaves the placeholder as it was.
    expect(await reader.info(file)).toMatchObject({ status: 'lfs-present', oid, duration: 4, width: 640, height: 480 });
    // Spotlight can't read a placeholder, so mdls never runs for one.
    expect(mdls).not.toHaveBeenCalled();
  });

  it('says a file is missing, and a folder is a folder', async () => {
    expect(await reader.info(path.join(root, 'gone.pdf'))).toEqual({ path: path.join(root, 'gone.pdf'), name: 'gone.pdf', size: 0, mtimeMs: 0, kind: 'pdf', status: 'missing' });
    expect(await reader.info(root)).toMatchObject({ kind: 'directory', status: 'local' });
  });

  it('asks Spotlight only for what the headers left out, with a timeout, and keeps the answer until the file changes', async () => {
    mdls.mockImplementation(spotlight({ kMDItemDurationSeconds: 95.5, kMDItemPixelWidth: 1280, kMDItemPixelHeight: 720 }));
    const file = await put('talk.webm', Buffer.from('not a header Opal reads'));
    expect(await reader.info(file)).toMatchObject({ kind: 'video', duration: 95.5, width: 1280, height: 720 });
    expect(mdls).toHaveBeenCalledWith(MDLS, ['-name', 'kMDItemNumberOfPages', '-name', 'kMDItemDurationSeconds', '-name', 'kMDItemPixelWidth', '-name', 'kMDItemPixelHeight', '--', file], { timeout: 3000 });
    await reader.info(file);
    expect(mdls).toHaveBeenCalledTimes(1);
    mdls.mockClear();
    await reader.info(await put('clip.mp4', movie({ seconds: 1, width: 10, height: 10 })));
    expect(mdls).not.toHaveBeenCalled();
  });

  it('reads Spotlight\'s answers by name, since mdls prints them in its own order', async () => {
    // A 1920 by 1380 picture; mdls prints height before width whatever the order asked.
    mdls.mockImplementation(spotlight({ kMDItemPixelWidth: 1920, kMDItemPixelHeight: 1380 }));
    expect(await reader.info(await put('scan.tiff', Buffer.from('II*\0 not a header Opal reads')))).toMatchObject({ kind: 'image', width: 1920, height: 1380 });
    mdls.mockImplementation(spotlight({ kMDItemNumberOfPages: 15 }));
    const pdf = await reader.info(await put('scan.pdf', Buffer.from('%PDF garbage')));
    expect(pdf).toMatchObject({ pages: 15 });
    expect(pdf.duration).toBeUndefined();
    mdls.mockImplementation(spotlight({ kMDItemDurationSeconds: 42, kMDItemPixelWidth: 640, kMDItemPixelHeight: 360 }));
    const video = await reader.info(await put('old.avi', Buffer.from('RIFF not read')));
    expect(video).toMatchObject({ duration: 42, width: 640, height: 360 });
    expect(video.pages).toBeUndefined();
  });

  it('counts the page tree\'s root inside an object stream when the inner Pages nodes are plain objects', () => {
    const stream = deflateSync(Buffer.from('2 0 <</Count 9/Kids[5 0 R 6 0 R]/Type/Pages>>'));
    const pdf = Buffer.concat([
      Buffer.from(`%PDF-1.7\n1 0 obj\n<</Filter/FlateDecode/First 4/Length ${stream.length}/N 1/Type/ObjStm>>stream\n`), stream,
      Buffer.from('\nendstream\nendobj\n5 0 obj\n<</Count 4/Kids[7 0 R]/Parent 2 0 R/Type/Pages>>\nendobj\n6 0 obj\n<</Count 5/Kids[8 0 R]/Parent 2 0 R/Type/Pages>>\nendobj\n'),
    ]);
    expect(pdfHeaders(pdf)).toEqual({ pages: 9 });
  });

  it('reads a large movie\'s headers at once, without waiting behind thumbnails in the queue', async () => {
    const queue = jobQueue(3);
    const busy = Array.from({ length: 6 }, () => queue.run(() => new Promise((resolve) => setTimeout(resolve, 300)), { visible: true, timeoutMs: 1000 }));
    const file = await put('long.mov', movie({ seconds: 4, width: 1920, height: 1080 }));
    await truncate(file, 9 * 1024 * 1024);
    const started = Date.now();
    expect(await new FileInfoReader({ limiter: queue, run: mdls }).info(file)).toMatchObject({ duration: 4, width: 1920, height: 1080 });
    expect(Date.now() - started).toBeLessThan(150);
    await Promise.all(busy);
  });
});

/** Answers as /usr/bin/mdls does: one `name = value` line per name, in its own (alphabetical) order, not the order asked. */
function spotlight(values: Record<string, number>): RunFile {
  return async (_file, args) => {
    const names = args.filter((_, index) => args[index - 1] === '-name').sort();
    const shown = names.map((name) => [name, name in values ? String(values[name]) : '(null)']);
    if (args.includes('-raw')) return { stdout: shown.map(([, value]) => value).join('\0'), stderr: '' };
    const width = Math.max(...names.map((name) => name.length));
    return { stdout: shown.map(([name, value]) => `${name.padEnd(width)} = ${value}\n`).join(''), stderr: '' };
  };
}
