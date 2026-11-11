import { readdir } from 'fs/promises';
import path from 'path';
import { isInsideRoot } from './paths';
import { assertNoSymlinks, isValidAdjacentCarrier } from './MetadataCodec';
import type { RootRegistry } from './RootRegistry';
import { mapLimited } from '@/main/mapLimited';

const LIST_CONCURRENCY = 16;

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

/**
 * One level of children under the shared rules. Throws when the directory
 * cannot be read. Hidden files are left out while they are not shown, unless
 * the registry is `seeingHidden()`.
 */
export async function listChildren(registry: RootRegistry, directory: string): Promise<DirectoryChildren> {
  const real = await assertNoSymlinks(registry, directory);
  const blocked = await registry.blocked();
  const children: DirectoryChildren = { directories: [], files: [] };
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    if (blocked(path.join(real, entry.name))) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) children.directories.push(target);
    else if (entry.isFile() && !(await isValidAdjacentCarrier(registry, target))) children.files.push(target);
  }
  return children;
}

/**
 * Every directory and file under a directory, the directory included, under
 * the same rules as walkRoot. The directories of one level are listed in
 * parallel, so the order is not walkRoot's.
 */
export async function listTree(
  registry: RootRegistry,
  directory: string,
  onError: TraversalVisitor['onError'],
): Promise<DirectoryChildren> {
  const tree: DirectoryChildren = { directories: [], files: [] };
  let level = [directory];
  while (level.length > 0) {
    const listed = await mapLimited(level, LIST_CONCURRENCY, async (current) => {
      try {
        return { current, children: await listChildren(registry, current) };
      } catch (error) {
        onError(current, error);
        return null;
      }
    });
    level = [];
    for (const entry of listed) {
      if (!entry) continue;
      tree.directories.push(entry.current);
      // A loop, not a spread: a folder of many thousand files would overflow the argument list.
      for (const file of entry.children.files) tree.files.push(file);
      for (const child of entry.children.directories) level.push(child);
    }
  }
  return tree;
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
