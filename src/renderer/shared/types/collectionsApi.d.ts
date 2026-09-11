import type { DiskResult } from '@/types/disk';
import type { CollectionPage, CollectionQuery, CollectionQueryResult, TagCount } from '@/types/collectionQuery';

export interface CollectionsAPI {
  query: (query: CollectionQuery, page?: Partial<CollectionPage>) => Promise<DiskResult<CollectionQueryResult>>;
  tags: () => Promise<DiskResult<TagCount[]>>;
  onChanged: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    collectionsAPI: CollectionsAPI;
  }
}
