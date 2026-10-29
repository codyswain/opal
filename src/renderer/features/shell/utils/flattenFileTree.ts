import { fileTreeLabel } from '@/common/fileKind';
import { basenameFsPath } from '@/common/fsPaths';
import { isTreeExpanded } from '@/renderer/features/disk-explorer/store/treeExpansion';
import type { DiskEntry, FileKind } from '@/types/disk';

export interface FileTreeNode {
  path: string;
  name: string;
  /** What the row shows. Markdown files drop `.md`, as in Obsidian. */
  label: string;
  kind: FileKind;
  isDirectory: boolean;
  /** True for a root row, which only exists when several folders are open. */
  isRoot: boolean;
  depth: number;
  /** The row this one sits under; null at the top level. */
  parentPath: string | null;
  isExpanded: boolean;
  positionInSet: number;
  setSize: number;
}

export interface FileTreeSource {
  roots: readonly string[];
  listings: Readonly<Record<string, readonly DiskEntry[] | undefined>>;
  expanded: Readonly<Record<string, boolean | undefined>>;
}

type PendingNode = Omit<FileTreeNode, 'label' | 'isExpanded'>;

type TreeItem = Pick<DiskEntry, 'path' | 'name' | 'kind' | 'isDirectory'>;

/**
 * Produces the visible tree in one pass, in the listing order main already
 * sorted (folders first, then files). The iterative walk avoids call-stack
 * growth for deeply nested folders and gives react-window a stable flat model.
 */
export function flattenFileTree({
  expanded,
  listings,
  roots,
}: FileTreeSource): FileTreeNode[] {
  const visible: FileTreeNode[] = [];
  const visited = new Set<string>();
  const pending: PendingNode[] = [];

  const push = (
    items: readonly TreeItem[],
    parentPath: string | null,
    depth: number,
    isRoot: boolean
  ) => {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const { path, name, kind, isDirectory } = items[index];
      pending.push({
        path,
        name,
        kind,
        isDirectory,
        isRoot,
        depth,
        parentPath,
        positionInSet: index + 1,
        setSize: items.length,
      });
    }
  };

  // A lone root is not a row: its children are the top level.
  if (roots.length === 1) {
    visited.add(roots[0]);
    push(listings[roots[0]] ?? [], null, 0, false);
  } else {
    push(
      roots.map((path) => ({
        path,
        name: basenameFsPath(path),
        kind: 'directory' as const,
        isDirectory: true,
      })),
      null,
      0,
      true
    );
  }

  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || visited.has(node.path)) continue;
    visited.add(node.path);

    const isExpanded =
      node.isDirectory && isTreeExpanded(roots, expanded, node.path);
    visible.push({
      ...node,
      label: fileTreeLabel(node.name, node.kind),
      isExpanded,
    });

    const children = isExpanded ? listings[node.path] : undefined;
    if (children) push(children, node.path, node.depth + 1, false);
  }

  return visible;
}
