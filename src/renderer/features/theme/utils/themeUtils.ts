import { Theme, THEME_STORAGE_KEY, DEFAULT_THEME } from '../config/themeConfig'

export function applyTheme(theme: Theme) {
  const root = window.document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(theme)
  localStorage.setItem(THEME_STORAGE_KEY, theme)
  // Tell main, so the next launch can paint the right background before the
  // renderer exists.
  window.systemAPI?.reportTheme?.(theme)
}

export function getInitialTheme(): Theme {
  if (typeof window !== 'undefined') {
    const theme = localStorage.getItem(THEME_STORAGE_KEY) as Theme
    return theme || DEFAULT_THEME
  }
  return DEFAULT_THEME
}
