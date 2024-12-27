import { Theme, THEME_STORAGE_KEY, DEFAULT_THEME } from '../config/themeConfig'

export function applyTheme(theme: Theme) {
  const root = window.document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(theme)
  localStorage.setItem(THEME_STORAGE_KEY, theme)
}

export function getInitialTheme(): Theme {
  if (typeof window !== 'undefined') {
    let theme = localStorage.getItem(THEME_STORAGE_KEY) as Theme;
    console.log('theme after local storage retrieval: ', theme)
    if (!theme) {
      console.log('failed to retrieve theme')
      theme = DEFAULT_THEME
    }
    console.log('retrieved theme: ', theme)
    return theme
  }
  return DEFAULT_THEME
}