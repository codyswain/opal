import { randomUUID } from 'crypto';
import { mkdir, readFile, rename, unlink, writeFile as writeFileOnDisk } from 'fs/promises';
import path from 'path';
import { isInsideRoot, normalizePath } from '@/main/fs/paths';
import type { ActivityKind, ActivityRecord } from '@/types/activity';

const STORE_VERSION = 1;
export const ACTIVITY_COALESCE_MS = 30_000;
export const ACTIVITY_DEFAULT_LIMIT = 2000;

interface ActivityFile { version: number; items: ActivityRecord[] }

export interface ActivityStoreDependencies {
  storePath: string;
  now?: () => number;
  limit?: number;
  coalesceMs?: number;
  /** Seam for write-failure tests. */
  writeFile?: (target: string, bytes: string) => Promise<void>;
}

type StampField = 'openedAt' | 'organizedAt' | 'editedAt';
const KIND_FIELD: Record<ActivityKind, StampField> = {
  opened: 'openedAt', organized: 'organizedAt', edited: 'editedAt',
};
/** Tie-break order: the more deliberate action wins. */
const KIND_PRIORITY: ActivityKind[] = ['edited', 'organized', 'opened'];

function isStamp(field: unknown): field is number | null {
  return field === null || (typeof field === 'number' && Number.isFinite(field));
}

function isRecord(value: unknown): value is ActivityRecord {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.path === 'string' && candidate.path.length > 0 &&
    (candidate.id === null || typeof candidate.id === 'string') &&
    isStamp(candidate.openedAt) && isStamp(candidate.organizedAt) && isStamp(candidate.editedAt);
}

/**
 * Personal activity behind Recent. Records are keyed by absolute canonical
 * path; the whole file is rewritten atomically on every change, serialized so
 * writes never interleave. Persistence failures are reported, never thrown.
 */
export class ActivityStore {
  private records = new Map<string, ActivityRecord>();
  private loadWarning: string | null = null;
  private persistenceError: string | null = null;
  private tail: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly limit: number;
  private readonly coalesceMs: number;

  constructor(private deps: ActivityStoreDependencies) {
    this.now = deps.now ?? Date.now;
    this.limit = Math.max(1, deps.limit ?? ACTIVITY_DEFAULT_LIMIT);
    this.coalesceMs = deps.coalesceMs ?? ACTIVITY_COALESCE_MS;
  }

  async load(): Promise<void> {
    this.records.clear();
    this.loadWarning = null;
    let raw: string;
    try {
      raw = await readFile(this.deps.storePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      this.loadWarning = `Recent activity could not be read: ${message(error)}`;
      return;
    }
    let parsed: ActivityFile | null = null;
    try { parsed = JSON.parse(raw) as ActivityFile; } catch { parsed = null; }
    if (!parsed || parsed.version !== STORE_VERSION || !Array.isArray(parsed.items)) {
      const aside = `${this.deps.storePath}.invalid-${this.now()}`;
      try { await rename(this.deps.storePath, aside); } catch { /* keep the original in place if it cannot move */ }
      this.loadWarning = `Recent activity could not be read; the previous file was kept at ${path.basename(aside)}.`;
      return;
    }
    for (const item of parsed.items) {
      if (isRecord(item)) {
        const key = normalizePath(item.path);
        this.records.set(key, { path: key, id: item.id, openedAt: item.openedAt, organizedAt: item.organizedAt, editedAt: item.editedAt });
      }
    }
  }

  list(): ActivityRecord[] { return [...this.records.values()].map((record) => ({ ...record })); }

  get(target: string): ActivityRecord | null {
    const record = this.records.get(normalizePath(target));
    return record ? { ...record } : null;
  }

  warnings(): string[] {
    return [this.loadWarning, this.persistenceError].filter((warning): warning is string => !!warning);
  }

  touchedAt(record: ActivityRecord): number {
    return Math.max(record.openedAt ?? 0, record.organizedAt ?? 0, record.editedAt ?? 0);
  }

  touchedKind(record: ActivityRecord): ActivityKind {
    const at = this.touchedAt(record);
    return KIND_PRIORITY.find((kind) => record[KIND_FIELD[kind]] === at) ?? 'opened';
  }

  touch(target: string, kind: ActivityKind, id: string | null): Promise<boolean> {
    const key = normalizePath(target);
    const now = this.now();
    const current = this.records.get(key);
    if (
      current && kind === 'opened' && current.openedAt !== null &&
      now - current.openedAt < this.coalesceMs && (id === null || id === current.id)
    ) {
      return Promise.resolve(false);
    }
    const next: ActivityRecord = {
      path: key,
      id: id ?? current?.id ?? null,
      openedAt: current?.openedAt ?? null,
      organizedAt: current?.organizedAt ?? null,
      editedAt: current?.editedAt ?? null,
    };
    next[KIND_FIELD[kind]] = now;
    this.records.delete(key);
    this.records.set(key, next);
    this.evict();
    return this.persist();
  }

  remap(oldPath: string, newPath: string): Promise<boolean> {
    const from = normalizePath(oldPath);
    const to = normalizePath(newPath);
    const moved = [...this.records.values()].filter((record) => isInsideRoot(from, record.path));
    if (moved.length === 0) return Promise.resolve(false);
    for (const record of moved) {
      this.records.delete(record.path);
      const suffix = record.path.slice(from.length);
      const remapped = normalizePath(`${to}${suffix}`);
      this.records.set(remapped, { ...record, path: remapped });
    }
    return this.persist();
  }

  remove(paths: readonly string[]): Promise<boolean> {
    const removed = paths.map(normalizePath);
    let changed = false;
    for (const key of [...this.records.keys()]) {
      if (removed.some((prefix) => isInsideRoot(prefix, key))) {
        this.records.delete(key);
        changed = true;
      }
    }
    return changed ? this.persist() : Promise.resolve(false);
  }

  clear(): Promise<boolean> {
    if (this.records.size === 0) return Promise.resolve(false);
    this.records.clear();
    return this.persist();
  }

  private evict(): void {
    while (this.records.size > this.limit) {
      let oldest: ActivityRecord | null = null;
      for (const record of this.records.values()) {
        if (!oldest || this.touchedAt(record) < this.touchedAt(oldest)) oldest = record;
      }
      if (!oldest) break;
      this.records.delete(oldest.path);
    }
  }

  /** Serialized atomic replace; resolves true after the attempt, recording any failure. */
  private persist(): Promise<boolean> {
    const payload: ActivityFile = { version: STORE_VERSION, items: this.list() };
    const write = this.deps.writeFile ?? ((target: string, bytes: string) => writeFileOnDisk(target, bytes, 'utf8'));
    const run = this.tail.then(async () => {
      const directory = path.dirname(this.deps.storePath);
      const temporary = path.join(directory, `.activity-${randomUUID()}.tmp`);
      try {
        await mkdir(directory, { recursive: true });
        await write(temporary, JSON.stringify(payload, null, 2));
        await rename(temporary, this.deps.storePath);
        this.persistenceError = null;
      } catch (error) {
        this.persistenceError = `Recent activity could not be saved: ${message(error)}`;
        try { await unlink(temporary); } catch { /* nothing to clean */ }
      }
    });
    this.tail = run;
    return run.then(() => true);
  }
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
