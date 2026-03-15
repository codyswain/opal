import { describe, it, expect } from 'vitest';
import { transformFileSystemData } from '@/main/database/transforms';
import { ItemWithAIMetadata } from '@/main/database/types';

describe('transformFileSystemData', () => {
  it('returns empty object for empty input', () => {
    const result = transformFileSystemData([]);
    expect(result).toEqual({});
  });

  it('transforms a single root folder', () => {
    const items: ItemWithAIMetadata[] = [{
      id: 'folder-1', type: 'folder', path: '/My Folder', parent_path: null as unknown as string,
      name: 'My Folder', created_at: '2026-01-01', updated_at: '2026-01-02',
      size: 0, is_mounted: 0, real_path: undefined, summary: undefined, tags: undefined,
    }];
    const result = transformFileSystemData(items);
    expect(result['folder-1']).toEqual({
      id: 'folder-1', name: 'My Folder', type: 'folder', path: '/My Folder',
      parentId: null, children: [],
      metadata: { createdAt: '2026-01-01', updatedAt: '2026-01-02', size: 0 },
      isMounted: false, realPath: undefined,
    });
  });

  it('correctly links parent-child relationships', () => {
    const items: ItemWithAIMetadata[] = [
      { id: 'folder-1', type: 'folder', path: '/Parent', parent_path: null as unknown as string, name: 'Parent', created_at: '', updated_at: '', size: 0, is_mounted: 0, real_path: undefined, summary: undefined, tags: undefined },
      { id: 'note-1', type: 'note', path: '/Parent/Child Note', parent_path: '/Parent', name: 'Child Note', created_at: '', updated_at: '', size: 100, is_mounted: 0, real_path: undefined, summary: undefined, tags: undefined },
    ];
    const result = transformFileSystemData(items);
    expect(result['folder-1'].children).toEqual(['note-1']);
    expect(result['note-1'].parentId).toBe('folder-1');
  });

  it('handles mounted folders', () => {
    const items: ItemWithAIMetadata[] = [{
      id: 'mounted-1', type: 'folder', path: '/Mounted', parent_path: null as unknown as string, name: 'Mounted',
      created_at: '', updated_at: '', size: 0, is_mounted: 1, real_path: '/Users/cody/real-path',
      summary: undefined, tags: undefined,
    }];
    const result = transformFileSystemData(items);
    expect(result['mounted-1'].isMounted).toBe(true);
    expect(result['mounted-1'].realPath).toBe('/Users/cody/real-path');
  });
});
