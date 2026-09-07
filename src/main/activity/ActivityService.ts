import path from 'path';
import logger from '@/main/logger';
import { readMetadata } from '@/main/fs/MetadataCodec';
import { normalizePath } from '@/main/fs/paths';
import type { RootRegistry } from '@/main/fs/RootRegistry';
import type { DiskEntry } from '@/types/disk';
import {
  RECENT_DEFAULT_LIMIT,
  RECENT_MAX_LIMIT,
  type RecentItem,
  type RecentQuery,
  type RecentResult,
} from '@/types/activity';
import type { ActivityStore } from './ActivityStore';

/** Main-side recording after successful mutations. Methods never throw. */
export interface ActivityRecorder {
  noteOrganized(target: string): Promise<void>;
  noteMoved(oldPath: string, newPath: string): Promise<void>;
  noteRemoved(target: string): Promise<void>;
}

export interface ActivityServiceDependencies {
  registry: RootRegistry;
  store: ActivityStore;
  statEntry: (target: string) => Promise<DiskEntry>;
  onChanged?: () => void;
  changeDebounceMs?: number;
}

/**
 * Records meaningful Opal actions and answers Recent. Every path is resolved
 * through the root registry first. Reading an item's UUID uses the bounded
 * single-item codec; it never builds the catalog or writes to the item.
 */
export class ActivityService implements ActivityRecorder {
  private changeTimer: NodeJS.Timeout | null = null;

  constructor(private deps: ActivityServiceDependencies) {}

  async recordOpened(target: string): Promise<void> {
    const resolved = await this.deps.registry.assertAllowed(target);
    await this.deps.statEntry(resolved);
    if (await this.deps.store.touch(resolved, 'opened', await this.readId(resolved))) this.emit();
  }

  async noteOrganized(target: string): Promise<void> {
    try {
      const resolved = await this.deps.registry.assertAllowed(target);
      if (await this.deps.store.touch(resolved, 'organized', await this.readId(resolved))) this.emit();
    } catch (error) {
      logger.warn(`Activity not recorded for ${target}: ${message(error)}`);
    }
  }

  async noteMoved(oldPath: string, newPath: string): Promise<void> {
    try {
      const from = normalizePath(oldPath);
      const to = await this.deps.registry.assertAllowed(newPath);
      const remapped = await this.deps.store.remap(from, to);
      const touched = await this.deps.store.touch(to, 'organized', await this.readId(to));
      if (remapped || touched) this.emit();
    } catch (error) {
      logger.warn(`Activity not remapped for ${oldPath}: ${message(error)}`);
    }
  }

  async noteRemoved(target: string): Promise<void> {
    try {
      if (await this.deps.store.remove([normalizePath(target)])) this.emit();
    } catch (error) {
      logger.warn(`Activity not removed for ${target}: ${message(error)}`);
    }
  }

  async clear(): Promise<void> {
    if (await this.deps.store.clear()) this.emit();
  }

  async recent(query: RecentQuery = {}): Promise<RecentResult> {
    const limit = Math.min(RECENT_MAX_LIMIT, Math.max(1, Math.floor(query.limit ?? RECENT_DEFAULT_LIMIT)));
    const store = this.deps.store;
    const records = store.list().sort((left, right) =>
      store.touchedAt(right) - store.touchedAt(left) ||
      path.basename(left.path).localeCompare(path.basename(right.path), undefined, { sensitivity: 'base' }) ||
      (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    const items: RecentItem[] = [];
    let index = 0;
    for (; index < records.length && items.length < limit; index++) {
      const record = records[index];
      let entry: DiskEntry;
      try { entry = await this.deps.statEntry(record.path); } catch { continue; }
      if (record.id !== null) {
        // A different readable identity means the item was replaced; unreadable
        // metadata is unknown and the record is kept.
        const currentId = await this.readCurrentId(record.path);
        if (currentId !== undefined && currentId !== record.id) continue;
      }
      items.push({
        entry,
        touchedAt: store.touchedAt(record),
        touchedKind: store.touchedKind(record),
        openedAt: record.openedAt,
        organizedAt: record.organizedAt,
        editedAt: record.editedAt,
      });
    }
    return { items, total: records.length, truncated: index < records.length, warnings: store.warnings() };
  }

  private async readId(target: string): Promise<string | null> {
    return (await this.readCurrentId(target)) ?? null;
  }

  /** `undefined` means unreadable (unknown); `null` means readable and unannotated. */
  private async readCurrentId(target: string): Promise<string | null | undefined> {
    try { return (await readMetadata(this.deps.registry, target)).id; } catch { return undefined; }
  }

  private emit(): void {
    if (!this.deps.onChanged || this.changeTimer) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      this.deps.onChanged?.();
    }, this.deps.changeDebounceMs ?? 100);
  }
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
