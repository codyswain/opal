import { randomUUID } from 'crypto';
import { open, rename, unlink } from 'fs/promises';
import path from 'path';
import { isSeq } from 'yaml';
import type { RootRegistry } from './RootRegistry';
import { MetadataCatalog, type CatalogSnapshot, type CatalogItem } from './MetadataCatalog';
import { MutationQueue, filesystemMutationQueue } from './MutationQueue';
import { MetadataError, MetadataConflictError, readMetadata, serializeMetadata, validateProperties, type MetadataState } from './MetadataCodec';
import type { ItemMetadata, ItemProperties, RelatedItem, AuthoredLink } from '@/types/metadata';
import type { ActivityRecorder } from '@/main/activity/ActivityService';

export interface MetadataServiceDependencies {
  registry: RootRegistry;
  queue?: MutationQueue;
  /** Records organized activity after a write succeeds; failures never affect the write. */
  activity?: ActivityRecorder;
  /** Filesystem replacement seam, also used for failure-injection tests. */
  renameEntry?: (source: string, destination: string) => Promise<void>;
}

export class MetadataService {
  readonly queue: MutationQueue;
  private catalog: MetadataCatalog;

  constructor(private deps: MetadataServiceDependencies) {
    this.queue = deps.queue ?? filesystemMutationQueue;
    this.catalog = new MetadataCatalog(deps.registry);
  }

  invalidate(): void { this.catalog.invalidate(); }

  read(target: string): Promise<ItemMetadata> {
    return this.queue.run(() => this.readInternal(target));
  }

  saveProperties(target: string, properties: ItemProperties, expectedRevision: string): Promise<ItemMetadata> {
    return this.queue.run(async () => {
      validateProperties(properties);
      const state = await readMetadata(this.deps.registry, target, true);
      if (state.revision !== expectedRevision) throw new MetadataConflictError();
      this.ensureIdentity(state);
      state.document.set('tags', properties.tags);
      state.document.set('annotation', properties.description);
      await this.write(state);
      await this.deps.activity?.noteOrganized(state.path);
      return this.readInternal(state.path);
    });
  }

  addRelated(target: string, targetPath: string): Promise<ItemMetadata> {
    return this.queue.run(async () => {
      this.invalidate();
      let source = await readMetadata(this.deps.registry, target);
      let destination = await readMetadata(this.deps.registry, targetPath);
      if (source.path === destination.path) throw new MetadataError('An item cannot be connected to itself.');
      const catalog = await this.catalog.get();
      for (const state of [source, destination]) {
        if (state.id && (catalog.byId.get(state.id)?.length ?? 0) > 1) throw new MetadataError('This identity is ambiguous because multiple items have the same UUID.');
      }
      if (source.id && destination.id && (source.links.some((link) => link.targetId === destination.id) ||
          destination.links.some((link) => link.targetId === source.id))) return this.readInternal(source.path);
      const sourceRevision = source.revision;
      source = await readMetadata(this.deps.registry, source.path, true);
      if (source.revision !== sourceRevision) throw new MetadataConflictError();
      const destinationNeedsIdentity = !destination.id;
      if (destinationNeedsIdentity) {
        const destinationRevision = destination.revision;
        destination = await readMetadata(this.deps.registry, destination.path, true);
        if (destination.revision !== destinationRevision) throw new MetadataConflictError();
      }
      this.ensureIdentity(source);
      this.ensureIdentity(destination);
      const link: AuthoredLink = { id: randomUUID(), targetId: destination.id, pathHint: path.relative(path.dirname(source.path), destination.path) };
      const linkPath = source.markdown ? ['opal', 'links'] : ['links'];
      if (!source.document.hasIn(linkPath)) source.document.setIn(linkPath, source.document.createNode([]));
      source.document.addIn(linkPath, source.document.createNode(link));
      // Preflight both serializations before either is authored. A later failure
      // may leave a target UUID, but can never leave a link to an unassigned UUID.
      serializeMetadata(source);
      if (destinationNeedsIdentity) { serializeMetadata(destination); await this.write(destination); }
      await this.write(source);
      await this.deps.activity?.noteOrganized(source.path);
      return this.readInternal(source.path);
    });
  }

