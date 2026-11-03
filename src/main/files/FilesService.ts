import { constants, rmSync } from 'fs';
import { chmod, copyFile, lstat, readdir, realpath, stat } from 'fs/promises';
import os from 'os';
import path from 'path';
import type { WebContents } from 'electron';
import { extensionOf, storedExtension, withoutHash } from '@/common/fileKind';
import { jobQueue, type JobQueue } from '@/main/mapLimited';
import { isInsideRoot } from '@/main/fs/paths';
import { PathNotAllowedError, type RootRegistry } from '@/main/fs/RootRegistry';
import type { FileInfo, FileStatus, ImportedFile, OpenResult, Rendition } from '@/types/files';
import { FilesError, type FileStore, type ImportSource, type RunFile, type StoreDependencies } from './FileStore';
import { linkInPlace, shortcutUrl } from './importRules';
import { FileInfoReader } from './fileInfo';
import { readFilesSettings } from './filesSettings';
import { FolderStore } from './FolderStore';
import { GitLfsStore } from './GitLfsStore';
import { materialize, sweepCopies, COPY_MAX_AGE_MS } from './materialize';
import { openable, openFile } from './openable';
import { Renditions } from './renditions';
import { DiskCache, Thumbnails, type ThumbnailProvider } from './thumbnails';

/** What the service asks of macOS. electronPlatform.ts gives the real one; tests pass fakes. */
export interface FilesPlatform {
  /** Resolves to '' on success, or to a message. */
  openPath: (file: string) => Promise<string>;
  showItemInFolder: (file: string) => void;
  /** The name of the app that opens this file, or null. */
  appName: (file: string) => Promise<string | null>;
  quickLook: (file: string, name: string) => void;
  thumbnail: ThumbnailProvider;
  /** Puts the file itself on the pasteboard. */
  copyFileToClipboard: (file: string) => void;
  /** Asks where to save `name`; null when cancelled. */
  saveDialog: (name: string) => Promise<string | null>;
  startDrag: (sender: WebContents, file: string) => Promise<void>;
}

export interface FilesServiceDependencies extends Omit<StoreDependencies, 'root' | 'folder'> {
  registry: RootRegistry;
  platform?: FilesPlatform;
  /** Opal's app data. Read-only copies and the picture cache live under it, never in the vault. */
  appData?: string;
  /** One queue for Quick Look, sips and mdls: three at a time. */
  limiter?: JobQueue;
  /** Runs git for import's check-ignore and check-attr; the real one by default. */
  git?: RunFile;
}

/** Thumbnails, display copies and mdls share this many places. */
export const JOBS_AT_ONCE = 3;

/**
 * Finds the store for a path from its opened folder's `.opal/files.json`,
 * read again on every call so a pull's change applies at once, and answers
 * what the page asks about the files it shows: their info, a thumbnail, a
 * display copy, and opening, copying or saving them. Every path that comes
 * in goes through RootRegistry first.
 */
export class FilesService {
  private limiter: JobQueue;
  private reader: FileInfoReader;
  private thumbnails: Thumbnails;
  private renditions: Renditions;
  readonly copiesDir: string;

  constructor(private deps: FilesServiceDependencies) {
    const appData = deps.appData ?? path.join(os.tmpdir(), 'opal-files');
    this.copiesDir = path.join(appData, 'open-copies');
    this.limiter = deps.limiter ?? jobQueue(JOBS_AT_ONCE);
    this.reader = new FileInfoReader({ limiter: this.limiter, run: deps.run });
    const cache = new DiskCache(path.join(appData, 'file-pictures'));
    const real = async (file: string) => (await materialize(file, this.copiesDir))?.path ?? null;
    this.thumbnails = new Thumbnails({ cache, limiter: this.limiter, provider: (file, px) => this.platform.thumbnail(file, px), materialize: real });
    this.renditions = new Renditions({ cache, limiter: this.limiter, materialize: real, run: deps.run });
  }

  private get platform(): FilesPlatform {
    if (!this.deps.platform) throw new FilesError('Opening files is not available here.');
    return this.deps.platform;
  }

  /** Removes read-only copies older than a day, as at launch. */
  cleanup(): Promise<void> {
    return sweepCopies(this.copiesDir, COPY_MAX_AGE_MS);
  }

  /** Removes every read-only copy at once, for quit, which does not wait for promises. */
  removeCopies(): void {
    rmSync(this.copiesDir, { recursive: true, force: true });
  }

