import type { FileTreeNode } from './flattenFileTree';

/** A folder row held at the top of the tree while the rows inside it scroll under it. */
export interface StickyFolder {
  node: FileTreeNode;
  index: number;
  /** Pixels from the top of the tree; less than the row's slot while its last row pushes it out. */
  top: number;
}

interface TreeLinks {
  /** Each row's parent row, or -1 at the top level. */
  parent: Int32Array;
  /** The last row inside each row's subtree: the row itself for a file or a closed folder. */
  last: Int32Array;
}

const linksByNodes = new WeakMap<readonly FileTreeNode[], TreeLinks>();

/** One pass over the rows, kept per nodes array so that a scroll costs O(depth). */
function treeLinks(nodes: readonly FileTreeNode[]): TreeLinks {
  const cached = linksByNodes.get(nodes);
  if (cached) return cached;
  const parent = new Int32Array(nodes.length);
  const last = new Int32Array(nodes.length);
  // The rows the current row sits inside, outermost first; open[d] is at depth d.
  const open: number[] = [];
  nodes.forEach((node, index) => {
    while (open.length > node.depth) {
      last[open[open.length - 1]] = index - 1;
      open.pop();
    }
    parent[index] = open.length > 0 ? open[open.length - 1] : -1;
    open.push(index);
  });
  for (const index of open) last[index] = nodes.length - 1;
  const links = { parent, last };
  linksByNodes.set(nodes, links);
  return links;
}

/** How many folder rows can stick: maxLevels, and no more than a third of the tree's height. */
export function maxStickyRows(
  viewportHeight: number,
  rowHeight: number,
  maxLevels: number
): number {
  return Math.max(0, Math.min(maxLevels, Math.floor(viewportHeight / 3 / rowHeight)));
}

/**
 * The folder rows to hold at the top of the tree, outermost first, picked
 * the way VS Code's sticky scroll picks them. Each one is the folder that
 * holds the row just below the folders already stuck, and whose own row has
 * scrolled under them. As a folder's last row scrolls up it pushes that
 * folder's stuck row up and out. Past the cap the innermost folders are left
 * out, as VS Code does.
 */
export function stickyFolders(
  nodes: readonly FileTreeNode[],
  scrollTop: number,
  rowHeight: number,
  viewportHeight: number,
  maxLevels: number
): StickyFolder[] {
  const maxRows = maxStickyRows(viewportHeight, rowHeight, maxLevels);
  if (scrollTop <= 0 || maxRows === 0 || nodes.length === 0) return [];
  const { parent, last } = treeLinks(nodes);
  const stuck: StickyFolder[] = [];

  while (stuck.length < maxRows) {
    const slot = stuck.length * rowHeight;
    const under = Math.floor((scrollTop + slot) / rowHeight);
    if (under >= nodes.length) break;

    // The folder of `under` that sits directly inside the last stuck folder.
    const outer = stuck.length > 0 ? stuck[stuck.length - 1].index : -1;
    let folder = under;
    while (parent[folder] !== outer) {
      folder = parent[folder];
      if (folder === -1) return stuck;
    }
    if (folder === under) {
      // The row in the slot is a folder: it sticks once it slides under the
      // stuck rows, and only when it is open with rows inside.
      if (last[folder] === folder) break;
      if (folder * rowHeight - scrollTop >= slot) break;
    }

    const lastRowBottom = (last[folder] + 1) * rowHeight - scrollTop;
    const top = Math.min(slot, lastRowBottom - rowHeight);
    stuck.push({ node: nodes[folder], index: folder, top });
    // Just below a pushed folder is the row after its last one, outside it,
    // so nothing deeper sticks.
    if (top < slot) break;
  }
  return stuck;
}

/**
 * The scroll offset that puts a row just below the stuck rows of its own
 * folders, where it shows and does not stick itself.
 */
export function offsetBelowStickyFolders(
  nodes: readonly FileTreeNode[],
  index: number,
  rowHeight: number,
  viewportHeight: number,
  maxLevels: number
): number {
  const above = Math.min(
    nodes[index]?.depth ?? 0,
    maxStickyRows(viewportHeight, rowHeight, maxLevels)
  );
  return Math.max(0, (index - above) * rowHeight);
}
