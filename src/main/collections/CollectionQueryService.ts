import { validateCollectionPage, validateCollectionQuery } from '@/common/collectionQuery';
import type { RootRegistry } from '@/main/fs/RootRegistry';
import type { ActivityStore } from '@/main/activity/ActivityStore';
import type { CollectionQueryResult } from '@/types/collectionQuery';
import type { CollectionIndex } from './CollectionIndex';
import { evaluateCollectionQuery } from './evaluateQuery';

export interface CollectionQueryServiceDependencies {
  registry: RootRegistry;
  index: CollectionIndex;
  activity: ActivityStore;
}

/**
 * Validates a query, evaluates it over every opened root with the in-memory
 * activity store joined in, and returns one bounded page.
 */
export class CollectionQueryService {
  constructor(private deps: CollectionQueryServiceDependencies) {}

  async query(rawQuery: unknown, rawPage?: unknown): Promise<CollectionQueryResult> {
    const query = validateCollectionQuery(rawQuery);
    const page = validateCollectionPage(rawPage);
    const snapshot = await this.deps.index.get();
    const store = this.deps.activity;
    const rows = evaluateCollectionQuery({
      items: snapshot.items,
      activity: (target) => store.get(target),
      touchedAt: (record) => store.touchedAt(record),
      allowedRoots: this.deps.registry.list(),
      query,
    });
    return {
      rows: rows.slice(page.offset, page.offset + page.limit),
      total: rows.length,
      offset: page.offset,
      limit: page.limit,
      warnings: snapshot.warnings,
    };
  }
}
