/**
 * Pure geometry for restoring a window position.
 *
 * Deliberately free of any Electron import so it can be unit-tested directly.
 * The caller supplies display work areas; this module only does arithmetic.
 */

export interface SavedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

export interface DisplayArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_WINDOW_WIDTH = 640;
export const MIN_WINDOW_HEIGHT = 480;

/** How much of the window must overlap a display for it to count as reachable. */
const MIN_VISIBLE_PX = 80;

function isFiniteRect(bounds: SavedBounds): boolean {
  return [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite);
}

function overlapArea(bounds: SavedBounds, display: DisplayArea): number {
  const overlapX = Math.min(bounds.x + bounds.width, display.x + display.width)
    - Math.max(bounds.x, display.x);
  const overlapY = Math.min(bounds.y + bounds.height, display.y + display.height)
    - Math.max(bounds.y, display.y);

  if (overlapX <= 0 || overlapY <= 0) return 0;
  return overlapX * overlapY;
}

export function isUsableBounds(
  bounds: SavedBounds | null,
  displays: DisplayArea[]
): boolean {
  if (!bounds) return false;
  if (!isFiniteRect(bounds)) return false;
  if (bounds.width < MIN_WINDOW_WIDTH) return false;
  if (bounds.height < MIN_WINDOW_HEIGHT) return false;
  if (displays.length === 0) return false;

  // The title bar must be on-screen. A window dragged above the top of every
  // display cannot be moved back with the mouse, so restoring one is a trap.
  const titleBarVisible = displays.some(
    (display) => bounds.y >= display.y - 1 && bounds.y < display.y + display.height
  );
  if (!titleBarVisible) return false;

  const visible = displays.reduce(
    (total, display) => total + overlapArea(bounds, display),
    0
  );
  return visible >= MIN_VISIBLE_PX * MIN_VISIBLE_PX;
}

/**
 * Returns bounds to apply, or null to let Electron place the window itself.
 *
 * Returning null rather than a computed centre keeps the fallback identical to
 * a first-ever launch, which is the behaviour a user expects when their saved
 * position has become meaningless.
 */
export function resolveBounds(
  saved: SavedBounds | null,
  displays: DisplayArea[],
  _defaults: { width: number; height: number }
): SavedBounds | null {
  return isUsableBounds(saved, displays) ? saved : null;
}
