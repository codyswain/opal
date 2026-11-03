import path from 'path';
import { isInsideRoot, normalizePath } from './paths';
import type { RootRegistry } from './RootRegistry';
import { listChildren, scanRootsFor, walkRoot } from './rootTraversal';

export interface LinkIndexDependencies {
  registry: RootRegistry;
}

/** Folds case and Unicode form, since macOS file names may be stored decomposed. */
function comparable(value: string): string {
  return value.normalize('NFC').toLowerCase();
}

/**
 * Where a wiki link target points, the way Obsidian resolves it: a path
 * relative to the linking note when it starts with "./" or "../", otherwise
 * a file whose name, or whose path suffix when the target has folders, is the
 * target, with or without ".md". Matching ignores case. Among several, the
 * one in the linking note's folder wins, then the shortest path. `keys` are
 * the files in comparable form, for callers that resolve many targets.
 */
export function resolveLinkTarget(target: string, from: string, files: readonly string[], keys = files.map(comparable)): string | null {
  const wanted = target.trim().replace(/\\/g, '/');
  if (!wanted) return null;
  const folder = path.posix.dirname(from);
  const relative = /^\.\.?\//.test(wanted);
  const name = comparable(relative ? normalizePath(path.posix.join(folder, wanted)) : `/${wanted.replace(/^\/+/, '')}`);
  const matches = files.filter((_file, index) =>
    [name, `${name}.md`].some((candidate) => (relative ? keys[index] === candidate : keys[index].endsWith(candidate))));
  matches.sort((a, b) =>
    Number(path.posix.dirname(b) === folder) - Number(path.posix.dirname(a) === folder)
    || a.length - b.length
    || a.localeCompare(b));
  return matches[0] ?? null;
}

/**
 * Every file under the opened roots, kept for resolving [[wiki links]] and
 * ![[embeds]]. Built on the first lookup; folders the watcher reports are
 * listed again before the next one, so an append to a note costs one listing.
 */
export class LinkIndex {
  /** Files directly inside each folder. */
  private folders = new Map<string, string[]>();
  /** Every file with its comparable key, rebuilt after a change. */
  private files: { paths: string[]; keys: string[] } | null = null;
  private rootKey: string | null = null;
  private stale = new Set<string>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private deps: LinkIndexDependencies) {}

  async resolve(from: string, targets: readonly string[]): Promise<Record<string, string | null>> {
    const source = await this.deps.registry.assertAllowed(from);
    await this.refresh();
    if (!this.files) {
      const paths = [...this.folders.values()].flat();
      this.files = { paths, keys: paths.map(comparable) };
    }
    const { paths, keys } = this.files;
    return Object.fromEntries(targets.map((target) => [target, resolveLinkTarget(target, source, paths, keys)]));
  }

  invalidateDirectories(directories: readonly string[]): void {
    for (const directory of directories) this.stale.add(normalizePath(directory));
  }

  invalidateAll(): void {
    this.rootKey = null;
  }

  private refresh(): Promise<void> {
    const run = this.queue.then(async () => {
      const roots = scanRootsFor(this.deps.registry.list()).sort();
      const rootKey = JSON.stringify(roots);
      if (rootKey !== this.rootKey) {
        this.folders = new Map();
        this.files = null;
        this.stale.clear();
        for (const root of roots) await this.add(root);
        this.rootKey = rootKey;
        return;
      }
      const stale = [...this.stale];
      this.stale.clear();
      for (const directory of stale) await this.relist(directory);
      if (stale.length > 0) this.files = null;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private add(directory: string): Promise<void> {
    return walkRoot(this.deps.registry, directory, {
      onDirectory: (folder) => { this.folders.set(normalizePath(folder), []); },
      onFile: (file) => { this.folders.get(normalizePath(path.dirname(file)))?.push(normalizePath(file)); },
      onError: () => undefined,
    });
  }

  /** Lists one changed folder again: new subfolders are walked, vanished ones dropped. */
  private async relist(directory: string): Promise<void> {
    if (!this.folders.has(directory)) return;
    const known = [...this.folders.keys()].filter((folder) => path.posix.dirname(folder) === directory);
    let children;
    try {
      children = await listChildren(this.deps.registry, directory);
    } catch {
      this.drop(directory);
      return;
    }
    this.folders.set(directory, children.files.map(normalizePath));
    const current = new Set(children.directories.map(normalizePath));
    for (const folder of known) if (!current.has(folder)) this.drop(folder);
    for (const folder of current) if (!this.folders.has(folder)) await this.add(folder);
  }

  private drop(directory: string): void {
    for (const folder of [...this.folders.keys()]) {
      if (isInsideRoot(directory, folder)) this.folders.delete(folder);
    }
  }
}
