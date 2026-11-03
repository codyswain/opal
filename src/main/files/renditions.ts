import { mkdtemp, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { extensionOf } from '@/common/fileKind';
import { imageSize } from '@/common/imageSize';
import type { JobQueue } from '@/main/mapLimited';
import type { FileInfo, Rendition } from '@/types/files';
import { runFile, type RunFile } from './FileStore';
import { SIPS } from './FolderStore';
import { DiskCache } from './thumbnails';

export { SIPS };
const RENDITION_TIMEOUT_MS = 20_000;
/** Formats Chromium can't draw; they show through a JPEG copy. */
const CONVERTED = new Set(['heic', 'heif', 'tif', 'tiff']);
/** Pictures that get a smaller display copy when they are much wider than the column. GIFs keep their frames. */
const SCALABLE = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp']);

export interface RenditionDependencies {
  cache: DiskCache;
  limiter: JobQueue;
  /** A path with the file's real bytes and name, or null when they are not here. */
  materialize: (file: string) => Promise<string | null>;
  run?: RunFile;
  timeoutMs?: number;
}

/**
 * Display copies of pictures, made with sips in a scratch folder and kept
 * in app data, never in the vault: HEIC and TIFF as JPEG, and a picture
 * more than twice as wide as `width` scaled to twice it, so a 5K
 * screenshot is not decoded at full size for a 700-pixel column. PNG stays
 * PNG so text in screenshots stays sharp. Null when the original shows as
 * it is, or when sips fails or times out (not tried again until the file
 * changes).
 */
export class Renditions {
  private failed = new Set<string>();

  constructor(private deps: RenditionDependencies) {}

  async rendition(info: FileInfo, width?: number, options: { visible?: boolean } = {}): Promise<Rendition | null> {
    const extension = extensionOf(info.name);
    const convert = CONVERTED.has(extension);
    const target = width && width > 0 ? Math.round(width * 2) : null;
    const shrink = SCALABLE.has(extension) && target !== null && (info.width ?? 0) > target;
    if (!convert && !shrink) return null;
    if (info.status === 'missing' || info.status === 'lfs-missing') return null;

    const png = extension === 'png' && !convert;
    // Only ever smaller: a picture narrower than the target keeps its width.
    const scaleTo = target !== null && (info.width ?? 0) > target ? target : null;
    const key = DiskCache.keyFor(info, `rendition-${scaleTo ?? 'full'}`);
    if (this.failed.has(key)) return null;
    let bytes = await this.deps.cache.get(key);
    if (!bytes) {
      bytes = await this.deps.limiter.run(() => this.make(info, scaleTo, png), {
        visible: options.visible,
        timeoutMs: this.deps.timeoutMs ?? RENDITION_TIMEOUT_MS,
        label: `Display copy of ${info.name}`,
      }).catch(() => null);
      if (!bytes) {
        this.failed.add(key);
        return null;
      }
      await this.deps.cache.set(key, bytes).catch(() => undefined);
    }
    const size = imageSize(bytes);
    if (!size) return null;
    return { url: `data:${png ? 'image/png' : 'image/jpeg'};base64,${bytes.toString('base64')}`, width: size.width, height: size.height };
  }

  private async make(info: FileInfo, scaleTo: number | null, png: boolean): Promise<Buffer | null> {
    const source = await this.deps.materialize(info.path);
    if (!source) return null;
    const run = this.deps.run ?? runFile;
    const scratch = await mkdtemp(path.join(os.tmpdir(), 'opal-rendition-'));
    try {
      const out = path.join(scratch, png ? 'copy.png' : 'copy.jpg');
      const args = ['-s', 'format', png ? 'png' : 'jpeg', ...(png ? [] : ['-s', 'formatOptions', '85'])];
      if (scaleTo) args.push('--resampleWidth', String(scaleTo));
      await run(SIPS, [...args, source, '--out', out], { timeout: this.deps.timeoutMs ?? RENDITION_TIMEOUT_MS });
      return await readFile(out);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}
