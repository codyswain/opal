import { useEffect, type RefObject } from 'react';

/**
 * Marks a scrolling column with data-fade-start and data-fade-end while rows
 * pass under its top or bottom edge, so the CSS can fade that edge, as the
 * tab strip does.
 */
export function useScrollFade(ref: RefObject<HTMLElement>): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      element.toggleAttribute('data-fade-start', element.scrollTop > 0);
      element.toggleAttribute('data-fade-end', element.scrollTop + element.clientHeight < element.scrollHeight - 1);
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    resize?.observe(element);
    const content = typeof MutationObserver === 'undefined' ? null : new MutationObserver(update);
    content?.observe(element, { childList: true, subtree: true });
    return () => {
      element.removeEventListener('scroll', update);
      resize?.disconnect();
      content?.disconnect();
    };
  }, [ref]);
}
