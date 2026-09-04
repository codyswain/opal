import { describe, expect, it } from 'vitest';
import { flattenDirectoryTree } from '@/renderer/features/shell/utils/flattenDirectoryTree';
import { entry } from '@/tests/helpers/diskApi';

describe('flattenDirectoryTree', () => {
  it('includes only visible directories and preserves tree metadata', () => {
    const nodes = flattenDirectoryTree({
      roots: ['/Vault'],
      expanded: {
        '/Vault': true,
        '/Vault/Design': true,
      },
      listings: {
        '/Vault': [
          entry({
            path: '/Vault/Design',
            name: 'Design',
            kind: 'directory',
            isDirectory: true,
          }),
          entry({
            path: '/Vault/readme.md',
            name: 'readme.md',
            kind: 'markdown',
          }),
          entry({
            path: '/Vault/Research',
            name: 'Research',
            kind: 'directory',
            isDirectory: true,
          }),
        ],
        '/Vault/Design': [
          entry({
            path: '/Vault/Design/Archive',
            name: 'Archive',
            kind: 'directory',
            isDirectory: true,
          }),
        ],
      },
    });

    expect(nodes.map((node) => node.path)).toEqual([
      '/Vault',
      '/Vault/Design',
      '/Vault/Design/Archive',
      '/Vault/Research',
    ]);
    expect(nodes[1]).toMatchObject({
      depth: 1,
      parentPath: '/Vault',
      positionInSet: 1,
      setSize: 2,
    });
    expect(nodes[2]).toMatchObject({
      depth: 2,
      parentPath: '/Vault/Design',
    });
  });

  it('does not expose descendants of a collapsed directory', () => {
    const nodes = flattenDirectoryTree({
      roots: ['/Vault'],
      expanded: { '/Vault': false },
      listings: {
        '/Vault': [
          entry({
            path: '/Vault/Hidden',
            name: 'Hidden',
            kind: 'directory',
            isDirectory: true,
          }),
        ],
      },
    });

    expect(nodes.map((node) => node.path)).toEqual(['/Vault']);
  });

  it('marks unloaded directories as expandable and loaded leaves as final', () => {
    const nodes = flattenDirectoryTree({
      roots: ['/Unloaded', '/Empty'],
      expanded: {},
      listings: { '/Empty': [] },
    });

    expect(nodes[0].isExpandable).toBe(true);
    expect(nodes[1].isExpandable).toBe(false);
  });

  it('flattens 5,000 visible directories within one frame', () => {
    const directories = Array.from({ length: 5_000 }, (_, index) =>
      entry({
        path: `/Vault/Folder ${index}`,
        name: `Folder ${index}`,
        kind: 'directory',
        isDirectory: true,
      })
    );
    const source = {
      roots: ['/Vault'],
      expanded: { '/Vault': true },
      listings: { '/Vault': directories },
    };

    // Warm up the JIT, then take the best of several samples so unrelated test
    // worker scheduling or a GC pause cannot masquerade as derivation cost.
    flattenDirectoryTree(source);
    const durations: number[] = [];
    let nodes = flattenDirectoryTree(source);
    for (let sample = 0; sample < 5; sample += 1) {
      const start = performance.now();
      nodes = flattenDirectoryTree(source);
      durations.push(performance.now() - start);
    }

    expect(nodes).toHaveLength(5_001);
    expect(Math.min(...durations)).toBeLessThan(16);
  });
});
