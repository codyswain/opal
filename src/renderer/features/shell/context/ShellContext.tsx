import * as React from 'react';
import {
  useLocation,
  useNavigate,
  type NavigateOptions,
  type To,
} from 'react-router-dom';
import {
  FILES_ROUTE_PATH,
  serializeFilesLocation,
  type FilesNavigationIntent,
} from '@/renderer/features/disk-explorer/navigation/filesLocation';
import {
  useTabsStore,
  type OpenOptions,
} from '@/renderer/features/disk-explorer/store/tabsStore';

interface ShellContextValue {
  /** Live React Router location; it is never copied into the shell store. */
  location: ReturnType<typeof useLocation>;
  navigateTo: (to: To, options?: NavigateOptions) => void;
  /**
   * Shows a place in the active tab, or in a new one with `newTab`. The files
   * route mirrors the tab into the URL; from anywhere else this goes there.
   */
  navigateFiles: (
    intent: FilesNavigationIntent,
    options?: Pick<OpenOptions, 'newTab'>
  ) => void;
}

const ShellContext = React.createContext<ShellContextValue | null>(null);

interface ShellProviderProps {
  children: React.ReactNode;
}

export function ShellProvider({ children }: ShellProviderProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = React.useRef(location.pathname);
  pathname.current = location.pathname;

  const navigateTo = React.useCallback(
    (to: To, options?: NavigateOptions) => navigate(to, options),
    [navigate]
  );
  const navigateFiles = React.useCallback(
    (intent: FilesNavigationIntent, options: Pick<OpenOptions, 'newTab'> = {}) => {
      useTabsStore.getState().open(intent.location, { newTab: options.newTab });
      if (pathname.current !== FILES_ROUTE_PATH)
        navigate(
          { pathname: FILES_ROUTE_PATH, search: serializeFilesLocation(intent.location) },
          { replace: true }
        );
    },
    [navigate]
  );

  const value = React.useMemo<ShellContextValue>(
    () => ({ location, navigateTo, navigateFiles }),
    [location, navigateFiles, navigateTo]
  );

  return (
    <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
  );
}

export function useShell(): ShellContextValue {
  const context = React.useContext(ShellContext);
  if (!context) {
    throw new Error('useShell must be used inside ShellProvider');
  }
  return context;
}

export { ShellContext };
export type { ShellContextValue, ShellProviderProps };
