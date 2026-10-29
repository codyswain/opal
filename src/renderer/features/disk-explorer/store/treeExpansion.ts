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
