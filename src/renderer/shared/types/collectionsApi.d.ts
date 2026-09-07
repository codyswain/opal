import type { DiskResult } from '@/types/disk';
import type { CollectionPage, CollectionQuery, CollectionQueryResult } from '@/types/collectionQuery';

export interface CollectionsAPI {
  query: (query: CollectionQuery, page?: Partial<CollectionPage>) => Promise<DiskResult<CollectionQueryResult>>;
  onChanged: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    collectionsAPI: CollectionsAPI;
  }
}
