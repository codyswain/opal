import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { watch as watchDirectory, type FSWatcher } from 'chokidar';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { CollectionQueryError, validateCollectionQuery } from '@/common/collectionQuery';
import { libraryPreferencesPath, viewsDirectory, viewsTrashDirectory } from '@/main/library/libraryPaths';
import {
  VIEW_NAME_MAX_LENGTH,
  type SavedView,
  type SavedViewDefinition,
  type SavedViewsListing,
  type UnreadableView,
  type ViewLayout,
} from '@/types/savedView';

const SCHEMA = 1;
const TRASH_LIMIT = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Safe, user-facing errors; the IPC layer may show these messages verbatim. */
export class ViewError extends Error {
  constructor(message: string) { super(message); this.name = 'ViewError'; }
}
export class ViewConflictError extends ViewError {
  constructor() { super('This view changed on disk since you opened it.'); this.name = 'ViewConflictError'; }
}
export class ViewNotFoundError extends ViewError {
  constructor() { super('This view no longer exists.'); this.name = 'ViewNotFoundError'; }
}

export interface ViewRepositoryDependencies {
  libraryDirectory: string;
  onChanged?: () => void;
  changeDebounceMs?: number;
  now?: () => number;
}

interface PreferencesFile { version: number; viewOrder: string[] }

export function isViewId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function validateViewDefinition(value: unknown): SavedViewDefinition {
  if (!value || typeof value !== 'object') throw new ViewError('A view needs a name, a query and a layout.');
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.name !== 'string') throw new ViewError('A view needs a name.');
  const name = candidate.name.trim();
  if (name.length === 0 || name.length > VIEW_NAME_MAX_LENGTH) {
    throw new ViewError(`View names are 1 to ${VIEW_NAME_MAX_LENGTH} characters.`);
  }
  if (candidate.layout !== 'list' && candidate.layout !== 'gallery') throw new ViewError('Layout must be list or gallery.');
  let query;
  try {
    query = validateCollectionQuery(candidate.query);
  } catch (error) {
    if (error instanceof CollectionQueryError) throw new ViewError(error.message);
    throw error;
  }
  return { name, query, layout: candidate.layout as ViewLayout };
}

