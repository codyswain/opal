export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export const RESOLVED_THEMES = ['light', 'dark'] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = (typeof RESOLVED_THEMES)[number];

export interface ThemeReport {
  preference: ThemePreference;
  resolved: ResolvedTheme;
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}

export function isResolvedTheme(value: unknown): value is ResolvedTheme {
  return RESOLVED_THEMES.includes(value as ResolvedTheme);
}

export function isThemeReport(value: unknown): value is ThemeReport {
  if (typeof value !== 'object' || value === null) return false;
  const report = value as Partial<ThemeReport>;
  return (
    isThemePreference(report.preference) && isResolvedTheme(report.resolved)
  );
}
