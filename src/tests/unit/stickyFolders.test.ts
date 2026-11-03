import { describe, expect, it } from 'vitest';
import { flattenFileTree } from '@/renderer/features/shell/utils/flattenFileTree';
import {
  offsetBelowStickyFolders,
  stickyFolders,
} from '@/renderer/features/shell/utils/stickyFolders';
import { entry } from '@/tests/helpers/diskApi';
import type { DiskEntry } from '@/types/disk';

const ROW = 30;
const HEIGHT = 600;
const LEVELS = 4;

const folder = (path: string) =>
  entry({ path, name: path.split('/').pop() ?? path, kind: 'directory', isDirectory: true });
const file = (path: string) =>
  entry({ path, name: path.split('/').pop() ?? path, kind: 'markdown' });
const files = (dir: string, prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) =>
    file(`${dir}/${prefix}-${String(index).padStart(2, '0')}.md`)
  );

/*
 *  0  RAM
 *  1    Archive (closed)
 *  2    runs
 *  3      2026-10
 *  4-8      a-00 … a-04
 *  9-18   run-00 … run-09
 * 19    notes
 * 20  Zebra (closed)
 * 21  README
 */
const LISTINGS: Record<string, DiskEntry[]> = {
  '/Vault': [folder('/Vault/RAM'), folder('/Vault/Zebra'), file('/Vault/README.md')],
  '/Vault/RAM': [
    folder('/Vault/RAM/Archive'),
    folder('/Vault/RAM/runs'),
    file('/Vault/RAM/notes.md'),
  ],
  '/Vault/RAM/runs': [
    folder('/Vault/RAM/runs/2026-10'),
    ...files('/Vault/RAM/runs', 'run', 10),
  ],
  '/Vault/RAM/runs/2026-10': files('/Vault/RAM/runs/2026-10', 'a', 5),
};

const nodes = flattenFileTree({
  roots: ['/Vault'],
  expanded: {
    '/Vault/RAM': true,
    '/Vault/RAM/runs': true,
    '/Vault/RAM/runs/2026-10': true,
  },
  listings: LISTINGS,
});

/*
 *  0-5    a/b/c/d/e/f, each inside the one before
 *  6-35   x-00 … x-29, the last of them ends all six folders
 * 36-55   z-00 … z-19, at the top level
 */
const deep = (() => {
  const listings: Record<string, DiskEntry[]> = {
    '/Deep': [folder('/Deep/a'), ...files('/Deep', 'z', 20)],
  };
  let dir = '/Deep/a';
  for (const name of ['b', 'c', 'd', 'e', 'f']) {
    listings[dir] = [folder(`${dir}/${name}`)];
    dir = `${dir}/${name}`;
  }
  listings[dir] = files(dir, 'x', 30);
  const expanded = Object.fromEntries(Object.keys(listings).map((path) => [path, true]));
  return flattenFileTree({ roots: ['/Deep'], expanded, listings });
})();

const stuckAt = (scrollTop: number, height = HEIGHT, levels = LEVELS, rows = nodes) =>
  stickyFolders(rows, scrollTop, ROW, height, levels).map(({ node, top }) => [node.label, top]);

