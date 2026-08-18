import { useCallback, useEffect, useRef, useState } from 'react';
import { readPref, writePref } from '@/renderer/shared/prefs/prefs';

/** Matches the debounce used for window bounds in main. */
const WRITE_DELAY_MS = 400;

function isValidLayout(candidate: unknown, expectedCount: number): candidate is number[] {
  return (
    Array.isArray(candidate) &&
    candidate.length === expectedCount &&
    candidate.every((size) => typeof size === 'number' && Number.isFinite(size))
  );
}

/**
 * Restores a pane layout synchronously on first render and persists changes.
 *
 * The pane count is part of validation: a stored two-pane layout applied to a
 * three-pane group produces a collapsed or overflowing layout that the user
 * cannot easily recover from, so a mismatch falls back to the defaults.
 *
 * Writes are debounced because react-resizable-panels reports a layout on every
 * animation frame of a drag.
 */
export function usePaneLayout(
  key: string,
  defaults: number[]
): { sizes: number[]; onLayout: (sizes: number[]) => void } {
  const prefKey = `pane.${key}`;

  const [sizes] = useState<number[]>(() => {
    const stored = readPref<unknown>(prefKey, null);
    return isValidLayout(stored, defaults.length) ? stored : defaults;
  });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onLayout = useCallback(
    (next: number[]) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => writePref(prefKey, next), WRITE_DELAY_MS);
    },
    [prefKey]
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // `sizes` is only ever the initial layout: react-resizable-panels owns the
  // live values after mount. Returning state here would fight it for control.
  return { sizes, onLayout };
}

/**
 * The restored size for one pane, for use as a Panel's defaultSize.
 * Falls back to the supplied default if the index is out of range.
 */
export function sizesFor(sizes: number[], index: number, fallback: number): number {
  const value = sizes[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
