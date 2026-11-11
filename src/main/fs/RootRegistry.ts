import { readFile, writeFile, mkdir, realpath, stat } from 'fs/promises';
import path from 'path';
import { normalizePath, isInsideRoot } from '@/main/fs/paths';
import { HiddenPathError } from '@/main/fs/HiddenFiles';

export { HiddenPathError };

export class PathNotAllowedError extends Error {
  constructor(target: string) {
    super(`Path is not inside any folder you have opened: ${target}`);
    this.name = 'PathNotAllowedError';
  }
}

/** The part of HiddenFiles the boundary asks (see HiddenFiles). */
export interface HiddenRule {
  ready(): Promise<void>;
  /** Whether a canonical path must be left out or refused now. */
  blocks(real: string): boolean;
  /** Whether a canonical path is hidden, shown or not. */
  isHidden(real: string): boolean;
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
  private hidden: HiddenRule | null = null;

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

  /** Hidden files: from now on the boundary refuses them while they are not shown. */
  setHidden(rule: HiddenRule | null): void {
    this.hidden = rule;
  }

  /**
   * Resolves `target` and confirms it lives inside a registered root and is
   * not hidden. Returns the resolved real path — callers should use that, not
   * the input, so downstream I/O cannot be redirected by a symlink swapped in
   * later. A hidden path throws HiddenPathError while hidden files are not
   * shown, so every reader refuses it unless it asked for `seeingHidden()`.
   */
  async assertAllowed(target: string): Promise<string> {
    const real = await this.resolveInside(target);
    if (this.hidden) {
      await this.hidden.ready();
      if (this.hidden.blocks(real)) throw new HiddenPathError();
    }
    return real;
  }

  /**
   * Waits for the hidden lists and answers, for a canonical path, whether it
   * must be left out of a listing now. Lets a listing filter its children
   * with one check each.
   */
  async blocked(): Promise<(real: string) => boolean> {
    const rule = this.hidden;
    if (!rule) return () => false;
    await rule.ready();
    return (real) => rule.blocks(real);
  }

  /** Whether a canonical path is hidden, shown or not, once the lists are read. */
  async hiddenRule(): Promise<(real: string) => boolean> {
    const rule = this.hidden;
    if (!rule) return () => false;
    await rule.ready();
    return (real) => rule.isHidden(real);
  }

  /**
   * The same boundary without the hidden check, for the few readers that
   * must see everything and filter what they hand out themselves: the link
   * and file-name indexes, a save of text already typed into a page, and
   * links from other apps. Never used to add or remove roots.
   */
  seeingHidden(): RootRegistry {
    const view = Object.create(this) as RootRegistry;
    view.assertAllowed = (target: string) => this.resolveInside(target);
    view.blocked = async () => () => false;
    return view;
  }

  private async resolveInside(target: string): Promise<string> {
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
