/*
 * Scrollbars show only while they are in use. Every scroll area in Opal has
 * no thumb at rest. A scroll marks the scrolled element with
 * data-scrollbar="shown", and so does the pointer on that element's
 * scrollbar; about a second after the last scroll, once the pointer is off
 * the scrollbar, the mark turns to "hidden" and the thumb fades out. The CSS
 * in styles/index.css paints the thumb from the mark. Scrolling itself stays
 * native: this only listens.
 */

export const SCROLLBAR_ATTRIBUTE = 'data-scrollbar';
/** How long the thumb stays after the last scroll event. */
export const SCROLLBAR_HIDE_AFTER_MS = 1000;

/** A side's border width in pixels, read only for elements that have room beside their client box. */
function border(element: Element, side: 'borderRightWidth' | 'borderBottomWidth'): number {
  const view = element.ownerDocument.defaultView;
  return view ? Number.parseFloat(view.getComputedStyle(element)[side]) || 0 : 0;
}

/** Whether the point is on the element's own vertical or horizontal scrollbar. */
export function isOnScrollbar(element: Element, x: number, y: number): boolean {
  const box = element as HTMLElement;
  const rect = element.getBoundingClientRect();
  if (box.offsetWidth - box.clientLeft - box.clientWidth > 0) {
    const start = rect.left + box.clientLeft + box.clientWidth;
    const end = rect.right - border(element, 'borderRightWidth');
    if (x >= start && x < end && y >= rect.top && y < rect.bottom) return true;
  }
  if (box.offsetHeight - box.clientTop - box.clientHeight > 0) {
    const start = rect.top + box.clientTop + box.clientHeight;
    const end = rect.bottom - border(element, 'borderBottomWidth');
    if (y >= start && y < end && x >= rect.left && x < rect.right) return true;
  }
  return false;
}

/**
 * Starts marking scroll areas in `doc` and returns the function that stops.
 * The listeners are passive and on the document, so they reach every scroll
 * area, including menus and dialogs in portals.
 */
export function installScrollbarVisibility(doc: Document = document, hideAfter = SCROLLBAR_HIDE_AFTER_MS): () => void {
  const view = doc.defaultView;
  if (!view) return () => undefined;
  const timers = new Map<Element, number>();
  let hovered: Element | null = null;

  const show = (element: Element) => {
    const timer = timers.get(element);
    if (timer !== undefined) view.clearTimeout(timer);
    timers.delete(element);
    if (element.getAttribute(SCROLLBAR_ATTRIBUTE) !== 'shown') element.setAttribute(SCROLLBAR_ATTRIBUTE, 'shown');
  };
  const hideLater = (element: Element) => {
    const timer = timers.get(element);
    if (timer !== undefined) view.clearTimeout(timer);
    timers.set(
      element,
      view.setTimeout(() => {
        timers.delete(element);
        if (element !== hovered && element.isConnected) element.setAttribute(SCROLLBAR_ATTRIBUTE, 'hidden');
      }, hideAfter),
    );
  };
  const hover = (element: Element | null) => {
    if (element === hovered) return;
    const left = hovered;
    hovered = element;
    if (left) hideLater(left);
    if (element) show(element);
  };

  const onScroll = (event: Event) => {
    const element = event.target instanceof view.Element ? event.target : doc.scrollingElement;
    if (!element) return;
    show(element);
    if (element !== hovered) hideLater(element);
  };
  const onPointerMove = (event: PointerEvent) => {
    const target = event.target instanceof view.Element ? event.target : null;
    hover(target && isOnScrollbar(target, event.clientX, event.clientY) ? target : null);
  };
  const onPointerOut = (event: PointerEvent) => {
    if (!event.relatedTarget) hover(null);
  };

  doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
  doc.addEventListener('pointermove', onPointerMove, { passive: true });
  doc.addEventListener('pointerout', onPointerOut, { passive: true });
  return () => {
    doc.removeEventListener('scroll', onScroll, { capture: true });
    doc.removeEventListener('pointermove', onPointerMove);
    doc.removeEventListener('pointerout', onPointerOut);
    for (const timer of timers.values()) view.clearTimeout(timer);
    timers.clear();
  };
}
