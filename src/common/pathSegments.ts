export interface PathSegment {
  name: string;
  path: string;
}

function stripTrailingSlash(value: string): string {
  return value.length > 1 && value.endsWith('/') ? value.slice(0, -1) : value;
}

/**
 * The clickable trail from `root` down to `target`.
 *
 * Segments above the root are deliberately omitted: they are outside every
 * opened root, so clicking one would produce a guard rejection rather than
 * navigation. Showing a path the user cannot follow is worse than showing less.
 *
 * Pure string work - no `path` import, so the renderer can use it directly.
 */
export function segmentsWithinRoot(root: string, target: string): PathSegment[] {
  const normalizedRoot = stripTrailingSlash(root);
  const normalizedTarget = stripTrailingSlash(target);

  const isRoot = normalizedTarget === normalizedRoot;
  const prefix = normalizedRoot === '/' ? '/' : `${normalizedRoot}/`;
  if (!isRoot && !normalizedTarget.startsWith(prefix)) return [];

  const rootName = normalizedRoot === '/' ? '/' : normalizedRoot.split('/').pop() ?? normalizedRoot;
  const segments: PathSegment[] = [{ name: rootName, path: normalizedRoot }];
  if (isRoot) return segments;

  const remainder = normalizedTarget.slice(prefix.length);
  let walked = normalizedRoot === '/' ? '' : normalizedRoot;

  for (const name of remainder.split('/').filter(Boolean)) {
    walked = `${walked}/${name}`;
    segments.push({ name, path: walked });
  }

  return segments;
}
