import path from 'path';

/**
 * Canonical form for every path that crosses a process boundary: absolute,
 * POSIX-separated, no trailing slash except at the filesystem root, with '.'
 * and '..' segments resolved lexically.
 *
 * This does NOT resolve symlinks — that requires I/O. Callers that make a
 * security decision must call fs.realpath first (see RootRegistry).
 */
export function normalizePath(p: string): string {
  const resolved = path.posix.normalize(p.split(path.sep).join(path.posix.sep));
  if (resolved.length > 1 && resolved.endsWith('/')) {
    return resolved.slice(0, -1);
  }
  return resolved;
}

/**
 * True when `target` is `root` or lives beneath it.
 *
 * Compares segment-wise rather than by string prefix, so '/a/Photos-backup'
 * is correctly rejected against root '/a/Photos' — a plain startsWith check
 * is the classic bug here and would let a sibling directory through.
 */
export function isInsideRoot(root: string, target: string): boolean {
  const normalizedRoot = normalizePath(root);
  const normalizedTarget = normalizePath(target);

  if (normalizedTarget === normalizedRoot) return true;

  const prefix = normalizedRoot === '/' ? '/' : `${normalizedRoot}/`;
  return normalizedTarget.startsWith(prefix);
}
