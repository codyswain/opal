/*
 * Which sections of a stack have a live editor. A stack can hold a hundred
 * daily pages, so only the sections in and near the view get a CodeMirror
 * view; the rest are placeholders of a known height. The planner is pure: the
 * stack measures, asks, and applies the answer.
 */

export const STACK_WINDOW = {
  /** Sections this many viewports below the view are mounted too. */
  nearViewports: 1,
  /**
   * Above the view they mount from this far, and still while scrolling up
   * fast, so they are drawn before they come into view.
   */
  aboveViewports: 2,
  /** A live section farther away than this, in viewports... */
  farViewports: 3,
  /** ...for this long is unmounted. */
  unmountAfterMs: 2000,
  /** Live editors at most; sections in view always stay. */
  maxLive: 12,
  /** Scrolling faster than this, in viewports per second, mounts only what is in view. */
  fastViewportsPerSecond: 3,
  /** How long after fast scrolling slows down the rest is mounted. */
  settleAfterFastMs: 120,
  /** More pages load when the bottom of the view comes this close, in viewports, to the last one. */
  loadAheadViewports: 2,
  /** The head and the next five sections start in the page... */
  firstLoad: 6,
  /** ...and ten more load each time. */
  loadStep: 10,
  /** `markdownAPI.read` calls one stack keeps in flight at most. */
  maxReads: 4,
} as const;

export interface SectionGeometry {
  path: string;
  /** Top of the section, in px from the top of the stack's content. */
  top: number;
  height: number;
  folded: boolean;
  live: boolean;
  /** Focused, unsaved, saving, in conflict or error, or showing properties or search. Never unmounted. */
  pinned: boolean;
}

export interface StackGeometry {
  scrollTop: number;
  viewport: number;
  /** The sections in the page, in order. */
  sections: readonly SectionGeometry[];
  /** How many sections the stack has, in the page or not. */
  total: number;
}

export interface StackWindowState {
  now: number;
  /** When each live section went far from the view. */
  farSince: ReadonlyMap<string, number>;
  /** Scrolling faster than `fastViewportsPerSecond`. */
  fast: boolean;
  /** Which way the view last moved; down when it has not. */
  direction?: 'up' | 'down';
  /** Editors still reading their file. */
  reading: number;
}

export interface StackWindowPlan {
  /** Sections to mount, nearest the view first. Mount one per frame. */
  mount: string[];
  unmount: string[];
  /** The page should take in the next sections of the list. */
  loadMore: boolean;
  farSince: Map<string, number>;
}

function distance(section: SectionGeometry, top: number, bottom: number): number {
  const end = section.top + section.height;
  if (end > top && section.top < bottom) return 0;
  return section.top >= bottom ? section.top - bottom : top - end;
}

export function planStackWindow(geometry: StackGeometry, state: StackWindowState): StackWindowPlan {
  const { scrollTop, viewport, sections, total } = geometry;
  const top = scrollTop;
  const bottom = scrollTop + viewport;
  const near = viewport * STACK_WINDOW.nearViewports;
  const far = viewport * STACK_WINDOW.farViewports;
  const farSince = new Map<string, number>();
  const unmount = new Set<string>();
  const away = new Map(sections.map((section) => [section.path, distance(section, top, bottom)]));
  const inView = (section: SectionGeometry) => section.top < bottom && section.top + section.height > top;
  // Sections in view come first, then the rest by how far they are from it.
  const rank = (section: SectionGeometry) => (inView(section) ? -1 : (away.get(section.path) ?? 0));

  for (const section of sections) {
    if (!section.live) continue;
    if (section.folded) {
      unmount.add(section.path);
      continue;
    }
    if ((away.get(section.path) ?? 0) <= far || section.pinned) continue;
    const since = state.farSince.get(section.path) ?? state.now;
    farSince.set(section.path, since);
    if (state.now - since >= STACK_WINDOW.unmountAfterMs) unmount.add(section.path);
  }

  const above = viewport * STACK_WINDOW.aboveViewports;
  const wanted = (section: SectionGeometry) => {
    if (inView(section)) return true;
    const gap = away.get(section.path) ?? 0;
    if (section.top + section.height <= top) return (!state.fast || state.direction === 'up') && gap < above;
    return !state.fast && gap < near;
  };
  const mount = sections
    .filter((section) => !section.live && !section.folded && wanted(section))
    .sort((a, b) => rank(a) - rank(b))
    .map((section) => section.path);

  // Over the limit, the sections farthest from the view go first; those in view and pinned ones stay.
  const after = sections.filter((section) => (section.live && !unmount.has(section.path)) || mount.includes(section.path));
  let excess = after.length - STACK_WINDOW.maxLive;
  if (excess > 0) {
    const eligible = after
      .filter((section) => !section.pinned && !inView(section))
      .sort((a, b) => (away.get(b.path) ?? 0) - (away.get(a.path) ?? 0));
    for (const section of eligible) {
      if (excess <= 0) break;
      if (section.live) unmount.add(section.path);
      else mount.splice(mount.indexOf(section.path), 1);
      excess -= 1;
    }
  }

  // Each read that is still in flight holds back one mount.
  const room = Math.max(0, STACK_WINDOW.maxReads - state.reading);
  const last = sections[sections.length - 1];
  const loadMore =
    sections.length < total &&
    (!last || last.top + last.height < bottom + viewport * STACK_WINDOW.loadAheadViewports);
  return { mount: mount.slice(0, Math.max(room, 0)), unmount: [...unmount], loadMore, farSince };
}

/**
 * A placeholder's height before its section has been measured: 16px type at
 * 1.6 line height and about 75 characters per line in the 700px column.
 */
export function estimateSectionHeight(size: number): number {
  return Math.max(120, Math.ceil(size / 75) * 25.6 + 48);
}

const HEIGHT_LIMIT = 2000;

interface MeasuredHeight {
  height: number;
  width: number;
  mtimeMs: number;
  size: number;
}

/**
 * The last measured body height per path, for placeholders. Kept in memory
 * only, for the 2000 paths measured most recently. A height measured at
 * another column width or file size is still the best estimate until the
 * section measures again.
 */
export class SectionHeights {
  private heights = new Map<string, MeasuredHeight>();

  get(path: string, size: number): number {
    return this.heights.get(path)?.height ?? estimateSectionHeight(size);
  }

  set(path: string, measured: MeasuredHeight): void {
    this.heights.delete(path);
    this.heights.set(path, measured);
    if (this.heights.size > HEIGHT_LIMIT) this.heights.delete(this.heights.keys().next().value as string);
  }

  has(path: string): boolean {
    return this.heights.has(path);
  }
}

export const sectionHeights = new SectionHeights();
