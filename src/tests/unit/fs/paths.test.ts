import { describe, it, expect } from 'vitest';
import { normalizePath, isInsideRoot } from '@/main/fs/paths';

describe('normalizePath', () => {
  it('strips a trailing slash', () => {
    expect(normalizePath('/Users/cody/Photos/')).toBe('/Users/cody/Photos');
  });

  it('preserves the filesystem root', () => {
    expect(normalizePath('/')).toBe('/');
  });

  it('collapses duplicate and dot segments', () => {
    expect(normalizePath('/Users//cody/./Photos')).toBe('/Users/cody/Photos');
    expect(normalizePath('/Users/cody/Docs/../Photos')).toBe('/Users/cody/Photos');
  });
});

describe('isInsideRoot', () => {
  const root = '/Users/cody/Photos';

  it('accepts the root itself', () => {
    expect(isInsideRoot(root, '/Users/cody/Photos')).toBe(true);
  });

  it('accepts descendants at any depth', () => {
    expect(isInsideRoot(root, '/Users/cody/Photos/a.jpg')).toBe(true);
    expect(isInsideRoot(root, '/Users/cody/Photos/Rwanda/2024/b.jpg')).toBe(true);
  });

  it('rejects ancestors and siblings', () => {
    expect(isInsideRoot(root, '/Users/cody')).toBe(false);
    expect(isInsideRoot(root, '/Users/cody/Documents/a.jpg')).toBe(false);
    expect(isInsideRoot(root, '/etc/passwd')).toBe(false);
  });

  it('rejects traversal that escapes the root', () => {
    expect(isInsideRoot(root, '/Users/cody/Photos/../../../etc/passwd')).toBe(false);
    expect(isInsideRoot(root, '/Users/cody/Photos/../Documents/a.jpg')).toBe(false);
  });

  it('rejects a sibling whose name merely starts with the root string', () => {
    expect(isInsideRoot(root, '/Users/cody/PhotosPrivate/a.jpg')).toBe(false);
    expect(isInsideRoot(root, '/Users/cody/Photos-backup')).toBe(false);
  });

  it('tolerates a trailing slash on either argument', () => {
    expect(isInsideRoot('/Users/cody/Photos/', '/Users/cody/Photos/a.jpg')).toBe(true);
    expect(isInsideRoot(root, '/Users/cody/Photos/sub/')).toBe(true);
  });
});
