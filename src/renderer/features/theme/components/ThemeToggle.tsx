import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/renderer/shared/components/Button';
import type { Theme } from '../config/themeConfig';
import { useTheme } from '../hooks/useTheme';

const NEXT_THEME: Record<Theme, Theme> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
};

const THEME_LABEL: Record<Theme, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === 'system') return <Monitor aria-hidden className="h-4 w-4" />;
  if (theme === 'dark') return <Moon aria-hidden className="h-4 w-4" />;
  return <Sun aria-hidden className="h-4 w-4" />;
}

export function ThemeToggle() {
  const { setTheme, theme } = useTheme();
  const nextTheme = NEXT_THEME[theme];

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 hover:bg-accent/50"
      aria-label={`Theme: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[nextTheme].toLowerCase()} theme`}
      onClick={() => setTheme(nextTheme)}
    >
      <ThemeIcon theme={theme} />
    </Button>
  );
}