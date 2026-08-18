import { describe, it, expect, beforeEach } from 'vitest';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';

const A = '/V/a.md';
const B = '/V/b.png';
const C = '/V/c.pdf';

beforeEach(() => {
  window.localStorage.clear();
  useTabsStore.setState({ openPaths: [], activePath: null, previewPath: null });
});

const state = () => useTabsStore.getState();

describe('preview tabs', () => {
  it('opens a preview tab and activates it', () => {
    state().openPreview(A);
    expect(state().openPaths).toEqual([A]);
    expect(state().activePath).toBe(A);
    expect(state().previewPath).toBe(A);
  });

  it('replaces the preview tab rather than accumulating tabs', () => {
    state().openPreview(A);
    state().openPreview(B);
    // Single-clicking through a folder must not leave a trail of tabs.
    expect(state().openPaths).toEqual([B]);
    expect(state().previewPath).toBe(B);
  });

  it('keeps a preview tab in place when it is pinned', () => {
    state().openPreview(A);
    state().pin(A);
    state().openPreview(B);
    expect(state().openPaths).toEqual([A, B]);
    expect(state().previewPath).toBe(B);
  });

  it('opens a pinned tab directly without touching the preview slot', () => {
    state().openPreview(A);
    state().openPinned(B);
    expect(state().openPaths).toEqual([A, B]);
    expect(state().previewPath).toBe(A);
    expect(state().activePath).toBe(B);
  });

  it('activates an already-open tab instead of duplicating it', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().openPinned(A);
    expect(state().openPaths).toEqual([A, B]);
    expect(state().activePath).toBe(A);
  });

  it('promotes the preview tab when the same path is opened pinned', () => {
    state().openPreview(A);
    state().openPinned(A);
    expect(state().openPaths).toEqual([A]);
    expect(state().previewPath).toBeNull();
  });
});

describe('closing', () => {
  it('removes a tab', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().close(A);
    expect(state().openPaths).toEqual([B]);
  });

  it('activates the neighbour to the right when the active tab closes', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().openPinned(C);
    state().activate(B);
    state().close(B);
    expect(state().activePath).toBe(C);
  });

  it('activates the neighbour to the left when the last tab closes', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().close(B);
    expect(state().activePath).toBe(A);
  });

  it('leaves nothing active when the final tab closes', () => {
    state().openPinned(A);
    state().close(A);
    expect(state().openPaths).toEqual([]);
    expect(state().activePath).toBeNull();
  });

  it('clears the preview slot when the preview tab closes', () => {
    state().openPreview(A);
    state().close(A);
    expect(state().previewPath).toBeNull();
  });

  it('does not change the active tab when a different tab closes', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().activate(A);
    state().close(B);
    expect(state().activePath).toBe(A);
  });

  it('ignores closing a path that is not open', () => {
    state().openPinned(A);
    state().close('/V/nope.txt');
    expect(state().openPaths).toEqual([A]);
  });

  it('closeAll empties everything', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().closeAll();
    expect(state().openPaths).toEqual([]);
    expect(state().activePath).toBeNull();
    expect(state().previewPath).toBeNull();
  });
});

describe('ordering and selection', () => {
  it('moves a tab to a new index', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().openPinned(C);
    state().move(0, 2);
    expect(state().openPaths).toEqual([B, C, A]);
  });

  it('ignores a move with an out-of-range index', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().move(0, 9);
    expect(state().openPaths).toEqual([A, B]);
  });

  it('activates by index for Cmd+1..9', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().activateIndex(0);
    expect(state().activePath).toBe(A);
  });

  it('ignores an index beyond the open tabs', () => {
    state().openPinned(A);
    state().activate(A);
    state().activateIndex(5);
    expect(state().activePath).toBe(A);
  });

  it('cycles forward and wraps', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().activate(B);
    state().activateNext();
    expect(state().activePath).toBe(A);
  });

  it('cycles backward and wraps', () => {
    state().openPinned(A);
    state().openPinned(B);
    state().activate(A);
    state().activatePrevious();
    expect(state().activePath).toBe(B);
  });

  it('does nothing when cycling with no tabs open', () => {
    state().activateNext();
    expect(state().activePath).toBeNull();
  });
});

describe('persistence', () => {
  it('restores open tabs into a fresh store', () => {
    state().openPinned(A);
    state().openPinned(B);

    const restored = useTabsStore.getState().hydrate();
    expect(restored.openPaths).toEqual([A, B]);
  });

  it('does not persist the preview tab', () => {
    // A preview tab is transient by definition; restoring one on launch would
    // reopen a file the user only glanced at.
    state().openPreview(A);
    const restored = useTabsStore.getState().hydrate();
    expect(restored.openPaths).toEqual([]);
  });
});
