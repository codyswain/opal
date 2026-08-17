import { readFile, writeFile, mkdir, realpath, stat } from 'fs/promises';
import path from 'path';
import { normalizePath, isInsideRoot } from '@/main/fs/paths';

export class PathNotAllowedError extends Error {
  constructor(target: string) {
    super(`Path is not inside any folder you have opened: ${target}`);
    this.name = 'PathNotAllowedError';
  }
}

export interface RootRegistryDependencies {
  /** Absolute path to the JSON file holding the root list. */
  storePath: string;
}

interface RootStoreFile {
  version: 1;
  roots: string[];
}

/**
 * The security boundary for all filesystem access.
 *
 * Opal may only read inside folders the user explicitly opened. Without this,
 * a compromised renderer could read any file the user can read, since both the
 * IPC surface and the opal-file:// protocol take arbitrary paths.
 *
 * Every check resolves symlinks first (fs.realpath), because a symlink inside
 * an allowed root can otherwise point anywhere on the disk.
 */
export class RootRegistry {
  private deps: RootRegistryDependencies;
  private roots: string[] = [];

  constructor(deps: RootRegistryDependencies) {
    this.deps = deps;
  }

  async load(): Promise<void> {
    let parsed: RootStoreFile | null = null;

    try {
      const raw = await readFile(this.deps.storePath, 'utf-8');
      parsed = JSON.parse(raw) as RootStoreFile;
    } catch {
      // Missing or corrupt store: start empty rather than fail to boot. Losing
      // the recent-folders list is a cosmetic problem; refusing to start is not.
      this.roots = [];
      return;
    }

    const candidates = Array.isArray(parsed?.roots) ? parsed.roots : [];

    // Drop roots that have since been deleted or unmounted, so a stale entry
    // never sits in the allow-list pointing at a path that could be recreated
    // by something else.
    const surviving: string[] = [];
    for (const candidate of candidates) {
      try {
        const real = normalizePath(await realpath(candidate));
        const info = await stat(real);
        if (info.isDirectory()) surviving.push(real);
      } catch {
        // Gone. Skip it.
      }
    }

    this.roots = [...new Set(surviving)];
  }

  list(): string[] {
    return [...this.roots];
  }

  async add(rootPath: string): Promise<string> {
    const real = normalizePath(await realpath(rootPath));
    const info = await stat(real);
    if (!info.isDirectory()) {
      throw new Error(`Cannot open as a folder because it is not a directory: ${rootPath}`);
    }

    if (!this.roots.includes(real)) {
      this.roots.push(real);
      await this.persist();
    }

    return real;
  }

  async remove(rootPath: string): Promise<void> {
    const normalized = normalizePath(rootPath);
    const next = this.roots.filter((root) => root !== normalized);
    if (next.length !== this.roots.length) {
      this.roots = next;
      await this.persist();
    }
  }

  /**
   * Resolves `target` and confirms it lives inside a registered root.
   * Returns the resolved real path — callers should use that, not the input,
   * so downstream I/O cannot be redirected by a symlink swapped in later.
   */
  async assertAllowed(target: string): Promise<string> {
    let real: string;
    try {
      real = normalizePath(await realpath(target));
    } catch {
      throw new PathNotAllowedError(target);
    }

    const allowed = this.roots.some((root) => isInsideRoot(root, real));
    if (!allowed) throw new PathNotAllowedError(target);

    return real;
  }

  private async persist(): Promise<void> {
    const payload: RootStoreFile = { version: 1, roots: this.roots };
    await mkdir(path.dirname(this.deps.storePath), { recursive: true });
    await writeFile(this.deps.storePath, JSON.stringify(payload, null, 2), 'utf-8');
  }
}
