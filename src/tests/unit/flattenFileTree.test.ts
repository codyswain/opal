import { describe, expect, it } from 'vitest';
import { flattenFileTree } from '@/renderer/features/shell/utils/flattenFileTree';
import { entry } from '@/tests/helpers/diskApi';

const design = entry({
  path: '/Vault/Design',
  name: 'Design',
  kind: 'directory',
  isDirectory: true,
});
const books = entry({
  path: '/Vault/Books',
  name: 'Books',
  kind: 'directory',
  isDirectory: true,
});
const readme = entry({
  path: '/Vault/README.md',
  name: 'README.md',
  kind: 'markdown',
});
const diagram = entry({
  path: '/Vault/Design/diagram.png',
  name: 'diagram.png',
  kind: 'image',
});

describe('flattenFileTree', () => {
  it('starts a lone root at its children and lists folders and files in listing order', () => {
    const nodes = flattenFileTree({
      roots: ['/Vault'],
      expanded: { '/Vault/Design': true },
      listings: {
        '/Vault': [books, design, readme],
        '/Vault/Design': [diagram],
      },
    });

    expect(nodes.map((node) => node.path)).toEqual([
      '/Vault/Books',
      '/Vault/Design',
      '/Vault/Design/diagram.png',
      '/Vault/README.md',
    ]);
    expect(nodes[1]).toMatchObject({
      depth: 0,
      parentPath: null,
      positionInSet: 2,
      setSize: 3,
      isExpanded: true,
      isRoot: false,
    });
    expect(nodes[2]).toMatchObject({
      depth: 1,
      parentPath: '/Vault/Design',
      isDirectory: false,
      isExpanded: false,
    });
  });

  it('drops .md from Markdown labels only', () => {
    const nodes = flattenFileTree({
      roots: ['/Vault'],
      expanded: { '/Vault/Design': true },
      listings: { '/Vault': [design, readme], '/Vault/Design': [diagram] },
    });

    expect(nodes.map((node) => node.label)).toEqual([
      'Design',
      'diagram.png',
      'README',
    ]);
  });

  it('keeps a lone root open even when it was collapsed as one of several', () => {
    const nodes = flattenFileTree({
      roots: ['/Vault'],
      expanded: { '/Vault': false },
      listings: { '/Vault': [readme] },
    });

    expect(nodes.map((node) => node.path)).toEqual(['/Vault/README.md']);
  });

  it('shows several roots as top-level rows, open until collapsed', () => {
    const nodes = flattenFileTree({
      roots: ['/Vault', '/Work'],
      expanded: { '/Work': false },
      listings: {
        '/Vault': [readme],
        '/Work': [entry({ path: '/Work/plan.md', name: 'plan.md', kind: 'markdown' })],
      },
    });

    expect(nodes.map((node) => node.path)).toEqual([
      '/Vault',
      '/Vault/README.md',
      '/Work',
    ]);
    expect(nodes[0]).toMatchObject({ isRoot: true, isExpanded: true, depth: 0 });
    expect(nodes[1]).toMatchObject({ depth: 1, parentPath: '/Vault' });
    expect(nodes[2]).toMatchObject({ isRoot: true, isExpanded: false });
  });

  it('shows an expanded folder with nothing in it, or not yet loaded, without children', () => {
    const empty = entry({
      path: '/Vault/Empty',
      name: 'Empty',
      kind: 'directory',
      isDirectory: true,
    });
    const nodes = flattenFileTree({
      roots: ['/Vault'],
      expanded: { '/Vault/Empty': true, '/Vault/Design': true },
      listings: { '/Vault': [design, empty], '/Vault/Empty': [] },
    });

    expect(nodes.map((node) => [node.path, node.isExpanded])).toEqual([
      ['/Vault/Design', true],
      ['/Vault/Empty', true],
    ]);
  });

  it('flattens 5,000 visible files and folders within one frame', () => {
    const children = Array.from({ length: 5_000 }, (_, index) =>
      index % 2 === 0
        ? entry({
            path: `/Vault/Folder ${index}`,
            name: `Folder ${index}`,
            kind: 'directory',
            isDirectory: true,
          })
        : entry({
            path: `/Vault/Note ${index}.md`,
            name: `Note ${index}.md`,
            kind: 'markdown',
          })
    );
    const source = {
      roots: ['/Vault'],
      expanded: {},
      listings: { '/Vault': children },
    };

    // Warm up the JIT, then take the best of several samples so unrelated test
    // worker scheduling or a GC pause cannot masquerade as derivation cost.
    flattenFileTree(source);
    const durations: number[] = [];
    let nodes = flattenFileTree(source);
    for (let sample = 0; sample < 5; sample += 1) {
      const start = performance.now();
      nodes = flattenFileTree(source);
      durations.push(performance.now() - start);
    }

    expect(nodes).toHaveLength(5_000);
    expect(Math.min(...durations)).toBeLessThan(16);
  });
});