describe('stickyFolders', () => {
  it('lays out the tree the tests assume', () => {
    expect(nodes).toHaveLength(22);
    expect(nodes[3].label).toBe('2026-10');
    expect(nodes[19].label).toBe('notes');
  });

  it('sticks nothing at the top of the tree', () => {
    expect(stuckAt(0)).toEqual([]);
    expect(stickyFolders([], 300, ROW, HEIGHT, LEVELS)).toEqual([]);
  });

  it('sticks the folder of the top row once its own row slides above the top', () => {
    expect(stuckAt(25)).toEqual([['RAM', 0]]);
    // runs is exactly in the slot below RAM, so its own row shows there.
    expect(stuckAt(30)).toEqual([['RAM', 0]]);
  });

  it('stacks nested folders outermost first, each in its own slot', () => {
    expect(stuckAt(180)).toEqual([
      ['RAM', 0],
      ['runs', 30],
      ['2026-10', 60],
    ]);
    const deepest = stickyFolders(nodes, 180, ROW, HEIGHT, LEVELS);
    expect(deepest.map(({ index }) => index)).toEqual([0, 2, 3]);
  });

  it('lets a folder slide under the stuck rows before its row is fully hidden', () => {
    // At 40 the runs row is at 20px, 10px under RAM's stuck row, and the
    // 2026-10 row below it is at 50px, 10px under the stuck runs.
    expect(stuckAt(40)).toEqual([
      ['RAM', 0],
      ['runs', 30],
      ['2026-10', 60],
    ]);
  });

  it('pushes a stuck folder up and out as the row after its last one scrolls up', () => {
    // a-04, the last row in 2026-10, ends 80px down: the folder's row moves up 10px.
    expect(stuckAt(190)).toEqual([
      ['RAM', 0],
      ['runs', 30],
      ['2026-10', 50],
    ]);
    expect(stuckAt(209)).toEqual([
      ['RAM', 0],
      ['runs', 30],
      ['2026-10', 31],
    ]);
    expect(stuckAt(210)).toEqual([
      ['RAM', 0],
      ['runs', 30],
    ]);
    // The top level goes the same way: notes is RAM's last row.
    expect(stuckAt(570)).toEqual([['RAM', 0]]);
    expect(stuckAt(580)).toEqual([['RAM', -10]]);
    expect(stuckAt(599)).toEqual([['RAM', -29]]);
    expect(stuckAt(600)).toEqual([]);
  });

  it('pushes an inner folder alone when it ends before its parent', () => {
    // run-09, the last row in runs, ends 50px down; RAM goes on to notes.
    expect(stuckAt(520)).toEqual([
      ['RAM', 0],
      ['runs', 20],
    ]);
  });

  it('pushes folders that end on the same row together, the inner one under the outer', () => {
    expect(stuckAt(970, HEIGHT, LEVELS, deep)).toEqual([
      ['a', 0],
      ['b', 30],
      ['c', 60],
      ['d', 80],
    ]);
    expect(stuckAt(1000, HEIGHT, LEVELS, deep)).toEqual([
      ['a', 0],
      ['b', 30],
      ['c', 50],
    ]);
    expect(stuckAt(1040, HEIGHT, LEVELS, deep)).toEqual([
      ['a', 0],
      ['b', 10],
    ]);
    expect(stuckAt(1060, HEIGHT, LEVELS, deep)).toEqual([['a', -10]]);
    expect(stuckAt(1080, HEIGHT, LEVELS, deep)).toEqual([]);
  });

  it('keeps the outermost folders when the level cap is reached, as VS Code does', () => {
    expect(stuckAt(180, HEIGHT, 2)).toEqual([
      ['RAM', 0],
      ['runs', 30],
    ]);
    expect(stuckAt(180, HEIGHT, 1)).toEqual([['RAM', 0]]);
  });

  it('never covers more than a third of the tree', () => {
    expect(stuckAt(180, 270)).toEqual([
      ['RAM', 0],
      ['runs', 30],
      ['2026-10', 60],
    ]);
    expect(stuckAt(180, 200)).toEqual([
      ['RAM', 0],
      ['runs', 30],
    ]);
    expect(stuckAt(180, 80)).toEqual([]);
  });

  it('caps at four levels in a deep tree', () => {
    expect(stuckAt(20 * ROW, HEIGHT, LEVELS, deep)).toEqual([
      ['a', 0],
      ['b', 30],
      ['c', 60],
      ['d', 90],
    ]);
  });

  it('does not stick a closed folder, a file or an empty open folder', () => {
    // Zebra is closed and at the top.
    expect(stuckAt(610)).toEqual([]);
    // Archive is closed and in the slot under RAM.
    expect(stuckAt(25)).toEqual([['RAM', 0]]);

    const empty = flattenFileTree({
      roots: ['/Vault'],
      expanded: { '/Vault/Empty': true },
      listings: { '/Vault': [folder('/Vault/Empty'), ...files('/Vault', 'z', 30)] },
    });
    expect(stuckAt(10, HEIGHT, LEVELS, empty)).toEqual([]);
  });

  it('skips a collapsed folder above the top row', () => {
    const collapsed = flattenFileTree({
      roots: ['/Vault'],
      expanded: { '/Vault/RAM': true },
      listings: LISTINGS,
    });
    // RAM, Archive, runs (closed), notes, Zebra, README: runs is half above the top.
    expect(stuckAt(70, HEIGHT, LEVELS, collapsed)).toEqual([['RAM', 0]]);
  });

  it('treats a year row in the daily pages folder as a folder', () => {
    const daily = '/Vault/Library/daily';
    const pages = Array.from({ length: 10 }, (_, index) =>
      file(`${daily}/2026-10-${String(index + 10)}.md`)
    );
    const rows = flattenFileTree({
      roots: ['/Vault'],
      expanded: { '/Vault/Library': true, [daily]: true, [`${daily}/2026`]: true },
      listings: {
        '/Vault': [folder('/Vault/Library')],
        '/Vault/Library': [folder(daily)],
        [daily]: [...pages, file(`${daily}/2025-12-31.md`)],
      },
    });

    const stuck = stickyFolders(rows, 5 * ROW, ROW, HEIGHT, LEVELS);
    expect(stuck.map(({ node }) => node.label)).toEqual(['Library', 'daily', '2026']);
    expect(stuck[2].node.isYearGroup).toBe(true);
  });

  it('sticks a root row when several roots are open', () => {
    const rows = flattenFileTree({
      roots: ['/Vault', '/Work'],
      expanded: {},
      listings: {
        '/Vault': files('/Vault', 'v', 20),
        '/Work': files('/Work', 'w', 20),
      },
    });

    const stuck = stickyFolders(rows, 5 * ROW, ROW, HEIGHT, LEVELS);
    expect(stuck.map(({ node }) => [node.path, node.isRoot])).toEqual([['/Vault', true]]);
    expect(stickyFolders(rows, 22 * ROW, ROW, HEIGHT, LEVELS).map(({ node }) => node.path)).toEqual([
      '/Work',
    ]);
  });
});

