import { readdir } from 'fs/promises';
import path from 'path';
import { isInsideRoot } from './paths';
import { assertNoSymlinks, isValidAdjacentCarrier } from './MetadataCodec';
import type { RootRegistry } from './RootRegistry';

/**
 * The one set of traversal rules shared by every scanner: hidden entries and
 * symlinks are skipped, valid adjacent metadata carriers are folded into their
 * primary item, and errors are reported without aborting the walk.
 */
export interface TraversalVisitor {
  onDirectory(directory: string): Promise<void> | void;
  /** Never called for a valid adjacent carrier; colliding or malformed ones stay visible. */
  onFile(file: string): Promise<void> | void;
  onError(target: string, error: unknown): void;
}

/**
 * An ancestor covers an opened root only when its ordinary traversal can reach
 * it. Hidden path components must not erase an explicitly opened root.
 */
export function scanRootsFor(roots: readonly string[]): string[] {
  return roots.filter((candidate) => !roots.some((other) =>
    other !== candidate && isInsideRoot(other, candidate) &&
    !path.relative(other, candidate).split(path.sep).some((segment) => segment.startsWith('.'))));
}

export interface DirectoryChildren {
  directories: string[];
  files: string[];
}

/** One level of children under the shared rules. Throws when the directory cannot be read. */
export async function listChildren(registry: RootRegistry, directory: string): Promise<DirectoryChildren> {
  await assertNoSymlinks(registry, directory);
  const children: DirectoryChildren = { directories: [], files: [] };
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) children.directories.push(target);
    else if (entry.isFile() && !(await isValidAdjacentCarrier(registry, target))) children.files.push(target);
  }
  return children;
}

export async function walkRoot(registry: RootRegistry, root: string, visitor: TraversalVisitor): Promise<void> {
  const walk = async (directory: string) => {
    let children: DirectoryChildren;
    try {
      children = await listChildren(registry, directory);
    } catch (error) {
      visitor.onError(directory, error);
      return;
    }
    await visitor.onDirectory(directory);
    for (const file of children.files) await visitor.onFile(file);
    for (const child of children.directories) await walk(child);
  };
  await walk(root);
}
