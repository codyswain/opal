import { createHash, randomUUID } from 'crypto';
import { lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { extensionOf } from '@/common/fileKind';
import { gitBusy } from '@/main/fs/gitActivity';
import { filesystemMutationQueue } from '@/main/fs/MutationQueue';
import { isInsideRoot } from '@/main/fs/paths';
import { inVault } from '@/main/vault/vaultPaths';
import { FILE_IMPORT_LIMIT, fileTooLarge, type FileStatus } from '@/types/files';
import { FilesError, runFile, type FileStore, type ImportSource, type StoreDependencies } from './FileStore';

/** Formats Opal's renderer cannot show; they are stored as JPEG. */
const TO_JPEG = new Set(['heic', 'heif', 'tif', 'tiff']);
/** Photos whose long edge is over this are scaled down to it. */
export const LONG_EDGE_LIMIT = 2400;
const SCALED = new Set(['jpg', 'jpeg', 'png', ...TO_JPEG]);
export const SIPS = '/usr/bin/sips';
const SIPS_TIMEOUT_MS = 60_000;
/** How often a write held for git looks again, and how long it waits at most. */
const GIT_RETRY_MS = 250;
const GIT_WAIT_LIMIT_MS = 30_000;

/** A name's stem as stored: lowercase letters, digits and single hyphens. */
export function fileStem(name: string): string {
  const extension = extensionOf(name);
  const stem = extension ? name.slice(0, -extension.length - 1) : name;
  return stem
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 80)
    .replace(/^-+|-+$/g, '') || 'file';
}

/**
 * `<stem>.<hash>.<ext>`, where the hash is the first 8 hex digits of the
 * bytes' SHA-256. The bytes are the ones given, before any conversion, so
 * the same file dropped again finds its copy before sips runs.
 */
export function storedName(name: string, bytes: Uint8Array): string {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  const extension = extensionOf(name).replace(/[^a-z0-9]/g, '');
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
    const copy = await this.copyOf(filename);
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

  /** A file stored as `filename` in any month, so the same file dropped again is stored once. */
  private async copyOf(filename: string): Promise<string | null> {
    const months = await readdir(this.folder).catch(() => []);
    for (const month of months.filter((entry) => MONTH.test(entry))) {
      const file = path.join(this.folder, month, filename);
      if (await isFile(file)) return file;
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