  /**
   * Adds a file for the vault that holds `page`: a file already in the vault
   * is linked where it is (unless git ignores it), a `.webloc` or `.url`
   * becomes its address, and anything else is copied into the files folder.
   */
  async import(page: string, source: ImportSource): Promise<ImportedFile> {
    const { root, store } = await this.storeFor(await this.deps.registry.assertAllowed(page));
    if ('path' in source) {
      const name = path.basename(source.path);
      if ((await stat(source.path).catch(() => null))?.isDirectory()) throw new FilesError("Folders can't be added yet.");
      const extension = extensionOf(name);
      if (extension === 'webloc' || extension === 'url') {
        return { path: '', vaultPath: '', name: name.slice(0, -extension.length - 1), url: await shortcutUrl(source.path, this.deps.run) };
      }
      const linked = await linkInPlace(root, source.path, this.deps.git);
      if (linked) return { ...linked, name };
    }
    const vaultPath = await store.import(source);
    return {
      path: path.join(root, ...vaultPath.split('/')),
      vaultPath,
      name: 'path' in source ? path.basename(source.path) : source.name,
    };
  }

  async status(target: string): Promise<FileStatus> {
    const resolved = await this.deps.registry.assertAllowed(target);
    return (await this.storeFor(resolved)).store.status(resolved);
  }

  async fetch(target: string): Promise<FileStatus> {
    const resolved = await this.deps.registry.assertAllowed(target);
    return (await this.storeFor(resolved)).store.fetch(resolved);
  }

  /** Size, kind, where the bytes are, and pages, duration or pixels from the headers. A gone file answers `missing`. */
  async info(target: string): Promise<FileInfo> {
    return this.reader.info(await this.locate(target));
  }

  /** A data: URL of the file's picture no larger than `px`, or null for a type without one. */
  async thumbnail(target: string, px: number, options: { visible?: boolean } = {}): Promise<string | null> {
    return this.thumbnails.thumbnail(await this.info(target), px, options);
  }

  /** A JPEG copy of a HEIC or TIFF, or a smaller copy of a picture more than twice `width`; null when the file shows as it is. */
  async rendition(target: string, width?: number, options: { visible?: boolean } = {}): Promise<Rendition | null> {
    return this.renditions.rendition(await this.info(target), width, options);
  }

  /** Opens the file in its app, by the rules in openable.ts. */
  async open(target: string, options: { confirmed?: boolean } = {}): Promise<OpenResult> {
    const { resolved, inside } = await this.anywhere(target);
    const { openPath, showItemInFolder, appName } = this.platform;
    return openFile(resolved, { inside, confirmed: options.confirmed }, { copiesDir: this.copiesDir, openPath, showItemInFolder, appName });
  }

  /** The app Open would use, for the bar's "Open in Keynote". */
  async appName(target: string): Promise<string | null> {
    const { resolved } = await this.anywhere(target);
    return this.platform.appName(resolved).catch(() => null);
  }

  /** Shows the file in the Quick Look panel, by the same rules as Open. */
  async quickLook(target: string, options: { confirmed?: boolean } = {}): Promise<OpenResult> {
    const { resolved, inside } = await this.anywhere(target);
    const check = await openable(resolved, { inside });
    if (check.action === 'reveal') {
      this.platform.showItemInFolder(resolved);
      return { action: 'revealed', reason: check.reason };
    }
    if (check.action === 'confirm' && !options.confirmed) return { action: 'confirm', app: null };
    const real = await this.real(resolved);
    this.platform.quickLook(real, withoutHash(path.basename(resolved)));
    return { action: 'opened', app: null };
  }

  /** Puts the file itself on the pasteboard, from its real bytes, so Slack, Gmail and Finder attach it. */
  async copyFile(target: string): Promise<void> {
    this.platform.copyFileToClipboard(await this.real(await this.deps.registry.assertAllowed(target)));
  }

