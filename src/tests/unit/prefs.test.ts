import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readPref, writePref, PREFS_VERSION } from '@/renderer/shared/prefs/prefs';

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readPref', () => {
  it('returns the fallback when nothing is stored', () => {
    expect(readPref('pane.left', 20)).toBe(20);
  });

  it('round-trips a value through writePref', () => {
    writePref('pane.left', 33);
    expect(readPref('pane.left', 20)).toBe(33);
  });

  it('round-trips objects and arrays, not just scalars', () => {
    writePref('tabs.open', ['/a.md', '/b.png']);
    expect(readPref<string[]>('tabs.open', [])).toEqual(['/a.md', '/b.png']);

    writePref('layout', { left: 20, right: 30 });
    expect(readPref('layout', { left: 0, right: 0 })).toEqual({ left: 20, right: 30 });
  });

  it('returns the fallback when the stored version is newer', () => {
    window.localStorage.setItem(
      'opal.pane.left',
      JSON.stringify({ version: PREFS_VERSION + 1, value: 99 })
    );
    expect(readPref('pane.left', 20)).toBe(20);
  });

  it('returns the fallback when the stored version is older', () => {
    window.localStorage.setItem(
      'opal.pane.left',
      JSON.stringify({ version: PREFS_VERSION - 1, value: 99 })
    );
    expect(readPref('pane.left', 20)).toBe(20);
  });

  it('returns the fallback for unparseable JSON rather than throwing', () => {
    window.localStorage.setItem('opal.pane.left', 'not json{{{');
    expect(() => readPref('pane.left', 20)).not.toThrow();
    expect(readPref('pane.left', 20)).toBe(20);
  });

  it('returns the fallback for a value stored without an envelope', () => {
    // Exactly what the old useLocalStorage wrote. Must not be mistaken for valid.
    window.localStorage.setItem('opal.pane.left', '42');
    expect(readPref('pane.left', 20)).toBe(20);
  });

  it('namespaces keys so it cannot collide with other localStorage users', () => {
    writePref('pane.left', 33);
    expect(window.localStorage.getItem('opal.pane.left')).not.toBeNull();
    expect(window.localStorage.getItem('pane.left')).toBeNull();
  });

  it('preserves a stored false, 0, and empty string rather than treating them as absent', () => {
    writePref('a', false);
    writePref('b', 0);
    writePref('c', '');
    expect(readPref('a', true)).toBe(false);
    expect(readPref('b', 5)).toBe(0);
    expect(readPref('c', 'x')).toBe('');
  });
});

describe('writePref', () => {
  it('reports failure without throwing when storage rejects the write', () => {
    // Safari private mode and a full quota both throw from setItem. Losing a
    // pane size must never take down the app.
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(writePref('pane.left', 33)).toBe(false);
  });

  it('reports a successful write', () => {
    expect(writePref('pane.left', 33)).toBe(true);
  });
});
