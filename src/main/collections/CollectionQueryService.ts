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
    // The index lists hidden files too, so showing them needs no new scan; they are left out here.
    const blocked = await this.deps.registry.blocked();
    const rows = evaluateCollectionQuery({
      items: snapshot.items.filter((item) => !blocked(item.path)),
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
      // A warning starts with the folder it is about.
      warnings: snapshot.warnings.filter((warning) => !blocked(warning.split(': ')[0])),
    };
  }
}
