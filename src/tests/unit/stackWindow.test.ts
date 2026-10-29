import { describe, expect, it } from 'vitest';
import {
  STACK_WINDOW,
  SectionHeights,
  estimateSectionHeight,
  planStackWindow,
  type SectionGeometry,
  type StackWindowState,
} from '@/renderer/features/disk-explorer/components/stack/stackWindow';

const VIEW = 800;

/** `count` sections of `height` px each, stacked from the top; `live` names the mounted ones by index. */
function sections(count: number, height: number, live: number[] = [], extra: Partial<Record<number, Partial<SectionGeometry>>> = {}): SectionGeometry[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `/Vault/Library/daily/${index}.md`,
    top: index * height,
    height,
    folded: false,
    live: live.includes(index),
    pinned: false,
    ...extra[index],
  }));
}

const state = (patch: Partial<StackWindowState> = {}): StackWindowState => ({
  now: 10_000,
  farSince: new Map(),
  fast: false,
  reading: 0,
  ...patch,
});

const name = (path: string) => Number(path.replace(/.*\/(\d+)\.md$/, '$1'));

describe('planStackWindow', () => {
  it('mounts what is in view and one viewport around it, nearest first', () => {
    const plan = planStackWindow({ scrollTop: 2000, viewport: VIEW, sections: sections(20, 400), total: 20 }, state({ reading: 0 }));
    // In view: 5 and 6 (2000-2800). Near: 3 and 4 above, 7 and 8 below. Four reads at a time.
    expect(plan.mount.slice(0, 2).map(name).sort()).toEqual([5, 6]);
    expect(plan.mount.slice(2).map(name).sort()).toEqual([4, 7]);
    const rest = planStackWindow(
      { scrollTop: 2000, viewport: VIEW, sections: sections(20, 400, [4, 5, 6, 7]), total: 20 },
      state({ reading: 0 }),
    );
    expect(rest.mount.map(name).sort()).toEqual([3, 8]);
  });

  it('keeps at most four reads in flight', () => {
    const plan = planStackWindow({ scrollTop: 2000, viewport: VIEW, sections: sections(20, 400), total: 20 }, state({ reading: 3 }));
    expect(plan.mount).toHaveLength(1);
    expect(planStackWindow({ scrollTop: 2000, viewport: VIEW, sections: sections(20, 400), total: 20 }, state({ reading: 4 })).mount).toEqual([]);
  });

  it('mounts only what is in view while scrolling fast', () => {
    const plan = planStackWindow({ scrollTop: 2000, viewport: VIEW, sections: sections(20, 400), total: 20 }, state({ fast: true }));
    expect(plan.mount.map(name).sort()).toEqual([5, 6]);
  });

  it('unmounts a section only after it has been far from the view for two seconds', () => {
    const geometry = { scrollTop: 8000, viewport: VIEW, sections: sections(30, 400, [0, 20]), total: 30 };
    const first = planStackWindow(geometry, state({ now: 1000 }));
    expect(first.unmount).toEqual([]);
    expect([...first.farSince.keys()].map(name)).toEqual([0]);
    const soon = planStackWindow(geometry, state({ now: 2500, farSince: first.farSince }));
    expect(soon.unmount).toEqual([]);
    const later = planStackWindow(geometry, state({ now: 1000 + STACK_WINDOW.unmountAfterMs, farSince: soon.farSince }));
    expect(later.unmount.map(name)).toEqual([0]);
  });

  it('forgets the timer when a section comes back near the view', () => {
    const far = planStackWindow({ scrollTop: 8000, viewport: VIEW, sections: sections(30, 400, [0]), total: 30 }, state({ now: 1000 }));
    const back = planStackWindow({ scrollTop: 0, viewport: VIEW, sections: sections(30, 400, [0]), total: 30 }, state({ now: 2000, farSince: far.farSince }));
    expect(back.farSince.size).toBe(0);
    expect(back.unmount).toEqual([]);
  });

  it('never unmounts a pinned section: focused, unsaved, in conflict, or showing properties', () => {
    const geometry = { scrollTop: 8000, viewport: VIEW, sections: sections(30, 400, [0], { 0: { pinned: true } }), total: 30 };
    const plan = planStackWindow(geometry, state({ now: 99_000, farSince: new Map([['/Vault/Library/daily/0.md', 0]]) }));
    expect(plan.unmount).toEqual([]);
  });

  it('unmounts a folded section at once, and never mounts one', () => {
    const geometry = { scrollTop: 0, viewport: VIEW, sections: sections(4, 300, [0, 1], { 1: { folded: true }, 2: { folded: true } }), total: 4 };
    const plan = planStackWindow(geometry, state());
    expect(plan.unmount.map(name)).toEqual([1]);
    expect(plan.mount.map(name)).not.toContain(2);
  });

  it('keeps at most twelve live editors, dropping the farthest first but never one in view', () => {
    // Twenty short sections all near the view, fifteen already live.
    const live = Array.from({ length: 15 }, (_, index) => index);
    const geometry = { scrollTop: 0, viewport: VIEW, sections: sections(20, 100, live), total: 20 };
    const plan = planStackWindow(geometry, state());
    expect(plan.mount).toEqual([]);
    expect(plan.unmount.map(name).sort((a, b) => a - b)).toEqual([12, 13, 14]);
  });

  it('asks for more pages when the bottom of the view nears the last one loaded', () => {
    const loaded = sections(6, 400);
    expect(planStackWindow({ scrollTop: 0, viewport: VIEW, sections: loaded, total: 30 }, state()).loadMore).toBe(false);
    expect(planStackWindow({ scrollTop: 900, viewport: VIEW, sections: loaded, total: 30 }, state()).loadMore).toBe(true);
    expect(planStackWindow({ scrollTop: 900, viewport: VIEW, sections: loaded, total: 6 }, state()).loadMore).toBe(false);
  });
});

describe('section heights', () => {
  it('estimates from the file size before a section is measured, and remembers what it measured', () => {
    expect(estimateSectionHeight(0)).toBe(120);
    expect(estimateSectionHeight(7500)).toBe(Math.ceil(7500 / 75) * 25.6 + 48);
    const heights = new SectionHeights();
    expect(heights.get('/a.md', 7500)).toBe(estimateSectionHeight(7500));
    heights.set('/a.md', { height: 640, width: 700, mtimeMs: 1, size: 7500 });
    expect(heights.get('/a.md', 9000)).toBe(640);
  });

  it('keeps the 2000 paths measured most recently', () => {
    const heights = new SectionHeights();
    for (let index = 0; index <= 2000; index += 1) heights.set(`/${index}.md`, { height: index, width: 700, mtimeMs: 0, size: 0 });
    expect(heights.has('/0.md')).toBe(false);
    expect(heights.has('/1.md')).toBe(true);
    expect(heights.has('/2000.md')).toBe(true);
  });
});
