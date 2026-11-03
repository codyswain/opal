import { useCallback, useEffect, useRef, useState } from 'react';

export interface Size {
  width: number;
  height: number;
}

/**
 * Measures an element with ResizeObserver.
 *
 * The fallback matters: happy-dom reports every element as 0x0 and does not
 * implement ResizeObserver, so without it react-window would render zero rows
 * and every component test would see an empty grid. Falling back to a nominal
 * size keeps the virtualized list testable without mocking react-window.
 */
const FALLBACK: Size = { width: 800, height: 600 };

export function useElementSize<T extends HTMLElement>(): [
  (node: T | null) => void,
  Size
] {
  const [size, setSize] = useState<Size>(FALLBACK);
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    if (!node || typeof ResizeObserver === 'undefined') return;

    observer.current = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.current.observe(node);
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return [ref, size];
}