  removeRelated(target: string, edgeId: string): Promise<ItemMetadata> {
    return this.queue.run(async () => {
      this.invalidate();
      const current = await readMetadata(this.deps.registry, target);
      const catalog = await this.catalog.get();
      const owners = current.links.some((link) => link.id === edgeId) ? [current] : catalog.items.filter((owner) =>
        owner.links.some((link) => link.id === edgeId && link.targetId === current.id));
      if (owners.length !== 1) throw new MetadataError(owners.length ? 'Connection ownership is ambiguous; remove it from its source item.' : 'This connection changed or no longer exists. Reload Details.');
      const owner = await readMetadata(this.deps.registry, owners[0].path, true);
      if (owner.revision !== owners[0].revision) throw new MetadataConflictError();
      const linkPath = owner.markdown ? ['opal', 'links'] : ['links'];
      const links = owner.document.getIn(linkPath, true);
      if (!isSeq(links)) throw new MetadataError('Connection list is malformed.');
      const index = owner.links.findIndex((link) => link.id === edgeId);
      if (index < 0) throw new MetadataConflictError();
      links.delete(index);
      await this.write(owner);
      await this.deps.activity?.noteOrganized(current.path);
      return this.readInternal(current.path);
    });
  }

  private ensureIdentity(state: MetadataState): void {
    if (state.id) return;
    state.id = randomUUID();
    const prefix = state.markdown ? ['opal'] : [];
    state.document.setIn([...prefix, 'schema'], 1);
    state.document.setIn([...prefix, 'id'], state.id);
  }

  private async write(state: MetadataState): Promise<void> {
    if (state.exists && (state.mode & 0o222) === 0) throw new MetadataError(`Metadata is read-only: ${state.carrier}`);
    const bytes = serializeMetadata(state);
    const temporary = path.join(path.dirname(state.carrier), `.opal-write-${randomUUID()}`);
    let failure: unknown;
    try {
      const handle = await open(temporary, 'wx', state.mode & 0o777);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      const latest = await readMetadata(this.deps.registry, state.path);
      if (latest.revision !== state.revision) throw new MetadataConflictError();
      await (this.deps.renameEntry ?? rename)(temporary, state.carrier);
    } catch (error) {
      failure = error;
    } finally {
      this.invalidate();
      try { await unlink(temporary); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') failure = new MetadataError(`Could not clean temporary metadata at ${temporary}: ${String(error)}. Original operation: ${String(failure ?? 'replacement completed')}`);
      }
    }
    if (failure) throw failure;
  }

  private async readInternal(target: string): Promise<ItemMetadata> {
    const state = await readMetadata(this.deps.registry, target);
    const catalog = await this.catalog.get();
    const warnings = [...catalog.warnings];
    if (state.id && (catalog.byId.get(state.id)?.length ?? 0) > 1) warnings.push('This item has a duplicate UUID; its identity is ambiguous.');
    const related = state.links.map((link) => this.row(state, link, 'outgoing', catalog));
    if (state.id) {
      for (const owner of catalog.items) {
        if (owner.path === state.path) continue;
        for (const link of owner.links) if (link.targetId === state.id) related.push(this.row(owner, link, 'incoming', catalog));
      }
    }
    // Never offer a stale navigation path from a cached index. Filesystem
    // changes invalidate via watcher; this guards a vanished path in that gap.
    for (const row of related) {
      if (row.targetPath) {
        try {
          const targetState = await readMetadata(this.deps.registry, row.targetPath);
          if (targetState.id !== row.targetId) { row.status = 'missing'; row.targetPath = null; row.targetKind = null; }
        } catch { row.status = 'missing'; row.targetPath = null; row.targetKind = null; }
      }
    }
    return { path: state.path, id: state.id, properties: state.properties, revision: state.revision, related, warnings, incomplete: catalog.warnings.length > 0 };
  }

  private row(owner: CatalogItem, link: AuthoredLink, direction: RelatedItem['direction'], catalog: CatalogSnapshot): RelatedItem {
    const targetId = direction === 'outgoing' ? link.targetId : owner.id;
    const matches = catalog.byId.get(targetId) ?? [];
    const available = matches.length === 1 ? matches[0] : null;
    const hint = direction === 'outgoing' ? link.pathHint : owner.path;
    return { edgeId: link.id, ownerId: owner.id, ownerPath: owner.path, direction, targetId,
      targetPath: available?.path ?? null, targetName: path.basename(available?.path ?? hint) || targetId,
      targetKind: available?.kind ?? null, pathHint: hint,
      status: matches.length > 1 ? 'ambiguous' : available ? 'available' : 'missing' };
  }
}