  /** Saves a copy where the person picks, named `name` or the stored name without its hash. The vault file is untouched. */
  async saveCopy(target: string, name?: string): Promise<{ saved: string | null }> {
    const resolved = await this.deps.registry.assertAllowed(target);
    const source = await this.real(resolved);
    const fallback = withoutHash(path.basename(resolved));
    const given = name ? path.basename(name.replace(/[\\/:\0]/g, '-')).trim() : '';
    const extension = storedExtension(fallback);
    const suggested = given ? (extension && !given.toLowerCase().endsWith(`.${extension}`) ? `${given}.${extension}` : given) : fallback;
    const destination = await this.platform.saveDialog(suggested);
    if (!destination) return { saved: null };
    // Saving over the vault file itself would copy it onto itself; it is already there.
    if (path.resolve(destination) === resolved || path.resolve(destination) === source) return { saved: destination };
    await copyFile(source, destination, constants.COPYFILE_FICLONE);
    await chmod(destination, 0o644);
    return { saved: destination };
  }

  /** Starts a drag of the file itself out of the window, to Finder, Slack or Gmail. */
  async startDrag(sender: WebContents, target: string): Promise<void> {
    const file = await this.real(await this.deps.registry.assertAllowed(target));
    await this.platform.startDrag(sender, file);
  }

  /**
   * For a stored file that is gone, the file in the same files folder with
   * the same hash in its name, which is where it went when it was moved or
   * renamed. Null when the file is there, has no hash, or has no twin.
   */
  async findMoved(target: string): Promise<string | null> {
    const resolved = await this.locate(target);
    if (await lstat(resolved).catch(() => null)) return null;
    const name = path.basename(resolved);
    const extension = storedExtension(name);
    const hash = /\.([0-9a-f]{8})$/.exec(extension ? name.slice(0, -extension.length - 1) : name)?.[1];
    if (!hash) return null;
    const root = this.rootOf(resolved);
    const { folder } = await readFilesSettings(root);
    const top = path.join(root, ...folder.split('/'));
    const found: string[] = [];
    const walk = async (directory: string, depth: number) => {
      for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory() && depth < 4) await walk(full, depth + 1);
        else if (entry.isFile() && entry.name.includes(`.${hash}.`) && storedExtension(entry.name) === extension) found.push(full);
      }
    };
    await walk(top, 0);
    return found.find((file) => path.basename(file) === name) ?? found.sort()[0] ?? null;
  }

  /** The real bytes' path: the file, or a read-only copy of its LFS object. */
  private async real(resolved: string): Promise<string> {
    const real = await materialize(resolved, this.copiesDir);
    if (!real) throw new FilesError(`"${withoutHash(path.basename(resolved))}" is not on this Mac yet. Download it first.`);
    return real.path;
  }

  /**
   * A path inside the opened folders, resolved, or one that is not there
   * yet below a folder that is. A link that leads out of them is refused,
   * since it exists.
   */
  private async locate(target: string): Promise<string> {
    try {
      return await this.deps.registry.assertAllowed(target);
    } catch (error) {
      if (!(error instanceof PathNotAllowedError)) throw error;
      const absolute = path.resolve(target);
      for (let directory = path.dirname(absolute); ; directory = path.dirname(directory)) {
        const real = await this.deps.registry.assertAllowed(directory).catch(() => null);
        if (real) {
          const missing = path.join(real, path.relative(directory, absolute));
          if (await lstat(missing).catch(() => null)) throw error;
          return missing;
        }
        if (path.dirname(directory) === directory) throw error;
      }
    }
  }

  /** A file inside the opened folders, or anywhere else on this Mac for Open and Quick Look, which ask first. */
  private async anywhere(target: string): Promise<{ resolved: string; inside: boolean }> {
    try {
      return { resolved: await this.deps.registry.assertAllowed(target), inside: true };
    } catch (error) {
      if (!(error instanceof PathNotAllowedError)) throw error;
      const resolved = await realpath(target).catch(() => null);
      if (!resolved) throw new FilesError(`Could not find "${path.basename(target)}".`);
      return { resolved, inside: false };
    }
  }

  /**
   * The outermost opened folder that holds `resolved`, since a vault keeps
   * its settings at its top even when one of its folders is opened too.
   */
  private rootOf(resolved: string): string {
    return this.deps.registry.list().filter((candidate) => isInsideRoot(candidate, resolved)).sort((a, b) => a.length - b.length)[0];
  }

  /** The store the root's settings name. */
  private async storeFor(resolved: string): Promise<{ root: string; store: FileStore }> {
    const root = this.rootOf(resolved);
    const { folder, store } = await readFilesSettings(root);
    const Store = store === 'git-lfs' ? GitLfsStore : FolderStore;
    return { root, store: new Store({ ...this.deps, root, folder }) };
  }
}
