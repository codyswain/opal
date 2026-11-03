/**
 * Whether the sidebar tree shows a folder's children. A lone root has no row,
 * so it is always open; with several roots each one is open until collapsed.
 * Every other folder is closed until expanded.
 */
export function isTreeExpanded(
  roots: readonly string[],
  expanded: Readonly<Record<string, boolean | undefined>>,
  path: string
): boolean {
  if (roots.includes(path)) return roots.length === 1 || expanded[path] !== false;
  return expanded[path] === true;
}

/**
 * Whether Collapse all folders has anything to close: a folder below the
 * roots, or with several roots an open root.
 */
export function canCollapseTree(
  roots: readonly string[],
  expanded: Readonly<Record<string, boolean | undefined>>
): boolean {
  if (roots.length > 1 && roots.some((root) => expanded[root] !== false)) return true;
  return Object.entries(expanded).some(([path, open]) => open === true && !roots.includes(path));
}

/** The expansion with every folder closed. A lone root has no row and stays open. */
export function collapsedTree(roots: readonly string[]): Record<string, boolean> {
  return roots.length > 1 ? Object.fromEntries(roots.map((root) => [root, false])) : {};
}
