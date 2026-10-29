import { useEffect, type RefObject } from 'react';
import { useTabsStore } from '../store/tabsStore';

/** Stops waiting for a page to grow tall enough to restore its scroll. */
const RESTORE_TIMEOUT_MS = 1500;
/** The page scroller sits a few levels inside the viewer. */
const SCROLLER_DEPTH = 6;

/** The element that scrolls the page: the shallowest one that can scroll vertically. */
export function findPageScroller(container: HTMLElement): HTMLElement | null {
  let level: Element[] = [container];
  for (let depth = 0; depth < SCROLLER_DEPTH && level.length > 0; depth += 1) {
    const scrollers = level.filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        ['auto', 'scroll'].includes(getComputedStyle(element).overflowY)
    );
    if (scrollers.length > 0) {
      return scrollers.find((element) => element.scrollHeight > element.clientHeight) ?? scrollers[0];
    }
    level = level.flatMap((element) => [...element.children]);
  }
  return null;
}

/**
 * Keeps each tab's place in a page, as Safari and Obsidian do: the scroll is
 * saved on the history entry when the tab leaves it, and restored once the
 * page under `container` is tall enough. Watching scroll events on the
 * container keeps this independent of which viewer draws the page.
 */
export function useTabScroll(
  container: RefObject<HTMLElement>,
  tabId: string | null,
  index: number,
  /** The page shown; swapping it in place restarts the watch. */
  page: string | null
): void {
  useEffect(() => {
    const element = container.current;
    if (!element || !tabId || !page) return;
    const entry = useTabsStore
      .getState()
      .tabs.find((tab) => tab.id === tabId)?.history[index];
    const target = entry?.scrollTop ?? 0;
    let last = target;
    let restoring = target > 0;
    let frame = 0;
    let scroller: HTMLElement | null = null;
    const started = performance.now();
    const pageScroller = () =>
      scroller?.isConnected ? scroller : (scroller = findPageScroller(element));

    const restore = () => {
      const page = pageScroller();
      const waited = performance.now() - started > RESTORE_TIMEOUT_MS;
      if (page && (page.scrollHeight - page.clientHeight >= target || waited)) {
        page.scrollTop = target;
      } else if (!waited) {
        frame = window.requestAnimationFrame(restore);
        return;
      }
      restoring = false;
    };
    // Reading or typing takes over from a restore still in progress.
    const stop = () => {
      restoring = false;
      window.cancelAnimationFrame(frame);
    };
    const onScroll = (event: Event) => {
      if (restoring || event.target !== pageScroller()) return;
      last = (event.target as HTMLElement).scrollTop;
    };

    if (restoring) frame = window.requestAnimationFrame(restore);
    element.addEventListener('scroll', onScroll, true);
    element.addEventListener('wheel', stop, { passive: true });
    element.addEventListener('pointerdown', stop);
    element.addEventListener('keydown', stop);
    return () => {
      window.cancelAnimationFrame(frame);
      element.removeEventListener('scroll', onScroll, true);
      element.removeEventListener('wheel', stop);
      element.removeEventListener('pointerdown', stop);
      element.removeEventListener('keydown', stop);
      if (!entry) return;
      // Pruning an earlier entry moves this one left; a rename swaps it for a
      // copy in the same place. Find it by identity, then by position.
      const history = useTabsStore.getState().tabs.find((tab) => tab.id === tabId)?.history;
      const at = history?.indexOf(entry) ?? -1;
      useTabsStore.getState().saveScroll(tabId, at === -1 ? index : at, last);
    };
  }, [container, tabId, index, page]);
}
