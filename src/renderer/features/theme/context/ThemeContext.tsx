import React, { createContext, useEffect, useState } from 'react';
import type { ResolvedTheme, Theme } from '../config/themeConfig';
import {
  applyTheme,
  getInitialTheme,
  resolveTheme,
  subscribeToSystemTheme,
} from '../utils/themeUtils';

type ThemeContextType = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
};

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(theme)
  );

  useEffect(() => {
    setResolvedTheme(applyTheme(theme));
    if (theme !== 'system') return;

    return subscribeToSystemTheme((nextTheme) => {
      setResolvedTheme(applyTheme('system', nextTheme));
    });
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}