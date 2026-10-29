import { classifyFile, fileTreeLabel } from '@/common/fileKind';
import { basenameFsPath, isFsPathAtOrBelow, parentFsPath } from '@/common/fsPaths';
import { dailyHeadDate } from '@/common/stackModel';
import { localDate } from '@/common/vaultModel';
import { locationPath, type FilesLocation } from '../navigation/filesLocation';

export interface TabLabel {
  /** The page name: the file's name, Markdown without `.md`, or Recent. */
  name: string;
  /** The parent folders that tell same-name tabs apart, or null. */
  hint: string | null;
  /** The vault-relative path, for the tooltip. */
  title: string;
}

/**
 * `Library/people/Alec.md` for a path under the lone root. With several roots
 * the path starts with its root's name, since that is what tells them apart.
 */
export function vaultRelativePath(path: string, roots: readonly string[]): string {
  const root = [...roots]
    .sort((left, right) => right.length - left.length)
    .find((candidate) => isFsPathAtOrBelow(candidate, path));
  if (!root) return path;
  const inside = path === root ? '' : path.slice(root === '/' ? 1 : root.length + 1);
  if (roots.length === 1 && inside) return inside;
  return [basenameFsPath(root), inside].filter(Boolean).join('/');
}

/** The folder a row names beside a file; files at the top of a lone vault have none. */
export function vaultFolder(path: string, roots: readonly string[]): string {
  const parent = parentFsPath(path);
  if (!parent || (roots.length === 1 && parent === roots[0])) return '';
  return vaultRelativePath(parent, roots);
}

/**
 * A tab's name. Today's stream of daily pages is "Today" while its head is
 * today's page; any other stack goes by its head's name, as the head opened
 * alone does.
 */
export function locationName(location: FilesLocation, today = localDate()): string {
  const path = locationPath(location);
  if (!path) return 'Recent';
  if (location.mode === 'stack' && location.kind === 'daily' && dailyHeadDate(path) === today) return 'Today';
  const name = basenameFsPath(path);
  return fileTreeLabel(name, classifyFile(name));
}

/** The folders above a path, nearest first. */
function foldersAbove(path: string): string[] {
  const folders: string[] = [];
  for (let folder = parentFsPath(path); folder && folder !== '/'; folder = parentFsPath(folder)) {
    folders.push(basenameFsPath(folder));
  }
  return folders;
}

/** As few parent folders as it takes to tell `path` apart from each rival. */
function distinguishingFolders(path: string, rivals: readonly string[]): string {
  const mine = foldersAbove(path);
  const theirs = rivals.map(foldersAbove);
  for (let depth = 1; depth <= mine.length; depth += 1) {
    const suffix = mine.slice(0, depth).join('/');
    if (theirs.every((folders) => folders.slice(0, depth).join('/') !== suffix)) {
      return mine.slice(0, depth).reverse().join('/');
    }
  }
  return [...mine].reverse().join('/');
}

/**
 * Labels for the row of tabs. Tabs whose names collide show their parent
 * folder, or as many folders as it takes to tell them apart, as VS Code does.
 */
export function tabLabels(
  locations: readonly FilesLocation[],
  roots: readonly string[]
): TabLabel[] {
  const names = locations.map((location) => locationName(location));
  const paths = locations.map(locationPath);
  return locations.map((_, index) => {
    const name = names[index];
    const path = paths[index];
    if (!path) return { name, hint: null, title: name };
    const rivals = paths.filter(
      (other, at): other is string =>
        other !== null && other !== path && names[at] === name
    );
    return {
      name,
      hint: rivals.length > 0 ? distinguishingFolders(path, rivals) : null,
      title: vaultRelativePath(path, roots),
    };
  });
}
