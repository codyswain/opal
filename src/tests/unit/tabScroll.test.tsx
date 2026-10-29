import React, { useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { findPageScroller, useTabScroll } from '@/renderer/features/disk-explorer/hooks/useTabScroll';
import { selectActiveTab, selectOpenedPath, useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { fileLocation } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { pathMutationCoordinator } from '@/renderer/features/disk-explorer/navigation/pathMutationCoordinator';
import { openTabs, resetTabs, tabId } from '@/tests/helpers/tabs';

/** A page whose scroller is two levels down, sized the way a browser would lay it out. */
function Page() {
  const container = useRef<HTMLDivElement>(null);
  const tab = useTabsStore(selectActiveTab);
  const page = useTabsStore(selectOpenedPath);
  useTabScroll(container, tab?.id ?? null, tab?.index ?? 0, page);
  return (
    <div ref={container}>
      <div>
        <div
          key={page}
          data-testid="scroller"
          style={{ overflowY: 'auto' }}
          ref={(element) => {
            if (!element) return;
            Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 5000 });
            Object.defineProperty(element, 'clientHeight', { configurable: true, value: 600 });
          }}
        />
      </div>
    </div>
  );
}

const frame = () => act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));

beforeEach(() => {
  window.localStorage.clear();
  resetTabs();
});

describe('useTabScroll', () => {
  it('finds the shallowest element that scrolls', () => {
    const container = document.createElement('div');
    container.innerHTML = '<div><div style="overflow-y: auto" id="page"><div style="overflow: auto"></div></div></div>';
    document.body.append(container);
    expect(findPageScroller(container)?.id).toBe('page');
    container.remove();
    expect(findPageScroller(document.createElement('div'))).toBeNull();
  });

  it('saves the scroll when the tab leaves a page and restores it on return', async () => {
    openTabs(['/V/long.md', '/V/other.md']);
    render(<Page />);
    const scroller = screen.getByTestId('scroller');
    scroller.scrollTop = 1500;
    fireEvent.scroll(scroller);

    act(() => useTabsStore.getState().activate(tabId(1)));
    expect(useTabsStore.getState().tabs[0].history[0].scrollTop).toBe(1500);
    await frame();
    expect(screen.getByTestId('scroller').scrollTop).toBe(0);

    act(() => useTabsStore.getState().activate(tabId(0)));
    await frame();
    expect(screen.getByTestId('scroller').scrollTop).toBe(1500);
  });

  it('keeps the place on each history entry, so Back returns to it', async () => {
    openTabs(['/V/long.md']);
    render(<Page />);
    screen.getByTestId('scroller').scrollTop = 900;
    fireEvent.scroll(screen.getByTestId('scroller'));
    act(() => useTabsStore.getState().open(fileLocation('/V/next.md')));
    await frame();
    act(() => useTabsStore.getState().back());
    await frame();
    expect(screen.getByTestId('scroller').scrollTop).toBe(900);
  });

  it('sets a restored place again when the page moves it while it draws', async () => {
    openTabs(['/V/long.md']);
    act(() => useTabsStore.getState().saveView(tabId(0), 0, { scrollTop: 900 }));
    render(<Page />);
    const scroller = screen.getByTestId('scroller');
    await frame();
    expect(scroller.scrollTop).toBe(900);
    // CodeMirror measures the lines above and keeps its anchor, moving the scroll.
    scroller.scrollTop = 1736;
    for (let count = 0; count < 5; count += 1) await frame();
    expect(scroller.scrollTop).toBe(900);
  });

  it('saves onto the page it left when an earlier history entry is removed', async () => {
    openTabs(['/V/a.md']);
    for (const file of ['/V/b.md', '/V/c.md', '/V/d.md']) useTabsStore.getState().open(fileLocation(file));
    useTabsStore.getState().back();
    render(<Page />);
    screen.getByTestId('scroller').scrollTop = 700;
    fireEvent.scroll(screen.getByTestId('scroller'));

    act(() => pathMutationCoordinator.applyExternalRemoval(['/V/a.md']));

    const [tab] = useTabsStore.getState().tabs;
    expect(tab.history.map((entry) => [entry.location.mode === 'focus' && entry.location.file, entry.scrollTop])).toEqual([
      ['/V/b.md', undefined],
      ['/V/c.md', 700],
      ['/V/d.md', undefined],
    ]);
  });

  it('lets the reader take over from a restore that is still waiting', async () => {
    openTabs(['/V/long.md']);
    act(() => useTabsStore.getState().saveView(tabId(0), 0, { scrollTop: 9000 }));
    render(<Page />);
    fireEvent.wheel(screen.getByTestId('scroller'));
    await frame();
    expect(screen.getByTestId('scroller').scrollTop).toBe(0);
  });
});