function revisionOf(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * One human-readable YAML file per view under the library directory, with
 * atomic replacement and revision checks so a stale draft never overwrites an
 * external edit. Removed views wait in `.trash` for undo.
 */
export class ViewRepository {
  private watcher: FSWatcher | null = null;
  private changeTimer: NodeJS.Timeout | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private deps: ViewRepositoryDependencies) {}

  private get directory(): string { return viewsDirectory(this.deps.libraryDirectory); }
  private get trash(): string { return viewsTrashDirectory(this.deps.libraryDirectory); }
  private fileFor(id: string): string { return path.join(this.directory, `${id}.yaml`); }

  list(): Promise<SavedViewsListing> {
    return this.serialize(() => this.listInternal());
  }

  create(definition: unknown): Promise<SavedView> {
    return this.serialize(async () => {
      const valid = validateViewDefinition(definition);
      const id = randomUUID();
      const view = await this.write(id, valid);
      const order = await this.readOrder();
      await this.writeOrder([...order, id]);
      this.emit();
      return view;
    });
  }

  save(id: unknown, definition: unknown, expectedRevision: unknown): Promise<SavedView> {
    return this.serialize(async () => {
      if (!isViewId(id)) throw new ViewError('Invalid view id.');
      if (typeof expectedRevision !== 'string' || !expectedRevision) throw new ViewError('A save needs the revision it was based on.');
      const valid = validateViewDefinition(definition);
      const current = await this.readCurrentRevision(id);
      if (current === null) throw new ViewNotFoundError();
      if (current !== expectedRevision) throw new ViewConflictError();
      const view = await this.write(id, valid, expectedRevision);
      this.emit();
      return view;
    });
  }

  duplicate(id: unknown): Promise<SavedView> {
    return this.serialize(async () => {
      if (!isViewId(id)) throw new ViewError('Invalid view id.');
      const source = await this.read(id);
      if (!source) throw new ViewNotFoundError();
      const copyId = randomUUID();
      const view = await this.write(copyId, { ...source, name: `${source.name} copy`.slice(0, VIEW_NAME_MAX_LENGTH) });
      const order = await this.readOrder();
      const at = order.indexOf(id);
      const next = [...order];
      next.splice(at >= 0 ? at + 1 : next.length, 0, copyId);
      await this.writeOrder(next);
      this.emit();
      return view;
    });
  }

  remove(id: unknown): Promise<{ undoToken: string }> {
    return this.serialize(async () => {
      if (!isViewId(id)) throw new ViewError('Invalid view id.');
      const file = this.fileFor(id);
      try { await stat(file); } catch { throw new ViewNotFoundError(); }
      await mkdir(this.trash, { recursive: true });
      const token = `${id}-${(this.deps.now ?? Date.now)()}`;
      await rename(file, path.join(this.trash, `${token}.yaml`));
      await this.writeOrder((await this.readOrder()).filter((candidate) => candidate !== id));
      await this.pruneTrash();
      this.emit();
      return { undoToken: token };
    });
  }

  restore(undoToken: unknown): Promise<SavedView> {
    return this.serialize(async () => {
      if (typeof undoToken !== 'string' || !/^[0-9a-f-]{36}-\d+$/i.test(undoToken)) throw new ViewError('Nothing to restore.');
      const id = undoToken.slice(0, 36);
      const trashed = path.join(this.trash, `${undoToken}.yaml`);
      try { await stat(trashed); } catch { throw new ViewError('This view can no longer be restored.'); }
      const file = this.fileFor(id);
      try { await stat(file); throw new ViewError('A view with this id already exists.'); } catch (error) {
        if (error instanceof ViewError) throw error;
      }
      await rename(trashed, file);
      const order = await this.readOrder();
      if (!order.includes(id)) await this.writeOrder([...order, id]);
      const view = await this.read(id);
      if (!view) throw new ViewError('The restored view could not be read.');
      this.emit();
      return view;
    });
  }

  async watch(): Promise<void> {
    if (this.watcher) return;
    await mkdir(this.directory, { recursive: true });
    const watcher = watchDirectory(this.directory, {
      ignoreInitial: true,
      depth: 0,
      ignored: (candidate: string) => path.basename(candidate).startsWith('.') && candidate !== this.directory,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });
    for (const event of ['add', 'change', 'unlink'] as const) watcher.on(event, () => this.emit());
    await new Promise<void>((resolve, reject) => {
      watcher.once('ready', resolve);
      watcher.once('error', reject);
    });
    this.watcher = watcher;
  }

  async close(): Promise<void> {
    if (this.changeTimer) { clearTimeout(this.changeTimer); this.changeTimer = null; }
    if (this.watcher) { await this.watcher.close(); this.watcher = null; }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async listInternal(): Promise<SavedViewsListing> {
    let names: string[] = [];
    try { names = await readdir(this.directory); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const views = new Map<string, SavedView>();
    const unreadable: UnreadableView[] = [];
    for (const name of names.sort()) {
      if (!name.endsWith('.yaml') || name.startsWith('.')) continue;
      const file = path.join(this.directory, name);
      try {
        const view = await this.parseFile(file, name.slice(0, -'.yaml'.length));
        views.set(view.id, view);
      } catch (error) {
        unreadable.push({ file, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const order = await this.readOrder();
    const ordered = [
      ...order.filter((id) => views.has(id)).map((id) => views.get(id) as SavedView),
      ...[...views.values()].filter((view) => !order.includes(view.id)),
    ];
    return { views: ordered, unreadable };
  }

  private async read(id: string): Promise<SavedView | null> {
    try {
      return await this.parseFile(this.fileFor(id), id);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error instanceof ViewError ? error : new ViewError(`This view file could not be read: ${String(error)}`);
    }
  }

  private async readCurrentRevision(id: string): Promise<string | null> {
    try {
      return revisionOf(await readFile(this.fileFor(id)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private async parseFile(file: string, expectedId: string): Promise<SavedView> {
    const bytes = await readFile(file);
    let data: unknown;
    try {
      data = parseYaml(bytes.toString('utf8'), { uniqueKeys: true, strict: true });
    } catch (error) {
      throw new ViewError(`Malformed YAML: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!data || typeof data !== 'object') throw new ViewError('A view file must be a YAML mapping.');
    const record = data as Record<string, unknown>;
    if (record.schema !== SCHEMA) throw new ViewError(`Unsupported view schema ${String(record.schema)}; this file was left untouched.`);
    if (record.id !== expectedId || !isViewId(record.id)) throw new ViewError('The view id does not match its file name.');
    const definition = validateViewDefinition({ name: record.name, query: record.query, layout: record.layout });
    return { ...definition, id: expectedId, revision: revisionOf(bytes), file };
  }

  private async write(id: string, definition: SavedViewDefinition, expectedRevision?: string): Promise<SavedView> {
    await mkdir(this.directory, { recursive: true });
    const file = this.fileFor(id);
    const body = stringifyYaml({ schema: SCHEMA, id, name: definition.name, layout: definition.layout, query: definition.query }, { lineWidth: 0 });
    const temporary = path.join(this.directory, `.view-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, body, 'utf8');
      if (expectedRevision !== undefined) {
        const latest = await this.readCurrentRevision(id);
        if (latest !== expectedRevision) throw new ViewConflictError();
      }
      await rename(temporary, file);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    return { ...definition, id, revision: revisionOf(body), file };
  }

  private async readOrder(): Promise<string[]> {
    try {
      const parsed = JSON.parse(await readFile(libraryPreferencesPath(this.deps.libraryDirectory), 'utf8')) as PreferencesFile;
      return parsed.version === 1 && Array.isArray(parsed.viewOrder) ? parsed.viewOrder.filter(isViewId) : [];
    } catch {
      return [];
    }
  }

  private async writeOrder(order: string[]): Promise<void> {
    const target = libraryPreferencesPath(this.deps.libraryDirectory);
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, viewOrder: [...new Set(order)] } satisfies PreferencesFile, null, 2), 'utf8');
    await rename(temporary, target);
  }

  private async pruneTrash(): Promise<void> {
    let names: string[] = [];
    try { names = (await readdir(this.trash)).filter((name) => name.endsWith('.yaml')); } catch { return; }
    if (names.length <= TRASH_LIMIT) return;
    const stamped = names.map((name) => ({ name, at: Number(name.slice(37, -'.yaml'.length)) || 0 }))
      .sort((left, right) => left.at - right.at);
    for (const entry of stamped.slice(0, names.length - TRASH_LIMIT)) {
      await rm(path.join(this.trash, entry.name), { force: true });
    }
  }

  private emit(): void {
    if (!this.deps.onChanged || this.changeTimer) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      this.deps.onChanged?.();
    }, this.deps.changeDebounceMs ?? 150);
  }
}
