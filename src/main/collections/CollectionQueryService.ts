import { validateCollectionPage, validateCollectionQuery } from '@/common/collectionQuery';
import type { RootRegistry } from '@/main/fs/RootRegistry';
import type { ActivityStore } from '@/main/activity/ActivityStore';
import type { CollectionQueryResult, TagCount } from '@/types/collectionQuery';
import type { CollectionIndex } from './CollectionIndex';
import { evaluateCollectionQuery } from './evaluateQuery';

export interface CollectionQueryServiceDependencies {
  registry: RootRegistry;
  index: CollectionIndex;
  activity: ActivityStore;
  now?: () => number;
}

/**
 * Validates a query, resolves its scope against the opened roots, joins the
 * in-memory activity store and returns one bounded page. A scoped folder that
 * is no longer inside an opened root is reported, never replaced.
 */
export class CollectionQueryService {
  constructor(private deps: CollectionQueryServiceDependencies) {}

  /** Distinct meaningful tags across the opened roots, most used first. */
  async tags(): Promise<TagCount[]> {
    const snapshot = await this.deps.index.get();
    const allowedRoots = this.deps.registry.list();
    const counts = new Map<string, number>();
    for (const item of snapshot.items) {
      if (!item.tags || !allowedRoots.some((root) => item.path === root || item.path.startsWith(`${root}/`))) continue;
      for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag));
  }

  async query(rawQuery: unknown, rawPage?: unknown): Promise<CollectionQueryResult> {
    const validated = validateCollectionQuery(rawQuery);
    const page = validateCollectionPage(rawPage);
    const allowedRoots = this.deps.registry.list();
    const unavailableScopes: string[] = [];
    let query = validated;
    if (validated.scope.kind === 'folders') {
      // Index paths are real paths; a scope spelled through a symlink or an
      // alias like /tmp must match by its resolved form.
      const resolved: string[] = [];
      for (const folder of validated.scope.folders) {
        try {
          resolved.push(await this.deps.registry.assertAllowed(folder));
        } catch {
          unavailableScopes.push(folder);
        }
      }
      query = { ...validated, scope: { ...validated.scope, folders: [...new Set(resolved)] } };
    }
    const indexState = this.deps.index.state() === 'ready' ? 'ready' : 'building';
    if (unavailableScopes.length > 0) {
      return {
        rows: [], total: 0, offset: page.offset, limit: page.limit, incomplete: false, warnings: [],
        indexState, unavailableScopes, generation: 0,
      };
    }
    const snapshot = await this.deps.index.get();
    const store = this.deps.activity;
    const evaluation = evaluateCollectionQuery({
      items: snapshot.items,
      activity: (target) => store.get(target),
      touchedOf: (record) => ({ at: store.touchedAt(record), kind: store.touchedKind(record) }),
      allowedRoots,
      query,
      now: (this.deps.now ?? Date.now)(),
    });
    const warnings = [...snapshot.warnings];
    if (evaluation.excludedUnknown > 0) {
      const count = evaluation.excludedUnknown;
      warnings.push(`${count} item${count === 1 ? '' : 's'} with unreadable metadata ${count === 1 ? 'was' : 'were'} left out because a filter needs it.`);
    }
    return {
      rows: evaluation.rows.slice(page.offset, page.offset + page.limit),
      total: evaluation.rows.length,
      offset: page.offset,
      limit: page.limit,
      incomplete: evaluation.excludedUnknown > 0 || snapshot.warnings.length > 0,
      warnings,
      indexState: 'ready',
      unavailableScopes: [],
      generation: snapshot.generation,
    };
  }
}
