import { mkdir, rename as renameEntry, stat, copyFile, unlink, readdir, rmdir } from 'fs/promises';
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
    const source = await this.deps.registry.assertAllowed(target);

    const destination = normalizePath(path.join(path.dirname(source), nextName));
    if (destination === source) return source;

    await assertAbsent(destination);
    await renameEntry(source, destination);
    return destination;
  }

  async move(target: string, destinationDir: string): Promise<string> {
    const source = await this.deps.registry.assertAllowed(target);
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
      await renameEntry(source, destination);
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
    const resolved = await this.deps.registry.assertAllowed(target);

    // Trashing an opened root would leave Opal pointing at a folder that no
    // longer exists, and is almost never what the user meant.
    if (this.deps.registry.list().includes(resolved)) {
      throw new Error('Cannot delete an opened folder. Close it first.');
    }

    await this.deps.trashItem(resolved);
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

async function assertAbsent(target: string): Promise<void> {
  try {
    await stat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }

  throw new DestinationExistsError(target);
}

async function copyRecursive(source: string, destination: string): Promise<void> {
  const info = await stat(source);
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
  const info = await stat(target);
  if (!info.isDirectory()) {
    await unlink(target);
    return;
  }

  for (const name of await readdir(target)) {
    await removeRecursive(path.join(target, name));
  }

  await rmdir(target);
}