describe('offsetBelowStickyFolders', () => {
  it('puts a row just below the stuck rows of its folders', () => {
    // a-02 is three levels down.
    expect(offsetBelowStickyFolders(nodes, 6, ROW, HEIGHT, LEVELS)).toBe(90);
    expect(offsetBelowStickyFolders(nodes, 6, ROW, HEIGHT, 2)).toBe(120);
    expect(offsetBelowStickyFolders(nodes, 0, ROW, HEIGHT, LEVELS)).toBe(0);
  });

  it('shows a stuck folder in its own row, no longer stuck', () => {
    const offset = offsetBelowStickyFolders(nodes, 2, ROW, HEIGHT, LEVELS);
    expect(offset).toBe(30);
    expect(stuckAt(offset)).toEqual([['RAM', 0]]);
  });

  it('asks no scroll for a row already showing below the stuck rows', () => {
    for (const rows of [nodes, deep]) {
      for (let offset = 0; offset <= rows.length * ROW - HEIGHT; offset += 5) {
        const stuck = stickyFolders(rows, offset, ROW, HEIGHT, LEVELS);
        const bottom = Math.max(0, ...stuck.map(({ top }) => top + ROW));
        rows.forEach((_, index) => {
          const top = index * ROW - offset;
          if (top < bottom || top + ROW > HEIGHT) return;
          expect(
            offsetBelowStickyFolders(rows, index, ROW, HEIGHT, LEVELS)
          ).toBeGreaterThanOrEqual(offset);
        });
      }
    }
  });

  it('never leaves the row behind the stuck rows, at any cap', () => {
    for (const [height, levels] of [
      [HEIGHT, LEVELS],
      [HEIGHT, 2],
      [200, LEVELS],
    ]) {
      nodes.forEach((node, index) => {
        const offset = offsetBelowStickyFolders(nodes, index, ROW, height, levels);
        const stuck = stickyFolders(nodes, offset, ROW, height, levels);
        const bottom = Math.max(0, ...stuck.map(({ top }) => top + ROW));
        expect(stuck.map((folder) => folder.index)).not.toContain(index);
        expect(index * ROW - offset).toBeGreaterThanOrEqual(bottom);
      });
    }
  });
});
