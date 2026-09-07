import {
  mkdir,
  mkdtemp,
  rename as renameOnDisk,
  stat,
  lstat,
  copyFile,
  unlink,
  readdir,
  rmdir,
  readlink,
  symlink,
} from 'fs/promises';
import type { Stats } from 'fs';
import path from 'path';
import { isInsideRoot, normalizePath } from '@/main/fs/paths';
import type { RootRegistry } from '@/main/fs/RootRegistry';
import type { MetadataService } from './MetadataService';
import { MutationQueue, filesystemMutationQueue } from './MutationQueue';
import { MetadataError, readMetadata, SIDECAR_SUFFIX, assertNoSymlinks } from './MetadataCodec';
import { classifyFile } from '@/common/fileKind';

export class DestinationExistsError extends Error {
  constructor(target: string) {
    super(`Something already exists at ${target}`);
    this.name = 'DestinationExistsError';
  }
}

export class InvalidNameError extends Error {
  constructor(name: string) {
    super(`"${name}" is not a valid file name`);
    this.name = 'InvalidNameError';
  }
}

export interface FileWriterDependencies {
  registry: RootRegistry;
  metadata?: Pick<MetadataService, 'queue' | 'invalidate'>;
  queue?: MutationQueue;
  /** shell.trashItem — injected so tests never touch the real Trash. */
  trashItem: (fullPath: string) => Promise<void>;
  /** Injected in tests to force EXDEV behavior. */
  renameEntry?: (source: string, destination: string) => Promise<void>;
}

/**
 * The single point through which Opal modifies the user's filesystem.
 *
 * Every method validates against RootRegistry before touching anything, and no
 * method ever overwrites silently. Concentrating mutations here means the
 * safety properties can be audited — and tested — in one place instead of
 * being re-derived at each call site.
 */
export class FileWriter {
  private deps: FileWriterDependencies;
  private queue: MutationQueue;

  constructor(deps: FileWriterDependencies) {
    this.deps = deps;
    this.queue = deps.queue ?? deps.metadata?.queue ?? filesystemMutationQueue;
  }

  createDirectory(parentDir: string, name: string): Promise<string> {
    return this.mutate(() => this.createDirectoryInternal(parentDir, name));
  }

  rename(target: string, nextName: string): Promise<string> {
    return this.mutate(() => this.renameInternal(target, nextName));
  }

  move(target: string, destinationDir: string): Promise<string> {
    return this.mutate(() => this.moveInternal(target, destinationDir));
  }

  moveToTrash(target: string): Promise<void> {
    return this.mutate(() => this.moveToTrashInternal(target));
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    return this.queue.run(async () => {
      try { return await operation(); } finally { this.deps.metadata?.invalidate(); }
    });
  }

  private async createDirectoryInternal(parentDir: string, name: string): Promise<string> {
    assertValidName(name);
    const parent = await assertNoSymlinks(this.deps.registry, parentDir);

    const target = normalizePath(path.join(parent, name));
    await assertAbsent(target);

    await mkdir(target);
    return target;
  }

  private async renameInternal(target: string, nextName: string): Promise<string> {
    assertValidName(nextName);
    const source = await assertMutableTarget(this.deps.registry, target);

    const destination = normalizePath(path.join(path.dirname(source), nextName));
    if (destination === source) return source;

    await assertAbsent(destination, source);
    const carrier = await this.preflightMetadata(target, source, destination);
    if (carrier) await this.renamePair(source, destination, carrier);
    else await this.renameEntry(source, destination);
    return destination;
  }

  private async moveInternal(target: string, destinationDir: string): Promise<string> {
    const source = await assertMutableTarget(this.deps.registry, target);
    const parent = await assertNoSymlinks(this.deps.registry, destinationDir);

    const parentInfo = await stat(parent);
    if (!parentInfo.isDirectory()) {
      throw new Error(`Cannot move into ${destinationDir} because it is not a directory`);
    }

    // Moving a directory inside itself detaches the whole subtree from the
    // tree and is unrecoverable, so it is checked before anything happens.
    const sourceInfo = await stat(source);
    if (sourceInfo.isDirectory() && isInsideRoot(source, parent)) {
      throw new Error('Cannot move a folder into itself');
    }

    const destination = normalizePath(path.join(parent, path.basename(source)));
    if (destination === source) return source;

    await assertAbsent(destination);
    const carrier = await this.preflightMetadata(target, source, destination);
    if (carrier) {
      await this.renamePair(source, destination, carrier);
      return destination;
    }

    try {
      await this.renameEntry(source, destination);
    } catch (error) {
      // EXDEV: source and destination are on different filesystems, where
      // rename cannot work. Copy fully first, and only then remove the source,
      // so a failure mid-way leaves the original intact.
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      await copyRecursive(source, destination);
      await removeRecursive(source);
    }

    return destination;
  }

