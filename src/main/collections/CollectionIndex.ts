import { stat } from 'fs/promises';
import path from 'path';
import { classifyFile, type FileKind } from '@/common/fileKind';
import { readMetadata } from '@/main/fs/MetadataCodec';
import { isInsideRoot, normalizePath } from '@/main/fs/paths';
import type { RootRegistry } from '@/main/fs/RootRegistry';
import { listChildren, listTree, scanRootsFor, type DirectoryChildren } from '@/main/fs/rootTraversal';
import { mapLimited } from '@/main/mapLimited';

export interface IndexedItem {
  path: string;
  name: string;
  kind: FileKind;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
  /** The metadata UUID, so a replaced file does not inherit the old one's activity; null when unreadable or not read yet. */
  id: string | null;
  /** The frontmatter `title`, which the file search also matches; null when absent, unreadable or not read yet. */
  title: string | null;
}

export interface IndexSnapshot {
  items: readonly IndexedItem[];
  /** Directories that could not be scanned; results built from this snapshot are partial. */
  warnings: string[];
}

export interface CollectionIndexDependencies {
  registry: RootRegistry;
  updateDebounceMs?: number;
}

const STAT_CONCURRENCY = 32;
// Lower than the stats: each read opens a file, and it runs while the window loads.
const METADATA_CONCURRENCY = 16;

/**
 * Disposable summaries of every item under the opened roots. Warmed once the
 * window shows, or built by the first collection query. A build lists and
 * stats every item, which is all a name search needs, and a query waits only
 * for that; each item's metadata (identity and title) is read afterwards in
 * the background. Kept current by targeted re-summaries of the directories
 * the watcher reports. Nothing here is authored truth and nothing is
 * persisted.
 */
export class CollectionIndex {
  private items = new Map<string, IndexedItem>();
  private scanWarnings = new Map<string, string>();
  private rootKey: string | null = null;
  private queue: Promise<void> = Promise.resolve();
  private pending = new Set<string>();
  private updateTimer: NodeJS.Timeout | null = null;
  /** Items whose metadata is still to be read. */
  private unread = new Set<string>();
  private reading = false;

  constructor(private deps: CollectionIndexDependencies) {}

  /** Starts the build without waiting for it, so the first search does not pay for it. */
  warm(): void {
    this.schedule();
  }

  async get(): Promise<IndexSnapshot> {
    this.schedule();
    await this.queue;
    return this.snapshot();
  }

  /** Watcher directories: re-summarize their children; coalesced and serialized. */
  invalidateDirectories(directories: readonly string[]): void {
    if (this.rootKey === null) return; // Never indexed: nothing to keep current.
    for (const directory of directories) this.pending.add(normalizePath(directory));
    if (this.updateTimer) return;
    this.updateTimer = setTimeout(() => this.flushPending(), this.deps.updateDebounceMs ?? 100);
  }

  invalidateAll(): void {
    this.rootKey = null;
    this.pending.clear();
    this.unread.clear();
    if (this.updateTimer) { clearTimeout(this.updateTimer); this.updateTimer = null; }
  }

  private schedule(): void {
    const rootKey = JSON.stringify(this.deps.registry.list().sort());
    if (rootKey !== this.rootKey) {
      this.rootKey = rootKey;
      this.enqueue(() => this.rebuild());
    } else if (this.pending.size > 0) {
      this.flushPending();
    }
  }

  private snapshot(): IndexSnapshot {
    return { items: [...this.items.values()], warnings: [...this.scanWarnings.values()] };
  }

  private enqueue(operation: () => Promise<void>): void {
    this.queue = this.queue.then(operation, operation);
  }

  private flushPending(): void {
    if (this.updateTimer) { clearTimeout(this.updateTimer); this.updateTimer = null; }
    const directories = [...this.pending];
    this.pending.clear();
    if (directories.length === 0) return;
    this.enqueue(async () => {
      for (const directory of directories) await this.refreshDirectory(directory);
    });
  }

  private async rebuild(): Promise<void> {
    const items = new Map<string, IndexedItem>();
    const warnings = new Map<string, string>();
    for (const root of scanRootsFor(this.deps.registry.list())) {
      const tree = await listTree(this.deps.registry, root, (target, error) => {
        warnings.set(normalizePath(target), describe(target, error));
      });
      for (const item of await summarizeAll(tree)) items.set(item.path, item);
    }
    this.items = items;
    this.scanWarnings = warnings;
    this.readMetadataLater(items.keys());
  }

