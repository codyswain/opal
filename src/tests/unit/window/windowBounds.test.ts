import { describe, it, expect } from 'vitest';
import {
  isUsableBounds,
  resolveBounds,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  type DisplayArea,
  type SavedBounds,
} from '@/main/window/windowBounds';

const LAPTOP: DisplayArea = { x: 0, y: 0, width: 1440, height: 900 };
const EXTERNAL: DisplayArea = { x: 1440, y: 0, width: 2560, height: 1440 };
const DEFAULTS = { width: 1200, height: 800 };

function bounds(overrides: Partial<SavedBounds> = {}): SavedBounds {
  return { x: 100, y: 100, width: 1000, height: 700, isMaximized: false, ...overrides };
}

describe('isUsableBounds', () => {
  it('rejects null', () => {
    expect(isUsableBounds(null, [LAPTOP])).toBe(false);
  });

  it('accepts a window fully inside a display', () => {
    expect(isUsableBounds(bounds(), [LAPTOP])).toBe(true);
  });

  it('accepts a window on a secondary display', () => {
    expect(isUsableBounds(bounds({ x: 1600, y: 200 }), [LAPTOP, EXTERNAL])).toBe(true);
  });

  it('rejects a window on a display that is no longer connected', () => {
    // Saved on the external monitor; now only the laptop is present.
    expect(isUsableBounds(bounds({ x: 1600, y: 200 }), [LAPTOP])).toBe(false);
  });

  it('accepts a window that straddles two displays', () => {
    expect(isUsableBounds(bounds({ x: 1200, y: 100 }), [LAPTOP, EXTERNAL])).toBe(true);
  });

  it('rejects a window whose title bar is above every display', () => {
    // Dragged-off-the-top is unrecoverable by mouse: there is no title bar to grab.
    expect(isUsableBounds(bounds({ y: -400 }), [LAPTOP])).toBe(false);
  });

  it('rejects a window smaller than the minimum', () => {
    expect(isUsableBounds(bounds({ width: MIN_WINDOW_WIDTH - 1 }), [LAPTOP])).toBe(false);
    expect(isUsableBounds(bounds({ height: MIN_WINDOW_HEIGHT - 1 }), [LAPTOP])).toBe(false);
  });

  it('rejects non-finite numbers from a corrupted store', () => {
    expect(isUsableBounds(bounds({ x: NaN }), [LAPTOP])).toBe(false);
    expect(isUsableBounds(bounds({ width: Infinity }), [LAPTOP])).toBe(false);
  });

  it('rejects everything when no displays are reported', () => {
    expect(isUsableBounds(bounds(), [])).toBe(false);
  });
});

describe('resolveBounds', () => {
  it('returns null when there is nothing saved, letting Electron centre the window', () => {
    expect(resolveBounds(null, [LAPTOP], DEFAULTS)).toBeNull();
  });

  it('returns null when the saved bounds are unusable', () => {
    expect(resolveBounds(bounds({ x: 1600 }), [LAPTOP], DEFAULTS)).toBeNull();
  });

  it('returns the saved bounds when they are usable', () => {
    const saved = bounds();
    expect(resolveBounds(saved, [LAPTOP], DEFAULTS)).toEqual(saved);
  });

  it('preserves the maximized flag', () => {
    const saved = bounds({ isMaximized: true });
    expect(resolveBounds(saved, [LAPTOP], DEFAULTS)?.isMaximized).toBe(true);
  });
});
