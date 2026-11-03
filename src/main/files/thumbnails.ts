import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { mkdir, readdir, readFile, rm, stat, utimes, writeFile } from 'fs/promises';
import path from 'path';
import { extensionOf } from '@/common/fileKind';
import { JobTimeoutError, type JobQueue } from '@/main/mapLimited';
import type { FileInfo } from '@/types/files';

/** The cache of thumbnails and display copies in app data stays under this. */
export const CACHE_LIMIT_BYTES = 500 * 1024 * 1024;
const THUMBNAIL_TIMEOUT_MS = 8000;
const UNZIP = '/usr/bin/unzip';
/** Sizes asked for are rounded up to one of these, so a card and its hover share entries. */
const BUCKETS = [64, 128, 256, 512, 1024, 2048];

/** Picture bytes and their type. */
export interface Picture {
  bytes: Buffer;
  type: 'image/png' | 'image/jpeg';
  /** A corner of the picture is see-through, as an icon's is and a page's, slide's or frame's never is. */
  clearCorner?: boolean;
}

/** Draws a thumbnail of a file on disk no larger than `px` points on its long side, at the screen's scale, or null when it can't. */
export type ThumbnailProvider = (file: string, px: number) => Promise<Picture | null>;

/** Runs a program without a shell and answers its output as bytes. */
export type RunBytes = (file: string, args: readonly string[], options: { timeout: number; maxBuffer: number }) => Promise<Buffer>;

export const runBytes: RunBytes = (file, args, options) => new Promise((resolve, reject) => {
  execFile(file, [...args], { ...options, encoding: 'buffer' }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
});

/**
 * Types with a picture of their content: Quick Look draws images, PDFs,
 * movies, Office and iWork files and 3D models; 3MF files carry Bambu's
 * plate picture. Everything else gets the page's grey icon, never a
 * generic file or app icon. HTML and SVG are left out on purpose: Quick
 * Look's renderer for them may fetch from the web.
 */
const PICTURED = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'heic', 'heif', 'tif', 'tiff',
  'pdf', 'mp4', 'm4v', 'mov', 'webm', 'mkv',
  'docx', 'pptx', 'xlsx', 'doc', 'ppt', 'xls', 'key', 'pages', 'numbers',
  'stl', 'obj', 'usdz', '3mf',
]);

/**
 * Types whose real picture is a page, slide or frame, opaque to its corners.
 * When Quick Look has no picture of such a file it answers the type's icon,
 * an app's coloured badge on a page, which the page never shows.
 */
const OPAQUE = new Set(['pdf', 'mp4', 'm4v', 'mov', 'webm', 'mkv', 'docx', 'pptx', 'xlsx', 'doc', 'ppt', 'xls', 'key', 'pages', 'numbers']);

/** Whether a corner pixel of a bitmap (four bytes a pixel, alpha last) is mostly see-through. */
export function hasClearCorner(bitmap: Buffer, width: number, height: number): boolean {
  if (width < 1 || height < 1 || bitmap.length < width * height * 4) return false;
  const alpha = (x: number, y: number) => bitmap[(y * width + x) * 4 + 3];
  return [alpha(0, 0), alpha(width - 1, 0), alpha(0, height - 1), alpha(width - 1, height - 1)].some((value) => value < 32);
}

/** A 3MF, Bambu's `.gcode.3mf` among them. */
const isThreeMf = (name: string) => extensionOf(name) === '3mf';

/** Entries keyed by a file's identity, as files under one folder in app data, oldest removed past the limit. */
export class DiskCache {
  private total: number | null = null;

  constructor(private folder: string, private limit = CACHE_LIMIT_BYTES) {}

  static keyFor(info: Pick<FileInfo, 'path' | 'size' | 'mtimeMs' | 'oid'>, variant: string): string {
    const identity = info.oid ? `oid:${info.oid}` : `${info.path}\0${info.size}\0${info.mtimeMs}`;
    return createHash('sha256').update(`${identity}\0${variant}`).digest('hex');
  }

  async get(key: string): Promise<Buffer | null> {
    const file = path.join(this.folder, key);
    const bytes = await readFile(file).catch(() => null);
    // Marks it recently used, so trimming takes older entries first.
    if (bytes) await utimes(file, new Date(), new Date()).catch(() => undefined);
    return bytes;
  }

  async set(key: string, bytes: Buffer): Promise<void> {
    await mkdir(this.folder, { recursive: true });
    if (this.total === null) this.total = await this.measure();
    await writeFile(path.join(this.folder, key), bytes);
    this.total += bytes.length;
    if (this.total > this.limit) await this.trim();
  }

