import { createHash, randomUUID } from 'crypto';
import { lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { extensionOf, storedExtension } from '@/common/fileKind';
import { gitBusy } from '@/main/fs/gitActivity';
import { filesystemMutationQueue } from '@/main/fs/MutationQueue';
import { isInsideRoot } from '@/main/fs/paths';
import { inVault } from '@/main/vault/vaultPaths';
import { FILE_IMPORT_LIMIT, fileTooLarge, type FileStatus } from '@/types/files';
import { FilesError, runFile, type FileStore, type ImportSource, type StoreDependencies } from './FileStore';
import { readPlaceholder } from './lfsPlaceholder';

/** Formats Opal's renderer cannot show; they are stored as JPEG. */
const TO_JPEG = new Set(['heic', 'heif', 'tif', 'tiff']);
/** Photos whose long edge is over this are scaled down to it. */
export const LONG_EDGE_LIMIT = 2400;
/**
 * Photos only. A PNG is kept as it is: a pasted screenshot has no original
 * anywhere else, and scaling blurs its text.
 */
const SCALED = new Set(['jpg', 'jpeg', ...TO_JPEG]);
export const SIPS = '/usr/bin/sips';
const SIPS_TIMEOUT_MS = 60_000;
/** How often a write held for git looks again, and how long it waits at most. */
const GIT_RETRY_MS = 250;
const GIT_WAIT_LIMIT_MS = 30_000;

/** A stem stays within 80 UTF-16 units and 200 bytes, cut between characters, so the whole name fits APFS's 255 bytes. */
const STEM_UNITS = 80;
const STEM_BYTES = 200;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * A name's stem as stored: lowercase letters, marks and digits from any
 * script, in NFC, joined by single hyphens. `Rapport été` (as macOS may
 * hand it, decomposed) becomes `rapport-été`; `日本語.pdf` keeps its letters.
 */
export function fileStem(name: string): string {
  const extension = storedExtension(name);
  const stem = (extension ? name.slice(0, -extension.length - 1) : name)
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+/, '');
  let kept = '';
  for (const { segment } of graphemes.segment(stem)) {
    const next = kept + segment;
    if (next.length > STEM_UNITS || Buffer.byteLength(next) > STEM_BYTES) break;
    kept = next;
  }
  return kept.replace(/-+$/, '') || 'file';
}

/**
 * `<stem>.<hash>.<ext>`, where the hash is the first 8 hex digits of the
 * bytes' SHA-256. The bytes are the ones given, before any conversion, so
 * the same file dropped again finds its copy before sips runs. Compound
 * extensions stay whole: `logs.a1b2c3d4.jsonl.gz`.
 */
export function storedName(name: string, bytes: Uint8Array): string {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  const extension = storedExtension(name).replace(/[^a-z0-9.]/g, '');
  const stored = TO_JPEG.has(extension) ? 'jpg' : extension;
  return `${fileStem(name)}.${hash}${stored ? `.${stored}` : ''}`;
}

const GIT_BUSY = 'Git is changing files in this folder. Try again in a moment.';

/** Waits while git rewrites the repo, so a file never lands in a tree git is resetting. */
export async function untilGitIdle(file: string): Promise<void> {
  for (const started = Date.now(); await gitBusy(file); ) {
    if (Date.now() - started > GIT_WAIT_LIMIT_MS) throw new FilesError(GIT_BUSY);
    await new Promise((resolve) => setTimeout(resolve, GIT_RETRY_MS));
  }
}

const isFile = async (file: string) => (await lstat(file).catch(() => null))?.isFile() ?? false;

/** Whether a stored file holds bytes with this SHA-256, itself or through its Git LFS placeholder. */
async function sameBytes(file: string, digest: string, size: number): Promise<boolean> {
  const info = await stat(file);
  if (info.size < 1024) {
    const placeholder = await readPlaceholder(file).catch(() => null);
    if (placeholder) return placeholder.oid === digest;
  }
  if (info.size !== size) return false;
  return createHash('sha256').update(await readFile(file)).digest('hex') === digest;
}
const MONTH = /^\d{4}-\d{2}$/;

/** Imported files as plain files in a folder of the opened folder. Git, if any, carries them like any file. */
export class FolderStore implements FileStore {
  constructor(protected readonly deps: StoreDependencies) {}

  protected get run() {
    return this.deps.run ?? runFile;
  }

  private get folder(): string {
    return path.join(this.deps.root, ...this.deps.folder.split('/'));
  }

