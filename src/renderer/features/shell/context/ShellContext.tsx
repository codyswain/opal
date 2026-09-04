import * as React from 'react';
import {
  matchRoutes,
  useLocation,
  useNavigate,
  type IndexRouteObject,
  type Location,
  type NavigateOptions,
  type NonIndexRouteObject,
  type RouteObject,
  type To,
} from 'react-router-dom';
import {
  toFilesRouterUpdate,
  type FilesNavigationIntent,
} from '@/renderer/features/disk-explorer/navigation/filesLocation';

export interface ShellBreadcrumbDescriptor {
  id: string;
  label: string;
  to?: To;
  onActivate?: () => void;
}

export interface ShellHeaderDescriptor {
  title: string;
  breadcrumbs?: readonly ShellBreadcrumbDescriptor[];
  leadingActions?: React.ReactNode;
  actions?: React.ReactNode;
  tabs?: React.ReactNode;
}

export interface ShellInspectorTabDescriptor {
  id: string;
  label: string;
  content: React.ReactNode;
}

export interface ShellInspectorDescriptor {
  ariaLabel: string;
  tabs: readonly ShellInspectorTabDescriptor[];
  emptyState?: React.ReactNode;
}

export interface ShellRouteDescriptor {
  id: string;
  header: ShellHeaderDescriptor;
  inspector?: ShellInspectorDescriptor;
}

export type ShellRouteDescriptorResolver = (
  location: Location
) => ShellRouteDescriptor;

export interface ShellRouteHandle {
  shell: ShellRouteDescriptor | ShellRouteDescriptorResolver;
}

type ShellIndexRouteObject = Omit<IndexRouteObject, 'handle'> & {
  handle?: ShellRouteHandle;
};

type ShellNonIndexRouteObject = Omit<
  NonIndexRouteObject,
  'children' | 'handle'
> & {
  children?: ShellRouteObject[];
  handle?: ShellRouteHandle;
};

export type ShellRouteObject =
  | ShellIndexRouteObject
  | ShellNonIndexRouteObject;

export function resolveShellRoute(
  routes: readonly ShellRouteObject[],
  location: Location,
  fallback: ShellRouteDescriptor
): ShellRouteDescriptor {
  const matches = matchRoutes(routes as RouteObject[], location);
  for (const match of [...(matches ?? [])].reverse()) {
    const shell = (match.route as ShellRouteObject).handle?.shell;
    if (shell) {
      return typeof shell === 'function' ? shell(location) : shell;
    }
  }
  return fallback;
}

export function resolveInspectorTab(
  descriptor: ShellInspectorDescriptor | undefined,
  requestedTabId: string | null
): ShellInspectorTabDescriptor | null {
  if (!descriptor || descriptor.tabs.length === 0) return null;
  return (
    descriptor.tabs.find((tab) => tab.id === requestedTabId) ??
    descriptor.tabs[0] ??
    null
  );
}

interface ShellContextValue {
  route: ShellRouteDescriptor;
  /** Live React Router location; it is never copied into the shell store. */
  location: ReturnType<typeof useLocation>;
  navigateTo: (to: To, options?: NavigateOptions) => void;
  navigateFiles: (intent: FilesNavigationIntent) => void;
  goBack: () => void;
  goForward: () => void;
}

const ShellContext = React.createContext<ShellContextValue | null>(null);

interface ShellProviderProps {
  routes: readonly ShellRouteObject[];
  fallbackRoute: ShellRouteDescriptor;
  children: React.ReactNode;
}

/**
 * The same route objects can feed `useRoutes` and this provider. Their handles
 * let the stable parent shell read child-route chrome without upward context or
 * effect-based registration.
 */
export function ShellProvider({
  children,
  fallbackRoute,
  routes,
}: ShellProviderProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const route = React.useMemo(
    () => resolveShellRoute(routes, location, fallbackRoute),
    [fallbackRoute, location, routes]
  );

  const navigateTo = React.useCallback(
    (to: To, options?: NavigateOptions) => navigate(to, options),
    [navigate]
  );
  const navigateFiles = React.useCallback(
    (intent: FilesNavigationIntent) => {
      const update = toFilesRouterUpdate(intent);
      if (!update) return;
      navigate(
        { pathname: update.pathname, search: update.search },
        { replace: update.replace }
      );
    },
    [navigate]
  );
  const goBack = React.useCallback(() => navigate(-1), [navigate]);
  const goForward = React.useCallback(() => navigate(1), [navigate]);

  const value = React.useMemo<ShellContextValue>(
    () => ({
      route,
      location,
      navigateTo,
      navigateFiles,
      goBack,
      goForward,
    }),
    [
      goBack,
      goForward,
      location,
      navigateFiles,
      navigateTo,
      route,
    ]
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