  private async entries(): Promise<{ file: string; size: number; mtimeMs: number }[]> {
    const names = await readdir(this.folder).catch(() => [] as string[]);
    const found = await Promise.all(names.map(async (name) => {
      const file = path.join(this.folder, name);
      const info = await stat(file).catch(() => null);
      return info?.isFile() ? { file, size: info.size, mtimeMs: info.mtimeMs } : null;
    }));
    return found.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }

  private async measure(): Promise<number> {
    return (await this.entries()).reduce((sum, entry) => sum + entry.size, 0);
  }

  /** Removes the least recently used entries until the cache is at 90% of its limit. */
  private async trim(): Promise<void> {
    const entries = (await this.entries()).sort((a, b) => a.mtimeMs - b.mtimeMs);
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of entries) {
      if (total <= this.limit * 0.9) break;
      await rm(entry.file, { force: true });
      total -= entry.size;
    }
    this.total = total;
  }
}

export interface ThumbnailDependencies {
  cache: DiskCache;
  /** The queue thumbnails share with renditions and mdls. */
  limiter: JobQueue;
  provider: ThumbnailProvider;
  /** A path with the file's real bytes and name (a read-only copy for LFS), or null when they are not here. */
  materialize: (file: string) => Promise<string | null>;
  runBytes?: RunBytes;
  timeoutMs?: number;
}

const dataUrl = (picture: Picture) => `data:${picture.type};base64,${picture.bytes.toString('base64')}`;

/** PNG files start with this; the cache stores either type without saying which. */
const isPng = (bytes: Buffer) => bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50;

/**
 * Thumbnails for cards, from macOS through a queue of a few at a time with
 * a timeout each, visible cards first. They are cached in app data, keyed
 * by the file's path, size and modified time, or by its LFS object id, so
 * the same object anywhere in the vault is drawn once. A file that failed
 * is not tried again until it changes. A picture that arrives after its
 * timeout is still cached, for the next ask. The page gets a data: URL.
 */
export class Thumbnails {
  private failed = new Set<string>();
  private pending = new Map<string, Promise<string | null>>();
  /** Drawings that outlived their timeout and are still running. */
  private late = new Set<string>();

  constructor(private deps: ThumbnailDependencies) {}

  async thumbnail(info: FileInfo, px: number, options: { visible?: boolean } = {}): Promise<string | null> {
    if (!PICTURED.has(extensionOf(info.name)) || info.status === 'missing' || info.status === 'lfs-missing') return null;
    const size = BUCKETS.find((bucket) => bucket >= px) ?? BUCKETS[BUCKETS.length - 1];
    // "picture": entries cached as "thumbnail" may hold an icon Quick Look drew for a file it could not.
    const key = DiskCache.keyFor(info, `picture-${size}`);
    if (this.failed.has(key) || this.late.has(key)) return null;
    const cached = await this.deps.cache.get(key);
    if (cached) return dataUrl({ bytes: cached, type: isPng(cached) ? 'image/png' : 'image/jpeg' });
    const running = this.pending.get(key);
    if (running) return running;

    const keep = async (picture: Picture | null) => {
      if (!picture) {
        this.failed.add(key);
        return null;
      }
      await this.deps.cache.set(key, picture.bytes).catch(() => undefined);
      return dataUrl(picture);
    };
    let drawing: Promise<Picture | null> | undefined;
    const job = this.deps.limiter.run(() => (drawing = this.draw(info, size)), {
      visible: options.visible,
      timeoutMs: this.deps.timeoutMs ?? THUMBNAIL_TIMEOUT_MS,
      label: `Thumbnail of ${info.name}`,
    }).then(keep, (error) => {
      if (error instanceof JobTimeoutError && drawing) {
        // A cold Quick Look of a large deck can take longer; its picture is kept when it comes.
        this.late.add(key);
        void drawing.then(keep, () => this.failed.add(key)).finally(() => this.late.delete(key));
        return null;
      }
      this.failed.add(key);
      return null;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, job);
    return job;
  }

  private async draw(info: FileInfo, px: number): Promise<Picture | null> {
    const file = await this.deps.materialize(info.path);
    if (!file) return null;
    if (isThreeMf(info.name)) {
      // Bambu Studio and PrusaSlicer save a picture of the first plate inside the 3MF zip.
      const run = this.deps.runBytes ?? runBytes;
      const bytes = await run(UNZIP, ['-p', file, 'Metadata/plate_1.png'], { timeout: this.deps.timeoutMs ?? THUMBNAIL_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
      return isPng(bytes) ? { bytes, type: 'image/png' } : null;
    }
    const picture = await this.deps.provider(file, px);
    return picture?.clearCorner && OPAQUE.has(extensionOf(info.name)) ? null : picture;
  }
}
