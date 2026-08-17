import {
  mkdir,
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

  constructor(deps: FileWriterDependencies) {
    this.deps = deps;
  }

  async createDirectory(parentDir: string, name: string): Promise<string> {
    assertValidName(name);
    const parent = await this.deps.registry.assertAllowed(parentDir);

    const target = normalizePath(path.join(parent, name));
    await assertAbsent(target);

    await mkdir(target);
    return target;
  }

  async rename(target: string, nextName: string): Promise<string> {
    assertValidName(nextName);
    const source = await assertMutableTarget(this.deps.registry, target);

    const destination = normalizePath(path.join(path.dirname(source), nextName));
    if (destination === source) return source;

    await assertAbsent(destination, source);
    await this.renameEntry(source, destination);
    return destination;
  }

  async move(target: string, destinationDir: string): Promise<string> {
    const source = await assertMutableTarget(this.deps.registry, target);
    const parent = await this.deps.registry.assertAllowed(destinationDir);

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

  async moveToTrash(target: string): Promise<void> {
    const resolved = await assertMutableTarget(this.deps.registry, target);
    await this.deps.trashItem(resolved);
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
  try {
    const targetInfo = await stat(target);
    if (source) {
      const sourceInfo = await stat(source);
      if (isSameEntry(sourceInfo, targetInfo)) return;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
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
