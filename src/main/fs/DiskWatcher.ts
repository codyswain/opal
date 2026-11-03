import { watch, type FSWatcher } from 'chokidar';
import path from 'path';
import logger from '@/main/logger';

export interface DiskWatcherDependencies {
  onChanged: (directories: string[]) => void;
  debounceMs?: number;
  /** Invalidate the disposable metadata catalog for any observed item change. */
  onMetadataChanged?: () => void;
}

const DEFAULT_DEBOUNCE_MS = 150;

/**
 * Watches opened roots and reports which *directories* changed.
 *
 * Directory granularity is deliberate: the renderer caches one listing per
 * directory, so that is the unit it can act on, and it collapses a thousand-file
 * operation into a single message. Per-file events would be both noisier and
 * less useful.
 */
export class DiskWatcher {
  private deps: DiskWatcherDependencies;
  private watchers = new Map<string, FSWatcher>();
  private pending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(deps: DiskWatcherDependencies) {
    this.deps = deps;
  }

  async watch(rootPath: string): Promise<void> {
    if (this.watchers.has(rootPath)) return;

    const watcher = watch(rootPath, {
      ignoreInitial: true,
      // Wait for writes to settle so large copies report once instead of
      // spamming the renderer with intermediate change events.
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      ignored: (candidate: string) => {
        const relative = path.relative(rootPath, candidate);
        if (!relative || relative.startsWith(`..${path.sep}`)) return false;
        return relative.split(path.sep).some((segment, index, segments) =>
          segment.startsWith('.') && !(segment === '.opal.yaml' && index === segments.length - 1));
      },
      followSymlinks: false,
      depth: 99,
    });

    for (const event of ['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const) {
      watcher.on(event, (changedPath: string) => {
        this.deps.onMetadataChanged?.();
        this.enqueue(path.dirname(changedPath));
      });
    }

    watcher.on('error', (error) => {
      const details = error instanceof Error ? error.message : String(error);
      logger.error(`Watcher error on ${rootPath}: ${details}`, error instanceof Error ? error : undefined);
    });

    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        watcher.off('error', onStartupError);
        resolve();
      };
      const onStartupError = (error: Error) => {
        watcher.off('ready', onReady);
        reject(error);
      };

      watcher.once('ready', onReady);
      watcher.once('error', onStartupError);
    });

    this.watchers.set(rootPath, watcher);
  }

  async unwatch(rootPath: string): Promise<void> {
    const watcher = this.watchers.get(rootPath);
    if (!watcher) return;
    await watcher.close();
    this.watchers.delete(rootPath);
  }

  async closeAll(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await Promise.all([...this.watchers.values()].map((watcher) => watcher.close()));
    this.watchers.clear();
  }

  watchedRoots(): string[] {
    return [...this.watchers.keys()];
  }

  private enqueue(directory: string): void {
    this.pending.add(directory);
    if (this.timer) return;

    this.timer = setTimeout(() => {
      const directories = [...this.pending];
      this.pending.clear();
      this.timer = null;
      if (directories.length > 0) this.deps.onChanged(directories);
    }, this.deps.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  }
}
