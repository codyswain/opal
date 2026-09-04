import {
  DEFAULT_RESOLVED_THEME,
  DEFAULT_THEME,
  LEGACY_THEME_STORAGE_KEY,
  SYSTEM_THEME_QUERY,
  THEME_PREFERENCE_KEY,
  isTheme,
  type ResolvedTheme,
  type Theme,
} from '../config/themeConfig';
import { readPref, writePref } from '@/renderer/shared/prefs/prefs';

function removeLegacyTheme(): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
  } catch {
    // Storage can be disabled. A theme preference is cosmetic.
  }
}

function readLegacyTheme(): Theme | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (isTheme(raw)) return raw;
    if (raw === null) return null;

    const parsed: unknown = JSON.parse(raw);
    return isTheme(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return DEFAULT_RESOLVED_THEME;
  }

  return window.matchMedia(SYSTEM_THEME_QUERY).matches ? 'dark' : 'light';
}

export function resolveTheme(
  theme: Theme,
  systemTheme: ResolvedTheme = getSystemTheme()
): ResolvedTheme {
  return theme === 'system' ? systemTheme : theme;
}

export function applyTheme(
  theme: Theme,
  systemTheme: ResolvedTheme = getSystemTheme()
): ResolvedTheme {
  const resolvedTheme = resolveTheme(theme, systemTheme);
  if (typeof window === 'undefined') return resolvedTheme;

  const root = window.document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(resolvedTheme);
  root.style.colorScheme = resolvedTheme;

  const persisted = writePref(THEME_PREFERENCE_KEY, theme);
  if (persisted) removeLegacyTheme();

  // Main needs both values: explicit themes reuse the resolved hint, while
  // `system` must be resolved against the current OS theme on every launch.
  window.systemAPI?.reportTheme?.({
    preference: theme,
    resolved: resolvedTheme,
  });
  return resolvedTheme;
}

export function getInitialTheme(): Theme {
  const stored = readPref<unknown>(THEME_PREFERENCE_KEY, null);
  if (isTheme(stored)) {
    removeLegacyTheme();
    return stored;
  }

  const legacy = readLegacyTheme();
  if (legacy) {
    if (writePref(THEME_PREFERENCE_KEY, legacy)) removeLegacyTheme();
    return legacy;
  }

  return DEFAULT_THEME;
}

export function subscribeToSystemTheme(
  onChange: (theme: ResolvedTheme) => void
): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }

  const media = window.matchMedia(SYSTEM_THEME_QUERY);
  const handleChange = (event: MediaQueryListEvent) => {
    onChange(event.matches ? 'dark' : 'light');
  };

  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }

  if (typeof media.addListener === 'function') {
    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }

  return () => undefined;
}
