import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, ThemeToggle, useTheme } from '@/renderer/features/theme';
import {
  DEFAULT_THEME,
  SYSTEM_THEME_QUERY,
  type ResolvedTheme,
} from '@/renderer/features/theme/config/themeConfig';
import {
  applyTheme,
  getInitialTheme,
  resolveTheme,
} from '@/renderer/features/theme/utils/themeUtils';
import { readPref, writePref } from '@/renderer/shared/prefs/prefs';

function installMatchMedia(initiallyDark: boolean) {
  let matches = initiallyDark;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mediaQueryList = {
    get matches() {
      return matches;
    },
    media: SYSTEM_THEME_QUERY,
    addEventListener: (
      _type: string,
      listener: (event: MediaQueryListEvent) => void
    ) => listeners.add(listener),
    removeEventListener: (
      _type: string,
      listener: (event: MediaQueryListEvent) => void
    ) => listeners.delete(listener),
  } as unknown as MediaQueryList;

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => mediaQueryList),
  });

  return {
    setDark(next: boolean) {
      matches = next;
      const event = { matches, media: SYSTEM_THEME_QUERY } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
}

function ThemeProbe() {
  const { theme, resolvedTheme } = useTheme();
  return <output>{`${theme}:${resolvedTheme}`}</output>;
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.style.colorScheme = '';
  Object.defineProperty(window, 'systemAPI', {
    configurable: true,
    value: { reportTheme: vi.fn() },
  });
  installMatchMedia(false);
});

describe('theme resolution', () => {
  it('keeps explicit themes and resolves system from the OS preference', () => {
    expect(resolveTheme('light', 'dark')).toBe('light');
    expect(resolveTheme('dark', 'light')).toBe('dark');
    expect(resolveTheme('system', 'dark')).toBe('dark');
    expect(resolveTheme('system', 'light')).toBe('light');
  });

  it('defaults to the system preference', () => {
    expect(getInitialTheme()).toBe(DEFAULT_THEME);
  });

  it('reads a valid versioned preference before the legacy key', () => {
    writePref('theme', 'system');
    window.localStorage.setItem('theme', 'dark');

    expect(getInitialTheme()).toBe('system');
    expect(window.localStorage.getItem('theme')).toBeNull();
  });

  it('migrates the old bare theme key into the preference envelope', () => {
    window.localStorage.setItem('theme', 'dark');

    expect(getInitialTheme()).toBe('dark');
    expect(readPref('theme', 'light')).toBe('dark');
    expect(window.localStorage.getItem('theme')).toBeNull();
  });

  it('ignores unknown stored theme values', () => {
    writePref('theme', 'sepia');
    window.localStorage.setItem('theme', 'also-sepia');

    expect(getInitialTheme()).toBe(DEFAULT_THEME);
  });

  it('applies and reports the resolved system theme while storing the preference', () => {
    installMatchMedia(true);

    expect(applyTheme('system')).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');
    expect(document.documentElement).not.toHaveClass('light');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(readPref('theme', 'light')).toBe('system');
    expect(window.systemAPI.reportTheme).toHaveBeenCalledWith({
      preference: 'system',
      resolved: 'dark',
    });
  });

  it('keeps the legacy key when migration storage fails', () => {
    window.localStorage.setItem('theme', 'dark');
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(getInitialTheme()).toBe('dark');
    expect(window.localStorage.getItem('theme')).toBe('dark');
    expect(window.localStorage.getItem('opal.theme')).toBeNull();
  });
});

describe('ThemeProvider', () => {
  it('reacts to OS theme changes while the system preference is active', () => {
    const media = installMatchMedia(false);
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    );

    expect(screen.getByText('system:light')).toBeInTheDocument();

    act(() => media.setDark(true));

    expect(screen.getByText('system:dark')).toBeInTheDocument();
    expect(document.documentElement).toHaveClass('dark');
    expect(window.systemAPI.reportTheme).toHaveBeenLastCalledWith({
      preference: 'system',
      resolved: 'dark',
    });
  });

  it('cycles the visible toggle through system, light, and dark', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeToggle />
        <ThemeProbe />
      </ThemeProvider>
    );

    const toggle = screen.getByRole('button', {
      name: /theme: system\. switch to light theme/i,
    });
    await user.click(toggle);
    expect(screen.getByText('light:light')).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByText('dark:dark')).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByText('system:light')).toBeInTheDocument();
  });

  it('does not follow OS changes after an explicit theme is selected', async () => {
    const media = installMatchMedia(false);
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeToggle />
        <ThemeProbe />
      </ThemeProvider>
    );

    await user.click(
      screen.getByRole('button', {
        name: /theme: system\. switch to light theme/i,
      })
    );

    act(() => media.setDark(true));

    expect(screen.getByText('light:light')).toBeInTheDocument();
  });
});

// Compile-time guard: resolved theme values are the only values sent to main.
const _resolvedThemeContract: ResolvedTheme = 'dark';
void _resolvedThemeContract;
