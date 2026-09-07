import type { DiskResult } from '@/types/disk';
import type { ItemMetadata, ItemProperties } from '@/types/metadata';

export interface MetadataAPI {
  read: (target: string) => Promise<DiskResult<ItemMetadata>>;
  saveProperties: (
    target: string,
    properties: ItemProperties,
    expectedRevision: string
  ) => Promise<DiskResult<ItemMetadata>>;
  addRelated: (target: string, relatedTarget: string) => Promise<DiskResult<ItemMetadata>>;
  removeRelated: (target: string, edgeId: string) => Promise<DiskResult<ItemMetadata>>;
}

declare global {
  interface Window {
    metadataAPI: MetadataAPI;
  }
}
