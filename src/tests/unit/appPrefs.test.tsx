import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePref } from '@/renderer/shared/prefs/usePref';
import { writePref } from '@/renderer/shared/prefs/prefs';

beforeEach(() => {
  window.localStorage.clear();
});

describe('usePref', () => {
  it('starts at the fallback when nothing is stored', () => {
    const { result } = renderHook(() => usePref('isLeftSidebarOpen', true));
    expect(result.current[0]).toBe(true);
  });

  it('starts at the stored value on first render, not after an effect', () => {
    writePref('isLeftSidebarOpen', false);
    const { result } = renderHook(() => usePref('isLeftSidebarOpen', true));
    // The old useLocalStorage returned the fallback here and corrected itself
    // in an effect, causing a visible flash of the wrong layout.
    expect(result.current[0]).toBe(false);
  });

  it('persists a write so a fresh hook sees it', () => {
    const { result } = renderHook(() => usePref('isLeftSidebarOpen', true));
    act(() => result.current[1](false));

    const { result: second } = renderHook(() => usePref('isLeftSidebarOpen', true));
    expect(second.current[0]).toBe(false);
  });

  it('keeps separate keys independent', () => {
    const { result: left } = renderHook(() => usePref('isLeftSidebarOpen', true));
    act(() => left.current[1](false));

    const { result: right } = renderHook(() => usePref('isRightSidebarOpen', true));
    expect(right.current[0]).toBe(true);
  });
});
