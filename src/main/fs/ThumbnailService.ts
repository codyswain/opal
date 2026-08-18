import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import path from 'path';
import type { RootRegistry } from '@/main/fs/RootRegistry';

/** The subset of Electron's NativeImage this service needs. */
export interface ThumbnailImage {
  toPNG: () => Buffer;
  isEmpty: () => boolean;
}

export interface ThumbnailServiceDependencies {
  registry: RootRegistry;
  cacheDir: string;
  /** nativeImage.createThumbnailFromPath — injected so tests need no Electron. */
  createThumbnail: (
    sourcePath: string,
    maxSize: { width: number; height: number }
  ) => Promise<ThumbnailImage>;
}

const THUMB_SIZE = { width: 512, height: 512 };

export class ThumbnailService {
  private deps: ThumbnailServiceDependencies;
  /**
   * Sources whose generation already failed. Without this, a folder holding a
   * corrupt file re-attempts an expensive OS call on every scroll, forever.
   */
  private failed = new Set<string>();

  constructor(deps: ThumbnailServiceDependencies) {
    this.deps = deps;
  }

  async getThumbnailPath(sourcePath: string): Promise<string> {
    const resolved = await this.deps.registry.assertAllowed(sourcePath);
    const info = await fs.stat(resolved);

    // mtime and size are part of the key, so an edited file lands on a new
    // cache entry automatically — no invalidation pass to write or to forget.
    const key = createHash('sha256')
      .update(`${resolved}:${info.mtimeMs}:${info.size}`)
      .digest('hex');

    if (this.failed.has(key)) {
      throw new Error(`Thumbnail generation already failed for ${sourcePath}`);
    }

    const cachePath = path.join(this.deps.cacheDir, `${key}.png`);
    try {
      await fs.access(cachePath);
      return cachePath;
    } catch {
      // Not cached yet — fall through and generate.
    }

    try {
      const image = await this.deps.createThumbnail(resolved, THUMB_SIZE);
      if (image.isEmpty()) {
        throw new Error('OS produced an empty thumbnail');
      }

      await fs.mkdir(this.deps.cacheDir, { recursive: true });
      const tempPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
      try {
        await fs.writeFile(tempPath, image.toPNG());
        await fs.rename(tempPath, cachePath);
      } catch (error) {
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
      }
      return cachePath;
    } catch (error) {
      this.failed.add(key);
      throw error;
    }
  }
}
