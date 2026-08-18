import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePaneLayout } from '@/renderer/shared/components/panes/usePaneLayout';
import { writePref, readPref } from '@/renderer/shared/prefs/prefs';

beforeEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
});

describe('usePaneLayout', () => {
  it('starts at the defaults when nothing is stored', () => {
    const { result } = renderHook(() => usePaneLayout('files', [20, 55, 25]));
    expect(result.current.sizes).toEqual([20, 55, 25]);
  });

  it('starts at the stored layout on first render', () => {
    writePref('pane.files', [10, 70, 20]);
    const { result } = renderHook(() => usePaneLayout('files', [20, 55, 25]));
    expect(result.current.sizes).toEqual([10, 70, 20]);
  });

  it('falls back when the stored layout has the wrong number of panes', () => {
    // A release that adds a pane must not restore a two-pane layout into three.
    writePref('pane.files', [40, 60]);
    const { result } = renderHook(() => usePaneLayout('files', [20, 55, 25]));
    expect(result.current.sizes).toEqual([20, 55, 25]);
  });

  it('falls back when the stored layout is not an array of numbers', () => {
    writePref('pane.files', ['a', 'b', 'c']);
    const { result } = renderHook(() => usePaneLayout('files', [20, 55, 25]));
    expect(result.current.sizes).toEqual([20, 55, 25]);
  });

  it('persists a layout reported by onLayout', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePaneLayout('files', [20, 55, 25]));

    act(() => result.current.onLayout([15, 60, 25]));
    act(() => { vi.advanceTimersByTime(400); });

    expect(readPref('pane.files', [])).toEqual([15, 60, 25]);
    vi.useRealTimers();
  });

  it('debounces, writing once for a burst of drag events', () => {
    vi.useFakeTimers();
    // happy-dom's localStorage carries its own setItem, so a prototype spy
    // would not see these writes.
    const setItem = vi.spyOn(window.localStorage, 'setItem');
    const { result } = renderHook(() => usePaneLayout('files', [20, 55, 25]));

    act(() => {
      for (let i = 0; i < 20; i += 1) result.current.onLayout([20 + i, 55 - i, 25]);
    });
    act(() => { vi.advanceTimersByTime(400); });

    expect(setItem).toHaveBeenCalledTimes(1);
    setItem.mockRestore();
    vi.useRealTimers();
  });

  it('keeps separate keys independent', () => {
    vi.useFakeTimers();
    const { result: files } = renderHook(() => usePaneLayout('files', [20, 80]));
    act(() => files.current.onLayout([30, 70]));
    act(() => { vi.advanceTimersByTime(400); });

    const { result: explorer } = renderHook(() => usePaneLayout('explorer', [18, 82]));
    expect(explorer.current.sizes).toEqual([18, 82]);
    vi.useRealTimers();
  });
});
