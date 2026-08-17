import { describe, it, expect } from 'vitest';
import { segmentsWithinRoot } from '@/common/pathSegments';

describe('segmentsWithinRoot', () => {
  const root = '/Users/cody/Photos';

  it('returns just the root when target is the root', () => {
    expect(segmentsWithinRoot(root, root)).toEqual([{ name: 'Photos', path: '/Users/cody/Photos' }]);
  });

  it('returns the trail from root to target', () => {
    expect(segmentsWithinRoot(root, '/Users/cody/Photos/Rwanda/2024')).toEqual([
      { name: 'Photos', path: '/Users/cody/Photos' },
      { name: 'Rwanda', path: '/Users/cody/Photos/Rwanda' },
      { name: '2024', path: '/Users/cody/Photos/Rwanda/2024' },
    ]);
  });

  it('never exposes segments above the root', () => {
    const segments = segmentsWithinRoot(root, '/Users/cody/Photos/Rwanda');
    expect(segments.some((s) => s.name === 'cody')).toBe(false);
    expect(segments.some((s) => s.name === 'Users')).toBe(false);
  });

  it('returns an empty trail when the target is outside the root', () => {
    expect(segmentsWithinRoot(root, '/Users/cody/Documents')).toEqual([]);
  });

  it('tolerates trailing slashes on either argument', () => {
    expect(segmentsWithinRoot(`${root}/`, '/Users/cody/Photos/Rwanda/')).toEqual([
      { name: 'Photos', path: '/Users/cody/Photos' },
      { name: 'Rwanda', path: '/Users/cody/Photos/Rwanda' },
    ]);
  });

  it('handles a root at the filesystem root', () => {
    expect(segmentsWithinRoot('/', '/etc')).toEqual([
      { name: '/', path: '/' },
      { name: 'etc', path: '/etc' },
    ]);
  });
});
