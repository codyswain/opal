import { stat } from 'fs/promises';
import path from 'path';
import { classifyFile, type FileKind } from '@/common/fileKind';
import { readMetadata } from '@/main/fs/MetadataCodec';
import { isInsideRoot, normalizePath } from '@/main/fs/paths';
import type { RootRegistry } from '@/main/fs/RootRegistry';
import { listChildren, scanRootsFor, walkRoot } from '@/main/fs/rootTraversal';

export interface IndexedItem {
  path: string;
  name: string;
  kind: FileKind;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
  /** The metadata UUID, so a replaced file does not inherit the old one's activity; null when unreadable. */
  id: string | null;
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

/**
 * Disposable summaries of every item under the opened roots. Built on the
 * first collection query, never on browsing; kept current by targeted
 * re-summaries of the directories the watcher reports. Nothing here is
 * authored truth and nothing is persisted.
 */
export class CollectionIndex {
  private items = new Map<string, IndexedItem>();
  private scanWarnings = new Map<string, string>();
  private rootKey: string | null = null;
  private queue: Promise<void> = Promise.resolve();
  private pending = new Set<string>();
  private updateTimer: NodeJS.Timeout | null = null;

  constructor(private deps: CollectionIndexDependencies) {}

  async get(): Promise<IndexSnapshot> {
    const rootKey = JSON.stringify(this.deps.registry.list().sort());
    if (rootKey !== this.rootKey) {
      this.rootKey = rootKey;
      this.enqueue(() => this.rebuild());
    } else if (this.pending.size > 0) {
      this.flushPending();
    }
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
    if (this.updateTimer) { clearTimeout(this.updateTimer); this.updateTimer = null; }
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
      await walkRoot(this.deps.registry, root, {
        onDirectory: async (directory) => { items.set(directory, await this.summarize(directory, true)); },
        onFile: async (file) => { items.set(file, await this.summarize(file, false)); },
        onError: (target, error) => { warnings.set(normalizePath(target), describe(target, error)); },
      });
    }
    this.items = items;
    this.scanWarnings = warnings;
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
    const keep = new Set<string>([directory]);
    this.items.set(directory, await this.summarize(directory, true));
    for (const file of children.files) {
      keep.add(file);
      this.items.set(file, await this.summarize(file, false));
    }
    for (const child of children.directories) {
      keep.add(child);
      if (this.items.has(child)) continue;
      await walkRoot(this.deps.registry, child, {
        onDirectory: async (nested) => { this.items.set(nested, await this.summarize(nested, true)); },
        onFile: async (nested) => { this.items.set(nested, await this.summarize(nested, false)); },
        onError: (target, error) => { this.scanWarnings.set(normalizePath(target), describe(target, error)); },
      });
    }
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

  private async summarize(target: string, isDirectory: boolean): Promise<IndexedItem> {
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
    let id: string | null = null;
    try {
      id = (await readMetadata(this.deps.registry, target)).id;
    } catch {
      // Unreadable metadata only means the identity check is skipped.
    }
    return { path: target, name, kind: isDirectory ? 'directory' : classifyFile(name), isDirectory, size, mtimeMs, id };
  }
}

function describe(target: string, error: unknown): string {
  return `${target}: ${error instanceof Error ? error.message : String(error)}`;
}
