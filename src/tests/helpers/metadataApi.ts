import { vi } from 'vitest';
import type { DiskResult } from '@/types/disk';
import type { ItemMetadata, ItemProperties } from '@/types/metadata';

export interface TestMetadataAPI {
  read: (target: string) => Promise<DiskResult<ItemMetadata>>;
  saveProperties: (
    target: string,
    properties: ItemProperties,
    expectedRevision: string
  ) => Promise<DiskResult<ItemMetadata>>;
  addRelated: (target: string, relatedTarget: string) => Promise<DiskResult<ItemMetadata>>;
  removeRelated: (target: string, edgeId: string) => Promise<DiskResult<ItemMetadata>>;
}

export function metadata(
  overrides: Partial<ItemMetadata> = {}
): ItemMetadata {
  return {
    path: '/V/note.md',
    id: '11111111-1111-4111-8111-111111111111',
    properties: { tags: [], description: '' },
    revision: 'rev-1',
    related: [],
    warnings: [],
    incomplete: false,
    ...overrides,
  };
}

export function installMetadataApi(
  overrides: Partial<TestMetadataAPI> = {}
): TestMetadataAPI {
  const api: TestMetadataAPI = {
    read: vi.fn(async (target: string) => ({
      success: true as const,
      data: metadata({ path: target }),
    })),
    saveProperties: vi.fn(async (target, properties) => ({
      success: true as const,
      data: metadata({ path: target, properties, revision: 'rev-2' }),
    })),
    addRelated: vi.fn(async (target) => ({
      success: true as const,
      data: metadata({ path: target }),
    })),
    removeRelated: vi.fn(async (target) => ({
      success: true as const,
      data: metadata({ path: target }),
    })),
    ...overrides,
  };

  (window as unknown as { metadataAPI: TestMetadataAPI }).metadataAPI = api;
  return api;
}