  async import(source: ImportSource): Promise<string> {
    const { root, links, queue = filesystemMutationQueue, now = () => new Date() } = this.deps;
    // A file already in the folder is linked where it is, not copied under a second name.
    if ('path' in source) {
      const real = await realpath(source.path).catch(() => source.path);
      if (isInsideRoot(this.folder, real) && (await isFile(real))) return this.vaultPath(real);
    }
    const { name, bytes } = await this.read(source);
    const filename = storedName(name, bytes);
    const copy = await this.copyOf(filename, bytes);
    if (copy) return this.vaultPath(copy);
    const date = now();
    const directory = path.join(this.folder, `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
    const file = path.join(directory, filename);
    const prepared = await this.prepare(name, bytes);
    // The wait is outside the write queue, so saves and other writes go on meanwhile.
    await untilGitIdle(file);
    await queue.run(async () => {
      await inVault(root, directory, true);
      await mkdir(directory, { recursive: true });
      await inVault(root, directory);
      await inVault(root, file, true);
      const temporary = path.join(directory, `.opal-edit-${randomUUID()}`);
      try {
        const handle = await open(temporary, 'wx', 0o644);
        try { await handle.writeFile(prepared); await handle.sync(); } finally { await handle.close(); }
        if (await gitBusy(file)) throw new FilesError(GIT_BUSY);
        // Sync never commits half a file: it appears whole, under its own name.
        await rename(temporary, file);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    });
    // The link index lists the new file, and any new month folder, before the embed asks for it.
    const listed = [root];
    for (let folder = directory; folder !== root && isInsideRoot(root, folder); folder = path.dirname(folder)) listed.push(folder);
    links.invalidateDirectories(listed);
    return this.vaultPath(file);
  }

  async status(target: string): Promise<FileStatus> {
    return (await isFile(target)) ? 'here' : 'missing';
  }

  /** A plain folder holds every file it lists. */
  fetch(target: string): Promise<FileStatus> {
    return this.status(target);
  }

  /**
   * The stored copy of these bytes in any month, so the same file dropped
   * again, under any name, is stored once. The same name and hash is the
   * same file. Under another name, a file with the same hash counts when its
   * bytes, or its LFS placeholder's object id, match in full; a photo that
   * was converted or scaled can't be compared, so its hash and type decide.
   */
  private async copyOf(filename: string, bytes: Buffer): Promise<string | null> {
    const months = (await readdir(this.folder).catch(() => [] as string[])).filter((entry) => MONTH.test(entry)).sort();
    for (const month of months) {
      const file = path.join(this.folder, month, filename);
      if (await isFile(file)) return file;
    }
    const [, hash, extension = ''] = /^.*?\.([0-9a-f]{8})(?:\.(.+))?$/.exec(filename) ?? [];
    if (!hash) return null;
    const suffix = `.${hash}${extension ? `.${extension}` : ''}`;
    const changed = SCALED.has(extensionOf(filename));
    const digest = createHash('sha256').update(bytes).digest('hex');
    for (const month of months) {
      for (const entry of await readdir(path.join(this.folder, month)).catch(() => [] as string[])) {
        if (!entry.endsWith(suffix) || entry.startsWith('.')) continue;
        const file = path.join(this.folder, month, entry);
        if (!(await isFile(file))) continue;
        if (changed || (await sameBytes(file, digest, bytes.length))) return file;
      }
    }
    return null;
  }

  private vaultPath(file: string): string {
    return path.relative(this.deps.root, file).split(path.sep).join('/');
  }

  private async read(source: ImportSource): Promise<{ name: string; bytes: Buffer }> {
    if ('bytes' in source) {
      if (source.bytes.byteLength > FILE_IMPORT_LIMIT) throw new FilesError(fileTooLarge(source.name));
      return { name: source.name, bytes: Buffer.from(source.bytes.buffer, source.bytes.byteOffset, source.bytes.byteLength) };
    }
    const name = path.basename(source.path);
    const info = await stat(source.path).catch(() => null);
    if (!info?.isFile()) throw new FilesError(`"${name}" is not a file Opal can add.`);
    if (info.size > FILE_IMPORT_LIMIT) throw new FilesError(fileTooLarge(name));
    const bytes = await readFile(source.path);
    // A file still being written can pass the check above.
    if (bytes.length > FILE_IMPORT_LIMIT) throw new FilesError(fileTooLarge(name));
    return { name, bytes };
  }

  /**
   * The bytes to store: HEIC, HEIF and TIFF as JPEG, which the renderer can
   * show, and photos no longer than LONG_EDGE_LIMIT on their long edge. Both
   * use macOS's sips, in a scratch folder outside the vault, so the write
   * queue never waits on it.
   */
  private async prepare(name: string, bytes: Buffer): Promise<Buffer> {
    const extension = extensionOf(name);
    if (!SCALED.has(extension)) return bytes;
    const scratch = await mkdtemp(path.join(os.tmpdir(), 'opal-import-'));
    try {
      let file = path.join(scratch, `source.${extension}`);
      await writeFile(file, bytes);
      if (TO_JPEG.has(extension)) {
        const jpeg = path.join(scratch, 'converted.jpg');
        await this.sips(name, ['-s', 'format', 'jpeg', file, '--out', jpeg]);
        file = jpeg;
      }
      const { stdout } = await this.sips(name, ['-g', 'pixelWidth', '-g', 'pixelHeight', file]);
      const edge = (key: string) => Number(new RegExp(`${key}: *(\\d+)`).exec(stdout)?.[1] ?? 0);
      if (Math.max(edge('pixelWidth'), edge('pixelHeight')) > LONG_EDGE_LIMIT) {
        await this.sips(name, ['-Z', String(LONG_EDGE_LIMIT), file]);
      }
      return await readFile(file);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }

  private async sips(name: string, args: string[]): Promise<{ stdout: string }> {
    try {
      return await this.run(SIPS, args, { timeout: SIPS_TIMEOUT_MS });
    } catch {
      throw new FilesError(`Opal could not read "${name}" as an image.`);
    }
  }
}