  private async refreshDirectory(directory: string): Promise<void> {
    if (!this.isVisible(directory)) return;
    let children;
    try {
      children = await listChildren(this.deps.registry, directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as Error).name === 'PathNotAllowedError') {
        this.removeSubtree(directory);
        this.scanWarnings.delete(directory);
      } else {
        this.scanWarnings.set(directory, describe(directory, error));
      }
      return;
    }
    this.scanWarnings.delete(directory);
    const keep = new Set<string>([directory, ...children.files, ...children.directories]);
    let directories = [directory];
    let files = children.files;
    for (const child of children.directories) {
      if (this.items.has(child)) continue;
      const tree = await listTree(this.deps.registry, child, (target, error) => {
        this.scanWarnings.set(normalizePath(target), describe(target, error));
      });
      directories = directories.concat(tree.directories);
      files = files.concat(tree.files);
    }
    const summaries = await summarizeAll({ directories, files });
    for (const item of summaries) {
      // The last identity and title stand until the metadata is read again.
      const known = this.items.get(item.path);
      this.items.set(item.path, known ? { ...item, id: known.id, title: known.title } : item);
    }
    this.readMetadataLater(summaries.map((item) => item.path));
    // Vanished children include directories that never indexed because they
    // could not be read; their warnings must go with them.
    for (const candidate of [...this.items.keys(), ...this.scanWarnings.keys()]) {
      if (path.dirname(candidate) === directory && !keep.has(candidate)) this.removeSubtree(candidate);
    }
  }

  private removeSubtree(target: string): void {
    for (const candidate of [...this.items.keys()]) {
      if (isInsideRoot(target, candidate)) this.items.delete(candidate);
    }
    for (const candidate of [...this.scanWarnings.keys()]) {
      if (isInsideRoot(target, candidate)) this.scanWarnings.delete(candidate);
    }
  }

  private isVisible(target: string): boolean {
    return this.deps.registry.list().some((root) =>
      isInsideRoot(root, target) &&
      !path.relative(root, target).split(path.sep).some((segment) => segment.startsWith('.')));
  }

  private readMetadataLater(targets: Iterable<string>): void {
    for (const target of targets) this.unread.add(target);
    if (!this.reading) void this.readUnread();
  }

  private async readUnread(): Promise<void> {
    this.reading = true;
    try {
      while (this.unread.size > 0) {
        const batch = [...this.unread];
        this.unread.clear();
        await mapLimited(batch, METADATA_CONCURRENCY, async (target) => {
          const item = this.items.get(target);
          if (!item) return;
          const metadata = await this.readItemMetadata(target);
          // A refresh or rebuild that replaced the item meanwhile has queued the new one.
          if (this.items.get(target) === item) this.items.set(target, { ...item, ...metadata });
        });
      }
    } finally {
      this.reading = false;
    }
  }

  private async readItemMetadata(target: string): Promise<Pick<IndexedItem, 'id' | 'title'>> {
    try {
      const state = await readMetadata(this.deps.registry, target);
      const title = state.document.get('title');
      return { id: state.id, title: typeof title === 'string' && title.trim() ? title.trim() : null };
    } catch {
      // Unreadable metadata only means the identity check is skipped and no title is matched.
      return { id: null, title: null };
    }
  }
}

function summarizeAll(tree: DirectoryChildren): Promise<IndexedItem[]> {
  const targets = [
    ...tree.directories.map((target) => ({ target, isDirectory: true })),
    ...tree.files.map((target) => ({ target, isDirectory: false })),
  ];
  return mapLimited(targets, STAT_CONCURRENCY, ({ target, isDirectory }) => summarize(target, isDirectory));
}

async function summarize(target: string, isDirectory: boolean): Promise<IndexedItem> {
  const name = path.basename(target);
  let size = 0;
  let mtimeMs = 0;
  try {
    const info = await stat(target);
    size = isDirectory ? 0 : info.size;
    mtimeMs = info.mtimeMs;
  } catch {
    // A vanished item is dropped by the next directory refresh; keep a stub until then.
  }
  return { path: target, name, kind: isDirectory ? 'directory' : classifyFile(name), isDirectory, size, mtimeMs, id: null, title: null };
}

function describe(target: string, error: unknown): string {
  return `${target}: ${error instanceof Error ? error.message : String(error)}`;
}
