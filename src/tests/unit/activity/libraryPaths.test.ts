import { describe, expect, it } from 'vitest';
import { activityStorePath, libraryDirectory } from '@/main/library/libraryPaths';

describe('libraryPaths', () => {
  it('places every library file under one app-managed directory', () => {
    expect(libraryDirectory('/data')).toBe('/data/library');
    expect(activityStorePath('/data')).toBe('/data/library/activity.json');
  });
});
