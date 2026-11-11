import { randomUUID } from 'crypto';
import { constants } from 'fs';
import { mkdir, open, rename, unlink } from 'fs/promises';
import path from 'path';
import { HIDDEN_MESSAGE } from '@/types/hidden';
import { filesystemMutationQueue } from './MutationQueue';
import { isInsideRoot, normalizePath } from './paths';
import { inVault } from '@/main/vault/vaultPaths';

/** A read of a path that is hidden while hidden files are not shown. */
export class HiddenPathError extends Error {
  readonly hidden = true;
  constructor() {
    super(HIDDEN_MESSAGE);
    this.name = 'HiddenPathError';
  }
}

/** This Mac cannot show the prompt, so hidden files stay hidden. The message says why, in one line. */
export class CannotPromptError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'CannotPromptError';
  }
}

export const HIDDEN_FOLDER = '.opal';
export const HIDDEN_FILE = 'hidden.json';
/** The most entries one folder keeps. */
export const HIDDEN_LIMIT = 2000;
/** A hidden file larger than this is not one Opal wrote. */
const FILE_LIMIT = 256 * 1024;

interface HiddenListFile {
  version: 1;
  /** Paths from the folder's top, with forward slashes. A folder hides everything under it. */
  hidden: string[];
}

/** Folds case and Unicode form, since macOS names one file in several spellings. */
const comparable = (value: string) => value.normalize('NFC').toLowerCase();

/** A stored entry as a clean path from the folder's top, or null when it is not one. */
export function cleanEntry(entry: unknown): string | null {
  if (typeof entry !== 'string' || !entry || entry.length > 4096 || entry.includes('\0') || entry.includes('\\')) return null;
  if (path.posix.isAbsolute(entry)) return null;
  const clean = path.posix.normalize(entry).replace(/\/+$/, '');
  if (!clean || clean === '.' || clean === '..' || clean.startsWith('../')) return null;
  return clean;
}

/** The entries a file's text lists. Anything that is not a version 1 list reads as nothing hidden. */
export function parseHidden(text: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const file = parsed as Partial<HiddenListFile> | null;
  if (!file || typeof file !== 'object' || file.version !== 1 || !Array.isArray(file.hidden)) return [];
  const entries: string[] = [];
  for (const entry of file.hidden) {
    const clean = cleanEntry(entry);
    if (clean && !entries.some((known) => comparable(known) === comparable(clean))) entries.push(clean);
  }
  return entries.slice(0, HIDDEN_LIMIT);
}

/**
 * The path rule: whether `relative`, a path from a folder's top, is one of
 * `entries` or sits under one. Case and Unicode form do not matter.
 */
export function hiddenBy(entries: readonly string[], relative: string): boolean {
  const target = comparable(relative);
  return entries.some((entry) => {
    const key = comparable(entry);
    return target === key || target.startsWith(`${key}/`);
  });
}

/** `relative` with `from` (and anything under it) moved to `to`; null when it is not at or under `from`. */
function moveEntry(entry: string, from: string, to: string): string | null {
  const key = comparable(entry);
  const source = comparable(from);
  if (key === source) return to;
  if (key.startsWith(`${source}/`)) return `${to}${entry.slice(from.length)}`;
  return null;
}

export interface HiddenFilesDependencies {
  /** The opened folders, canonical. */
  roots: () => string[];
  /**
   * Asks the person to prove they are there. Touch ID in the app; stubbed in
   * tests. Resolves when they pass, rejects when the prompt fails or is
   * cancelled.
   */
  prompt: (reason: string) => Promise<void>;
  /** Whether this Mac can show the prompt now, and if not, why. */
  canPrompt: () => { ok: boolean; reason?: string };
  /**
   * Called when what is hidden or whether it shows changed. `directories` are
   * the folders whose listings now read differently.
   */
  onChanged?: (change: { shown: boolean; directories: string[] }) => void;
}

/** The reason the Touch ID prompt gives. */
export const PROMPT_REASON = 'show hidden files';

/**
 * Hidden files: each opened folder's `.opal/hidden.json`, and whether they
 * show. They are Hidden on every launch and Shown only after the prompt
 * passes, until hidden again, the Mac locks or sleeps, or Opal quits. The
 * state lives here in memory and nowhere else.
 *
 * RootRegistry asks `blocks` about every path that crosses IPC, so a view
 * cannot forget the check. This keeps files off the screen; it does not
 * protect them on disk.
 */
