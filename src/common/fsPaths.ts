/**
 * Renderer-safe lexical path helpers.
 *
 * Disk IPC returns absolute, POSIX-separated paths. These helpers also accept
 * Windows separators so persisted navigation state can be validated without
 * importing Node's `path` module into the renderer.
 */
export function normalizeFsPath(input: string): string {
  if (input.length === 0) return '';

  const value = input.replace(/\\/g, '/');
  const driveMatch = /^([a-zA-Z]):\//.exec(value);
  const drive = driveMatch?.[1]?.toUpperCase() ?? null;
  const isAbsolute = value.startsWith('/') || drive !== null;
  const prefixLength = drive ? 3 : value.startsWith('/') ? 1 : 0;
  const segments = value.slice(prefixLength).split('/');
  const normalized: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (normalized.length > 0 && normalized[normalized.length - 1] !== '..') {
        normalized.pop();
      } else if (!isAbsolute) {
        normalized.push(segment);
      }
      continue;
    }
    normalized.push(segment);
  }

  if (drive) {
    return normalized.length > 0
      ? `${drive}:/${normalized.join('/')}`
      : `${drive}:/`;
  }
  if (isAbsolute) {
    return normalized.length > 0 ? `/${normalized.join('/')}` : '/';
  }
  return normalized.length > 0 ? normalized.join('/') : '.';
}

export function isAbsoluteFsPath(input: string): boolean {
  const normalized = normalizeFsPath(input);
  return normalized.startsWith('/') || /^[A-Z]:\//.test(normalized);
}

/** True when `target` is `root` or belongs to its subtree. */
export function isFsPathAtOrBelow(root: string, target: string): boolean {
  const normalizedRoot = normalizeFsPath(root);
  const normalizedTarget = normalizeFsPath(target);
  if (!normalizedRoot || !normalizedTarget) return false;
  if (normalizedRoot === normalizedTarget) return true;

  const prefix =
    normalizedRoot === '/' || /^[A-Z]:\/$/.test(normalizedRoot)
      ? normalizedRoot
      : `${normalizedRoot}/`;
  return normalizedTarget.startsWith(prefix);
}

export function parentFsPath(input: string): string | null {
  const normalized = normalizeFsPath(input);
  if (
    !normalized ||
    normalized === '/' ||
    /^[A-Z]:\/$/.test(normalized)
  ) {
    return null;
  }

  const separator = normalized.lastIndexOf('/');
  if (separator < 0) return null;
  if (separator === 0) return '/';
  if (separator === 2 && /^[A-Z]:\//.test(normalized)) {
    return normalized.slice(0, 3);
  }
  return normalized.slice(0, separator);
}

export function basenameFsPath(input: string): string {
  const normalized = normalizeFsPath(input);
  if (normalized === '/' || /^[A-Z]:\/$/.test(normalized)) return normalized;
  const separator = normalized.lastIndexOf('/');
  return separator >= 0 ? normalized.slice(separator + 1) : normalized;
}

/**
 * Applies an exact old-prefix to new-prefix subtree mapping.
 * Unrelated paths are normalized but otherwise unchanged.
 */
export function remapFsPath(
  input: string,
  oldPrefix: string,
  newPrefix: string
): string {
  const path = normalizeFsPath(input);
  const oldPath = normalizeFsPath(oldPrefix);
  const newPath = normalizeFsPath(newPrefix);
  if (!isFsPathAtOrBelow(oldPath, path)) return path;
  if (path === oldPath) return newPath;

  const suffix = path.slice(
    oldPath === '/' || /^[A-Z]:\/$/.test(oldPath)
      ? oldPath.length
      : oldPath.length + 1
  );
  const separator =
    newPath === '/' || /^[A-Z]:\/$/.test(newPath) ? '' : '/';
  return normalizeFsPath(`${newPath}${separator}${suffix}`);
}
