export const THEME_STORAGE_KEY = 'theme'
export const DEFAULT_THEME = 'light'
export const AVAILABLE_THEMES = ['light', 'dark'] as const

export type Theme = typeof AVAILABLE_THEMES[number]