export class HiddenFiles {
  private lists = new Map<string, string[]>();
  private loading = new Map<string, Promise<void>>();
  private shown = false;

  constructor(private deps: HiddenFilesDependencies) {}

  isShown(): boolean {
    return this.shown;
  }

  /** Reads the list of every opened folder not read yet. */
  async ready(): Promise<void> {
    await Promise.all(this.deps.roots().map((root) => this.load(root)));
  }

  /** Whether `real`, a canonical path, is on a list. Call `ready` first. */
  isHidden(real: string): boolean {
    const target = normalizePath(real);
    for (const root of this.deps.roots()) {
      const entries = this.lists.get(root);
      if (!entries?.length || !isInsideRoot(root, target) || target === root) continue;
      if (hiddenBy(entries, path.posix.relative(root, target))) return true;
    }
    return false;
  }

  /** Whether `real` must be left out or refused now. */
  blocks(real: string): boolean {
    return !this.shown && this.isHidden(real);
  }

  /** Whether `real` is listed itself, not only through a folder above it. */
  isListed(real: string): boolean {
    const place = this.place(real);
    if (!place) return false;
    const key = comparable(place.relative);
    return (this.lists.get(place.root) ?? []).some((entry) => comparable(entry) === key);
  }

  /** Asks for Touch ID, then shows hidden files. Throws with the reason when it cannot. */
  async show(): Promise<void> {
    if (this.shown) return;
    const check = this.deps.canPrompt();
    if (!check.ok) throw new CannotPromptError(check.reason ?? 'This Mac cannot ask for Touch ID now.');
    await this.deps.prompt(PROMPT_REASON);
    this.shown = true;
    this.emit(await this.allDirectories());
  }

  /** Hides hidden files again. Needs no prompt. */
  async hide(): Promise<void> {
    if (!this.shown) return;
    this.shown = false;
    this.emit(await this.allDirectories());
  }

  /** Adds `real` to its folder's list, keeping what the file gained since it was read. */
  add(real: string): Promise<void> {
    return filesystemMutationQueue.run(async () => {
      const place = this.place(real);
      if (!place) throw new Error('Only files and folders inside an opened folder can be hidden.');
      await this.edit(place.root, (entries) =>
        hiddenBy(entries, place.relative) ? entries : [...entries, place.relative]);
    });
  }

  /** Takes `real` off its folder's list. A path hidden by a folder above it stays hidden. */
  remove(real: string): Promise<void> {
    return filesystemMutationQueue.run(async () => {
      const place = this.place(real);
      if (!place) throw new Error('Only files and folders inside an opened folder can be hidden.');
      const key = comparable(place.relative);
      const current = await this.read(place.root);
      if (!current.some((entry) => comparable(entry) === key)) {
        if (hiddenBy(current, place.relative)) throw new Error('A folder above it is hidden. Unhide that folder.');
        return;
      }
      await this.edit(place.root, (entries) => entries.filter((entry) => comparable(entry) !== key));
    });
  }

  /**
   * Follows a rename or move made in Opal. Runs inside the file writer's
   * queue, so it does not queue itself. Never throws: a failure here must
   * not undo the move.
   */
  async moved(from: string, to: string): Promise<void> {
    try {
      const source = this.place(from);
      if (!source) return;
      const destination = this.place(to);
      const current = await this.read(source.root);
      const under = (entry: string) => moveEntry(entry, source.relative, source.relative) !== null;
      if (!current.some(under)) return;
      const sameRoot = destination?.root === source.root;
      const follow = (entry: string) => (destination ? moveEntry(entry, source.relative, destination.relative) : null);
      // In the same folder an entry takes its new path; into another opened folder it goes to that folder's list.
      await this.write(source.root, current.flatMap((entry) => {
        if (!under(entry)) return [entry];
        const followed = sameRoot ? follow(entry) : null;
        return followed ? [followed] : [];
      }));
      if (destination && !sameRoot) {
        const carried = current.filter(under).map(follow).filter((entry): entry is string => entry !== null);
        const known = await this.read(destination.root);
        const added = carried.filter((entry) => !hiddenBy(known, entry));
        if (added.length > 0) await this.write(destination.root, [...known, ...added]);
      }
    } catch {
      // The list keeps the old path; the file shows until it is hidden again.
    }
  }

  /** Drops the entries at or under a path moved to the Trash in Opal. Never throws. */
  async removed(target: string): Promise<void> {
    try {
      const place = this.place(target);
      if (!place) return;
      const current = await this.read(place.root);
      const kept = current.filter((entry) => moveEntry(entry, place.relative, place.relative) === null);
      if (kept.length !== current.length) await this.write(place.root, kept);
    } catch {
      // A leftover entry names nothing and does no harm.
    }
  }

