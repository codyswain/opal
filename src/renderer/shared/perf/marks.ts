/**
 * Performance budgets and the marks that measure them.
 *
 * The numbers come from the design doc and are not to be relaxed to make a
 * failing test pass — a missed budget means the code got slower, which is the
 * signal this file exists to produce.
 */
export const BUDGETS = {
  /** App launch to the first meaningful paint. */
  coldLaunchMs: 400,
  /** Switching between /files and /explorer. */
  routeSwitchMs: 50,
  /** Sorting and rendering a 5,000-entry directory listing. */
  listingMs: 150,
  /** One keystroke in a filter or search box — one 60fps frame. */
  keystrokeMs: 16,
} as const;

const supported = typeof performance !== 'undefined' && typeof performance.mark === 'function';

export function mark(name: string): void {
  if (!supported) return;
  try {
    performance.mark(name);
  } catch {
    // Marking must never be able to break a render.
  }
}

/**
 * Milliseconds between two marks, or null if either is missing.
 * Reading this in DevTools is the intended use; the budget test measures the
 * pure functions directly, which is far less noisy than measuring a render.
 */
export function measure(name: string, from: string, to: string): number | null {
  if (!supported) return null;
  try {
    performance.measure(name, from, to);
    const entries = performance.getEntriesByName(name, 'measure');
    const latest = entries[entries.length - 1];
    return latest ? latest.duration : null;
  } catch {
    return null;
  }
}
