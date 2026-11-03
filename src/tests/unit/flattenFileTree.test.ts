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

  describe('the daily pages folder', () => {
    const library = entry({ path: '/Vault/Library', name: 'Library', kind: 'directory', isDirectory: true });
    const daily = entry({ path: '/Vault/Library/daily', name: 'daily', kind: 'directory', isDirectory: true });
    const page = (date: string) =>
      entry({ path: `/Vault/Library/daily/${date}.md`, name: `${date}.md`, kind: 'markdown' });
    const listings = {
      '/Vault': [library],
      '/Vault/Library': [daily],
      '/Vault/Library/daily': [page('2025-12-31'), page('2026-10-29'), page('2026-10-30'), readme],
    };

    it('groups pages under a row per year, newest first, named by month, day and weekday', () => {
      const nodes = flattenFileTree({
        roots: ['/Vault'],
        expanded: { '/Vault/Library': true, '/Vault/Library/daily': true, '/Vault/Library/daily/2026': true },
        listings,
      });

      expect(nodes.map((node) => [node.label, node.depth])).toEqual([
        ['Library', 0],
        ['daily', 1],
        ['2026', 2],
        ['10-30 Fri', 3],
        ['10-29 Thu', 3],
        ['2025', 2],
        ['README', 2],
      ]);
      expect(nodes[2]).toMatchObject({
        path: '/Vault/Library/daily/2026',
        isDirectory: true,
        isYearGroup: true,
        isExpanded: true,
        parentPath: '/Vault/Library/daily',
      });
      expect(nodes[3]).toMatchObject({
        path: '/Vault/Library/daily/2026-10-30.md',
        name: '2026-10-30.md',
        isYearGroup: false,
        parentPath: '/Vault/Library/daily/2026',
      });
    });

    it('leaves pages loose when a real folder has the year’s name, and other folders alone', () => {
      const real = entry({ path: '/Vault/Library/daily/2026', name: '2026', kind: 'directory', isDirectory: true });
      const nodes = flattenFileTree({
        roots: ['/Vault'],
        expanded: { '/Vault/Library': true, '/Vault/Library/daily': true },
        listings: { ...listings, '/Vault/Library/daily': [real, page('2026-10-30'), page('2025-12-31')] },
      });

      expect(nodes.slice(2).map((node) => [node.label, node.isYearGroup])).toEqual([
        ['2025', true],
        ['2026', false],
        ['2026-10-30', false],
      ]);
    });
  });
});