  /**
   * The disk watcher reports changed folders. A changed `.opal` folder, as
   * after a pull or a hand edit, reads its list again.
   */
  async changed(directories: readonly string[]): Promise<void> {
    for (const root of this.deps.roots()) {
      const folder = path.join(root, HIDDEN_FOLDER);
      if (!directories.some((directory) => normalizePath(directory) === folder)) continue;
      const before = this.lists.get(root) ?? [];
      this.loading.delete(root);
      this.lists.delete(root);
      await this.load(root);
      const after = this.lists.get(root) ?? [];
      if (JSON.stringify(before) !== JSON.stringify(after)) this.emit(this.directoriesOf(root, [...before, ...after]));
    }
  }

  /** Forgets folders that were closed. */
  forget(): void {
    const open = new Set(this.deps.roots());
    for (const root of [...this.lists.keys()]) if (!open.has(root)) this.lists.delete(root);
    for (const root of [...this.loading.keys()]) if (!open.has(root)) this.loading.delete(root);
  }

  /** The innermost opened folder that holds `real`, and the path below it. */
  private place(real: string): { root: string; relative: string } | null {
    const target = normalizePath(real);
    const root = this.deps.roots()
      .filter((candidate) => candidate !== target && isInsideRoot(candidate, target))
      .sort((a, b) => b.length - a.length)[0];
    if (!root) return null;
    const relative = cleanEntry(path.posix.relative(root, target));
    return relative ? { root, relative } : null;
  }

  private load(root: string): Promise<void> {
    let pending = this.loading.get(root);
    if (!pending) {
      pending = this.read(root).then((entries) => { this.lists.set(root, entries); });
      this.loading.set(root, pending);
    }
    return pending;
  }

  /** Applies `change` to the list as the file holds it now, and writes it when it changed. */
  private async edit(root: string, change: (entries: string[]) => string[]): Promise<void> {
    const current = await this.read(root);
    const next = change(current);
    if (next.length > HIDDEN_LIMIT) throw new Error('That is too many hidden files.');
    if (JSON.stringify(next) === JSON.stringify(current)) {
      this.lists.set(root, current);
      return;
    }
    await this.write(root, next);
  }

  private async read(root: string): Promise<string[]> {
    let handle;
    try {
      // inVault refuses a symlinked .opal or hidden.json; O_NOFOLLOW covers a swap since.
      const file = await inVault(root, path.join(root, HIDDEN_FOLDER, HIDDEN_FILE));
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      return [];
    }
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > FILE_LIMIT) return [];
      return parseHidden(await handle.readFile('utf8'));
    } catch {
      return [];
    } finally {
      await handle.close();
    }
  }

  /** Writes the list in one step, takes it at once, and reports the folders it changes. */
  private async write(root: string, entries: string[]): Promise<void> {
    const folder = path.join(root, HIDDEN_FOLDER);
    const file = path.join(folder, HIDDEN_FILE);
    await inVault(root, folder, true);
    await mkdir(folder, { recursive: true });
    await inVault(root, folder);
    await inVault(root, file, true);
    const temporary = path.join(folder, `.${HIDDEN_FILE}-${randomUUID()}`);
    const contents: HiddenListFile = { version: 1, hidden: entries };
    try {
      const handle = await open(temporary, 'wx', 0o644);
      try {
        await handle.writeFile(`${JSON.stringify(contents, null, 2)}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, file);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    const before = this.lists.get(root) ?? [];
    this.lists.set(root, entries);
    this.loading.set(root, Promise.resolve());
    this.emit(this.directoriesOf(root, [...before, ...entries]));
  }

  /** Each entry's folder and the entry itself, as absolute paths. */
  private directoriesOf(root: string, entries: readonly string[]): string[] {
    const found = new Set<string>([root]);
    for (const entry of entries) {
      const absolute = normalizePath(path.join(root, ...entry.split('/')));
      found.add(absolute);
      found.add(normalizePath(path.dirname(absolute)));
    }
    return [...found];
  }

  private async allDirectories(): Promise<string[]> {
    await this.ready();
    return [...new Set(this.deps.roots().flatMap((root) => this.directoriesOf(root, this.lists.get(root) ?? [])))];
  }

  private emit(directories: string[]): void {
    this.deps.onChanged?.({ shown: this.shown, directories });
  }
}
