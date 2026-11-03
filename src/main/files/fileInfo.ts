import { constants } from 'fs';
import { open, stat } from 'fs/promises';
import path from 'path';
import { classifyFile } from '@/common/fileKind';
import type { JobQueue } from '@/main/mapLimited';
import type { FileInfo } from '@/types/files';
import { runFile, type RunFile } from './FileStore';
import { localObject, readPlaceholder } from './lfsPlaceholder';
import { readMediaHeaders, type MediaHeaders } from './mediaHeaders';

export const MDLS = '/usr/bin/mdls';
const MDLS_TIMEOUT_MS = 3000;
const CACHE_LIMIT = 2000;
const MDLS_NAMES = ['kMDItemNumberOfPages', 'kMDItemDurationSeconds', 'kMDItemPixelWidth', 'kMDItemPixelHeight'] as const;

export interface FileInfoDependencies {
  /** The queue mdls shares with thumbnails and renditions. */
  limiter: JobQueue;
  run?: RunFile;
}

/** Which fields a kind of file should have, so mdls runs only when the headers left one out. */
const WANTED: Partial<Record<FileInfo['kind'], (keyof MediaHeaders)[]>> = {
  pdf: ['pages'],
  video: ['duration', 'width', 'height'],
  audio: ['duration'],
  image: ['width', 'height'],
};

/**
 * Where a file is, what it is and how big it shows, from its headers, so
 * the page knows a preview's height before it loads. An LFS file is read
 * from its object in git's store. Answers are kept by path, size and
 * modified time, so a file read once costs nothing until it changes.
 */
export class FileInfoReader {
  private cache = new Map<string, FileInfo>();

  constructor(private deps: FileInfoDependencies) {}

  /** `resolved` has passed RootRegistry, or is a path that does not exist below an allowed folder. */
  async info(resolved: string): Promise<FileInfo> {
    const name = path.basename(resolved);
    const kind = classifyFile(name);
    const found = await stat(resolved).catch(() => null);
    if (!found) return { path: resolved, name, size: 0, mtimeMs: 0, kind, status: 'missing' };
    if (found.isDirectory()) return { path: resolved, name, size: 0, mtimeMs: found.mtimeMs, kind: 'directory', status: 'local' };

    const key = `${resolved}\0${found.size}\0${found.mtimeMs}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const placeholder = found.size < 1024 ? await readPlaceholder(resolved).catch(() => null) : null;
    let result: FileInfo;
    if (placeholder) {
      const object = await localObject(resolved, placeholder);
      result = {
        path: resolved, name, kind, size: placeholder.size, mtimeMs: found.mtimeMs, oid: placeholder.oid,
        status: object ? 'lfs-present' : 'lfs-missing',
        ...(object ? await this.headers(object, name, placeholder.size) : {}),
      };
    } else {
      result = { path: resolved, name, kind, size: found.size, mtimeMs: found.mtimeMs, status: 'local', ...(await this.headers(resolved, name, found.size)) };
      const wanted = WANTED[kind] ?? [];
      if (wanted.some((field) => result[field] === undefined)) Object.assign(result, await this.spotlight(resolved, result));
    }

    if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(key, result);
    return result;
  }

  private async headers(file: string, name: string, size: number): Promise<MediaHeaders> {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null);
    if (!handle) return {};
    try {
      return await readMediaHeaders(name, size, async (position, length) => {
        const buffer = Buffer.alloc(Math.max(0, Math.min(length, size - position)));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        return buffer.subarray(0, bytesRead);
      });
    } finally {
      await handle.close();
    }
  }

  /** What Spotlight knows, for the fields the headers left out. Nothing when mdls is slow or missing. */
  private async spotlight(file: string, known: MediaHeaders): Promise<MediaHeaders> {
    const run = this.deps.run ?? runFile;
    try {
      const { stdout } = await this.deps.limiter.run(
        () => run(MDLS, ['-raw', ...MDLS_NAMES.flatMap((name) => ['-name', name]), '--', file], { timeout: MDLS_TIMEOUT_MS }),
        { timeoutMs: MDLS_TIMEOUT_MS, label: 'mdls' },
      );
      const [pages, duration, width, height] = stdout.split('\0').map((value) => {
        const number = Number(value.trim());
        return value.trim() === '(null)' || !Number.isFinite(number) || number <= 0 ? undefined : number;
      });
      const found: MediaHeaders = {};
      if (known.pages === undefined && pages !== undefined) found.pages = Math.round(pages);
      if (known.duration === undefined && duration !== undefined) found.duration = duration;
      if (known.width === undefined && width !== undefined && height !== undefined) {
        found.width = Math.round(width);
        found.height = Math.round(height);
      }
      return found;
    } catch {
      return {};
    }
  }
}
