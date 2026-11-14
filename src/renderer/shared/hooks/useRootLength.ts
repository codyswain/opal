import * as React from 'react';

/**
 * A length token from the document root, such as `--row-height-compact`, in
 * pixels, for code that must know a size the stylesheet sets (a virtual
 * list's row height). It reads again whenever the root's class or attributes
 * change, so a variant or theme that sets other token values is followed at
 * once. `fallback` is used while the token is missing or not a px or rem
 * length, as in tests without the stylesheet.
 */
export function readRootLength(name: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  const root = document.documentElement;
  const value = getComputedStyle(root).getPropertyValue(name).trim();
  const match = /^(-?[\d.]+)(px|rem)$/.exec(value);
  if (!match) return fallback;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return fallback;
  if (match[2] === 'px') return amount;
  const base = Number.parseFloat(getComputedStyle(root).fontSize);
  return amount * (Number.isFinite(base) && base > 0 ? base : 16);
}

export function useRootLength(name: string, fallback: number): number {
  const [length, setLength] = React.useState(() => readRootLength(name, fallback));
  React.useEffect(() => {
    const update = () => setLength(readRootLength(name, fallback));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, [fallback, name]);
  return length;
}
