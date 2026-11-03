import {
  THEME_PREFERENCES,
  isThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from '@/common/theme';

export const AVAILABLE_THEMES = THEME_PREFERENCES;

export type Theme = ThemePreference;
export type { ResolvedTheme };

export const DEFAULT_THEME: Theme = 'system';
export const DEFAULT_RESOLVED_THEME: ResolvedTheme = 'light';
export const THEME_PREFERENCE_KEY = 'theme';
export const LEGACY_THEME_STORAGE_KEY = 'theme';
export const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)';

export function isTheme(value: unknown): value is Theme {
  return isThemePreference(value);
}