  private async moveToTrashInternal(target: string): Promise<void> {
    const resolved = await assertMutableTarget(this.deps.registry, target);
    await assertNoSymlinks(this.deps.registry, target);
    const carrier = await this.carrierFor(resolved);
    if (!carrier) { await this.deps.trashItem(resolved); return; }
    const bundle = await mkdtemp(path.join(path.dirname(resolved), '.opal-trash-'));
    const stagedPrimary = path.join(bundle, path.basename(resolved));
    const stagedCarrier = path.join(bundle, path.basename(carrier));
    const staged: Array<[string, string]> = [];
    try {
      await this.renameEntry(resolved, stagedPrimary);
      staged.push([stagedPrimary, resolved]);
      await this.renameEntry(carrier, stagedCarrier);
      staged.push([stagedCarrier, carrier]);
      await this.deps.trashItem(bundle);
    } catch (error) {
      const failures: unknown[] = [];
      for (const [from, to] of staged.reverse()) {
        try { await assertAbsent(to); await this.renameEntry(from, to); } catch (rollbackError) { failures.push(rollbackError); }
      }
      try { await rmdir(bundle); } catch (cleanupError) { failures.push(cleanupError); }
      if (failures.length) throw await this.rollbackError(error, [resolved, carrier, stagedPrimary, stagedCarrier, bundle]);
      throw new MetadataError(`Trash failed; the original files were restored: ${message(error)}`);
    }
  }

  private async carrierFor(source: string): Promise<string | null> {
    const info = await lstat(source);
    if (info.isDirectory() || classifyFile(path.basename(source)) === 'markdown') return null;
    const state = await readMetadata(this.deps.registry, source);
    return state.exists ? state.carrier : null;
  }

  private async preflightMetadata(original: string, source: string, destination: string): Promise<string | null> {
    await assertNoSymlinks(this.deps.registry, original);
    const info = await lstat(source);
    if (info.isDirectory()) return null;
    const fromMarkdown = classifyFile(path.basename(source)) === 'markdown';
    const toMarkdown = classifyFile(path.basename(destination)) === 'markdown';
    if (fromMarkdown !== toMarkdown) throw new MetadataError('Changing between Markdown and another file format is not supported because it changes the metadata carrier.');
    if (fromMarkdown) return null;
    await assertAbsent(`${destination}${SIDECAR_SUFFIX}`, `${source}${SIDECAR_SUFFIX}`);
    return this.carrierFor(source);
  }

  private async renamePair(source: string, destination: string, carrier: string): Promise<void> {
    try { await this.renameEntry(source, destination); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EXDEV') throw new MetadataError('Moving a file with metadata across filesystems is not supported yet. The original pair was preserved.');
      throw error;
    }
    try { await this.renameEntry(carrier, `${destination}${SIDECAR_SUFFIX}`); } catch (error) {
      try { await assertAbsent(source, destination); await this.renameEntry(destination, source); } catch {
        throw await this.rollbackError(error, [destination, carrier, source, `${destination}${SIDECAR_SUFFIX}`]);
      }
      throw new MetadataError(`Metadata move failed; the original files were restored: ${message(error)}`);
    }
  }

  private async rollbackError(error: unknown, candidates: string[]): Promise<MetadataError> {
    const surviving: string[] = [];
    for (const candidate of candidates) {
      try { await lstat(candidate); surviving.push(candidate); } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') surviving.push(`${candidate} (could not verify)`);
      }
    }
    return new MetadataError(`Operation failed (${message(error)}) and rollback failed. Surviving paths: ${surviving.join(', ')}`);
  }

  private async renameEntry(source: string, destination: string): Promise<void> {
    const renameEntry = this.deps.renameEntry ?? renameOnDisk;
    await renameEntry(source, destination);
  }
}

/**
 * Names are validated in main, not in the UI. A renderer check is a
 * convenience for the user; this is the actual guarantee.
 */
function assertValidName(name: string): void {
  const trimmed = name.trim();
  if (
    trimmed.length === 0 ||
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('\0')
  ) {
    throw new InvalidNameError(name);
  }
}

async function assertMutableTarget(registry: RootRegistry, target: string): Promise<string> {
  const resolved = await registry.assertAllowed(target);

  // Mutating an opened root would leave the registry pointing at a path that
  // no longer exists or that now refers to a different on-disk location.
  if (registry.list().includes(resolved)) {
    throw new Error('Cannot modify an opened folder. Close it first.');
  }

  return resolved;
}

async function assertAbsent(target: string, source?: string): Promise<void> {
  let targetInfo: Stats;

  try {
    targetInfo = await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }

  if (source) {
    try {
      const sourceInfo = await lstat(source);
      if (target.toLowerCase() === source.toLowerCase() && isSameEntry(sourceInfo, targetInfo)) return;
    } catch {
      // If the destination exists but the source cannot be stated anymore, the
      // safe answer is still "destination occupied", never "destination free".
    }
  }

  throw new DestinationExistsError(target);
}

async function copyRecursive(source: string, destination: string): Promise<void> {
  const info = await lstat(source);
  if (info.isSymbolicLink()) {
    await symlink(await readlink(source), destination);
    return;
  }

  if (!info.isDirectory()) {
    await copyFile(source, destination);
    return;
  }

  await mkdir(destination);
  for (const name of await readdir(source)) {
    await copyRecursive(path.join(source, name), path.join(destination, name));
  }
}

async function removeRecursive(target: string): Promise<void> {
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    await unlink(target);
    return;
  }

  for (const name of await readdir(target)) {
    await removeRecursive(path.join(target, name));
  }

  await rmdir(target);
}

function isSameEntry(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
