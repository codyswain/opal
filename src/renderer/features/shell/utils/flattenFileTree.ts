import {
  dailyFileDate,
  dailyTreeLabel,
  dailyYearGroups,
  isDailyFolder,
} from '@/common/dailyTree';
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
  /** True for a year row in the daily pages folder, which is not a folder on disk. */
  isYearGroup: boolean;
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

type PendingNode = Omit<FileTreeNode, 'label' | 'isExpanded' | 'isYearGroup'> & {
  label?: string;
  isYearGroup?: boolean;
};

type TreeItem = Pick<DiskEntry, 'path' | 'name' | 'kind' | 'isDirectory'> & {
  label?: string;
  isYearGroup?: boolean;
};

/**
 * Produces the visible tree in one pass, in the listing order main already
 * sorted (folders first, then files). The iterative walk avoids call-stack
 * growth for deeply nested folders and gives react-window a stable flat model.
 * The daily pages folder shows its pages by year instead (see dailyTree).
 */
export function flattenFileTree({
  expanded,
  listings,
  roots,
}: FileTreeSource): FileTreeNode[] {
  const visible: FileTreeNode[] = [];
  const visited = new Set<string>();
  const pending: PendingNode[] = [];
  const yearPages = new Map<string, TreeItem[]>();

  const childrenOf = (path: string): readonly TreeItem[] | undefined => {
    const grouped = yearPages.get(path);
    if (grouped) return grouped;
    const listing = listings[path];
    if (!listing || !isDailyFolder(path, roots)) return listing;
    const { groups, rest } = dailyYearGroups(path, listing);
    for (const group of groups) {
      yearPages.set(
        group.path,
        group.pages.map((page) => ({
          ...page,
          label: dailyTreeLabel(dailyFileDate(page.name) ?? page.name),
        }))
      );
    }
    return [
      ...groups.map((group) => ({
        path: group.path,
        name: group.year,
        kind: 'directory' as const,
        isDirectory: true,
        isYearGroup: true,
      })),
      ...rest,
    ];
  };

  const push = (
    items: readonly TreeItem[],
    parentPath: string | null,
    depth: number,
    isRoot: boolean
  ) => {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const { path, name, kind, isDirectory, label, isYearGroup } = items[index];
      pending.push({
        path,
        name,
        kind,
        isDirectory,
        label,
        isYearGroup,
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
    push(childrenOf(roots[0]) ?? [], null, 0, false);
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
      label: node.label ?? fileTreeLabel(node.name, node.kind),
      isYearGroup: node.isYearGroup ?? false,
      isExpanded,
    });

    const children = isExpanded ? childrenOf(node.path) : undefined;
    if (children) push(children, node.path, node.depth + 1, false);
  }

  return visible;
}
