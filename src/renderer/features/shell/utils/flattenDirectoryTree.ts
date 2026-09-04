import { basenameFsPath } from '@/common/fsPaths';
import type { DiskEntry } from '@/types/disk';

export interface FlattenedDirectoryNode {
  path: string;
  name: string;
  depth: number;
  parentPath: string | null;
  isRoot: boolean;
  isExpanded: boolean;
  isExpandable: boolean;
  positionInSet: number;
  setSize: number;
}

export interface DirectoryTreeSource {
  roots: readonly string[];
  listings: Readonly<Record<string, readonly DiskEntry[] | undefined>>;
  expanded: Readonly<Record<string, boolean | undefined>>;
}

interface PendingNode {
  path: string;
  name: string;
  depth: number;
  parentPath: string | null;
  isRoot: boolean;
  positionInSet: number;
  setSize: number;
}

function directoryChildren(
  path: string,
  listings: DirectoryTreeSource['listings']
): readonly DiskEntry[] | undefined {
  return listings[path]?.filter((entry) => entry.isDirectory);
}

/**
 * Produces the visible tree in one pass. The iterative walk avoids call-stack
 * growth for deeply nested folders and gives react-window a stable flat model.
 */
export function flattenDirectoryTree({
  expanded,
  listings,
  roots,
}: DirectoryTreeSource): FlattenedDirectoryNode[] {
  const visible: FlattenedDirectoryNode[] = [];
  const visited = new Set<string>();
  const pending: PendingNode[] = [];

  for (let index = roots.length - 1; index >= 0; index -= 1) {
    const path = roots[index];
    pending.push({
      path,
      name: basenameFsPath(path),
      depth: 0,
      parentPath: null,
      isRoot: true,
      positionInSet: index + 1,
      setSize: roots.length,
    });
  }

  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || visited.has(node.path)) continue;
    visited.add(node.path);

    const children = directoryChildren(node.path, listings);
    const isExpanded = Boolean(expanded[node.path]);
    visible.push({
      ...node,
      isExpanded,
      isExpandable: children === undefined || children.length > 0,
    });

    if (!isExpanded || !children) continue;

    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      pending.push({
        path: child.path,
        name: child.name,
        depth: node.depth + 1,
        parentPath: node.path,
        isRoot: false,
        positionInSet: index + 1,
        setSize: children.length,
      });
    }
  }

  return visible;
}
