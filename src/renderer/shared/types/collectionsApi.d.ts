import type { DiskResult } from '@/types/disk';
import type { CollectionPage, CollectionQuery, CollectionQueryResult } from '@/types/collectionQuery';

export interface CollectionsAPI {
  query: (query: CollectionQuery, page?: Partial<CollectionPage>) => Promise<DiskResult<CollectionQueryResult>>;
}

declare global {
  interface Window {
    collectionsAPI: CollectionsAPI;
  }
}
